import test from 'node:test';
import assert from 'node:assert/strict';
import { appHarness, deferred, STORAGE_KEY } from './helpers/app-harness.mjs';
import { PLAYLISTS_KEY } from '../src/playlists.js';

const work = (id, extra = {}) => ({
  id, title: `Artwork ${id}`, artist: 'Example artist', kind: 'image', source: 'Orkhan',
  collection: 'Studies', mediaUrl: `https://media.example/${id}.webp`,
  width: 1920, height: 1080, ...extra,
});
const mixed = [
  work('painting', { rotation: 90, alternateMediaUrl: 'https://backup.example/painting.webp' }),
  work('video', { kind: 'video', source: 'Your links', mediaUrl: 'https://media.example/video.mp4', width: 1080, height: 1920 }),
  work('animation', { mediaUrl: 'https://media.example/animation.gif', animated: true, rotation: 180 }),
];
const settings = { duration: 60, fit: 'cover', transition: 'none', captions: false, shuffle: true };
const exhibition = (works = mixed, name = 'Evening studies', preferences = settings) => ({
  format: 'artdrops-exhibition', version: 1, name, works, settings: preferences,
});
const contents = ({ name, works, settings }) => ({ name, works, settings });
const catalog = [work('catalog', { width: 1080, height: 1920 })];
const boot = options => appHarness({ stored: exhibition(), catalog, ...options });
const snapshot = async app => contents((await app.exportFile()).json);
const savedEntries = app => JSON.parse(app.storage.get(PLAYLISTS_KEY)).playlists;
const playlistButton = (app, label) => {
  const button = app.node('playlist-list').querySelectorAll('button').find(item => item.getAttribute('aria-label') === label);
  assert.ok(button, `expected playlist control: ${label}`);
  return button;
};
async function saveCurrent(app, name) {
  await app.click('playlists');
  app.node('playlist-name').value = name;
  await app.node('playlist-name').dispatch('input');
  await app.node('playlist-form').dispatch('submit');
  assert.equal(app.node('playlist-error').hidden, true);
}

test('the actual export handler creates an attached download anchor with a mixed-media JSON Blob', async () => {
  const app = await boot();
  const download = await app.exportFile();
  assert.equal(download.blob.type, 'application/json');
  assert.equal(download.connected, true, 'the anchor is attached before its simulated click');
  assert.match(download.filename, /^artdrops-.*\.json$/);
  assert.match(download.href, /^blob:/);
  assert.equal(download.json.format, 'artdrops-exhibition');
  assert.equal(download.json.name, 'Evening studies');
  assert.deepEqual(download.json.settings, settings);
  assert.deepEqual(download.json.works.map(({ id, kind, rotation, animated }) => [id, kind, rotation, animated]), [
    ['painting', 'image', 90, false], ['video', 'video', 0, false], ['animation', 'image', 180, true],
  ]);
  assert.equal(download.json.works[0].alternateMediaUrl, 'https://backup.example/painting.webp');
});

test('the actual exported Blob imports into another app instance and Undo restores the prior exhibition', async () => {
  const source = await boot();
  const backup = await source.exportFile();
  const destination = await boot({ stored: exhibition([work('previous')], 'Previous show', { ...settings, duration: 20 }) });
  const previous = await snapshot(destination);
  await destination.importFile(backup.blob);
  assert.equal(destination.node('duration').value, '60');
  assert.equal(destination.node('captions').checked, false);
  assert.equal(destination.node('import-file').value, '');
  assert.deepEqual(contents(JSON.parse(destination.storage.get(STORAGE_KEY))), contents(backup.json));
  await destination.click('toast-undo');
  assert.deepEqual(await snapshot(destination), previous);
});

test('invalid JSON and invalid artwork imports leave the working exhibition and storage unchanged', async () => {
  const app = await boot();
  const before = await snapshot(app);
  const stored = app.storage.get(STORAGE_KEY);
  for (const text of ['{not json', JSON.stringify({ ...exhibition(), version: 99 }), JSON.stringify(exhibition([mixed[0], mixed[0]])), JSON.stringify(exhibition([work('bad', { mediaUrl: 'javascript:alert(1)' })]))]) {
    await app.importText(text);
    assert.deepEqual(await snapshot(app), before);
    assert.equal(app.storage.get(STORAGE_KEY), stored);
  }
});

test('a BOM-prefixed backup imports its name, artwork order and display settings', async () => {
  const app = await boot({ stored: exhibition([work('old')], 'Old show') });
  const text = `\uFEFF${JSON.stringify(exhibition(mixed, 'BOM show'))}`;
  await app.importFile({ size: Buffer.byteLength(text), text: async () => text });
  const actual = await snapshot(app);
  assert.equal(actual.name, 'BOM show');
  assert.deepEqual(actual.works.map(item => item.id), mixed.map(item => item.id));
  assert.deepEqual(actual.settings, settings);
});

test('an earlier slow file read cannot replace a later completed import', async () => {
  const app = await boot();
  const read = deferred();
  const pending = app.importFile({ size: 1000, text: () => read.promise });
  await app.importText(JSON.stringify(exhibition([work('newer')], 'Latest import')));
  read.resolve(JSON.stringify(exhibition([work('older')], 'Earlier import')));
  await pending;
  const actual = await snapshot(app);
  assert.equal(actual.name, 'Latest import');
  assert.deepEqual(actual.works.map(item => item.id), ['newer']);
});

