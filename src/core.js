export const DEFAULT_SETTINGS = Object.freeze({ duration: 30, fit: 'contain', transition: 'fade', captions: true, shuffle: false });
export const MAX_WORKS = 150;
export const MAX_CATALOG_WORKS = 300;
export const HOUR_MIX_SIZE = 120;
export function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
export function cleanWork(work) {
  if (!work || typeof work !== 'object' || work.kind !== 'video') return null;
  const mediaUrl = safeUrl(work.mediaUrl);
  if (!mediaUrl || /\.(?:jpg|jpeg|png|gif|svg|html?)(?:$|[?#])/i.test(mediaUrl)) return null;
  if (typeof work.id !== 'string' || !work.id || work.id.length > 240) return null;
  if (typeof work.title !== 'string' || !work.title.trim() || typeof work.artist !== 'string' || !work.artist.trim()) return null;
  const width = Number(work.width) > 0 ? Number(work.width) : null;
  const height = Number(work.height) > 0 ? Number(work.height) : null;
  return {
    id: work.id, title: work.title.trim().slice(0, 160), artist: work.artist.trim().slice(0, 160),
    artistKey: typeof work.artistKey === 'string' ? work.artistKey.slice(0, 240) : work.artist.toLocaleLowerCase().trim(),
    kind: 'video', source: ['objkt', 'Verse'].includes(work.source) ? work.source : 'Your links',
    sourceUrl: safeUrl(work.sourceUrl), mediaUrl, alternateMediaUrl: safeUrl(work.alternateMediaUrl),
    posterUrl: safeUrl(work.posterUrl), width, height,
    orientation: width && height ? (width / height > 1.08 ? 'landscape' : width / height < 0.92 ? 'portrait' : 'square') : (['landscape', 'portrait', 'square'].includes(work.orientation) ? work.orientation : 'unknown'),
    year: String(work.year || '').slice(0, 4), description: String(work.description || '').slice(0, 1000),
    verifiedAt: typeof work.verifiedAt === 'string' ? work.verifiedAt : null,
  };
}
export function cleanSettings(settings = {}) {
  return { duration: [10, 20, 30, 60, 120].includes(Number(settings?.duration)) ? Number(settings.duration) : 30,
    fit: settings?.fit === 'cover' ? 'cover' : 'contain', transition: settings?.transition === 'none' ? 'none' : 'fade',
    captions: settings?.captions !== false, shuffle: settings?.shuffle === true };
}
export function filterWorks(works, { search = '', source = 'all', shape = 'all' } = {}) {
  const q = search.normalize('NFKC').toLocaleLowerCase().trim();
  return works.filter(work => (source === 'all' || work.source === source) && (shape === 'all' || (shape === 'screen-portrait' ? isPortraitScreenWork(work) : work.orientation === shape)) && (!q || `${work.title} ${work.artist}`.normalize('NFKC').toLocaleLowerCase().includes(q)));
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
  return { works, settings: cleanSettings(input.settings) };
}
export function makeExhibition(works, settings) {
  return { format: 'artdrops-exhibition', version: 1, exportedAt: new Date().toISOString(), settings: cleanSettings(settings), works: uniqueWorks(works) };
}
export function makeHourMix(works, settings) {
  const selected = uniqueWorks(works).slice(0, HOUR_MIX_SIZE);
  if (selected.length < HOUR_MIX_SIZE) return null;
  return { works: selected, settings: cleanSettings({ ...settings, duration: 30, shuffle: true }) };
}
export function portraitCoverage(work) {
  if (!work) return 0;
  const width = Number(work.width), height = Number(work.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 0;
  const ratio = (width / height) / (9 / 16);
  return Math.min(ratio, 1 / ratio);
}
export function isPortraitScreenWork(work) {
  return Boolean(work && work.width >= 1080 && work.height >= 1920 && portraitCoverage(work) + 1e-9 >= 0.9);
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
