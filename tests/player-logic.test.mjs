import test from 'node:test';
import assert from 'node:assert/strict';
import { ExhibitionPlayer, safeMediaUrl, shuffleWorks } from '../src/player.js';

const work = (id) => ({ id, title: id, kind: 'video', mediaUrl: `https://media.example/${id}.mp4` });

test('media URLs cannot execute script or embed documents; local uploads stay same-origin', () => {
  const origin = 'https://artdrops.example';
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'file:///video.mp4', 'https://user:pass@media.example/video.mp4', 'https://media.example/page.html', 'https://media.example/art.svg']) {
    assert.equal(safeMediaUrl(url, origin), null);
  }
  assert.equal(safeMediaUrl('blob:https://other.example/123', origin), null);
  assert.equal(safeMediaUrl('blob:https://artdrops.example/123', origin), 'blob:https://artdrops.example/123');
  assert.equal(safeMediaUrl('https://gateway.example/ipfs/QmArtwork', origin), 'https://gateway.example/ipfs/QmArtwork');
  assert.equal(safeMediaUrl('/art.webm', origin), `${origin}/art.webm`);
});

test('shuffling preserves the set and avoids repeating the previous work at the cycle boundary', () => {
  const works = [work('a'), work('b'), work('c')];
  for (const random of [() => 0, () => 0.5, () => 0.999]) {
    const result = shuffleWorks(works, 'a', random);
    assert.notEqual(result[0].id, 'a');
    assert.deepEqual(result.map((item) => item.id).sort(), ['a', 'b', 'c']);
    assert.deepEqual(works.map((item) => item.id), ['a', 'b', 'c']);
  }
  assert.deepEqual(shuffleWorks([work('a')], 'a').map((item) => item.id), ['a']);
});

test('navigation skips quarantined works and terminates when all have failed', () => {
  const player = new ExhibitionPlayer();
  Object.assign(player, { order: [work('a'), work('b'), work('c')], position: 0, failed: new Set(['b']), settings: { shuffle: false } });
  assert.equal(player.plan(1).position, 2);
  assert.equal(player.plan(-1).position, 2);
  player.failed.add('a');
  player.failed.add('c');
  assert.equal(player.plan(1), null);
});

test('a fallback gets one attempt before a failed work is quarantined', () => {
  const events = [];
  const player = new ExhibitionPlayer({ onStatus: (message) => events.push(message) });
  const artwork = { ...work('a'), alternateMediaUrl: 'https://backup.example/a.mp4' };
  player.failed = new Set();
  player.pending = { work: artwork, slot: { watchdog: null }, sourceIndex: 0 };
  let retries = 0;
  let advances = 0;
  player.loadPending = () => { retries++; };
  player.advance = () => { advances++; };
  player.failPending();
  assert.equal(retries, 1);
  assert.equal(advances, 0);
  assert.equal(player.failed.size, 0);
  player.failPending();
  assert.equal(retries, 1);
  assert.equal(advances, 1);
  assert.equal(player.pending, null);
  assert.equal(player.failed.has('a'), true);
  assert.equal(events.length, 1);
});

test('freezing the playback clock preserves elapsed time without double-counting', () => {
  const player = new ExhibitionPlayer();
  player.elapsed = 1000;
  player.startedAt = performance.now() - 250;
  player.freezeClock();
  const elapsed = player.elapsed;
  assert.ok(elapsed >= 1250 && elapsed < 1500);
  assert.equal(player.startedAt, null);
  player.freezeClock();
  assert.equal(player.elapsed, elapsed);
  assert.equal(player.clockElapsed(), elapsed);
});

test('a rejected play promise from an earlier session cannot skip the current session', async () => {
  const player = new ExhibitionPlayer();
  let rejectPlay;
  const slot = { video: { play: () => new Promise((resolve, reject) => { rejectPlay = reject; }) } };
  const token = Symbol('old');
  Object.assign(player, { opened: true, session: 1, paused: false, pending: { slot, token } });
  let failures = 0;
  player.failPending = () => { failures++; };
  player.play(slot, token);
  player.session = 2;
  rejectPlay(new Error('old request failed'));
  await Promise.resolve();
  assert.equal(failures, 0);
});

