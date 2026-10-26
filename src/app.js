import { ExhibitionPlayer } from './player.js';
import { DEFAULT_SETTINGS, MAX_WORKS, MAX_CATALOG_WORKS, MAX_EXHIBITION_BYTES, cleanWork, cleanSettings, uniqueWorks, rememberCustomWork, filterWorks, moveItem, makeExhibition, makeHourMix, makePortraitMix, portraitScreenWorks, isPortraitScreenWork, displayDimensions, readExhibition, parseExhibition, serializeExhibition, exhibitionFilename, durationLabel, safeUrl } from './core.js';
import { PLAYLISTS_KEY, normalizePlaylistName, listPlaylists, savePlaylist, deletePlaylist, restorePlaylist, withPlaylistLock } from './playlists.js';

const $ = (selector) => document.querySelector(selector);
const STORAGE_KEY = 'artdrops:exhibition:v1';
const PAGE_SIZE = 12;
let catalog = [], custom = [], queue = [], settings = { ...DEFAULT_SETTINGS };
let loaded = false, saved = false, visibleCount = PAGE_SIZE, toastTimer, undoAction, importController;
let previewObserver, lastFocus, activeShow = false;
let playlistName = '', pendingReplace = null, importRevision = 0, workingRevision = 0;
const observed = new Set();
const inView = new Set();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function notify(message, undo) {
  clearTimeout(toastTimer);
  $('#toast-message').textContent = message;
  undoAction = undo;
  $('#toast-undo').hidden = !undo;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; undoAction = undefined; }, undo ? 12000 : 6500);
}
$('#toast-close').addEventListener('click', () => { $('#toast').hidden = true; });
$('#toast-undo').addEventListener('click', async () => { const undo = undoAction; undoAction = undefined; $('#toast').hidden = true; await undo?.(); });

try {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    const stored = JSON.parse(raw);
    const restored = readExhibition(stored);
    queue = restored.works;
    settings = restored.settings;
    playlistName = restored.name || '';
    custom = uniqueWorks(Array.isArray(stored.custom) ? stored.custom : []);
    saved = true;
  }
} catch { notify('Saved data couldn’t be read. The starter exhibition will be available when the collection loads.'); }

function persist() {
  workingRevision++;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...makeExhibition(queue, settings, playlistName), custom }));
    saved = true;
    $('#save-note').textContent = '✓ Saved on this browser';
    return true;
  } catch {
    $('#save-note').textContent = 'Not saved · export a backup';
    notify('Browser storage is unavailable. Export your exhibition to keep a copy.');
    return false;
  }
}
function allWorks() {
  const known = new Set(catalog.map(work => work.id));
  return [...catalog, ...custom.filter(work => !known.has(work.id))];
}
function currentFilters() { return { search: $('#search').value, source: $('#source-filter').value, shape: $('#shape-filter').value, collection: $('#collection-filter').value, media: $('#media-filter').value }; }
function syncSources() {
  const select = $('#source-filter'), selected = select.value;
  select.replaceChildren(new Option('All sources', 'all'));
  const sources = [...new Set(allWorks().map(work => work.source))];
  sources.forEach(source => select.append(new Option(source, source)));
  select.value = sources.includes(selected) ? selected : 'all';
  select.hidden = sources.length < 2;
  const collectionSelect = $('#collection-filter'), currentCollection = collectionSelect.value;
  const counts = new Map();
  allWorks().forEach(work => { if (work.collection) counts.set(work.collection, (counts.get(work.collection) || 0) + 1); });
  collectionSelect.replaceChildren(new Option('All collections', 'all'));
  [...counts].sort(([a], [b]) => a.localeCompare(b)).forEach(([name, count]) => collectionSelect.append(new Option(`${name} · ${count}`, name)));
  collectionSelect.value = counts.has(currentCollection) ? currentCollection : 'all';
}

