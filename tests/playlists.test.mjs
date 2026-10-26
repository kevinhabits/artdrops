import test from 'node:test';
import assert from 'node:assert/strict';
import { makeExhibition, MAX_EXHIBITION_BYTES } from '../src/core.js';
import {
  PLAYLISTS_KEY, MAX_PLAYLISTS, normalizePlaylistName, listPlaylists,
  savePlaylist, deletePlaylist, restorePlaylist, withPlaylistLock,
} from '../src/playlists.js';

const work = (id, extra = {}) => ({ id, title: `Artwork ${id}`, artist: 'Example Artist', kind: 'image',
  mediaUrl: `https://media.example/${id}.jpg`, collection: 'Paintings', source: 'Orkhan',
  sourceUrl: 'https://orkhan.art/untitled/gallery', width: 1920, height: 1080, rotation: 90, ...extra });
const snapshot = (name, works = [work('a')], settings = {}) => ({ name, works, settings });
const envelope = playlists => JSON.stringify({ format: 'artdrops-playlists', version: 1, playlists });

function storage(value = null) {
  return {
    value, writes: 0, reads: 0, readError: null, writeError: null,
    getItem(key) { assert.equal(key, PLAYLISTS_KEY); this.reads++; if (this.readError) throw this.readError; return this.value; },
    setItem(key, value) { assert.equal(key, PLAYLISTS_KEY); this.writes++; if (this.writeError) throw this.writeError; this.value = value; },
  };
}

function queuedLocks() {
  let tail = Promise.resolve();
  return {
    request(key, action) {
      assert.equal(key, PLAYLISTS_KEY);
      const result = tail.then(action);
      tail = result.catch(() => {});
      return result;
    },
  };
}

test('playlist names collapse whitespace, preserve display case, and reject blank or oversized names', () => {
  assert.equal(normalizePlaylistName('  Evening\n\t Gallery  '), 'Evening Gallery');
  assert.equal(normalizePlaylistName('a'.repeat(80)), 'a'.repeat(80));
  for (const name of [undefined, null, 12, '', ' \n\t ']) assert.throws(() => normalizePlaylistName(name), /name/);
  assert.throws(() => normalizePlaylistName('a'.repeat(81)), /80 characters/);
});

test('saving and reloading preserves ordered mixed artwork fields, settings, and a named exhibition snapshot', () => {
  const store = storage();
  const works = [work('still'), work('clip', { kind: 'video', mediaUrl: 'https://media.example/clip.mp4', source: 'Google Drive' })];
  const settings = { duration: 120, captions: false, shuffle: true, fit: 'contain', transition: 'none' };
  const saved = savePlaylist(store, snapshot('  Main   show ', works, settings));
  assert.match(saved.id, /^[0-9a-f-]{36}$/i);
  assert.equal(saved.name, 'Main show');
  assert.ok(Number.isFinite(Date.parse(saved.updatedAt)));
  assert.equal(saved.exhibition.format, 'artdrops-exhibition');
  assert.equal(saved.exhibition.version, 1);
  assert.equal(saved.exhibition.name, 'Main show');
  assert.deepEqual(saved.exhibition.works.map(item => [item.id, item.kind, item.rotation, item.collection, item.source]), [
    ['still', 'image', 90, 'Paintings', 'Orkhan'], ['clip', 'video', 90, 'Paintings', 'Google Drive'],
  ]);
  assert.deepEqual(saved.exhibition.settings, settings);
  assert.deepEqual(listPlaylists(store), [saved]);
  assert.equal(store.writes, 1);
});

test('latest saved playlists sort first and explicit replacement retains its id', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 26) });
  const store = storage();
  const first = savePlaylist(store, snapshot('First'));
  t.mock.timers.tick(1000);
  const second = savePlaylist(store, snapshot('Second'));
  assert.deepEqual(listPlaylists(store).map(entry => entry.id), [second.id, first.id]);
  t.mock.timers.tick(1000);
  const replaced = savePlaylist(store, { ...snapshot('FIRST', [work('replacement')]), replaceId: first.id });
  assert.equal(replaced.id, first.id);
  assert.notEqual(replaced.updatedAt, first.updatedAt);
  assert.deepEqual(listPlaylists(store).map(entry => entry.id), [first.id, second.id]);
  assert.deepEqual(listPlaylists(store)[0].exhibition.works.map(item => item.id), ['replacement']);
});

