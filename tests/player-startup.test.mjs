import test from 'node:test';
import assert from 'node:assert/strict';
import { ExhibitionPlayer } from '../src/player.js';

const artwork = (id) => ({ id, title: id, artist: 'Test artist', source: 'objkt', kind: 'video', mediaUrl: `https://media.example/${id}.mp4` });
const flushPromises = async () => { for (let count = 0; count < 6; count++) await Promise.resolve(); };

// Exercise open(), its real controls, and media listeners. Only browser DOM,
// decoded media, and fullscreen capability are simulated; no player method is stubbed.
function browserHarness(context, fullscreen = 'success') {
  const events = [];
  const fullscreenCompletions = [];
  const globals = ['document', 'navigator', 'matchMedia'];
  const originals = new Map(globals.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const document = Object.assign(new EventTarget(), { hidden: false, fullscreenElement: null, fullscreenEnabled: fullscreen !== 'unavailable' });
  class Element extends EventTarget {
    constructor(tag) {
      super();
      this.tagName = tag.toUpperCase();
      this.children = [];
      this.parentElement = null;
      this.attributes = new Map();
      this.className = '';
      this.textContent = '';
      this.hidden = false;
      this.disabled = false;
      this.style = { setProperty(name, value) { this[name] = value; }, getPropertyValue(name) { return this[name] || ''; }, removeProperty(name) { delete this[name]; } };
      this.classList = {
        contains: name => this.className.split(/\s+/).includes(name),
        add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
        remove: (...names) => { this.className = this.className.split(/\s+/).filter(name => !names.includes(name)).join(' '); },
      };
      if (tag === 'video') Object.assign(this, { src: '', paused: true, currentTime: 0, readyState: 4, videoWidth: 1920, videoHeight: 1080, error: null });
      if (fullscreen !== 'unavailable') this.requestFullscreen = () => {
        events.push({ type: 'fullscreen-request', element: this });
        if (fullscreen === 'throw') throw new Error('Fullscreen API failed synchronously');
        if (fullscreen === 'denied') return Promise.reject(new DOMException('Fullscreen not allowed', 'NotAllowedError'));
        if (fullscreen === 'deferred') return new Promise(resolve => {
          fullscreenCompletions.push(() => {
            document.fullscreenElement = this;
            document.dispatchEvent(new Event('fullscreenchange'));
            resolve();
          });
        });
        return Promise.resolve().then(() => {
          document.fullscreenElement = this;
          document.dispatchEvent(new Event('fullscreenchange'));
        });
      };
    }
    append(...children) {
      for (const child of children) { child.remove(); child.parentElement = this; this.children.push(child); }
    }
    remove() {
      if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this);
      this.parentElement = null;
    }
    contains(element) { return this === element || this.children.some(child => child.contains(element)); }
    get isConnected() { return document.documentElement?.contains(this) || false; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return name === 'src' ? this.src || null : this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); if (name === 'src') this.src = ''; }
    querySelector(selector) {
      if (selector.includes(':focus-visible')) return null;
      for (const child of this.children) {
        if (selector.startsWith('.') ? child.classList.contains(selector.slice(1)) : child.tagName.toLowerCase() === selector) return child;
        const match = child.querySelector(selector);
        if (match) return match;
      }
      return null;
    }
    focus() { document.activeElement = this; }
    showModal() { this.open = true; events.push({ type: 'dialog-open', element: this }); }
    close() { this.open = false; this.dispatchEvent(new Event('close')); }
    click() { if (!this.disabled) this.dispatchEvent(new Event('click')); }
    pause() { this.paused = true; }
    load() { this.error = null; this.currentTime = 0; events.push({ type: 'media-load', element: this, src: this.src }); }
    play() { this.paused = false; events.push({ type: 'media-play', element: this, src: this.src }); return Promise.resolve(); }
  }
  document.createElement = tag => new Element(tag);
  document.documentElement = new Element('html');
  document.body = new Element('body');
  document.documentElement.append(document.body);
  document.exitFullscreen = async () => {
    events.push({ type: 'fullscreen-exit', element: document.fullscreenElement });
    document.fullscreenElement = null;
    document.dispatchEvent(new Event('fullscreenchange'));
  };
  const values = { document, navigator: {}, matchMedia: () => Object.assign(new EventTarget(), { matches: false }) };
  for (const name of globals) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: values[name] });
  context.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let closes = 0;
  const player = new ExhibitionPlayer({ onClose: () => { closes++; } });
  context.after(async () => {
    try { player.close(); await flushPromises(); }
    finally {
      for (const name of globals) {
        const descriptor = originals.get(name);
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
    }
  });
  const start = (works = [artwork('first'), artwork('second')]) => player.open(works, { transition: 'none' });
  const beginPlaying = () => {
    const video = player.pending.slot.video;
    video.dispatchEvent(new Event('playing'));
    return video;
  };
  return { document, events, fullscreenCompletions, player, start, beginPlaying, closes: () => closes };
}

