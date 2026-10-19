import test from 'node:test';
import assert from 'node:assert/strict';
import { ExhibitionPlayer, safeMediaUrl } from '../src/player.js';

const imageWork = (id, extra = {}) => ({ id, title: id, kind: 'image', mediaUrl: `https://media.example/${id}.jpg`, ...extra });
const videoWork = (id) => ({ id, title: id, kind: 'video', mediaUrl: `https://media.example/${id}.mp4` });

function element() {
  const classes = new Set();
  return {
    style: { setProperty(name, value) { this[name] = value; } },
    classList: { add(value) { classes.add(value); }, remove(value) { classes.delete(value); }, contains(value) { return classes.has(value); } },
    clientWidth: 1920, clientHeight: 1080,
  };
}

function fixture(t, works = [imageWork('a'), videoWork('b'), imageWork('c')]) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const previousDocument = globalThis.document;
  globalThis.document = { hidden: false, body: { style: {} } };
  let now = 1000;
  t.mock.method(performance, 'now', () => now);
  const slots = [0, 1].map(() => {
    const frame = element();
    const video = {
      ...element(), src: '', readyState: 4, videoWidth: 1920, currentTime: 0, error: null, paused: true, playCalls: 0,
      pause() { this.paused = true; },
      play() { this.paused = false; this.playCalls++; return Promise.resolve(); },
      load() { this.currentTime = 0; this.error = null; },
      getAttribute() { return this.src; },
      removeAttribute(name) { if (name === 'src') this.src = ''; },
    };
    let source = '';
    const image = {
      ...element(), complete: false, naturalWidth: 0, loads: [],
      get src() { return source; },
      set src(value) { source = value; this.complete = false; this.naturalWidth = 0; this.loads.push({ source, visible: frame.classList.contains('is-active') }); },
      getAttribute() { return source; },
      removeAttribute(name) { if (name === 'src') { source = ''; this.complete = false; this.naturalWidth = 0; } },
      decode() { return Promise.resolve(); },
    };
    return { frame, video, image, work: null, watchdog: null };
  });
  const player = new ExhibitionPlayer();
  Object.assign(player, {
    opened: true, session: 1, slots, order: works, position: 0,
    settings: { duration: 60, shuffle: false, transition: 'fade' },
    failed: new Set(), paused: false, needsPlayGesture: false,
    active: null, pending: null, nextPlan: null, elapsed: 0, startedAt: null,
    message: {}, title: {}, artist: {}, counter: {}, caption: {},
    dialog: { ...element(), remove() {} }, progress: element(),
    pauseButton: { setAttribute() {} }, showControls() {}, releaseFullscreen() {},
  });
  t.after(() => {
    player.opened = false;
    player.finishTransition();
    slots.forEach((slot) => player.clearWatch(slot));
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  });
  const load = async (slot = player.pending.slot) => {
    slot.image.complete = true;
    slot.image.naturalWidth = 1200;
    player.imageEvent(slot, 'load');
    await Promise.resolve();
    return slot;
  };
  return { player, load, elapse: (ms) => { now += ms; } };
}

test('image URLs accept raster artwork while still rejecting executable documents and unsafe schemes', () => {
  const origin = 'https://artdrops.example';
  for (const suffix of ['jpg', 'jpeg', 'png', 'webp', 'gif']) {
    const url = `https://media.example/art.${suffix}`;
    assert.equal(safeMediaUrl(url, origin, 'image'), url);
    assert.equal(safeMediaUrl(url, origin, 'video'), null);
  }
  for (const url of ['javascript:alert(1)', 'data:image/svg+xml,test', 'https://media.example/art.svg', 'https://media.example/page.html', 'https://media.example/code.js', 'https://media.example/movie.mp4']) {
    assert.equal(safeMediaUrl(url, origin, 'image'), null);
  }
  assert.equal(safeMediaUrl('blob:https://artdrops.example/upload', origin, 'image'), 'blob:https://artdrops.example/upload');
  assert.equal(safeMediaUrl('blob:https://other.example/upload', origin, 'image'), null);
});

