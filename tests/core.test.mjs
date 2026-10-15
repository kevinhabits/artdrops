import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanWork, cleanSettings, filterWorks, moveItem, makeExhibition, readExhibition, safeUrl, uniqueWorks, rememberCustomWork, MAX_WORKS, durationLabel } from '../src/core.js';
const work = { id: '1', title: 'Moving Colors', artist: 'A Person', kind: 'video', mediaUrl: 'https://example.com/art.mp4', width: 1920, height: 1080, source: 'objkt', sourceUrl: 'https://objkt.com/tokens/1' };
test('import/export preserves order and display preferences', () => {
  const exported = makeExhibition([work, { ...work, id: '2', title: 'Second' }], { duration: 60, captions: false, shuffle: true, fit: 'cover' });
  const imported = readExhibition(JSON.parse(JSON.stringify(exported)));
  assert.deepEqual(imported.works.map(item => item.id), ['1', '2']);
  assert.deepEqual(imported.settings, { duration: 60, captions: false, shuffle: true, fit: 'cover' });
});
test('rejects malformed imports atomically instead of silently dropping artworks', () => {
  assert.throws(() => readExhibition({ format: 'artdrops-exhibition', version: 1, works: [work, { ...work, mediaUrl: 'javascript:alert(1)', id: 'evil' }] }), /invalid/);
  assert.throws(() => readExhibition({ format: 'artdrops-exhibition', version: 1, works: [work, work] }), /duplicate/);
  assert.throws(() => readExhibition({ works: [] }), /ArtDrops/);
});
test('user URLs cannot inject executable content, inline documents, credentials or still images', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'http://example.com/a.mp4', 'https://user:secret@example.com/art.mp4']) assert.equal(safeUrl(url), null);
  for (const url of ['https://example.com/a.jpg', 'https://example.com/a.svg?q=1', 'https://example.com/test.html']) assert.equal(cleanWork({ ...work, mediaUrl: url }), null);
  assert.equal(cleanWork({ ...work, kind: 'iframe' }), null);
});
test('media identity and orientation survive catalog normalization', () => {
  assert.equal(cleanWork(work).orientation, 'landscape');
  assert.equal(cleanWork({ ...work, width: 1080, height: 1920 }).orientation, 'portrait');
  assert.equal(cleanWork({ ...work, width: 1080 }).orientation, 'square');
  assert.equal(cleanWork({ ...work, mediaUrl: 'https://assets.objkt.media/file/assets-003/cid/artifact' }).mediaUrl, 'https://assets.objkt.media/file/assets-003/cid/artifact');
});
test('filters combine artist/title, source and shape without changing catalog order', () => {
  const works = [cleanWork(work), cleanWork({ ...work, id: '2', artist: 'B Person', source: 'Verse', width: 100 })];
  assert.deepEqual(filterWorks(works, { search: 'a person', source: 'objkt', shape: 'landscape' }).map(x => x.id), ['1']);
  assert.equal(filterWorks(works, { search: 'missing' }).length, 0);
  assert.equal(filterWorks(works, { source: 'Verse', shape: 'landscape' }).length, 0);
});
test('reordering handles both ends without losing or duplicating works', () => {
  assert.deepEqual(moveItem(['a', 'b', 'c'], 1, -1), ['b', 'a', 'c']);
  assert.deepEqual(moveItem(['a', 'b', 'c'], 0, -1), ['a', 'b', 'c']);
  assert.deepEqual(moveItem(['a', 'b', 'c'], 2, 1), ['a', 'b', 'c']);
  assert.deepEqual(moveItem(['a', 'b', 'c'], 1, 1), ['a', 'c', 'b']);
});
test('untrusted settings stay within supported player values', () => {
  assert.deepEqual(cleanSettings({ duration: -1, fit: '<script>', captions: false, shuffle: 'true' }), { duration: 30, fit: 'contain', captions: false, shuffle: false });
  assert.equal(uniqueWorks([work, work]).length, 1);
  assert.equal(durationLabel(6, 30), '3 min loop');
});
test('a full custom library makes room without losing any selected exhibition works', () => {
  const custom = Array.from({ length: MAX_WORKS }, (_, index) => ({ ...work, id: `custom:${index}` }));
  const queue = custom.slice(1);
  const incoming = { ...work, id: 'custom:new' };
  const remembered = rememberCustomWork(custom, incoming, queue);
  assert.equal(remembered.length, MAX_WORKS);
  assert.ok(remembered.some(item => item.id === incoming.id));
  assert.ok(queue.every(selected => remembered.some(item => item.id === selected.id)));
  assert.equal(remembered.some(item => item.id === custom[0].id), false);
  assert.equal(custom.length, MAX_WORKS);
});