test('Start requests media before fullscreen and fullscreens the entire player inside its modal', async (context) => {
  const { document, events, player, start } = browserHarness(context);
  start();
  assert.equal(player.slots.length, 3);
  assert.ok(player.slots.every(slot => slot.video.muted && slot.video.defaultMuted));
  await flushPromises();
  const playIndex = events.findIndex(event => event.type === 'media-play');
  const fullscreenIndex = events.findIndex(event => event.type === 'fullscreen-request');
  assert.ok(playIndex >= 0 && fullscreenIndex > playIndex, 'media must start before fullscreen consumes the user gesture');
  const surface = events[fullscreenIndex].element;
  assert.notEqual(surface, document.documentElement);
  assert.notEqual(surface.tagName, 'DIALOG');
  assert.equal(player.dialog.contains(surface), true);
  for (const selector of ['.player-stage', '.player-top', '.player-caption', '.player-controls', '.player-progress', '.player-message']) {
    assert.ok(surface.querySelector(selector), `${selector} must remain visible inside fullscreen`);
  }
  assert.equal(document.fullscreenElement, surface);
  assert.equal(player.fullscreenButton.textContent, 'Exit fullscreen');
});

for (const mode of ['throw', 'denied']) {
  test(`a ${mode === 'throw' ? 'synchronous fullscreen error' : 'rejected fullscreen promise'} cannot abort Start`, async (context) => {
    const { document, events, player, start, beginPlaying, closes } = browserHarness(context, mode);
    assert.doesNotThrow(start);
    await flushPromises();
    assert.equal(player.opened, true);
    assert.equal(player.dialog.open, true);
    assert.equal(document.fullscreenElement, null);
    assert.equal(player.pending.work.id, 'first');
    assert.ok(events.some(event => event.type === 'media-play'));
    assert.equal(player.failed.size, 0, 'display-mode failures must not quarantine artworks');
    const video = beginPlaying();
    assert.equal(player.active.video, video);
    assert.equal(video.paused, false);
    assert.equal(closes(), 0);
    assert.equal(player.fullscreenButton.textContent, 'Fullscreen');
  });
}

test('repeated fullscreen button clicks preserve playback, current work, and elapsed time', async (context) => {
  const { document, events, player, start, beginPlaying, closes } = browserHarness(context);
  start();
  await flushPromises();
  const video = beginPlaying();
  const active = player.active;
  video.currentTime = 8;
  player.elapsed = 8000;
  const startedAt = player.startedAt;
  const loads = events.filter(event => event.type === 'media-load').length;
  for (let count = 0; count < 4; count++) {
    player.fullscreenButton.click();
    await flushPromises();
    assert.equal(Boolean(document.fullscreenElement), count % 2 === 1);
    assert.equal(player.fullscreenButton.textContent, count % 2 === 1 ? 'Exit fullscreen' : 'Fullscreen');
    assert.equal(player.opened, true);
    assert.equal(player.active, active);
    assert.equal(player.pending, null);
    assert.equal(video.currentTime, 8);
    assert.equal(video.paused, false);
    assert.equal(player.elapsed, 8000);
    assert.equal(player.startedAt, startedAt);
    assert.equal(events.filter(event => event.type === 'media-load').length, loads);
  }
  assert.equal(closes(), 0);
});

