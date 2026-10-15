import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanWork, cleanSettings, filterWorks, moveItem, makeExhibition, makeHourMix, makePortraitMix, portraitScreenWorks, isPortraitScreenWork, portraitCoverage, readExhibition, safeUrl, uniqueWorks, rememberCustomWork, MAX_WORKS, MAX_CATALOG_WORKS, durationLabel } from '../src/core.js';
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
test('one-hour mix uses 120 distinct playable works and preserves display preferences', () => {
  const works = Array.from({ length: 132 }, (_, index) => ({ ...work, id: String(index) }));
  const settings = { duration: 120, shuffle: false, captions: false, fit: 'cover' };
  const mix = makeHourMix([works[0], ...works], settings);
  assert.equal(mix.works.length, 120);
  assert.equal(new Set(mix.works.map(item => item.id)).size, 120);
  assert.equal(mix.works.length * mix.settings.duration, 3600);
  assert.deepEqual(mix.settings, { duration: 30, shuffle: true, captions: false, fit: 'cover' });
  assert.deepEqual(readExhibition(makeExhibition(mix.works, mix.settings)), mix);
  assert.equal(settings.duration, 120);
  assert.equal(works.length, 132);
  assert.equal(makeHourMix(works.slice(0, 119), settings), null);
  assert.equal(makeHourMix([...works.slice(0, 119), works[0], { ...work, id: 'bad', kind: 'image' }], settings), null);
});
test('long exhibition durations stay readable', () => {
  assert.equal(durationLabel(120, 30), '1 hr loop');
  assert.equal(durationLabel(132, 30), '1 hr 6 min loop');
  assert.equal(durationLabel(120, 120), '4 hr loop');
});
test('portrait screen selection requires high-resolution art with at least 90% uncropped coverage', () => {
  for (const [width, height] of [[1080, 1920], [2160, 3840], [1200, 1920], [1440, 2560]]) {
    assert.equal(isPortraitScreenWork({ ...work, width, height }), true);
  }
  for (const [width, height] of [[720, 1280], [1080, 1350], [2160, 2160], [1920, 1080], [1080, 2400], [1201, 1920], [Infinity, 3840], [2160, NaN]]) {
    assert.equal(isPortraitScreenWork({ ...work, width, height }), false);
  }
  assert.equal(isPortraitScreenWork(null), false);
  assert.equal(portraitCoverage({ width: 2160, height: 3840 }), 1);
  assert.ok(Math.abs(portraitCoverage({ width: 1200, height: 1920 }) - 0.9) < 1e-9);
  const portrait = cleanWork({ ...work, width: 2160, height: 3840 });
  assert.deepEqual(filterWorks([cleanWork(work), portrait], { shape: 'screen-portrait', source: 'objkt' }), [portrait]);
});
test('a larger catalog preserves portrait works past the exhibition queue limit', () => {
  const landscape = Array.from({ length: 150 }, (_, i) => ({ ...work, id: `wide-${i}` }));
  const portraits = Array.from({ length: 60 }, (_, i) => ({ ...work, id: `tall-${i}`, width: 1080, height: 1920 }));
  portraits[0] = { ...portraits[0], width: 2160, height: 3840 };
  const catalog = [...landscape, ...portraits];
  assert.equal(uniqueWorks(catalog).length, 150);
  assert.equal(uniqueWorks(catalog, MAX_CATALOG_WORKS).length, 210);
  assert.equal(portraitScreenWorks(catalog).length, 60);
  assert.equal(portraitScreenWorks(catalog)[0].id, 'tall-0');
  const mix = makePortraitMix(catalog, { duration: 30, fit: 'cover', captions: false, shuffle: false });
  assert.equal(mix.works.length, 60);
  assert.deepEqual(mix.settings, { duration: 60, fit: 'contain', captions: false, shuffle: true });
  assert.equal(mix.works.length * mix.settings.duration, 3600);
  assert.deepEqual(readExhibition(makeExhibition(mix.works, mix.settings)), mix);
  assert.equal(catalog.length, 210);
  assert.throws(() => readExhibition({ ...makeExhibition([], {}), works: catalog }), /up to 150/);
});
test('portrait mix keeps a full hour with a smaller selection and never fills with landscape works', () => {
  const works = Array.from({ length: 40 }, (_, i) => ({ ...work, id: String(i), width: 1080, height: 1920 }));
  const mix = makePortraitMix(works, {});
  assert.equal(mix.works.length, 30);
  assert.equal(mix.settings.duration, 120);
  assert.equal(mix.works.length * mix.settings.duration, 3600);
  assert.equal(makePortraitMix([...works.slice(0, 29), work], {}), null);
});