test('failure of the last healthy active work cannot reuse its cached next plan', () => {
  for (const works of [[work('a')], [work('a'), work('b')]]) {
    const player = new ExhibitionPlayer();
    Object.assign(player, {
      opened: true,
      order: works,
      position: 0,
      failed: new Set(works.slice(1).map((item) => item.id)),
      settings: { shuffle: false },
      active: { work: works[0], sourceIndex: 0, watchdog: null },
      pending: null,
      nextPlan: { order: works, position: 0 },
    });
    let unavailable = 0;
    player.unavailable = () => { unavailable++; };
    player.requestWork = () => { assert.fail('a quarantined video must not be requested again'); };
    player.failActive();
    assert.equal(player.failed.size, works.length);
    assert.equal(player.nextPlan, null);
    assert.equal(unavailable, 1);
  }
});

test('manual navigation while paused promotes a decoded first frame without starting playback', () => {
  const player = new ExhibitionPlayer();
  const slot = { video: { videoWidth: 1920 } };
  player.paused = true;
  player.pending = { slot };
  let promotions = 0;
  player.promote = () => { promotions++; };
  player.videoEvent(slot, 'loadeddata');
  assert.equal(promotions, 1);
  player.videoEvent({ video: { videoWidth: 1920 } }, 'loadeddata');
  assert.equal(promotions, 1);
  player.paused = false;
  player.videoEvent(slot, 'loadeddata');
  assert.equal(promotions, 1);
});

test('fullscreen targets the document and exits only fullscreen acquired by the player', async () => {
  const original = globalThis.document;
  const fake = { fullscreenElement: null, documentElement: {}, exits: 0 };
  fake.documentElement.requestFullscreen = async () => { fake.fullscreenElement = fake.documentElement; };
  fake.exitFullscreen = async () => { fake.exits++; fake.fullscreenElement = null; };
  globalThis.document = fake;
  try {
    const player = new ExhibitionPlayer();
    player.opened = true;
    player.session = 1;
    await player.enterFullscreen();
    assert.equal(fake.fullscreenElement, fake.documentElement);
    assert.equal(player.fullscreenOwned, true);
    player.releaseFullscreen();
    assert.equal(fake.exits, 1);

    fake.fullscreenElement = fake.documentElement;
    await player.enterFullscreen();
    assert.equal(player.fullscreenOwned, false);
    player.releaseFullscreen();
    assert.equal(fake.exits, 1);
    assert.equal(fake.fullscreenElement, fake.documentElement);
  } finally {
    if (original === undefined) delete globalThis.document;
    else globalThis.document = original;
  }
});

test('a fullscreen request that completes after close releases its acquired fullscreen', async () => {
  const original = globalThis.document;
  let complete;
  const fake = { fullscreenElement: null, documentElement: {}, exits: 0 };
  fake.documentElement.requestFullscreen = () => new Promise((resolve) => {
    complete = () => { fake.fullscreenElement = fake.documentElement; resolve(); };
  });
  fake.exitFullscreen = async () => { fake.exits++; fake.fullscreenElement = null; };
  globalThis.document = fake;
  try {
    const player = new ExhibitionPlayer();
    player.opened = true;
    player.session = 1;
    const pending = player.enterFullscreen();
    player.releaseFullscreen();
    player.opened = false;
    player.session++;
    complete();
    await pending;
    assert.equal(fake.fullscreenElement, null);
    assert.equal(fake.exits, 1);
  } finally {
    if (original === undefined) delete globalThis.document;
    else globalThis.document = original;
  }
});