function stopPreviews() { observed.forEach(video => video.pause()); }
function syncPreviews() {
  let playing = 0;
  for (const video of observed) {
    const shouldPlay = !activeShow && !document.hidden && !reducedMotion.matches && inView.has(video) && playing < 4;
    if (shouldPlay) {
      playing++;
      if (!video.src && video.dataset.src) { video.src = video.dataset.src; video.load(); }
      if (video.paused) video.play().catch(() => {});
    } else video.pause();
  }
}
function watchVideo(video) {
  observed.add(video);
  if (!previewObserver) previewObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) inView.add(entry.target); else inView.delete(entry.target);
    }
    syncPreviews();
  }, { threshold: .15 });
  previewObserver.observe(video);
}
function unloadVideo(video) {
  video.pause(); previewObserver?.unobserve(video); observed.delete(video); inView.delete(video);
  video.removeAttribute('src'); video.load();
}
function previewVideo(work, container) {
  if (work.kind === 'image') {
    const image = element('img', 'art-preview-image');
    image.src = work.posterUrl || work.mediaUrl; image.alt = ''; image.loading = 'lazy'; image.decoding = 'async';
    const fallbacks = [...new Set([work.mediaUrl, work.alternateMediaUrl].filter(Boolean))].filter(url => url !== image.src);
    image.addEventListener('error', () => {
      if (fallbacks.length) image.src = fallbacks.shift();
      else if (!container.querySelector('.media-error')) container.append(element('div', 'media-error', 'Preview unavailable'));
    });
    container.append(image); rotatePreview(image, work, container);
    return image;
  }
  const video = element('video');
  video.muted = true; video.defaultMuted = true; video.loop = true; video.playsInline = true;
  video.preload = 'none'; video.setAttribute('aria-hidden', 'true');
  video.dataset.src = work.mediaUrl;
  if (work.posterUrl) video.poster = work.posterUrl;
  let triedAlternate = false;
  video.addEventListener('error', () => {
    if (work.alternateMediaUrl && !triedAlternate) {
      triedAlternate = true; video.src = work.alternateMediaUrl; video.load();
      if (!activeShow && inView.has(video)) video.play().catch(() => {});
      return;
    }
    if (!container.querySelector('.media-error')) {
      const error = element('div', 'media-error', 'Preview unavailable');
      error.append(element('small', '', 'Open the artwork to try again'));
      container.append(error);
    }
  });
  container.append(video); rotatePreview(video, work, container); watchVideo(video);
  return video;
}

const rotatedPreviews = new Map();
const rotationObserver = new ResizeObserver(entries => {
  for (const entry of entries) {
    const media = rotatedPreviews.get(entry.target);
    if (media) { media.style.width = `${entry.contentRect.height}px`; media.style.height = `${entry.contentRect.width}px`; }
  }
});
function rotatePreview(media, work, container) {
  if (!work.rotation) return;
  media.style.transform = `translate(-50%, -50%) rotate(${work.rotation}deg)`;
  media.style.left = '50%'; media.style.top = '50%';
  if ([90, 270].includes(work.rotation)) { rotatedPreviews.set(container, media); rotationObserver.observe(container); }
}
function clearRotatedPreviews(host) {
  for (const [container] of rotatedPreviews) if (container === host || host.contains(container)) { rotationObserver.unobserve(container); rotatedPreviews.delete(container); }
}

const player = new ExhibitionPlayer({
  onClose: () => { activeShow = false; syncPreviews(); if (lastFocus?.isConnected) lastFocus.focus({ preventScroll: true }); },
  onStatus: message => { /* Player shows failures inside its modal. */ },
});
function play(works) {
  if (!works.length) { notify('Add an artwork to your exhibition first.'); return; }
  lastFocus = document.activeElement;
  activeShow = true; stopPreviews();
  try { player.open(works, settings); }
  catch (error) {
    player.close();
    activeShow = false; syncPreviews();
    console.error('Exhibition could not start:', error);
    notify('The exhibition could not start. Reload the page and try again in an up-to-date browser.');
  }
}
$('#hero-play').addEventListener('click', () => play(queue));
$('#start-show').addEventListener('click', () => play(queue));