test('an image is promoted and timed only after decoding without starting a video', async (t) => {
  const { player, load } = fixture(t);
  player.requestWork(0);
  const slot = player.pending.slot;
  let decode;
  slot.image.decode = () => new Promise((resolve) => { decode = resolve; });
  await load(slot);
  assert.equal(player.active, null);
  assert.equal(player.startedAt, null);
  assert.notEqual(slot.watchdog, null);
  decode();
  await Promise.resolve();
  assert.equal(player.active, slot);
  assert.equal(player.pending, null);
  assert.equal(slot.video.playCalls, 0);
  assert.equal(slot.video.hidden, true);
  assert.equal(slot.image.hidden, false);
  assert.equal(slot.watchdog, null);
  assert.equal(slot.frame.classList.contains('is-active'), true);
  assert.equal(player.startedAt, 1000);
});

test('images hold for their duration, pause accurately, and never trip the video stall detector', async (t) => {
  const { player, load, elapse } = fixture(t);
  player.requestWork(0);
  const slot = await load();
  player.finishTransition();
  elapse(20_000);
  player.tick();
  assert.equal(player.active, slot);
  assert.equal(player.failed.size, 0);
  player.togglePause();
  assert.equal(player.elapsed, 20_000);
  elapse(120_000);
  player.tick();
  assert.equal(player.clockElapsed(), 20_000);
  player.togglePause();
  assert.equal(slot.video.playCalls, 0);
  assert.equal(slot.watchdog, null);
  elapse(39_999);
  player.tick();
  assert.equal(player.pending, null);
  elapse(1);
  player.tick();
  assert.equal(player.pending.work.id, 'b');
});

test('image/video crossfades retain the outgoing artwork until its hidden slot can be reused', async (t) => {
  const { player, load } = fixture(t);
  player.requestWork(0);
  const first = await load();
  player.finishTransition(true);
  player.advance(1);
  const second = player.pending.slot;
  player.videoEvent(second, 'playing');
  assert.equal(second.video.hidden, false);
  assert.equal(second.image.hidden, true);
  assert.equal(first.image.src, imageWork('a').mediaUrl);
  assert.equal(first.frame.classList.contains('is-active'), true);
  assert.equal(second.frame.style.zIndex, '2');
  t.mock.timers.tick(1500);
  assert.equal(first.frame.classList.contains('is-active'), false);
  assert.equal(first.image.src, imageWork('c').mediaUrl);
  assert.equal(first.image.loads.at(-1).visible, false);
  await load(first); // Decode the preloaded image before advancing.
  player.advance(1);
  assert.equal(player.active, first);
  assert.equal(player.pending, null);
  assert.equal(second.video.paused, false);
  t.mock.timers.tick(1500);
  assert.equal(second.video.paused, true);
  assert.equal(player.slots.length, 2);
});

test('a broken image tries its alternate once and quarantines only that work on timeout', (t) => {
  const work = imageWork('a', { alternateMediaUrl: 'https://backup.example/a.png' });
  const { player } = fixture(t, [work, videoWork('b')]);
  player.requestWork(0);
  const slot = player.pending.slot;
  player.imageEvent(slot, 'error');
  assert.equal(player.pending.sourceIndex, 1);
  assert.equal(slot.image.src, work.alternateMediaUrl);
  assert.equal(player.failed.size, 0);
  t.mock.timers.tick(15_000);
  assert.deepEqual([...player.failed], ['a']);
  assert.equal(player.pending.work.id, 'b');
});

test('image decode rejection skips the corrupt work without displaying it', async (t) => {
  const { player, load } = fixture(t, [imageWork('a'), videoWork('b')]);
  player.requestWork(0);
  const slot = player.pending.slot;
  slot.image.decode = () => Promise.reject(new Error('Invalid image data'));
  await load(slot);
  assert.equal(player.failed.has('a'), true);
  assert.equal(player.active, null);
  assert.equal(slot.frame.classList.contains('is-active'), false);
  assert.equal(player.pending.work.id, 'b');
});