test('a browser without fullscreen support still starts playable media and hides the unavailable control', async (context) => {
  const { events, player, start, beginPlaying, closes } = browserHarness(context, 'unavailable');
  assert.doesNotThrow(start);
  await flushPromises();
  assert.equal(player.fullscreenButton.hidden, true);
  assert.equal(events.some(event => event.type === 'fullscreen-request'), false);
  const video = beginPlaying();
  assert.equal(video.paused, false);
  const fullscreenShortcut = new Event('keydown', { cancelable: true });
  Object.defineProperty(fullscreenShortcut, 'key', { value: 'f' });
  player.dialog.dispatchEvent(fullscreenShortcut);
  assert.equal(player.fullscreenNotice.hidden, false);
  assert.match(player.fullscreenNotice.textContent, /fullscreen.*unavailable/i);
  assert.equal(player.opened, true);
  assert.equal(closes(), 0);
});

test('pending fullscreen attempts are deduplicated and late completion cannot disrupt a reopened exhibition', async (context) => {
  const { document, events, fullscreenCompletions, player, start, beginPlaying, closes } = browserHarness(context, 'deferred');
  start();
  const oldSurface = events.find(event => event.type === 'fullscreen-request').element;
  for (let attempt = 0; attempt < 3; attempt++) {
    player.fullscreenButton.click();
    const shortcut = new Event('keydown', { cancelable: true });
    Object.defineProperty(shortcut, 'key', { value: 'f' });
    player.dialog.dispatchEvent(shortcut);
  }
  assert.equal(fullscreenCompletions.length, 1);
  player.close();
  start([artwork('replacement')]);
  const video = beginPlaying();
  const active = player.active;
  video.currentTime = 12;
  player.elapsed = 12_000;
  const startedAt = player.startedAt;
  const loads = events.filter(event => event.type === 'media-load').length;
  fullscreenCompletions[0]();
  await flushPromises();
  assert.equal(document.fullscreenElement, null);
  assert.ok(events.some(event => event.type === 'fullscreen-exit' && event.element === oldSurface));
  assert.equal(player.opened, true);
  assert.equal(player.dialog.open, true);
  assert.equal(player.active, active);
  assert.equal(player.active.work.id, 'replacement');
  assert.equal(video.paused, false);
  assert.equal(video.currentTime, 12);
  assert.equal(player.elapsed, 12_000);
  assert.equal(player.startedAt, startedAt);
  assert.equal(events.filter(event => event.type === 'media-load').length, loads);
  assert.equal(closes(), 1, 'only the explicit close of the earlier exhibition should stop playback');
  assert.equal(player.fullscreenButton.disabled, false);
  player.fullscreenButton.click();
  assert.equal(fullscreenCompletions.length, 2);
  fullscreenCompletions[1]();
  await flushPromises();
  assert.notEqual(document.fullscreenElement, oldSurface);
  assert.equal(player.dialog.contains(document.fullscreenElement), true);
  assert.equal(player.active, active);
});

for (const firstDismissal of ['Escape', 'cancel']) {
  test(`${firstDismissal} exits fullscreen without stopping the exhibition; the next Escape closes it`, async (context) => {
    const { document, player, start, beginPlaying, closes } = browserHarness(context);
    start();
    await flushPromises();
    const video = beginPlaying();
    const active = player.active;
    video.currentTime = 7;
    const event = new Event(firstDismissal === 'cancel' ? 'cancel' : 'keydown', { cancelable: true });
    if (firstDismissal === 'Escape') Object.defineProperty(event, 'key', { value: 'Escape' });
    player.dialog.dispatchEvent(event);
    await flushPromises();
    assert.equal(event.defaultPrevented, true);
    assert.equal(document.fullscreenElement, null);
    assert.equal(player.opened, true);
    assert.equal(player.dialog.open, true);
    assert.equal(player.active, active);
    assert.equal(video.paused, false);
    assert.equal(video.currentTime, 7);
    assert.equal(closes(), 0);
    const escape = new Event('keydown', { cancelable: true });
    Object.defineProperty(escape, 'key', { value: 'Escape' });
    player.dialog.dispatchEvent(escape);
    await flushPromises();
    assert.equal(player.opened, false);
    assert.equal(video.paused, true);
    assert.equal(video.src, '');
    assert.equal(closes(), 1);
  });
}
