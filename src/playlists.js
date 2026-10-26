import { readExhibition, serializeExhibition } from './core.js';

export const PLAYLISTS_KEY = 'artdrops:playlists:v1';
export const MAX_PLAYLISTS = 20;
const FORMAT = 'artdrops-playlists';

export function withPlaylistLock(action, locks = globalThis.navigator?.locks) {
  return typeof locks?.request === 'function'
    ? locks.request(PLAYLISTS_KEY, action)
    : Promise.resolve().then(action);
}

export function normalizePlaylistName(name) {
  if (typeof name !== 'string') throw new Error('Enter a playlist name.');
  const normalized = name.trim().replace(/\s+/gu, ' ');
  if (!normalized) throw new Error('Enter a playlist name.');
  if (normalized.length > 80) throw new Error('Keep playlist names to 80 characters or fewer.');
  return normalized;
}

const nameKey = name => normalizePlaylistName(name).toLowerCase();
const validId = id => typeof id === 'string' && id.length > 0 && id.length <= 128
  && id.trim() === id && !/[\u0000-\u001f\u007f]/u.test(id);

function validateEntry(entry) {
  if (!entry || !validId(entry.id) || typeof entry.updatedAt !== 'string' || !Number.isFinite(Date.parse(entry.updatedAt))) {
    throw new Error('Invalid saved playlist.');
  }
  const name = normalizePlaylistName(entry.name);
  const parsed = readExhibition(entry.exhibition);
  if (!parsed.works.length) throw new Error('Add an artwork before saving a playlist.');
  if (entry.exhibition.name !== undefined && nameKey(entry.exhibition.name) !== nameKey(name)) {
    throw new Error('The playlist name does not match its exhibition.');
  }
  const exhibition = {
    format: 'artdrops-exhibition', version: 1,
    ...(entry.exhibition.exportedAt !== undefined ? { exportedAt: entry.exhibition.exportedAt } : {}),
    ...(entry.exhibition.name !== undefined ? { name } : {}),
    works: parsed.works, settings: parsed.settings,
  };
  return { id: entry.id, name, updatedAt: entry.updatedAt, exhibition };
}

export function listPlaylists(storage) {
  let raw;
  try { raw = storage.getItem(PLAYLISTS_KEY); }
  catch (cause) { throw new Error('Saved playlists are unavailable in this browser.', { cause }); }
  if (raw === null || (typeof raw === 'string' && !raw.trim())) return [];
  try {
    const saved = JSON.parse(raw);
    if (!saved || saved.format !== FORMAT || saved.version !== 1 || !Array.isArray(saved.playlists) || saved.playlists.length > MAX_PLAYLISTS) {
      throw new Error('Invalid playlist library.');
    }
    const ids = new Set(), names = new Set();
    const entries = saved.playlists.map(validateEntry);
    for (const entry of entries) {
      const key = nameKey(entry.name);
      if (ids.has(entry.id) || names.has(key)) throw new Error('Duplicate saved playlists.');
      ids.add(entry.id); names.add(key);
    }
    return entries.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  } catch (cause) {
    throw new Error('Saved playlists could not be read. Existing data was left untouched.', { cause });
  }
}

function writePlaylists(storage, entries) {
  const value = JSON.stringify({ format: FORMAT, version: 1, playlists: entries });
  try { storage.setItem(PLAYLISTS_KEY, value); }
  catch (cause) { throw new Error('Could not save playlists. Browser storage may be full or unavailable. Export a backup and try again.', { cause }); }
}

function assertRoom(entries) {
  if (entries.length >= MAX_PLAYLISTS) throw new Error(`You can save up to ${MAX_PLAYLISTS} playlists. Delete one before saving another.`);
}

function duplicateName(name) {
  return new Error(`A playlist named “${name}” already exists. Replace that playlist or choose a different name.`);
}

export function savePlaylist(storage, { name, works, settings, replaceId } = {}) {
  const entries = listPlaylists(storage);
  name = normalizePlaylistName(name);
  const existing = entries.find(entry => nameKey(entry.name) === nameKey(name));
  if (replaceId !== undefined) {
    const target = entries.find(entry => entry.id === replaceId);
    if (!target) throw new Error('That playlist no longer exists. Save it as a new playlist.');
    if (nameKey(target.name) !== nameKey(name)) throw new Error('The selected playlist does not match this name. Select it again or save a new playlist.');
  }
  if (existing && existing.id !== replaceId) throw duplicateName(name);
  if (replaceId === undefined) assertRoom(entries);
  const parsed = readExhibition({ format: 'artdrops-exhibition', version: 1, works, settings });
  if (!parsed.works.length) throw new Error('Add an artwork before saving a playlist.');
  const entry = validateEntry({
    id: replaceId ?? crypto.randomUUID(), name, updatedAt: new Date().toISOString(),
    exhibition: JSON.parse(serializeExhibition(parsed.works, parsed.settings, name)),
  });
  if (replaceId === undefined && entries.some(item => item.id === entry.id)) throw new Error('Could not create a unique playlist. Try saving again.');
  writePlaylists(storage, [entry, ...entries.filter(item => item.id !== replaceId)]);
  return entry;
}

export function deletePlaylist(storage, id) {
  const entries = listPlaylists(storage);
  const entry = entries.find(item => item.id === id);
  if (!entry) throw new Error('That playlist no longer exists.');
  writePlaylists(storage, entries.filter(item => item.id !== id));
  return entry;
}

export function restorePlaylist(storage, entry) {
  const entries = listPlaylists(storage);
  const restored = validateEntry(entry);
  if (entries.some(item => item.id === restored.id)) throw new Error('That playlist already exists. Nothing was overwritten.');
  if (entries.some(item => nameKey(item.name) === nameKey(restored.name))) throw duplicateName(restored.name);
  assertRoom(entries);
  writePlaylists(storage, [restored, ...entries]);
  return restored;
}