function updateSelectionButtons() {
  const ids = new Set(queue.map(work => work.id));
  document.querySelectorAll('.add-button').forEach(button => {
    const selected = ids.has(button.dataset.id);
    button.setAttribute('aria-pressed', String(selected));
    button.textContent = selected ? '✓' : '+';
    button.setAttribute('aria-label', `${selected ? 'Remove' : 'Add'} ${button.dataset.title} ${selected ? 'from' : 'to'} exhibition`);
  });
  const addCollection = $('#add-filtered');
  const available = filterWorks(allWorks(), currentFilters()).filter(work => !ids.has(work.id)).length;
  const count = Math.min(available, MAX_WORKS - queue.length);
  addCollection.hidden = $('#collection-filter').value === 'all';
  addCollection.disabled = count === 0;
  addCollection.textContent = count ? `Add ${count} ${count === 1 ? 'work' : 'works'}` : available ? 'Exhibition full' : 'Already added';
}
$('#add-filtered').addEventListener('click', () => {
  const previous = queue, ids = new Set(queue.map(work => work.id));
  const available = filterWorks(allWorks(), currentFilters()).filter(work => !ids.has(work.id));
  const selected = available.slice(0, MAX_WORKS - queue.length);
  if (!selected.length) return;
  queue = [...queue, ...selected]; updateQueue(); persist();
  notify(`Added ${selected.length} works.${available.length > selected.length ? ` The exhibition limit is ${MAX_WORKS}; the rest remain in the library.` : ''}`, () => { queue = previous; updateQueue(); persist(); });
});
function toggleWork(work) {
  const index = queue.findIndex(item => item.id === work.id);
  if (index >= 0) { removeWork(index); return; }
  if (queue.length >= MAX_WORKS) { notify(`An exhibition can hold up to ${MAX_WORKS} works.`); return; }
  queue = [...queue, work]; updateQueue(); persist();
  notify(`Added “${work.title}” to your exhibition.`);
}
function removeWork(index) {
  const previous = [...queue], work = queue[index];
  if (!work) return;
  queue = queue.filter((_, i) => i !== index); updateQueue(); persist();
  notify(`Removed “${work.title}”.`, () => { queue = previous; updateQueue(); persist(); });
}
function renderFeatured() {
  const host = $('#featured');
  clearRotatedPreviews(host);
  host.querySelectorAll('video').forEach(unloadVideo); host.replaceChildren();
  if (!catalog.length) return;
  const work = catalog[0];
  previewVideo(work, host);
  const overlay = element('div', 'featured-overlay');
  const top = element('div', 'featured-top');
  top.append(element('span', 'feature-badge', 'IN THE SPOTLIGHT'), element('span', 'feature-number', '01 / ∞'));
  const bottom = element('div', 'featured-bottom');
  const text = element('div'); text.append(element('h2', '', work.title), element('p', '', work.artist));
  const button = element('button', 'featured-play');
  button.setAttribute('aria-label', `Preview ${work.title}`); button.append(element('span', 'play-icon'));
  button.addEventListener('click', () => play([work]));
  bottom.append(text, button); overlay.append(top, bottom); host.append(overlay);
}
function renderLibrary() {
  const grid = $('#art-grid');
  clearRotatedPreviews(grid);
  grid.querySelectorAll('video').forEach(unloadVideo); grid.replaceChildren();
  const works = filterWorks(allWorks(), currentFilters());
  const portraitView = ['screen-portrait', 'portrait'].includes($('#shape-filter').value);
  grid.classList.toggle('portrait-grid', portraitView);
  $('#results-count').textContent = `${works.length} ${works.length === 1 ? 'work' : 'works'}${$('#shape-filter').value === 'screen-portrait' ? ' · For your 9:16 screen' : ''}`;
  $('#empty-state').hidden = works.length > 0 || !loaded;
  $('#load-more').hidden = works.length <= visibleCount;
  $('#load-more').textContent = `Show ${Math.min(PAGE_SIZE, works.length - visibleCount)} more works ↓`;
  works.slice(0, visibleCount).forEach(work => {
    const card = element('article', 'art-card'); card.dataset.workId = work.id;
    const visual = element('div', 'art-visual'); previewVideo(work, visual);
    const dimensions = displayDimensions(work);
    const videoTag = element('span', 'video-tag', isPortraitScreenWork(work) ? (dimensions.width >= 2160 && dimensions.height >= 3840 ? '4K PORTRAIT' : 'PORTRAIT FIT') : work.kind === 'image' ? (work.animated ? 'ANIMATION' : 'STILL ART') : 'MOVING ART');
    const preview = element('button', 'preview-button'); preview.setAttribute('aria-label', `Preview ${work.title} by ${work.artist}`);
    const circle = element('span', 'preview-play'); circle.append(element('span', 'play-icon')); preview.append(circle);
    preview.addEventListener('click', () => play([work])); visual.append(videoTag, preview);
    const info = element('div', 'art-info'), caption = element('div', 'art-caption');
    const title = element('h3', '', work.title); title.title = work.title;
    const artist = element('span', 'art-artist', work.artist); artist.title = work.artist;
    const source = element(work.sourceUrl ? 'a' : 'span', 'art-source', `${work.source}${work.sourceUrl ? ' ↗' : ''}`);
    if (work.sourceUrl) { source.href = work.sourceUrl; source.target = '_blank'; source.rel = 'noopener noreferrer'; source.setAttribute('aria-label', `View ${work.title} on ${work.source}`); }
    caption.append(title, artist, source);
    if (work.collection) { const collection = element('span', 'art-collection', work.collection); collection.title = work.collection; caption.append(collection); }
    if (dimensions.width && dimensions.height) caption.append(element('span', 'art-dimensions', `${dimensions.width} × ${dimensions.height}${work.rotation ? ` · rotated ${work.rotation}°` : ''}`));
    const add = element('button', 'add-button', '+'); add.dataset.id = work.id; add.dataset.title = work.title;
    add.addEventListener('click', () => toggleWork(work));
    info.append(caption, add); card.append(visual, info); grid.append(card);
  });
  grid.setAttribute('aria-busy', 'false'); updateSelectionButtons();
}
function updateQueue() {
  $('#nav-count').textContent = queue.length; $('#queue-count').textContent = queue.length;
  $('#queue-summary').textContent = queue.length ? `${queue.length} ${queue.length === 1 ? 'work' : 'works'} · ${durationLabel(queue.length, settings.duration)}` : 'Start with a few favorites';
  $('#queue-empty').hidden = Boolean(queue.length); $('#clear-queue').hidden = !queue.length;
  $('#start-show').disabled = !queue.length; $('#hero-play').disabled = !queue.length;
  $('#export-queue').disabled = !queue.length;
  const list = $('#queue-list'); list.replaceChildren();
  queue.forEach((work, index) => {
    const item = element('li', 'queue-item');
    const number = element('span', 'queue-position', String(index + 1).padStart(2, '0')); number.setAttribute('aria-hidden', 'true');
    const thumb = work.posterUrl ? element('img', 'queue-thumb') : element('span', 'queue-thumb queue-thumb-placeholder', '▷');
    if (work.posterUrl) { thumb.src = work.posterUrl; thumb.alt = ''; thumb.loading = 'lazy'; thumb.addEventListener('error', () => { thumb.replaceWith(element('span', 'queue-thumb queue-thumb-placeholder', '▷')); }, { once: true }); }
    const text = element('div', 'queue-text'); text.title = `${work.title} — ${work.artist}`;
    text.append(element('strong', '', work.title), element('span', '', work.artist));
    const buttons = element('div', 'queue-buttons'), moves = element('div', 'queue-move');
    [-1, 1].forEach(offset => {
      const button = element('button', '', offset === -1 ? '⌃' : '⌄');
      button.setAttribute('aria-label', `Move ${work.title} ${offset === -1 ? 'up' : 'down'}`);
      button.disabled = offset === -1 ? index === 0 : index === queue.length - 1;
      button.addEventListener('click', () => {
        queue = moveItem(queue, index, offset); updateQueue(); persist();
        const moved = $('#queue-list').children[index + offset]; moved?.querySelector(offset === -1 ? '.queue-move button:first-child' : '.queue-move button:last-child')?.focus({ preventScroll: true });
      }); moves.append(button);
    });
    const remove = element('button', 'queue-remove', '×'); remove.setAttribute('aria-label', `Remove ${work.title} from exhibition`);
    remove.addEventListener('click', () => { removeWork(index); $('#queue-list').children[Math.min(index, queue.length - 1)]?.querySelector('.queue-remove')?.focus({ preventScroll: true }); });
    buttons.append(moves, remove); item.append(number, thumb, text, buttons); list.append(item);
  });
  updateSelectionButtons();
}
function syncSettings() {
  $('#duration').value = settings.duration; $('#fit').value = settings.fit;
  $('#transition').value = settings.transition;
  $('#captions').checked = settings.captions; $('#shuffle').checked = settings.shuffle;
}
for (const id of ['duration', 'fit', 'transition', 'captions', 'shuffle']) {
  $(`#${id}`).addEventListener('change', () => {
    settings = cleanSettings({ duration: $('#duration').value, fit: $('#fit').value, transition: $('#transition').value, captions: $('#captions').checked, shuffle: $('#shuffle').checked });
    updateQueue(); persist();
  });
}
$('#clear-queue').addEventListener('click', () => { const previous = { queue, playlistName }; queue = []; playlistName = ''; updateQueue(); persist(); notify('Exhibition cleared.', () => { ({ queue, playlistName } = previous); updateQueue(); persist(); }); });
function selectedMix() { return $('#mix-format').value === 'portrait' ? makePortraitMix(catalog, settings) : makeHourMix(catalog, settings); }
function syncMix() {
  const mix = selectedMix(), portrait = $('#mix-format').value === 'portrait';
  $('#hour-mix').disabled = !mix;
  $('#hour-mix-note').textContent = mix ? `${mix.works.length} works · ${mix.settings.duration === 30 ? '30 seconds' : `${mix.settings.duration / 60} minute${mix.settings.duration > 60 ? 's' : ''}`} each · fresh shuffle every loop` : (loaded ? 'This mix is temporarily unavailable.' : 'Loading your selection…');
  $('#mix-screen-note').hidden = !portrait;
}
$('#mix-format').addEventListener('change', syncMix);
$('#hour-mix').addEventListener('click', () => {
  const mix = selectedMix();
  if (!mix) return;
  const previous = { queue, settings, playlistName };
  queue = mix.works; settings = mix.settings; playlistName = '';
  syncSettings(); updateQueue(); persist();
  $('#start-show').focus({ preventScroll: true });
  notify('1-hour mix ready. A fresh shuffle every loop, for as long as you like.', () => {
    ({ queue, settings, playlistName } = previous); syncSettings(); updateQueue(); persist();
  });
});
for (const id of ['search', 'source-filter', 'shape-filter', 'collection-filter', 'media-filter']) $(`#${id}`).addEventListener(id === 'search' ? 'input' : 'change', () => { visibleCount = PAGE_SIZE; renderLibrary(); });
$('#reset-filters').addEventListener('click', () => { $('#search').value = ''; for (const id of ['source-filter', 'shape-filter', 'collection-filter', 'media-filter']) $(`#${id}`).value = 'all'; visibleCount = PAGE_SIZE; renderLibrary(); });
$('#load-more').addEventListener('click', () => { visibleCount += PAGE_SIZE; renderLibrary(); });

