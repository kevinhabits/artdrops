import { ExhibitionPlayer } from './player.js';
import { DEFAULT_SETTINGS, MAX_WORKS, HOUR_MIX_SIZE, cleanWork, cleanSettings, uniqueWorks, rememberCustomWork, filterWorks, moveItem, makeExhibition, makeHourMix, readExhibition, durationLabel, safeUrl } from './core.js';

const $ = (selector) => document.querySelector(selector);
const STORAGE_KEY = 'artdrops:exhibition:v1';
const PAGE_SIZE = 12;
let catalog = [], custom = [], queue = [], settings = { ...DEFAULT_SETTINGS };
let loaded = false, saved = false, visibleCount = PAGE_SIZE, toastTimer, undoAction, importController;
let previewObserver, lastFocus, activeShow = false;
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
$('#toast-undo').addEventListener('click', () => { const undo = undoAction; undoAction = undefined; $('#toast').hidden = true; undo?.(); });

try {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    const stored = JSON.parse(raw);
    const restored = readExhibition(stored);
    queue = restored.works;
    settings = restored.settings;
    custom = uniqueWorks(Array.isArray(stored.custom) ? stored.custom : []);
    saved = true;
  }
} catch { notify('Saved data couldn’t be read. The starter exhibition will be available when the collection loads.'); }

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...makeExhibition(queue, settings), custom }));
    saved = true;
    $('#save-note').textContent = '✓ Saved on this browser';
  } catch {
    $('#save-note').textContent = 'Not saved · export a backup';
    notify('Browser storage is unavailable. Export your exhibition to keep a copy.');
  }
}
function allWorks() {
  const known = new Set(catalog.map(work => work.id));
  return [...catalog, ...custom.filter(work => !known.has(work.id))];
}
function currentFilters() { return { search: $('#search').value, source: $('#source-filter').value, shape: $('#shape-filter').value }; }
function syncSources() {
  const select = $('#source-filter'), selected = select.value;
  select.replaceChildren(new Option('All sources', 'all'));
  const sources = [...new Set(allWorks().map(work => work.source))];
  sources.forEach(source => select.append(new Option(source, source)));
  select.value = sources.includes(selected) ? selected : 'all';
  select.hidden = sources.length < 2;
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
  container.append(video); watchVideo(video);
  return video;
}

const player = new ExhibitionPlayer({
  onClose: () => { activeShow = false; syncPreviews(); if (lastFocus?.isConnected) lastFocus.focus({ preventScroll: true }); },
  onStatus: message => { /* Player shows failures inside its modal. */ },
});
function play(works) {
  if (!works.length) { notify('Add an artwork to your exhibition first.'); return; }
  lastFocus = document.activeElement;
  activeShow = true; stopPreviews(); player.open(works, settings);
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
}
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
  grid.querySelectorAll('video').forEach(unloadVideo); grid.replaceChildren();
  const works = filterWorks(allWorks(), currentFilters());
  $('#results-count').textContent = `${works.length} ${works.length === 1 ? 'work' : 'works'} · Motion only`;
  $('#empty-state').hidden = works.length > 0 || !loaded;
  $('#load-more').hidden = works.length <= visibleCount;
  $('#load-more').textContent = `Show ${Math.min(PAGE_SIZE, works.length - visibleCount)} more works ↓`;
  works.slice(0, visibleCount).forEach(work => {
    const card = element('article', 'art-card'); card.dataset.workId = work.id;
    const visual = element('div', 'art-visual'); previewVideo(work, visual);
    const videoTag = element('span', 'video-tag', 'MOVING ART');
    const preview = element('button', 'preview-button'); preview.setAttribute('aria-label', `Preview ${work.title} by ${work.artist}`);
    const circle = element('span', 'preview-play'); circle.append(element('span', 'play-icon')); preview.append(circle);
    preview.addEventListener('click', () => play([work])); visual.append(videoTag, preview);
    const info = element('div', 'art-info'), caption = element('div', 'art-caption');
    const title = element('h3', '', work.title); title.title = work.title;
    const artist = element('span', 'art-artist', work.artist); artist.title = work.artist;
    const source = element(work.sourceUrl ? 'a' : 'span', 'art-source', `${work.source}${work.sourceUrl ? ' ↗' : ''}`);
    if (work.sourceUrl) { source.href = work.sourceUrl; source.target = '_blank'; source.rel = 'noopener noreferrer'; source.setAttribute('aria-label', `View ${work.title} on ${work.source}`); }
    caption.append(title, artist, source);
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
  $('#captions').checked = settings.captions; $('#shuffle').checked = settings.shuffle;
}
for (const id of ['duration', 'fit', 'captions', 'shuffle']) {
  $(`#${id}`).addEventListener('change', () => {
    settings = cleanSettings({ duration: $('#duration').value, fit: $('#fit').value, captions: $('#captions').checked, shuffle: $('#shuffle').checked });
    updateQueue(); persist();
  });
}
$('#clear-queue').addEventListener('click', () => { const previous = [...queue]; queue = []; updateQueue(); persist(); notify('Exhibition cleared.', () => { queue = previous; updateQueue(); persist(); }); });
$('#hour-mix').addEventListener('click', () => {
  const mix = makeHourMix(catalog, settings);
  if (!mix) return;
  const previous = { queue, settings };
  queue = mix.works; settings = mix.settings;
  syncSettings(); updateQueue(); persist();
  $('#start-show').focus({ preventScroll: true });
  notify('1-hour mix ready. A fresh shuffle every loop, for as long as you like.', () => {
    ({ queue, settings } = previous); syncSettings(); updateQueue(); persist();
  });
});
for (const id of ['search', 'source-filter', 'shape-filter']) $(`#${id}`).addEventListener(id === 'search' ? 'input' : 'change', () => { visibleCount = PAGE_SIZE; renderLibrary(); });
$('#reset-filters').addEventListener('click', () => { $('#search').value = ''; $('#source-filter').value = 'all'; $('#shape-filter').value = 'all'; visibleCount = PAGE_SIZE; renderLibrary(); });
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
$('#add-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
  const url = safeUrl(data.get('url')); const error = $('#add-error'); error.hidden = true;
  const candidate = cleanWork({ id: `custom:${crypto.randomUUID()}`, kind: 'video', title: data.get('title'), artist: data.get('artist'), mediaUrl: url, source: 'Your links' });
  if (!candidate) { error.textContent = 'Use an HTTPS video URL and include a title and artist.'; error.hidden = false; return; }
  if (queue.length >= MAX_WORKS) { error.textContent = `An exhibition can hold up to ${MAX_WORKS} works. Remove a work before adding another.`; error.hidden = false; return; }
  if (allWorks().some(work => work.mediaUrl === url)) {
    const existing = allWorks().find(work => work.mediaUrl === url);
    if (!queue.some(work => work.id === existing.id)) toggleWork(existing);
    else notify('This artwork is already in your exhibition.');
    $('#add-dialog').close(); return;
  }
  importController?.abort(); importController = new AbortController(); const controller = importController;
  $('#add-submit').disabled = true; $('#add-submit').textContent = 'Checking video…';
  try {
    const dimensions = await checkVideo(url, controller.signal);
    if (controller.signal.aborted || !$('#add-dialog').open) return;
    const work = cleanWork({ ...candidate, ...dimensions, verifiedAt: new Date().toISOString() });
    const replaced = custom.length >= MAX_WORKS;
    custom = rememberCustomWork(custom, work, queue); queue = [...queue, work]; syncSources(); renderLibrary(); updateQueue(); persist();
    $('#add-dialog').close(); form.reset(); notify(`Added “${work.title}”.${replaced ? ' One unused saved link was removed to make room.' : ''}`);
  } catch (reason) { if (reason.name !== 'AbortError') { error.textContent = reason.message; error.hidden = false; } }
  finally { if (controller === importController) { $('#add-submit').disabled = false; $('#add-submit').textContent = 'Check & add artwork ↗'; } }
});

