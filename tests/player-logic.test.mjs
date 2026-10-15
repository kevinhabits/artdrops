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
