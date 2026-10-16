import test from 'node:test';
import assert from 'node:assert/strict';
import { ExhibitionPlayer } from '../src/player.js';

const blockedMessage = 'Your browser paused playback. Select Resume to start the artwork.';
const playbackError = (name) => Object.assign(new Error(name), { name });

function fixture(t, { active = false } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const previousDocument = globalThis.document;
  globalThis.document = { hidden: false };
  t.after(() => {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  });
  const works = ['a', 'b'].map((id) => ({ id, title: id, kind: 'video', mediaUrl: `https://media.example/${id}.mp4` }));
  const slots = works.map((work, position) => ({
    work, position, sourceIndex: 0, watchdog: null, buffering: false,
    lastTime: 0, lastProgressAt: performance.now(),
    video: {
      videoWidth: 1920, readyState: 4, currentTime: 0, paused: false, error: null,
      playCalls: 0, pauseCalls: 0,
      play() { this.playCalls++; this.paused = false; return this.playResult?.(); },
      pause() { this.paused = true; this.pauseCalls++; },
    },
  }));
  const attributes = {};
  const player = new ExhibitionPlayer();
  Object.assign(player, {
    opened: true, session: 1, settings: { duration: 30, shuffle: false, transition: 'none' },
    slots, order: works, position: 0, failed: new Set(), paused: false, needsPlayGesture: false,
    active: active ? slots[0] : null,
    pending: active ? null : { slot: slots[0], work: works[0], position: 0, sourceIndex: 0, token: Symbol('pending') },
    elapsed: 1000, startedAt: active ? performance.now() - 500 : null,
    message: { hidden: true, textContent: '' },
    pauseButton: { disabled: false, textContent: 'Pause', setAttribute(name, value) { attributes[name] = value; } },
    counter: {}, progress: { style: { setProperty() {} } }, title: {}, artist: {},
    controlsShown: 0, advances: 0, transitions: 0,
    showControls() { this.controlsShown++; },
    advance() { this.advances++; },
    beginTransition() { this.transitions++; },
  });
  return { player, slot: slots[0], attributes };
}

async function block(player, slot) {
  slot.video.playResult = () => Promise.reject(playbackError('NotAllowedError'));
  player.play(slot, player.pending?.token ?? null);
  await Promise.resolve();
}

test('blocked initial playback keeps its artwork and clears every watchdog without skipping', async (t) => {
  const { player, slot, attributes } = fixture(t);
  const pending = player.pending;
  player.slots.forEach((candidate) => player.watch(candidate));
  await block(player, slot);
  assert.equal(player.pending, pending);
  assert.equal(player.failed.size, 0);
  assert.equal(player.needsPlayGesture, true);
  assert.equal(player.paused, true);
  assert.equal(player.startedAt, null);
  assert.equal(player.message.textContent, blockedMessage);
  assert.equal(player.message.hidden, false);
  assert.equal(player.pauseButton.textContent, 'Resume');
  assert.equal(attributes['aria-pressed'], 'true');
  assert.ok(player.controlsShown > 0);
  for (const candidate of player.slots) {
    assert.equal(candidate.watchdog, null);
    assert.equal(candidate.video.paused, true);
  }
  // Neither late loading/stall events nor the elapsed timeout may dismiss the prompt.
  player.videoEvent(slot, 'loadeddata');
  player.videoEvent(slot, 'playing'); // A queued event from before pause is stale.
  player.videoEvent(slot, 'waiting');
  player.watch(slot);
  t.mock.timers.tick(30_000);
  assert.equal(player.pending, pending);
  assert.equal(player.message.hidden, false);
  assert.equal(player.transitions, 0);
  assert.equal(player.advances, 0);
  assert.equal(player.failed.size, 0);
});

test('an outgoing video cannot dismiss a blocked incoming artwork prompt', async (t) => {
  const { player, slot } = fixture(t);
  const outgoing = player.slots[1];
  player.active = outgoing;
  await block(player, slot);
  outgoing.video.paused = false;
  player.videoEvent(outgoing, 'playing');
  assert.equal(player.needsPlayGesture, true);
  assert.equal(player.paused, true);
  assert.equal(player.pending.slot, slot);
  assert.equal(player.message.hidden, false);
});