$('#export-queue').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(makeExhibition(queue, settings), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const link = element('a'); link.href = url; link.download = 'artdrops-exhibition.json'; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000); notify('Exhibition exported. Import it on your show laptop.');
});
$('#import-queue').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  try {
    if (file.size > 2_000_000) throw new Error('This file is too large. Choose an ArtDrops exhibition JSON file.');
    const imported = readExhibition(JSON.parse(await file.text()));
    const previous = { queue, settings, custom };
    queue = imported.works; settings = imported.settings;
    const known = new Set(catalog.map(work => work.id)); custom = uniqueWorks([...queue.filter(work => !known.has(work.id)), ...custom]);
    syncSettings(); syncSources(); renderLibrary(); updateQueue(); persist();
    notify(`Imported ${queue.length} works.`, () => { ({ queue, settings, custom } = previous); syncSettings(); syncSources(); renderLibrary(); updateQueue(); persist(); });
  } catch (error) { notify(error instanceof SyntaxError ? 'This isn’t a valid exhibition JSON file. Your exhibition is unchanged.' : error.message); }
});

async function loadCatalog() {
  $('#catalog-error').hidden = true; $('#art-grid').setAttribute('aria-busy', 'true');
  try {
    const response = await fetch('/catalog.json', { signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error('Catalog unavailable');
    const result = await response.json();
    if (result.version !== 1 || !Array.isArray(result.works)) throw new Error('Invalid catalog');
    const works = uniqueWorks(result.works); if (!works.length) throw new Error('Empty catalog');
    catalog = works; loaded = true;
    $('#hour-mix').disabled = catalog.length < HOUR_MIX_SIZE;
    const fresh = new Map(catalog.map(work => [work.id, work])); queue = queue.map(work => fresh.get(work.id) || work);
    if (!saved && !queue.length) {
      const artists = new Set();
      queue = catalog.filter(work => !artists.has(work.artistKey) && artists.add(work.artistKey)).slice(0, 6);
      persist();
    }
    const artists = new Set(catalog.map(work => work.artistKey)).size, sources = new Set(catalog.map(work => work.source)).size;
    $('#collection-stats').textContent = `${catalog.length} works · ${artists} artists · ${sources} ${sources === 1 ? 'source' : 'sources'}`;
    const date = new Date(result.updatedAt);
    $('#catalog-updated').textContent = Number.isNaN(date.getTime()) ? '' : `Catalog checked ${new Intl.DateTimeFormat('en', { month: 'long', day: 'numeric', year: 'numeric' }).format(date)}. Video links and decoded motion were checked during selection.`;
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