test('stale image decoding cannot promote a replacement video or mutate a closed session', async (t) => {
  const { player, load } = fixture(t);
  player.requestWork(0);
  const slot = player.pending.slot;
  let decode;
  slot.image.decode = () => new Promise((resolve) => { decode = resolve; });
  await load();
  player.requestWork(1);
  decode();
  await Promise.resolve();
  assert.equal(player.active, null);
  assert.equal(player.pending.work.kind, 'video');
  player.requestWork(2);
  await load();
  player.close();
  decode();
  await Promise.resolve();
  assert.equal(player.active, null);
  assert.equal(player.pending, null);
  assert.equal(slot.image.src, '');
  assert.equal(slot.video.src, '');
});

test('quarter turns swap the fitting viewport, update on resize, and reset for other rotations', (t) => {
  const { player } = fixture(t, [imageWork('a', { rotation: 90 })]);
  player.requestWork(0);
  const frame = player.pending.slot.frame;
  assert.equal(frame.style['--artwork-rotation'], '90deg');
  assert.equal(frame.style['--player-media-width'], '1080px');
  assert.equal(frame.style['--player-media-height'], '1920px');
  frame.clientWidth = 1080;
  frame.clientHeight = 1920;
  player.layoutMedia();
  assert.equal(frame.style['--player-media-width'], '1920px');
  assert.equal(frame.style['--player-media-height'], '1080px');
  player.pending.work.rotation = 270;
  player.layoutMedia();
  assert.equal(frame.style['--artwork-rotation'], '270deg');
  player.pending.work.rotation = 180;
  player.layoutMedia();
  assert.equal(frame.style['--player-media-width'], '100%');
  assert.equal(frame.style['--player-media-height'], '100%');
  player.pending.work.rotation = 'invalid';
  player.layoutMedia();
  assert.equal(frame.style['--artwork-rotation'], '0deg');
});

test('paused navigation to an image shows it without resuming and ignores cleared video events', async (t) => {
  const { player, load } = fixture(t);
  player.paused = true;
  player.needsPlayGesture = true;
  player.requestWork(0);
  const slot = await load();
  assert.equal(player.active, slot);
  assert.equal(player.paused, true);
  assert.equal(player.startedAt, null);
  assert.equal(player.needsPlayGesture, false);
  slot.video.error = { code: 4 };
  player.videoEvent(slot, 'error');
  player.videoEvent(slot, 'waiting');
  assert.equal(player.failed.size, 0);
  assert.equal(slot.buffering, false);
  player.togglePause();
  assert.equal(player.paused, false);
  assert.equal(player.startedAt, 1000);
  assert.equal(slot.video.playCalls, 0);
});

test('a single healthy image loops without reloading or introducing another fade', async (t) => {
  const { player, load } = fixture(t, [imageWork('a')]);
  player.requestWork(0);
  const slot = await load();
  player.finishTransition();
  player.advance(1);
  assert.equal(player.active, slot);
  assert.equal(player.pending, null);
  assert.equal(player.fadeState, null);
  assert.equal(slot.image.loads.length, 1);
});

test('returning to the active image after a blocked video clears gesture recovery and Resume works', async (t) => {
  const { player, load, elapse } = fixture(t);
  player.requestWork(0);
  const still = await load();
  player.finishTransition(true);
  const incoming = player.slots.find(slot => slot !== still);
  incoming.video.play = () => Promise.reject(Object.assign(new Error('Autoplay blocked'), { name: 'NotAllowedError' }));
  player.advance(1);
  await Promise.resolve();
  assert.equal(player.pending.work.id, 'b');
  assert.equal(player.needsPlayGesture, true);
  assert.equal(player.paused, true);
  assert.equal(player.message.hidden, false);

  player.advance(-1);
  assert.equal(player.active, still);
  assert.equal(player.pending, null);
  assert.equal(player.needsPlayGesture, false);
  assert.equal(player.message.hidden, true);
  assert.equal(player.paused, true);
  player.togglePause();
  assert.equal(player.paused, false);
  assert.equal(player.startedAt, 1000);
  elapse(1000);
  assert.equal(player.clockElapsed(), 1000);
  assert.equal(still.video.playCalls, 0);
  assert.equal(still.image.loads.length, 1);
  assert.equal(player.failed.size, 0);
});
