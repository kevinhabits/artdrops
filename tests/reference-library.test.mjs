import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanWork, displayDimensions, filterWorks, isPortraitScreenWork, portraitCoverage,
  portraitScreenWorks, makeExhibition, readExhibition, uniqueWorks, MAX_CATALOG_WORKS, MAX_WORKS,
} from '../src/core.js';

const image = (id, extra = {}) => ({
  id, title: `Painting ${id}`, artist: 'Example Artist', kind: 'image', source: 'Orkhan',
  collection: 'Paintings', mediaUrl: `https://media.example/${id}.jpg`, width: 1080, height: 1920,
  ...extra,
});
const video = (id, extra = {}) => image(id, { kind: 'video', mediaUrl: `https://media.example/${id}.mp4`, source: 'objkt', ...extra });
const ids = (works) => works.map(work => work.id);

test('still and moving filters separate photographs, paintings, videos, and animated images', () => {
  const works = [
    image('painting'),
    image('photo', { collection: 'Photography', source: 'Verse' }),
    video('video', { collection: 'Motion' }),
    image('gif', { collection: 'Motion', mediaUrl: 'https://media.example/animation.gif', animated: true }),
  ].map(cleanWork);
  assert.deepEqual(ids(filterWorks(works, { media: 'still' })), ['painting', 'photo']);
  assert.deepEqual(ids(filterWorks(works, { media: 'moving' })), ['video', 'gif']);
  assert.deepEqual(ids(filterWorks(works, { media: 'all' })), ['painting', 'photo', 'video', 'gif']);
  assert.deepEqual(ids(works), ['painting', 'photo', 'video', 'gif']);
});

test('collection, media, source, shape and normalized text filters combine without losing order', () => {
  const works = [
    image('a', { collection: 'Paper Studies', artist: 'Ada', source: 'Verse' }),
    image('b', { collection: 'Paper Studies', artist: 'Ada', source: 'Verse', width: 1920, height: 1080 }),
    video('c', { collection: 'Paper Studies', artist: 'Ada', source: 'Verse' }),
    image('d', { collection: 'Paper Studies', artist: 'Ada', source: 'Orkhan' }),
    image('e', { collection: 'Other', artist: 'Ada', source: 'Verse' }),
  ].map(cleanWork);
  assert.deepEqual(ids(filterWorks(works, { collection: 'Paper Studies', media: 'still', source: 'Verse', shape: 'screen-portrait', search: 'ＡＤＡ' })), ['a']);
  assert.deepEqual(ids(filterWorks(works, { search: 'paper studies' })), ['a', 'b', 'c', 'd']);
  assert.deepEqual(ids(filterWorks(works, { collection: 'Other' })), ['e']);
  assert.equal(filterWorks(works, { collection: 'Missing collection' }).length, 0);
  assert.deepEqual(ids(filterWorks(works, {})), ['a', 'b', 'c', 'd', 'e']);
});

test('quarter-turn rotation changes orientation and portrait eligibility for both media types', () => {
  for (const kind of ['image', 'video']) {
    const original = kind === 'image' ? image('a', { width: 1920, height: 1080 }) : video('a', { width: 1920, height: 1080 });
    for (const rotation of [90, 270]) {
      const work = cleanWork({ ...original, rotation });
      assert.deepEqual(displayDimensions(work), { width: 1080, height: 1920 });
      assert.equal(work.orientation, 'portrait');
      assert.equal(isPortraitScreenWork(work), true);
      assert.equal(portraitCoverage(work), 1);
    }
    for (const rotation of [0, 180]) {
      const work = cleanWork({ ...original, rotation });
      assert.equal(work.orientation, 'landscape');
      assert.equal(isPortraitScreenWork(work), false);
    }
    const lowResolution = cleanWork({ ...original, width: 1280, height: 720, rotation: 90 });
    assert.equal(lowResolution.orientation, 'portrait');
    assert.equal(isPortraitScreenWork(lowResolution), false);
    const turnedPortrait = cleanWork({ ...original, width: 1080, height: 1920, rotation: 90 });
    assert.equal(turnedPortrait.orientation, 'landscape');
    assert.equal(isPortraitScreenWork(turnedPortrait), false);
  }
});