test('shuffle keeps the last healthy work playing when the rest of the cycle has failed', (context) => {
  context.mock.method(Math, 'random', () => 0.999);
  const player = new ExhibitionPlayer();
  const works = ['a', 'b', 'c'].map(work);
  Object.assign(player, {
    order: works,
    position: 0,
    active: { work: works[0] },
    failed: new Set(['b', 'c']),
    settings: { shuffle: true },
  });
  const next = player.plan(1);
  assert.ok(next);
  assert.equal(next.order[next.position].id, 'a');
});

// Exercise the real loading, promotion, preloading, timer advancement and
// failure paths. Only the browser's network and video elements are simulated.
function simulatedExhibition(works) {
  const player = new ExhibitionPlayer();
  const slots = [0, 1].map(() => {
    const classes = new Set();
    return {
    watchdog: null,
    video: {
      src: '', currentTime: 0, videoWidth: 1920, readyState: 4, error: null,
      paused: true, loads: [], style: {},
      classList: { add(value) { classes.add(value); }, remove(value) { classes.delete(value); }, contains(value) { return classes.has(value); } },
      getAttribute() { return this.src; },
      removeAttribute(name) { if (name === 'src') this.src = ''; },
      pause() { this.paused = true; },
      load() { this.loads.push({ src: this.src, visible: classes.has('is-active') }); this.error = null; this.currentTime = 0; },
      play() { this.paused = false; return Promise.resolve(); },
    },
  }; });
  Object.assign(player, {
    opened: true, session: 1, slots,
    order: shuffleWorks(works), position: 0,
    settings: { shuffle: true, duration: 30 },
    failed: new Set(), paused: false,
    active: null, pending: null, nextPlan: null, elapsed: 0, startedAt: null,
    message: {}, title: {}, artist: {}, counter: {},
    dialog: { style: { setProperty() {} } },
    progress: { style: { setProperty() {} } },
  });
  return player;
}

function transitionSimulation(context, options = {}) {
  const original = globalThis.document;
  globalThis.document = { hidden: false, body: { style: {} } };
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const works = ['a', 'b', 'c'].map(work);
  const player = simulatedExhibition(works);
  player.order = works;
  player.settings = { duration: 30, shuffle: false, transition: options.transition || 'fade' };
  player.reducedMotion = { matches: options.reducedMotion || false };
  context.after(() => {
    player.opened = false;
    player.finishTransition();
    for (const slot of player.slots) player.clearWatch(slot);
    if (original === undefined) delete globalThis.document;
    else globalThis.document = original;
  });
  const show = (position) => {
    player.requestWork(position);
    if (!player.pending) return player.active;
    const slot = player.pending.slot;
    player.videoEvent(slot, player.paused ? 'loadeddata' : 'playing');
    return slot;
  };
  return { player, show };
}

test('gentle fade retains the opaque moving outgoing layer until incoming is shown, then safely preloads', (context) => {
  const { player, show } = transitionSimulation(context);
  const outgoing = show(0);
  player.finishTransition();
  const incoming = show(1);
  assert.equal(player.transitionDuration(), 1500);
  assert.equal(outgoing.video.classList.contains('is-active'), true);
  assert.equal(incoming.video.classList.contains('is-active'), true);
  assert.equal(outgoing.video.style.zIndex, '1');
  assert.equal(incoming.video.style.zIndex, '2');
  assert.equal(outgoing.video.paused, false);
  assert.equal(player.elapsed, 0);
  assert.ok(player.startedAt !== null, 'the exhibition clock starts at promotion, not after fading');
  context.mock.timers.tick(1499);
  assert.equal(outgoing.video.src, work('a').mediaUrl);
  assert.equal(outgoing.video.paused, false);
  context.mock.timers.tick(1);
  assert.equal(player.fadeState, null);
  assert.equal(outgoing.video.paused, true);
  assert.equal(outgoing.video.classList.contains('is-active'), false);
  assert.equal(outgoing.video.src, work('c').mediaUrl);
  assert.equal(outgoing.video.loads.at(-1).visible, false);
  assert.equal(incoming.video.classList.contains('is-active'), true);
});

