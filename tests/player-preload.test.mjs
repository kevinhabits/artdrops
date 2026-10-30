import test from 'node:test';
import assert from 'node:assert/strict';
import { ExhibitionPlayer } from '../src/player.js';

const work = (id, kind = 'video', extra = {}) => ({ id, title: id, artist: 'Artist', kind,
  mediaUrl: `https://media.example/${id}.${kind === 'image' ? 'jpg' : 'mp4'}`, ...extra });
const flush = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };

function element() {
  const classes = new Set();
  return {
    style: { setProperty(name, value) { this[name] = value; } },
    classList: { add(name) { classes.add(name); }, remove(name) { classes.delete(name); }, contains(name) { return classes.has(name); } },
    clientWidth: 1920, clientHeight: 1080,
  };
}

function fixture(t, works, settings = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const previousDocument = globalThis.document;
  globalThis.document = { hidden: false, body: { style: {} } };
  let now = 1000;
  t.mock.method(performance, 'now', () => now);
  const slots = Array.from({ length: 3 }, () => {
    const frame = element();
    const video = {
      ...element(), src: '', readyState: 0, videoWidth: 0, currentTime: 0, paused: true,
      muted: true, defaultMuted: true, error: null, loads: [], playCalls: 0,
      pause() { this.paused = true; },
      play() { this.paused = false; this.playCalls++; return Promise.resolve(); },
      load() { this.readyState = 0; this.videoWidth = 0; this.error = null; this.currentTime = 0;
        this.loads.push({ source: this.src, visible: frame.classList.contains('is-active') }); },
      getAttribute() { return this.src; },
      removeAttribute(name) { if (name === 'src') this.src = ''; },
    };
    let source = '';
    const image = {
      ...element(), complete: false, naturalWidth: 0, loads: [],
      get src() { return source; },
      set src(value) { source = value; this.complete = false; this.naturalWidth = 0;
        this.loads.push({ source, visible: frame.classList.contains('is-active') }); },
      getAttribute() { return source; },
      removeAttribute(name) { if (name === 'src') { source = ''; this.complete = false; this.naturalWidth = 0; } },
      decode() { return Promise.resolve(); },
    };
    return { frame, video, image, work: null, sourceIndex: 0, watchdog: null };
  });
  const statuses = [];
  const player = new ExhibitionPlayer({ onStatus: value => statuses.push(value) });
  Object.assign(player, {
    opened: true, session: 1, slots, works, order: works, position: 0,
    settings: { duration: 60, shuffle: false, transition: 'fade', ...settings },
    failed: new Set(), paused: false, needsPlayGesture: false,
    active: null, pending: null, nextPlan: null, nextPlans: [], elapsed: 0, startedAt: null,
    message: {}, title: {}, artist: {}, counter: {}, caption: {},
    dialog: { ...element(), remove() {} }, progress: element(),
    pauseButton: { setAttribute() {} }, showControls() {}, releaseFullscreen() {},
  });
  t.after(() => {
    player.close();
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  });
  const slotFor = id => slots.find(slot => slot.work?.id === id);
  const ready = async (slot) => {
    if (slot.work.kind === 'image') {
      slot.image.complete = true;
      slot.image.naturalWidth = 1920;
      player.imageEvent(slot, 'load');
      await flush();
    } else {
      slot.video.readyState = 4;
      slot.video.videoWidth = 1920;
      player.videoEvent(slot, 'loadeddata');
    }
  };
  const show = async () => {
    const slot = player.pending.slot;
    await ready(slot);
    if (slot.work.kind === 'video' && player.pending) player.videoEvent(slot, 'playing');
    return slot;
  };
  const error = slot => {
    if (slot.work.kind === 'image') player.imageEvent(slot, 'error');
    else { slot.video.error = { code: 4 }; player.videoEvent(slot, 'error'); }
  };
  return { player, slots, slotFor, ready, show, error, statuses,
    elapse(ms) { now += ms; t.mock.timers.tick(ms); } };
}

test('two upcoming works start loading before the first frame and retain their real media elements', async (t) => {
  const { player, slots, slotFor, ready, show } = fixture(t, ['a', 'b', 'c', 'd'].map(id => work(id)));
  player.requestWork(0);
  const first = player.pending.slot, second = slotFor('b'), third = slotFor('c');
  assert.ok(second?.preloading && third?.preloading);
  assert.equal(player.active, null);
  assert.deepEqual(slots.map(slot => slot.video.playCalls), [1, 0, 0]);
  await ready(second); await ready(third);
  await show();
  assert.ok(player.fadeState, 'preloading does not wait for the initial fade');
  const loads = second.video.loads.length;
  player.advance(1);
  assert.equal(player.pending.slot, second);
  assert.equal(second.video.loads.length, loads);
  await show();
  assert.equal(first.work.id, 'a', 'the outgoing artwork remains untouched throughout the fade');
  assert.equal(slotFor('c'), third);
  t.mock.timers.tick(1500);
  assert.equal(first.work.id, 'd');
  assert.equal(first.video.loads.at(-1).visible, false);
  assert.equal(slots.length, 3);
});