test('duplicate names and mismatched or missing replacement targets never overwrite a playlist', () => {
  const store = storage();
  const first = savePlaylist(store, snapshot('Main Show'));
  const second = savePlaylist(store, snapshot('Other'));
  const before = store.value;
  assert.throws(() => savePlaylist(store, snapshot(' main\n SHOW ')), /already exists/);
  assert.throws(() => savePlaylist(store, { ...snapshot('Main Show'), replaceId: second.id }), /does not match/);
  assert.throws(() => savePlaylist(store, { ...snapshot('Renamed'), replaceId: first.id }), /does not match/);
  assert.throws(() => savePlaylist(store, { ...snapshot('Main Show'), replaceId: 'missing' }), /no longer exists/);
  assert.equal(store.value, before);
  assert.equal(store.writes, 2);
});

test('the twenty-playlist cap permits replacement but rejects new saves and conflicting restores', () => {
  const store = storage();
  const entries = Array.from({ length: MAX_PLAYLISTS }, (_, index) => savePlaylist(store, snapshot(`Show ${index}`)));
  assert.equal(MAX_PLAYLISTS, 20);
  const before = store.value;
  assert.throws(() => savePlaylist(store, snapshot('Overflow')), /20 playlists/);
  assert.equal(store.value, before);
  savePlaylist(store, { ...snapshot(entries[0].name, [work('new')]), replaceId: entries[0].id });
  assert.equal(listPlaylists(store).length, 20);
  const otherStore = storage();
  const removedElsewhere = savePlaylist(otherStore, snapshot('Another'));
  assert.throws(() => restorePlaylist(store, removedElsewhere), /20 playlists/);
  assert.equal(listPlaylists(store).length, 20);
});

test('two clients with stale lists can add or delete sequentially without losing the other client’s updates', () => {
  const store = storage();
  const staleClientA = listPlaylists(store), staleClientB = listPlaylists(store);
  const a = savePlaylist(store, snapshot('Client A'));
  const b = savePlaylist(store, snapshot('Client B'));
  assert.equal(staleClientA.length, 0);
  assert.equal(staleClientB.length, 0);
  assert.deepEqual(new Set(listPlaylists(store).map(entry => entry.id)), new Set([a.id, b.id]));
  deletePlaylist(store, a.id);
  assert.deepEqual(listPlaylists(store).map(entry => entry.id), [b.id]);
});

test('overlapping clients share a playlist lock and both saved snapshots survive', async () => {
  const store = storage(), locks = queuedLocks(), started = [];
  let releaseFirst;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  const first = withPlaylistLock(async () => {
    started.push('first');
    await firstGate;
    return savePlaylist(store, snapshot('Client A', [work('a')]));
  }, locks);
  const second = withPlaylistLock(() => {
    started.push('second');
    return savePlaylist(store, snapshot('Client B', [work('b')]));
  }, locks);
  await Promise.resolve();
  assert.deepEqual(started, ['first']);
  assert.equal(store.writes, 0);
  releaseFirst();
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(started, ['first', 'second']);
  assert.deepEqual(new Set(listPlaylists(store).map(entry => entry.id)), new Set([a.id, b.id]));
  assert.deepEqual(new Set(listPlaylists(store).map(entry => entry.exhibition.works[0].id)), new Set(['a', 'b']));
  assert.equal(store.writes, 2);
});