for (const options of [{ transition: 'none' }, { reducedMotion: true }]) {
  test(`${options.transition === 'none' ? 'instant transitions' : 'reduced motion'} release the outgoing slot without a fade delay`, (context) => {
    const { player, show } = transitionSimulation(context, options);
    const outgoing = show(0);
    const incoming = show(1);
    assert.equal(player.transitionDuration(), 0);
    assert.equal(player.fadeState, null);
    assert.equal(player.fadeTimer, null);
    assert.equal(outgoing.video.paused, true);
    assert.equal(outgoing.video.classList.contains('is-active'), false);
    assert.equal(outgoing.video.src, work('c').mediaUrl);
    assert.equal(incoming.video.style.transition, 'none');
    assert.equal(incoming.video.classList.contains('is-active'), true);
  });
}

test('rapid navigation settles the visible blend before reuse and ignores stale fade callbacks', (context) => {
  const { player, show } = transitionSimulation(context);
  const callbacks = [];
  const schedule = globalThis.setTimeout;
  context.mock.method(globalThis, 'setTimeout', (callback, duration) => {
    if (duration === 1500) callbacks.push(callback);
    return schedule(callback, duration);
  });
  const first = show(0);
  player.finishTransition();
  const second = show(1);
  const oldCompletion = callbacks.at(-1);
  player.requestWork(2);
  assert.equal(first.video.classList.contains('is-active'), false);
  assert.equal(first.video.loads.at(-1).visible, false);
  assert.equal(first.video.src, work('c').mediaUrl);
  assert.equal(second.video.classList.contains('is-active'), true);
  assert.equal(second.video.style.transition, 'none');
  assert.equal(second.video.paused, false);
  oldCompletion();
  assert.equal(player.pending.work.id, 'c');
  player.videoEvent(player.pending.slot, 'playing');
  const currentFade = player.fadeState;
  oldCompletion();
  assert.equal(player.fadeState, currentFade);
  assert.equal(second.video.paused, false);
  assert.equal(player.slots.length, 2);
});

test('close clears a running transition and an old callback cannot mutate a reopened session', (context) => {
  const { player, show } = transitionSimulation(context);
  const callbacks = [];
  const schedule = globalThis.setTimeout;
  context.mock.method(globalThis, 'setTimeout', (callback, duration) => {
    if (duration === 1500) callbacks.push(callback);
    return schedule(callback, duration);
  });
  show(0); player.finishTransition(); show(1);
  const completion = callbacks.at(-1);
  player.releaseFullscreen = () => {};
  player.controller = { abort() {} };
  player.dialog.close = () => {};
  player.dialog.remove = () => {};
  player.close();
  assert.equal(player.fadeState, null);
  assert.equal(player.fadeTimer, null);
  assert.ok(player.slots.every((slot) => slot.video.paused && slot.video.src === ''));
  const replacement = simulatedExhibition(['x', 'y'].map(work));
  Object.assign(player, replacement, { session: 10 });
  const newActive = player.slots[0];
  player.active = newActive;
  newActive.video.src = work('x').mediaUrl;
  newActive.video.paused = false;
  completion();
  assert.equal(player.active, newActive);
  assert.equal(newActive.video.paused, false);
  assert.equal(newActive.video.src, work('x').mediaUrl);
});

test('a failed incoming work settles its fade before the outgoing slot is reused', (context) => {
  const { player, show } = transitionSimulation(context);
  const outgoing = show(0);
  player.finishTransition();
  const incoming = show(1);
  incoming.video.error = { code: 3 };
  player.videoEvent(incoming, 'error');
  assert.equal(player.failed.has('b'), true);
  assert.equal(player.fadeState, null);
  assert.equal(player.pending.work.id, 'c');
  assert.equal(outgoing.video.loads.at(-1).visible, false);
});