test('a preload recovers its alternate before it is due and activation never reloads the recovered source', async (t) => {
  const b = work('b', 'video', { alternateMediaUrl: 'https://backup.example/b.mp4' });
  const { player, slotFor, ready, show, error } = fixture(t, [work('a'), b, work('c')]);
  player.requestWork(0); await show();
  const current = player.active, prepared = slotFor('b');
  const before = { position: player.position, elapsed: player.elapsed, startedAt: player.startedAt, title: player.title.textContent };
  error(prepared);
  assert.equal(prepared.video.src, b.alternateMediaUrl);
  assert.equal(prepared.sourceIndex, 1);
  await ready(prepared);
  assert.equal(prepared.watchdog, null);
  assert.equal(player.active, current);
  assert.deepEqual({ position: player.position, elapsed: player.elapsed, startedAt: player.startedAt, title: player.title.textContent }, before);
  const loads = prepared.video.loads.length;
  player.advance(1);
  assert.equal(player.pending.slot, prepared);
  assert.equal(player.pending.sourceIndex, 1);
  assert.equal(prepared.video.loads.length, loads);
  await show();
  assert.equal(player.active, prepared);
});

test('preload timeouts retry and skip only the future work while a paused artwork remains unchanged', async (t) => {
  const b = work('b', 'image', { alternateMediaUrl: 'https://backup.example/b.jpg' });
  const { player, slotFor, ready, show } = fixture(t, [work('a', 'image'), b, work('c'), work('d')]);
  player.requestWork(0); await show(); await ready(slotFor('c'));
  player.togglePause();
  const current = player.active, prepared = slotFor('b');
  const before = { position: player.position, elapsed: player.elapsed, title: player.title.textContent };
  t.mock.timers.tick(15_000);
  assert.equal(prepared.image.src, b.alternateMediaUrl);
  assert.equal(player.failed.size, 0);
  t.mock.timers.tick(15_000);
  assert.equal(player.failed.has('b'), true);
  assert.equal(player.nextPlan.order[player.nextPlan.position].id, 'c');
  assert.equal(player.active, current);
  assert.equal(player.pending, null);
  assert.equal(player.paused, true);
  assert.equal(player.needsPlayGesture, false);
  assert.equal(player.startedAt, null);
  assert.deepEqual({ position: player.position, elapsed: player.elapsed, title: player.title.textContent }, before);
  assert.ok(slotFor('d').preloading);
});

test('exhausted future works leave the healthy current work looping with bounded slots and no reload', async (t) => {
  const { player, slots, slotFor, show, error } = fixture(t, [work('a', 'image'), work('b'), work('c')]);
  player.requestWork(0); await show(); player.finishTransition(true);
  const active = player.active, loads = active.image.loads.length;
  error(slotFor('b')); error(slotFor('c'));
  assert.deepEqual([...player.failed].sort(), ['b', 'c']);
  assert.equal(player.active, active);
  player.advance(1);
  assert.equal(player.active, active);
  assert.equal(player.pending, null);
  assert.equal(active.image.loads.length, loads);
  assert.equal(slots.length, 3);
  assert.ok(slots.every(slot => slot.watchdog === null));
});

test('repeated preparation keeps the same shuffled future order across a cycle boundary', async (t) => {
  let calls = 0;
  t.mock.method(Math, 'random', () => { calls++; return 0.3; });
  const { player, show } = fixture(t, ['a', 'b', 'c', 'd'].map(id => work(id)), { shuffle: true });
  player.requestWork(2); await show();
  const plans = [...player.nextPlans], orders = plans.map(plan => plan.order), randomCalls = calls;
  assert.equal(plans[0].order[plans[0].position].id, 'd');
  assert.notEqual(plans[1].order[plans[1].position].id, 'd');
  for (let i = 0; i < 20; i++) player.preloadNext();
  assert.deepEqual(player.nextPlans, plans);
  assert.equal(player.nextPlans[1].order, orders[1]);
  assert.equal(calls, randomCalls);
  player.advance(1); await show();
  player.advance(1); await show();
  assert.equal(player.order, orders[1]);
  assert.equal(player.active.work.id, plans[1].order[plans[1].position].id);
});