test('a rejected storage write releases the lock so the next client can save', async () => {
  const store = storage(), locks = queuedLocks();
  store.writeError = new Error('Quota exceeded');
  const failed = withPlaylistLock(() => savePlaylist(store, snapshot('Failed')), locks);
  const next = withPlaylistLock(() => {
    assert.equal(store.value, null);
    store.writeError = null;
    return savePlaylist(store, snapshot('Next'));
  }, locks);
  await assert.rejects(failed, /storage may be full/);
  const saved = await next;
  assert.deepEqual(listPlaylists(store), [saved]);
});

test('without Web Locks the action runs asynchronously and preserves results and failures', async () => {
  let ran = false;
  const pending = withPlaylistLock(() => { ran = true; return 'saved'; }, null);
  assert.equal(ran, false);
  assert.equal(await pending, 'saved');
  assert.equal(ran, true);
  assert.equal(await withPlaylistLock(async () => 'async result', {}), 'async result');
  const failure = new Error('Cannot save');
  await assert.rejects(withPlaylistLock(() => { throw failure; }, null), error => error === failure);
});

test('delete returns a detached snapshot for Undo and restore never replaces a conflicting id or name', () => {
  const store = storage();
  const original = savePlaylist(store, snapshot('Night show'));
  const removed = deletePlaylist(store, original.id);
  assert.deepEqual(removed, original);
  assert.deepEqual(listPlaylists(store), []);
  assert.deepEqual(restorePlaylist(store, removed), original);
  const before = store.value;
  assert.throws(() => restorePlaylist(store, removed), /already exists/);
  assert.equal(store.value, before);
  deletePlaylist(store, original.id);
  const replacement = savePlaylist(store, snapshot('NIGHT SHOW'));
  assert.throws(() => restorePlaylist(store, removed), /already exists/);
  assert.deepEqual(listPlaylists(store).map(entry => entry.id), [replacement.id]);
  assert.throws(() => deletePlaylist(store, original.id), /no longer exists/);
});

test('input changes and returned object mutations cannot change saved snapshots', () => {
  const store = storage();
  const works = [work('a')], settings = { duration: 60, fit: 'contain' };
  const saved = savePlaylist(store, snapshot('Stable', works, settings));
  works[0].title = 'Changed input'; works.push(work('b')); settings.duration = 10;
  saved.name = 'Changed return'; saved.exhibition.works[0].title = 'Changed return';
  const listed = listPlaylists(store);
  assert.equal(listed[0].name, 'Stable');
  assert.equal(listed[0].exhibition.works.length, 1);
  assert.equal(listed[0].exhibition.works[0].title, 'Artwork a');
  assert.equal(listed[0].exhibition.settings.duration, 60);
  listed[0].exhibition.settings.duration = 20;
  assert.equal(listPlaylists(store)[0].exhibition.settings.duration, 60);
});

test('blank or missing storage is empty, whereas invalid JSON and envelopes are protected', () => {
  for (const value of [null, '', ' \n ']) assert.deepEqual(listPlaylists(storage(value)), []);
  const invalid = ['{', 'null', '[]', '{}', JSON.stringify({ format: 'other', version: 1, playlists: [] }),
    JSON.stringify({ format: 'artdrops-playlists', version: 2, playlists: [] }),
    JSON.stringify({ format: 'artdrops-playlists', version: 1, playlists: {} })];
  for (const raw of invalid) {
    const store = storage(raw);
    assert.throws(() => listPlaylists(store), /could not be read/);
    assert.throws(() => savePlaylist(store, snapshot('New')), /left untouched/);
    assert.throws(() => deletePlaylist(store, 'anything'), /left untouched/);
    assert.equal(store.value, raw);
    assert.equal(store.writes, 0);
  }
});