for (const [button, dialog] of [['guide-open', 'guide-dialog'], ['about-open', 'about-dialog'], ['add-link-open', 'add-dialog']]) {
  $(`#${button}`).addEventListener('click', () => { $(`#${dialog}`).showModal(); stopPreviews(); });
}
document.querySelectorAll('.content-dialog').forEach(dialog => {
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => { if (dialog.id === 'add-dialog') importController?.abort(); syncPreviews(); });
});

function checkVideo(url, signal) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video'); video.muted = true; video.playsInline = true; video.preload = 'auto';
    let finished = false;
    const timeout = setTimeout(() => finish(new Error('The video took too long to load. Check the link or try a smaller file.')), 15000);
    const abort = () => finish(new DOMException('Cancelled', 'AbortError'));
    function finish(error) {
      if (finished) return; finished = true;
      const dimensions = { width: video.videoWidth, height: video.videoHeight };
      clearTimeout(timeout); signal.removeEventListener('abort', abort); video.onloadeddata = null; video.onerror = null; video.pause(); video.removeAttribute('src'); video.load();
      if (error) reject(error); else resolve(dimensions);
    }
    video.onloadeddata = () => video.videoWidth > 0 && video.videoHeight > 0 ? finish() : finish(new Error('This link does not contain a playable video.'));
    video.onerror = () => finish(new Error('This link could not play. Use a direct public MP4 or WebM URL.'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort(); else { video.src = url; video.load(); }
  });
}
function checkImage(url, signal) {
  return new Promise((resolve, reject) => {
    const image = new Image(); let finished = false;
    const timeout = setTimeout(() => finish(new Error('The image took too long to load. Check the link or try a smaller file.')), 15000);
    const abort = () => finish(new DOMException('Cancelled', 'AbortError'));
    function finish(error) {
      if (finished) return; finished = true;
      const dimensions = { width: image.naturalWidth, height: image.naturalHeight };
      clearTimeout(timeout); signal.removeEventListener('abort', abort); image.onload = null; image.onerror = null; image.removeAttribute('src');
      if (error) reject(error); else resolve(dimensions);
    }
    image.onload = () => image.naturalWidth > 0 ? finish() : finish(new Error('This link does not contain a readable image.'));
    image.onerror = () => finish(new Error('This image could not load. Use a direct public JPG, PNG, WebP, or GIF URL.'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort(); else image.src = url;
  });
}
$('#add-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
  const url = safeUrl(data.get('url')); const error = $('#add-error'); error.hidden = true;
  const candidate = cleanWork({ id: `custom:${crypto.randomUUID()}`, kind: data.get('kind'), rotation: Number(data.get('rotation')), title: data.get('title'), artist: data.get('artist'), mediaUrl: url, source: 'Your links', posterUrl: data.get('kind') === 'image' ? url : null, animated: data.get('kind') === 'image' && /\.gif(?:$|[?#])/i.test(url || '') });
  if (!candidate) { error.textContent = 'Use an HTTPS artwork file URL, select its media type, and include a title and artist.'; error.hidden = false; return; }
  if (queue.length >= MAX_WORKS) { error.textContent = `An exhibition can hold up to ${MAX_WORKS} works. Remove a work before adding another.`; error.hidden = false; return; }
  const existing = allWorks().find(work => work.mediaUrl === url && work.kind === candidate.kind && work.rotation === candidate.rotation);
  if (existing) {
    if (!queue.some(work => work.id === existing.id)) toggleWork(existing);
    else notify('This artwork is already in your exhibition.');
    $('#add-dialog').close(); return;
  }
  importController?.abort(); importController = new AbortController(); const controller = importController;
  $('#add-submit').disabled = true; $('#add-submit').textContent = 'Checking artwork…';
  try {
    const dimensions = await (candidate.kind === 'image' ? checkImage : checkVideo)(url, controller.signal);
    if (controller.signal.aborted || !$('#add-dialog').open) return;
    const work = cleanWork({ ...candidate, ...dimensions, verifiedAt: new Date().toISOString() });
    const replaced = custom.length >= MAX_WORKS;
    custom = rememberCustomWork(custom, work, queue); queue = [...queue, work]; syncSources(); renderLibrary(); updateQueue(); persist();
    $('#add-dialog').close(); form.reset(); notify(`Added “${work.title}”.${replaced ? ' One unused saved link was removed to make room.' : ''}`);
  } catch (reason) { if (reason.name !== 'AbortError') { error.textContent = reason.message; error.hidden = false; } }
  finally { if (controller === importController) { $('#add-submit').disabled = false; $('#add-submit').textContent = 'Check & add artwork ↗'; } }
});

function exportJson(works, displaySettings, name) {
  try {
    const blob = new Blob([serializeExhibition(works, displaySettings, name)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = element('a');
    link.href = url; link.download = exhibitionFilename(name); document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
    notify('JSON download requested. Keep the file as a backup or import it on another computer.');
  } catch (error) { notify(error.message); }
}
function applyExhibition(imported, message) {
  const previous = { queue, settings, custom, playlistName };
  queue = imported.works; settings = imported.settings; playlistName = imported.name || '';
  const known = new Set(catalog.map(work => work.id));
  custom = uniqueWorks([...queue.filter(work => !known.has(work.id)), ...custom]);
  syncSettings(); syncSources(); renderLibrary(); updateQueue();
  const stored = persist();
  notify(`${message}${stored ? '' : ' Browser storage is unavailable; export a backup.'}`, () => {
    ({ queue, settings, custom, playlistName } = previous);
    syncSettings(); syncSources(); renderLibrary(); updateQueue(); persist();
  });
}
$('#export-queue').addEventListener('click', () => exportJson(queue, settings, playlistName));
$('#import-queue').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  const request = ++importRevision, revision = workingRevision;
  try {
    if (file.size > MAX_EXHIBITION_BYTES) throw new Error('Choose an ArtDrops JSON file no larger than 2 MB.');
    const text = await file.text();
    if (request !== importRevision) return;
    if (revision !== workingRevision) { notify('Import cancelled because your exhibition changed. Choose the file again to import it.'); return; }
    const imported = parseExhibition(text);
    applyExhibition(imported, `Imported ${imported.works.length} works${imported.name ? ` from “${imported.name}”` : ''}.`);
  } catch (error) {
    if (request === importRevision && revision === workingRevision) notify(error instanceof SyntaxError ? 'This isn’t a valid exhibition JSON file. Your exhibition is unchanged.' : error.message);
  }
});

function playlistError(message = '') {
  $('#playlist-error').textContent = message; $('#playlist-error').hidden = !message;
}
function resetReplacement() {
  pendingReplace = null; $('#playlist-save').textContent = 'Save playlist';
  $('#playlist-replace-note').hidden = true; $('#playlist-cancel-replace').hidden = true;
}
function renderPlaylists() {
  const list = $('#playlist-list'); list.replaceChildren();
  $('#playlist-empty').hidden = true;
  $('#playlist-save').disabled = !queue.length;
  $('#playlist-save-help').textContent = queue.length ? `${queue.length} works · ${durationLabel(queue.length, settings.duration)}` : 'Add an artwork before saving a playlist.';
  try {
    const entries = listPlaylists(localStorage);
    $('#playlist-empty').hidden = entries.length > 0;
    for (const entry of entries) {
      const row = element('li', 'playlist-row'), details = element('div', 'playlist-details');
      details.append(element('strong', '', entry.name), element('span', '', `${entry.exhibition.works.length} works · ${durationLabel(entry.exhibition.works.length, entry.exhibition.settings.duration)}`));
      const actions = element('div', 'playlist-actions');
      for (const [label, accessible, action] of [
        ['Load', `Load ${entry.name}`, () => {
          const current = listPlaylists(localStorage).find(item => item.id === entry.id);
          if (!current) throw new Error('That playlist no longer exists.');
          importRevision++; $('#playlists-dialog').close();
          applyExhibition({ ...readExhibition(current.exhibition), name: current.name }, `Loaded “${current.name}”.`);
        }],
        ['Export JSON', `Export ${entry.name} as JSON`, () => {
          $('#playlists-dialog').close(); exportJson(entry.exhibition.works, entry.exhibition.settings, entry.name);
        }],
        ['Delete', `Delete ${entry.name}`, async () => {
          const removed = await withPlaylistLock(() => deletePlaylist(localStorage, entry.id));
          $('#playlists-dialog').close();
          notify(`Deleted “${removed.name}”.`, async () => {
            try { await withPlaylistLock(() => restorePlaylist(localStorage, removed)); notify(`Restored “${removed.name}”.`); }
            catch (error) { notify(error.message); }
          });
        }],
      ]) {
        const button = element('button', 'text-button', label); button.type = 'button'; button.setAttribute('aria-label', accessible);
        button.addEventListener('click', async () => { try { await action(); } catch (error) { if ($('#playlists-dialog').open) playlistError(error.message); else notify(error.message); } });
        actions.append(button);
      }
      row.append(details, actions); list.append(row);
    }
  } catch (error) { playlistError(error.message); $('#playlist-save').disabled = true; }
}
$('#playlists').addEventListener('click', () => {
  $('#playlist-name').value = playlistName; resetReplacement(); playlistError(); renderPlaylists();
  $('#playlists-dialog').showModal(); stopPreviews();
});
$('#playlist-name').addEventListener('input', () => { resetReplacement(); playlistError(); });
$('#playlist-cancel-replace').addEventListener('click', () => { resetReplacement(); playlistError(); });
$('#playlist-form').addEventListener('submit', async event => {
  event.preventDefault(); playlistError();
  $('#playlist-save').disabled = true;
  try {
    const name = normalizePlaylistName($('#playlist-name').value);
    const snapshot = makeExhibition(queue, settings, name), revision = workingRevision;
    const entry = await withPlaylistLock(() => {
      const existing = listPlaylists(localStorage).find(item => item.name.toLowerCase() === name.toLowerCase());
      if (existing && (pendingReplace?.id !== existing.id || pendingReplace?.updatedAt !== existing.updatedAt)) {
        pendingReplace = { id: existing.id, updatedAt: existing.updatedAt };
        $('#playlist-replace-note').textContent = `“${existing.name}” already exists. Replace its saved artwork and settings?`;
        $('#playlist-replace-note').hidden = false; $('#playlist-cancel-replace').hidden = false;
        $('#playlist-save').textContent = 'Replace saved playlist'; return;
      }
      return savePlaylist(localStorage, { name, works: snapshot.works, settings: snapshot.settings, ...(existing ? { replaceId: existing.id } : {}) });
    });
    if (!entry) return;
    let stored = true;
    if (revision === workingRevision) { playlistName = entry.name; stored = persist(); }
    $('#playlists-dialog').close();
    notify(`Saved “${entry.name}”.${stored ? '' : ' The current exhibition could not be autosaved.'}`);
  } catch (error) { playlistError(error.message); }
  finally {
    $('#playlist-save').disabled = !queue.length;
    if ($('#playlists-dialog').open && pendingReplace) $('#playlist-save').focus({ preventScroll: true });
  }
});
window.addEventListener('storage', event => {
  if (event.key === PLAYLISTS_KEY || event.key === null) {
    resetReplacement(); playlistError(); if ($('#playlists-dialog').open) renderPlaylists();
  }
});

async function loadCatalog() {
  $('#catalog-error').hidden = true; $('#art-grid').setAttribute('aria-busy', 'true');
  try {
    const response = await fetch('/catalog.json', { signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error('Catalog unavailable');
    const result = await response.json();
    if (result.version !== 1 || !Array.isArray(result.works)) throw new Error('Invalid catalog');
    let references;
    try {
      const extra = await fetch('/references.json', { signal: AbortSignal.timeout(12000) });
      if (!extra.ok) throw new Error('References unavailable');
      references = await extra.json();
      if (references.version !== 1 || !Array.isArray(references.works)) throw new Error('Invalid references');
    } catch { references = null; notify('The requested collections could not load. The original library is still available; reload to try again.'); }
    const works = uniqueWorks([...result.works, ...(references?.works || [])], MAX_CATALOG_WORKS); if (!works.length) throw new Error('Empty catalog');
    catalog = works; loaded = true;
    syncMix();
    // Saved exhibitions are snapshots: a catalog refresh must not reset their rotation or links.
    if (!saved && !queue.length) {
      const artists = new Set();
      queue = portraitScreenWorks(catalog).filter(work => !artists.has(work.artistKey) && artists.add(work.artistKey)).slice(0, 6);
      persist();
    }
    const artists = new Set(catalog.map(work => work.artistKey)).size, sources = new Set(catalog.map(work => work.source)).size;
    $('#collection-stats').textContent = `${catalog.length} works · ${artists} artists · ${sources} ${sources === 1 ? 'source' : 'sources'}`;
    const date = new Date(references?.updatedAt || result.updatedAt);
    $('#catalog-updated').textContent = Number.isNaN(date.getTime()) ? '' : `Catalog checked ${new Intl.DateTimeFormat('en', { month: 'long', day: 'numeric', year: 'numeric' }).format(date)}. Media links were checked during selection; availability can change.`;
    const referenceList = $('#reference-list'); referenceList.replaceChildren();
    for (const reference of references?.references || []) {
      const item = element('li');
      const link = element('a', '', reference.name);
      const url = safeUrl(reference.url);
      if (url) { link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; }
      item.append(link, element('span', '', `${reference.available || 0} available${reference.note ? ` · ${reference.note}` : ''}`));
      referenceList.append(item);
    }
    $('#reference-status').hidden = !referenceList.children.length;
    syncSources(); renderFeatured(); renderLibrary(); updateQueue();
  } catch {
    $('#catalog-error').hidden = false; $('#collection-stats').textContent = 'Collection temporarily unavailable';
    $('#art-grid').setAttribute('aria-busy', 'false');
    $('#featured').replaceChildren(element('div', 'art-loading', 'The collection is taking a moment. Try reloading below.'));
    if (custom.length) { syncSources(); renderLibrary(); }
  }
}
$('#retry-catalog').addEventListener('click', loadCatalog);
document.addEventListener('visibilitychange', syncPreviews);
reducedMotion.addEventListener('change', syncPreviews);
syncSettings(); updateQueue(); loadCatalog();