test('a pending import cannot erase a later settings edit or queue removal', async () => {
  for (const edit of ['settings', 'queue']) {
    const app = await boot();
    const read = deferred();
    const pending = app.importFile({ size: 1000, text: () => read.promise });
    if (edit === 'settings') await app.change('duration', '120');
    else await app.node('queue-list').children[0].querySelector('.queue-remove').click();
    const expected = await snapshot(app);
    read.resolve(JSON.stringify(exhibition([work('stale')], 'Stale file')));
    await pending;
    assert.deepEqual(await snapshot(app), expected, edit);
  }
});

test('loading a saved playlist defeats an earlier pending import and restores the saved snapshot', async () => {
  const app = await boot();
  const expected = await snapshot(app);
  await saveCurrent(app, 'Saved show');
  await app.importText(JSON.stringify(exhibition([work('different')], 'Working draft')));
  const read = deferred();
  const pending = app.importFile({ size: 1000, text: () => read.promise });
  await app.click('playlists');
  await playlistButton(app, 'Load Saved show').click();
  read.resolve(JSON.stringify(exhibition([work('stale')], 'Stale file')));
  await pending;
  assert.deepEqual(await snapshot(app), { ...expected, name: 'Saved show' });
});

test('replacing a saved playlist requires a second submit and Cancel preserves the old snapshot', async () => {
  const app = await boot();
  await saveCurrent(app, 'My saved show');
  const previous = savedEntries(app)[0];
  await app.importText(JSON.stringify(exhibition([work('replacement')], 'Draft', { ...settings, duration: 120 })));
  await saveCurrent(app, 'My saved show');
  assert.deepEqual(savedEntries(app), [previous], 'first submit must not overwrite a same-name playlist');
  assert.equal(app.node('playlist-replace-note').hidden, false);
  await app.click('playlist-cancel-replace');
  assert.equal(app.node('playlist-replace-note').hidden, true);
  assert.deepEqual(savedEntries(app), [previous]);
  await app.node('playlist-form').dispatch('submit');
  assert.deepEqual(savedEntries(app), [previous], 'cancellation requires a fresh confirmation');
  await app.node('playlist-form').dispatch('submit');
  const entries = savedEntries(app);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, previous.id);
  assert.deepEqual(entries[0].exhibition.works.map(item => item.id), ['replacement']);
  assert.equal(entries[0].exhibition.settings.duration, 120);
  assert.equal(app.node('playlists-dialog').open, false);
});

test('deleting a playlist leaves the current exhibition intact and Undo restores the saved entry', async () => {
  const app = await boot();
  await saveCurrent(app, 'Keep this show');
  const saved = savedEntries(app)[0];
  await app.importText(JSON.stringify(exhibition([work('current')], 'Current show')));
  const current = app.storage.get(STORAGE_KEY);
  await app.click('playlists');
  await playlistButton(app, 'Delete Keep this show').click();
  assert.deepEqual(savedEntries(app), []);
  assert.equal(app.storage.get(STORAGE_KEY), current);
  assert.equal(app.node('playlists-dialog').open, false, 'Undo must be outside a closed modal');
  assert.equal(app.node('toast-undo').hidden, false);
  await app.click('toast-undo');
  assert.deepEqual(savedEntries(app), [saved]);
  assert.equal(app.storage.get(STORAGE_KEY), current);
  const reloaded = await appHarness({ storage: app.storage, catalog });
  await reloaded.click('playlists');
  await playlistButton(reloaded, 'Load Keep this show').click();
  assert.deepEqual(await snapshot(reloaded), contents(saved.exhibition));
});

test('a saved playlist exports its own detached snapshot while another exhibition is being edited', async () => {
  const app = await boot();
  await saveCurrent(app, 'Backup show');
  const saved = savedEntries(app)[0];
  await app.importText(JSON.stringify(exhibition([work('unrelated')], 'Working show', { ...settings, duration: 10 })));
  const working = app.storage.get(STORAGE_KEY);
  await app.click('playlists');
  await playlistButton(app, 'Export Backup show as JSON').click();
  const download = app.downloads.at(-1);
  assert.equal(download.connected, true);
  assert.deepEqual(contents(JSON.parse(await download.blob.text())), contents(saved.exhibition));
  assert.equal(app.storage.get(STORAGE_KEY), working);
  assert.equal(app.node('playlists-dialog').open, false);
});

test('catalog completion and reload preserve saved artwork rotation and media despite matching IDs', async () => {
  const saved = work('shared', { rotation: 90, mediaUrl: 'https://saved.example/custom.webp', title: 'Saved version' });
  const fresh = work('shared', { rotation: 0, mediaUrl: 'https://catalog.example/replacement.webp', title: 'New catalog version' });
  const gate = deferred();
  const app = await boot({ stored: exhibition([saved], 'Saved snapshot'), catalog: [fresh], catalogGate: gate });
  const before = await snapshot(app);
  gate.resolve();
  await app.flush();
  assert.deepEqual(await snapshot(app), before);
  await app.click('retry-catalog');
  assert.deepEqual(await snapshot(app), before);
  const reloaded = await appHarness({ storage: app.storage, catalog: [fresh] });
  assert.deepEqual(await snapshot(reloaded), before);
});