test('rotation normalization preserves valid turns and rejects unsupported transforms', () => {
  assert.equal(cleanWork(image('a', { rotation: '90' })).rotation, 90);
  for (const rotation of [45, -90, 360, 'rotate(90deg)', '<script>', Infinity]) {
    const work = cleanWork(image('a', { rotation }));
    assert.equal(work.rotation, 0);
    assert.equal(work.orientation, 'portrait');
  }
});

test('mixed-media exhibition backups preserve collection, rotation, animation and source details', () => {
  const works = [
    video('personal', { collection: 'Personal videos', source: 'Google Drive', width: 1920, height: 1080, rotation: 90 }),
    image('painting', { collection: 'Paintings', rotation: 180, posterUrl: 'https://media.example/painting-small.webp', alternateMediaUrl: 'https://backup.example/painting.jpg' }),
    image('animation', { collection: 'Motion studies', mediaUrl: 'https://media.example/animation.gif', animated: true, rotation: 270 }),
  ];
  const restored = readExhibition(JSON.parse(JSON.stringify(makeExhibition(works, { duration: 60, fit: 'contain', transition: 'fade' }))));
  assert.deepEqual(restored.works, works.map(cleanWork));
  assert.deepEqual(restored.works.map(work => [work.kind, work.collection, work.rotation, work.animated]), [
    ['video', 'Personal videos', 90, false], ['image', 'Paintings', 180, false], ['image', 'Motion studies', 270, true],
  ]);
  assert.equal(restored.works[0].orientation, 'portrait');
  assert.equal(restored.works[0].source, 'Google Drive');
});

test('unsafe image links are rejected before catalog display or exhibition import', () => {
  const invalid = [
    'javascript:alert(1)', 'data:image/svg+xml,<svg/>', 'file:///photo.jpg', 'http://media.example/photo.jpg',
    'https://user:password@media.example/photo.jpg', 'https://media.example/art.svg?download=1',
    'https://media.example/page.html', 'https://media.example/code.js#art', 'https://media.example/document.pdf',
    'https://media.example/video.mp4', 'https://media.example/video.webm',
  ];
  for (const mediaUrl of invalid) assert.equal(cleanWork(image('unsafe', { mediaUrl })), null, mediaUrl);
  for (const extension of ['jpg', 'jpeg', 'png', 'webp', 'gif']) {
    assert.ok(cleanWork(image('valid', { mediaUrl: `https://media.example/art.${extension}` })));
  }
  const exported = makeExhibition([image('safe')], {});
  assert.throws(() => readExhibition({ ...exported, works: [...exported.works, image('unsafe', { mediaUrl: invalid[0] })] }), /invalid/);
  assert.deepEqual(ids(exported.works), ['safe']);
});

test('a library of over one thousand works remains fully filterable beyond the exhibition limit', () => {
  const raw = Array.from({ length: 1234 }, (_, index) => image(`work-${index}`, { collection: index < 1200 ? 'Earlier works' : 'Final collection' }));
  const library = uniqueWorks(raw, MAX_CATALOG_WORKS);
  assert.equal(library.length, raw.length);
  assert.deepEqual(ids(filterWorks(library, { collection: 'Final collection' })), ids(raw.slice(1200)));
  assert.deepEqual(ids(filterWorks(library, { search: 'work-1233', media: 'still' })), ['work-1233']);
  assert.equal(portraitScreenWorks(library).length, raw.length);
  assert.equal(uniqueWorks(raw).length, MAX_WORKS);
  assert.throws(() => readExhibition({ ...makeExhibition([], {}), works: library }), /up to 150/);
});

test('the catalog cap counts five thousand valid unique works independently of queue capacity', () => {
  assert.equal(MAX_CATALOG_WORKS, 5000);
  const raw = Array.from({ length: 5001 }, (_, index) => image(`work-${index}`));
  const library = uniqueWorks([raw[0], { ...raw[0], id: 'invalid', mediaUrl: 'javascript:alert(1)' }, ...raw], MAX_CATALOG_WORKS);
  assert.equal(library.length, 5000);
  assert.equal(new Set(ids(library)).size, 5000);
  assert.equal(library.at(-1).id, 'work-4999');
  assert.deepEqual(ids(filterWorks(library, { search: 'work-4999' })), ['work-4999']);
  assert.equal(library.some(work => work.id === 'work-5000'), false);
});
