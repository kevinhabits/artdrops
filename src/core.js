export const DEFAULT_SETTINGS = Object.freeze({ duration: 30, fit: 'contain', transition: 'fade', captions: true, shuffle: false });
export const MAX_WORKS = 150;
export const MAX_CATALOG_WORKS = 5000;
export const HOUR_MIX_SIZE = 120;
export const MAX_EXHIBITION_BYTES = 2_000_000;
export function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
export function cleanWork(work) {
  if (!work || typeof work !== 'object' || !['video', 'image'].includes(work.kind)) return null;
  const mediaUrl = safeUrl(work.mediaUrl);
  if (!mediaUrl || /\.(?:svg|html?|js|pdf)(?:$|[?#])/i.test(mediaUrl)) return null;
  if (work.kind === 'video' && /\.(?:jpe?g|png|gif|webp|avif)(?:$|[?#])/i.test(mediaUrl)) return null;
  if (work.kind === 'image' && /\.(?:mp4|webm|mov)(?:$|[?#])/i.test(mediaUrl)) return null;
  if (typeof work.id !== 'string' || !work.id || work.id.length > 240) return null;
  if (typeof work.title !== 'string' || !work.title.trim() || typeof work.artist !== 'string' || !work.artist.trim()) return null;
  const width = Number.isFinite(Number(work.width)) && Number(work.width) > 0 ? Number(work.width) : null;
  const height = Number.isFinite(Number(work.height)) && Number(work.height) > 0 ? Number(work.height) : null;
  const rotation = [0, 90, 180, 270].includes(Number(work.rotation)) ? Number(work.rotation) : 0;
  const dimensions = displayDimensions({ width, height, rotation });
  return {
    id: work.id, title: work.title.trim().slice(0, 160), artist: work.artist.trim().slice(0, 160),
    artistKey: typeof work.artistKey === 'string' ? work.artistKey.slice(0, 240) : work.artist.toLocaleLowerCase().trim(),
    kind: work.kind, source: ['objkt', 'Verse', 'SuperRare', 'Orkhan', 'Google Drive', 'Reddit'].includes(work.source) ? work.source : 'Your links',
    collection: typeof work.collection === 'string' ? work.collection.trim().slice(0, 160) : '',
    animated: work.kind === 'image' && work.animated === true, rotation,
    sourceUrl: safeUrl(work.sourceUrl), mediaUrl, alternateMediaUrl: safeUrl(work.alternateMediaUrl),
    posterUrl: safeUrl(work.posterUrl), width, height,
    orientation: width && height ? (dimensions.width / dimensions.height > 1.08 ? 'landscape' : dimensions.width / dimensions.height < 0.92 ? 'portrait' : 'square') : (['landscape', 'portrait', 'square'].includes(work.orientation) ? work.orientation : 'unknown'),
    year: String(work.year || '').slice(0, 4), description: String(work.description || '').slice(0, 1000),
    verifiedAt: typeof work.verifiedAt === 'string' ? work.verifiedAt : null,
  };
}
export function cleanSettings(settings = {}) {
  return { duration: [10, 20, 30, 60, 120].includes(Number(settings?.duration)) ? Number(settings.duration) : 30,
    fit: settings?.fit === 'cover' ? 'cover' : 'contain', transition: settings?.transition === 'none' ? 'none' : 'fade',
    captions: settings?.captions !== false, shuffle: settings?.shuffle === true };
}
export function filterWorks(works, { search = '', source = 'all', shape = 'all', collection = 'all', media = 'all' } = {}) {
  const q = search.normalize('NFKC').toLocaleLowerCase().trim();
  return works.filter(work => (source === 'all' || work.source === source)
    && (collection === 'all' || work.collection === collection)
    && (media === 'all' || (media === 'moving' ? work.kind === 'video' || work.animated : work.kind === 'image' && !work.animated))
    && (shape === 'all' || (shape === 'screen-portrait' ? isPortraitScreenWork(work) : work.orientation === shape))
    && (!q || `${work.title} ${work.artist} ${work.collection || ''}`.normalize('NFKC').toLocaleLowerCase().includes(q)));
}
export function displayDimensions(work) {
  return [90, 270].includes(Number(work?.rotation)) ? { width: work.height, height: work.width } : { width: work?.width, height: work?.height };
}
export function moveItem(items, index, offset) {
  const next = [...items]; const target = index + offset;
  if (index < 0 || index >= next.length || target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
export function uniqueWorks(works, limit = MAX_WORKS) {
  const seen = new Set();
  return works.map(cleanWork).filter(work => work && !seen.has(work.id) && seen.add(work.id)).slice(0, limit);
}
export function rememberCustomWork(custom, work, queue) {
  const selected = new Set(queue.map(item => item.id));
  return uniqueWorks([work, ...custom.filter(item => selected.has(item.id)), ...custom.filter(item => !selected.has(item.id))]);
}
export function readExhibition(input) {
  if (!input || input.format !== 'artdrops-exhibition' || input.version !== 1 || !Array.isArray(input.works) || input.works.length > MAX_WORKS) throw new Error('Choose an ArtDrops exhibition JSON file with up to 150 works.');
  const works = uniqueWorks(input.works);
  if (works.length !== input.works.length) throw new Error('This file contains invalid or duplicate artworks. Your exhibition was not changed.');
  const name = exhibitionName(input.name);
  return { works, settings: cleanSettings(input.settings), ...(name ? { name } : {}) };
}
function exhibitionName(value) {
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string') throw new Error('The playlist name must be text.');
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length > 80) throw new Error('Use a playlist name of 80 characters or fewer.');
  return name;
}
export function makeExhibition(works, settings, name) {
  const snapshot = readExhibition({ format: 'artdrops-exhibition', version: 1, works, settings, name });
  return { format: 'artdrops-exhibition', version: 1, exportedAt: new Date().toISOString(), ...snapshot };
}
export function serializeExhibition(works, settings, name) {
  const text = JSON.stringify(makeExhibition(works, settings, name));
  if (new TextEncoder().encode(text).length > MAX_EXHIBITION_BYTES) throw new Error('This exhibition exceeds the 2 MB JSON limit. Remove some works or shorten custom links.');
  return text;
}
export function parseExhibition(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_EXHIBITION_BYTES) throw new Error('Choose an ArtDrops JSON file no larger than 2 MB.');
  const imported = readExhibition(JSON.parse(text.replace(/^\uFEFF/, '')));
  // An accepted import must also fit in its normalized export form.
  serializeExhibition(imported.works, imported.settings, imported.name);
  return imported;
}
export function exhibitionFilename(name) {
  const slug = String(name || 'exhibition').normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60);
  return `artdrops-${slug || 'exhibition'}.json`;
}
export function makeHourMix(works, settings) {
  const selected = uniqueWorks(works).slice(0, HOUR_MIX_SIZE);
  if (selected.length < HOUR_MIX_SIZE) return null;
  return { works: selected, settings: cleanSettings({ ...settings, duration: 30, shuffle: true }) };
}
export function portraitCoverage(work) {
  if (!work) return 0;
  const dimensions = displayDimensions(work);
  const width = Number(dimensions.width), height = Number(dimensions.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 0;
  const ratio = (width / height) / (9 / 16);
  return Math.min(ratio, 1 / ratio);
}
export function isPortraitScreenWork(work) {
  const { width, height } = displayDimensions(work);
  return Boolean(work && width >= 1080 && height >= 1920 && portraitCoverage(work) + 1e-9 >= 0.9);
}
export function portraitScreenWorks(works) {
  return uniqueWorks(works, MAX_CATALOG_WORKS).filter(isPortraitScreenWork).sort((a, b) =>
    portraitCoverage(b) - portraitCoverage(a) || b.width * b.height - a.width * a.height);
}
export function makePortraitMix(works, settings) {
  const candidates = portraitScreenWorks(works);
  const count = candidates.length >= 60 ? 60 : 30;
  if (candidates.length < count) return null;
  return { works: candidates.slice(0, count), settings: cleanSettings({ ...settings, duration: 3600 / count, shuffle: true, fit: 'contain' }) };
}
export function durationLabel(count, seconds) {
  const total = count * seconds;
  if (total < 60) return `${total} sec loop`;
  if (total >= 3600) {
    const hours = Math.floor(total / 3600), minutes = Number(((total % 3600) / 60).toFixed(1));
    return `${hours} hr${minutes ? ` ${minutes} min` : ''} loop`;
  }
  return `${Number((total / 60).toFixed(1))} min loop`;
}