test('paused navigation fades decoded still frames without resuming either video', (context) => {
  const { player, show } = transitionSimulation(context);
  const outgoing = show(0);
  player.finishTransition();
  player.paused = true;
  player.freezeClock();
  outgoing.video.pause();
  const incoming = show(1);
  assert.equal(outgoing.video.paused, true);
  assert.equal(incoming.video.paused, true);
  assert.equal(player.startedAt, null);
  assert.equal(player.title.textContent, 'b');
  assert.ok(player.fadeState);
  context.mock.timers.tick(1500);
  assert.equal(player.fadeState, null);
  assert.equal(incoming.video.paused, true);
});

test('repeating the only healthy artwork keeps its current video without another fade or load', (context) => {
  const { player, show } = transitionSimulation(context);
  player.order = [work('a')];
  const active = show(0);
  player.finishTransition();
  const loads = active.video.loads.length;
  player.elapsed = 30_000;
  player.startedAt = null;
  player.advance(1);
  assert.equal(player.active, active);
  assert.equal(player.pending, null);
  assert.equal(player.fadeState, null);
  assert.equal(active.video.loads.length, loads);
  assert.equal(active.video.paused, false);
  assert.equal(player.elapsed, 0);
});

for (const unavailableCount of [0, 12]) {
  test(`four simulated hours use every healthy artwork once per cycle, with ${unavailableCount} unavailable works`, (context) => {
    let seed = 137;
    context.mock.method(Math, 'random', () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    });
    const original = globalThis.document;
    // No transition may allocate extra video nodes after the two-slot setup.
    globalThis.document = { hidden: false, createElement() { assert.fail('unexpected DOM allocation during playback'); } };
    const works = Array.from({ length: 120 + unavailableCount }, (_, index) => work(`work-${index}`));
    const unavailable = new Set(works.slice(120).map((item) => item.id));
    const expected = works.slice(0, 120).map((item) => item.id).sort();
    const player = simulatedExhibition(works);
    const videos = new Set(player.slots.map((slot) => slot.video));
    const cycles = [];
    const failures = new Map();
    let currentOrder;
    let previousId;
    try {
      player.requestWork(0);
      for (let shown = 0; shown < 480; shown++) {
        while (player.pending && unavailable.has(player.pending.work.id)) {
          const { work: artwork, slot } = player.pending;
          failures.set(artwork.id, (failures.get(artwork.id) || 0) + 1);
          slot.video.error = { code: 4 };
          player.videoEvent(slot, 'error');
        }
        assert.ok(player.pending, 'a healthy video remains available');
        const slot = player.pending.slot;
        player.videoEvent(slot, 'playing');
        player.finishTransition();
        const id = player.active.work.id;
        if (player.order !== currentOrder) {
          if (currentOrder) assert.notEqual(id, previousId, 'cycle boundary cannot immediately repeat');
          cycles.push([]);
          currentOrder = player.order;
        }
        cycles.at(-1).push(id);
        previousId = id;
        assert.equal(videos.has(player.active.video), true);
        assert.equal(player.slots.length, 2);
        assert.equal(player.active.video.src, player.active.work.mediaUrl);
        player.preloadNext();
        assert.equal(videos.has(player.slots.find((candidate) => candidate !== player.active).video), true);
        if (shown < 479) {
          player.elapsed = 30_000;
          player.startedAt = null;
          player.active.video.currentTime += 30;
          player.tick();
        }
      }
      assert.equal(cycles.length, 4);
      for (const cycle of cycles) {
        assert.equal(cycle.length, 120);
        assert.deepEqual([...cycle].sort(), expected);
      }
      assert.equal(player.failed.size, unavailableCount);
      for (const attempts of failures.values()) assert.equal(attempts, 1, 'failed works stay quarantined across cycles');
    } finally {
      player.opened = false;
      clearTimeout(player.fadeTimer);
      for (const slot of player.slots) player.clearWatch(slot);
      if (original === undefined) delete globalThis.document;
      else globalThis.document = original;
    }
  });
}