test('Resume retries the same pending artwork and starts its clock only when playback starts', async (t) => {
  const { player, slot, attributes } = fixture(t);
  await block(player, slot);
  const pending = player.pending;
  slot.video.playResult = () => Promise.resolve();
  player.togglePause();
  assert.equal(slot.video.playCalls, 2);
  assert.equal(player.pending, pending);
  assert.equal(player.needsPlayGesture, true);
  assert.equal(player.paused, true);
  assert.equal(player.startedAt, null);
  assert.equal(player.message.hidden, false);
  player.videoEvent(slot, 'playing');
  assert.equal(player.active, slot);
  assert.equal(player.pending, null);
  assert.equal(player.needsPlayGesture, false);
  assert.equal(player.paused, false);
  assert.equal(player.message.hidden, true);
  assert.equal(player.pauseButton.textContent, 'Pause');
  assert.equal(attributes['aria-pressed'], 'false');
  assert.equal(player.elapsed, 0);
  assert.notEqual(player.startedAt, null);
  assert.equal(player.failed.size, 0);
});

test('blocked active playback preserves elapsed time through repeated Resume attempts', async (t) => {
  const { player, slot } = fixture(t, { active: true });
  await block(player, slot);
  const elapsed = player.clockElapsed();
  assert.ok(elapsed >= 1500);
  player.togglePause();
  await Promise.resolve();
  t.mock.timers.tick(30_000);
  player.tick();
  assert.equal(player.active, slot);
  assert.equal(player.clockElapsed(), elapsed);
  assert.equal(player.failed.size, 0);
  assert.equal(player.advances, 0);
  slot.video.playResult = () => undefined; // Older media implementations may not return a promise.
  player.togglePause();
  assert.equal(player.paused, true);
  player.videoEvent(slot, 'playing');
  assert.equal(player.needsPlayGesture, false);
  assert.equal(player.paused, false);
  assert.equal(player.elapsed, elapsed);
  assert.notEqual(player.startedAt, null);
  assert.equal(player.message.hidden, true);
});

test('synchronous autoplay rejection receives the same recoverable Resume state', (t) => {
  const { player, slot } = fixture(t);
  slot.video.playResult = () => { throw playbackError('NotAllowedError'); };
  assert.doesNotThrow(() => player.play(slot, player.pending.token));
  assert.equal(player.needsPlayGesture, true);
  assert.equal(player.paused, true);
  assert.equal(player.pending.slot, slot);
  assert.equal(player.failed.size, 0);
  assert.equal(player.message.textContent, blockedMessage);
});

for (const active of [false, true]) {
  test(`non-policy failures still quarantine the failed ${active ? 'active' : 'pending'} artwork`, async (t) => {
    const { player, slot } = fixture(t, { active });
    slot.video.playResult = () => Promise.reject(playbackError('NotSupportedError'));
    player.play(slot, player.pending?.token ?? null);
    await Promise.resolve();
    assert.equal(player.failed.has(slot.work.id), true);
    assert.equal(player.advances, 1);
    assert.equal(player.needsPlayGesture, false);
  });
}

test('late rejected requests cannot pause a replacement work or a later session', async (t) => {
  const { player, slot } = fixture(t);
  let rejectPlay;
  slot.video.playResult = () => new Promise((resolve, reject) => { rejectPlay = reject; });
  player.play(slot, player.pending.token);
  player.pending = { slot: player.slots[1], token: Symbol('replacement') };
  rejectPlay(playbackError('NotAllowedError'));
  await Promise.resolve();
  assert.equal(player.needsPlayGesture, false);
  assert.equal(player.paused, false);
  player.pending = { slot, token: Symbol('new') };
  player.play(slot, player.pending.token);
  player.session++;
  rejectPlay(playbackError('NotAllowedError'));
  await Promise.resolve();
  assert.equal(player.needsPlayGesture, false);
  assert.equal(player.paused, false);
});

test('ordinary paused navigation still promotes a decoded first frame', (t) => {
  const { player, slot } = fixture(t);
  player.paused = true;
  player.videoEvent(slot, 'loadeddata');
  assert.equal(player.active, slot);
  assert.equal(player.pending, null);
  assert.equal(player.paused, true);
  assert.equal(player.startedAt, null);
  assert.equal(slot.video.paused, true);
});