for (const pending of [false, true]) {
  test(`failure of the final ${pending ? 'pending' : 'preloaded'} item repairs a cached shuffle boundary without repeating the visible work`, async (t) => {
    t.mock.method(Math, 'random', () => 0);
    const { player, slotFor, show, error } = fixture(t, ['c', 'a', 'b'].map(id => work(id)), { shuffle: true });
    player.requestWork(1); await show();
    assert.equal(player.nextPlans[1].order[player.nextPlans[1].position].id, 'a');
    const current = player.active;
    if (pending) player.advance(1);
    error(slotFor('b'));
    assert.equal(player.active, current);
    assert.equal(player.failed.has('b'), true);
    if (!pending) player.advance(1);
    assert.equal(player.pending.work.id, 'c');
    await show();
    assert.equal(player.active.work.id, 'c');
    player.advance(1); await show();
    assert.equal(player.active.work.id, 'a');
  });
}

test('an in-flight preload retains its original timeout deadline when selected', async (t) => {
  const b = work('b', 'video', { alternateMediaUrl: 'https://backup.example/b.mp4' });
  const { player, slotFor, ready, show, elapse } = fixture(t, [work('a', 'image'), b, work('c')]);
  player.requestWork(0); await show(); await ready(slotFor('c'));
  const prepared = slotFor('b'), deadline = prepared.loadDeadline;
  elapse(10_000);
  player.advance(1);
  assert.equal(player.pending.slot, prepared);
  assert.equal(prepared.loadDeadline, deadline);
  elapse(4999);
  assert.equal(prepared.video.src, b.mediaUrl);
  elapse(1);
  assert.equal(player.pending.sourceIndex, 1);
  assert.equal(prepared.video.src, b.alternateMediaUrl);
  assert.equal(prepared.loadDeadline, deadline + 15_000);
});

test('rapid navigation reuses prepared slots and never loads a resource into a visible frame', async (t) => {
  const { player, slots, slotFor, ready, show } = fixture(t, ['a', 'b', 'c', 'd', 'e'].map(id => work(id)));
  player.requestWork(0); await show(); await ready(slotFor('b')); await ready(slotFor('c'));
  player.advance(1); await show();
  const second = player.active, third = slotFor('c'), loads = third.video.loads.length;
  player.advance(1);
  assert.equal(player.pending.slot, third);
  assert.equal(third.video.loads.length, loads);
  assert.equal(second.frame.classList.contains('is-active'), true);
  await show();
  player.togglePause();
  player.advance(-1);
  if (player.pending) await show();
  assert.equal(player.active.work.id, 'b');
  assert.equal(player.paused, true);
  assert.equal(player.active.video.paused, true);
  assert.ok(slots.every(slot => slot.video.loads.every(load => !load.visible)));
});

test('close cancels every prepared source and late image decoding cannot change the closed session', async (t) => {
  const { player, slots, slotFor, ready, show } = fixture(t, [work('a'), work('b', 'image'), work('c')]);
  player.requestWork(0); await show();
  const prepared = slotFor('b');
  let resolveDecode;
  prepared.image.decode = () => new Promise(resolve => { resolveDecode = resolve; });
  await ready(prepared);
  player.close();
  resolveDecode(); await flush();
  assert.equal(player.active, null);
  assert.equal(player.pending, null);
  assert.deepEqual(player.nextPlans, []);
  assert.ok(slots.every(slot => slot.watchdog === null && !slot.preloading && !slot.video.src && !slot.image.src && slot.video.paused));
  assert.equal(prepared.imageReady, false);
});

test('a late play rejection cannot affect an image that reuses the same media slot', async (t) => {
  const { player, slots, show } = fixture(t, [work('a'), work('b', 'image'), work('c', 'image'), work('d', 'image')], { transition: 'none' });
  let rejectPlay;
  slots[0].video.play = () => new Promise((resolve, reject) => { rejectPlay = reject; });
  player.requestWork(0);
  const originalSlot = player.pending.slot;
  player.requestWork(1); await show();
  player.requestWork(3); await show();
  assert.equal(player.active, originalSlot);
  rejectPlay(Object.assign(new Error('Late policy rejection'), { name: 'NotAllowedError' }));
  await flush();
  assert.equal(player.active.work.id, 'd');
  assert.equal(player.needsPlayGesture, false);
  assert.equal(player.paused, false);
  assert.equal(player.failed.size, 0);
});