test('invalid entries, duplicate ids or names, and oversized libraries are not silently repaired', () => {
  const valid = savePlaylist(storage(), snapshot('Valid'));
  const malformed = [
    [{ ...valid, id: '' }], [{ ...valid, id: 3 }], [{ ...valid, name: ' ' }],
    [{ ...valid, updatedAt: 'not a date' }], [{ ...valid, exhibition: { ...valid.exhibition, version: 2 } }],
    [{ ...valid, exhibition: { ...valid.exhibition, name: 'Mismatch' } }],
    [{ ...valid, exhibition: { ...valid.exhibition, works: [] } }],
    [valid, valid], [valid, { ...valid, id: 'different', name: 'VALID', exhibition: { ...valid.exhibition, name: 'VALID' } }],
    Array.from({ length: 21 }, (_, index) => ({ ...valid, id: String(index), name: String(index), exhibition: { ...valid.exhibition, name: String(index) } })),
  ];
  for (const entries of malformed) {
    const raw = envelope(entries), store = storage(raw);
    assert.throws(() => listPlaylists(store), /could not be read/);
    assert.throws(() => restorePlaylist(store, valid), /left untouched/);
    assert.equal(store.value, raw);
    assert.equal(store.writes, 0);
  }
});

test('storage access and quota failures are explicit and never report a successful mutation', () => {
  const store = storage();
  const entry = savePlaylist(store, snapshot('Saved'));
  const before = store.value;
  store.writeError = Object.assign(new Error('Full'), { name: 'QuotaExceededError' });
  assert.throws(() => savePlaylist(store, snapshot('Another')), /storage may be full/);
  assert.throws(() => savePlaylist(store, { ...snapshot('Saved', [work('new')]), replaceId: entry.id }), /storage may be full/);
  assert.throws(() => deletePlaylist(store, entry.id), /storage may be full/);
  assert.equal(store.value, before);
  store.writeError = null;
  const removed = deletePlaylist(store, entry.id);
  const empty = store.value;
  store.writeError = new Error('Storage disabled');
  assert.throws(() => restorePlaylist(store, removed), /unavailable/);
  assert.equal(store.value, empty);
  store.readError = new Error('SecurityError');
  const writes = store.writes;
  for (const operation of [() => listPlaylists(store), () => savePlaylist(store, snapshot('X')), () => deletePlaylist(store, entry.id), () => restorePlaylist(store, entry)]) {
    assert.throws(operation, /unavailable in this browser/);
  }
  assert.equal(store.writes, writes);
});

test('empty, duplicate, invalid or oversized artwork queues cannot create partial saved playlists', () => {
  const store = storage();
  for (const works of [[], [work('a'), work('a')], [work('a', { mediaUrl: 'javascript:alert(1)' })], Array.from({ length: 151 }, (_, index) => work(String(index)))]) {
    assert.throws(() => savePlaylist(store, snapshot('Invalid', works)));
  }
  assert.equal(store.value, null);
  assert.equal(store.writes, 0);
});

test('snapshots exceeding the export size limit cannot create or replace saved playlists', () => {
  const store = storage();
  const original = savePlaylist(store, snapshot('Saved'));
  const before = store.value, writes = store.writes;
  const works = [work('large', { mediaUrl: `https://media.example/large.jpg?token=${'x'.repeat(MAX_EXHIBITION_BYTES)}` })];
  assert.throws(() => savePlaylist(store, snapshot('Too large', works)), /2 MB JSON limit/);
  assert.throws(() => savePlaylist(store, { ...snapshot('Saved', works), replaceId: original.id }), /2 MB JSON limit/);
  assert.equal(store.value, before);
  assert.equal(store.writes, writes);
  assert.deepEqual(listPlaylists(store), [original]);
});

test('a saved v1 exhibition without an optional backup name remains compatible', () => {
  const legacy = { id: 'legacy-playlist', name: 'Legacy', updatedAt: '2026-10-20T12:00:00.000Z', exhibition: makeExhibition([work('old')], { duration: 60 }) };
  delete legacy.exhibition.name;
  const store = storage(envelope([legacy]));
  assert.equal(listPlaylists(store)[0].name, 'Legacy');
  assert.equal(listPlaylists(store)[0].exhibition.works[0].id, 'old');
  const removed = deletePlaylist(store, legacy.id);
  restorePlaylist(store, removed);
  assert.equal(listPlaylists(store)[0].exhibition.settings.duration, 60);
});
