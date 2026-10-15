const LOAD_TIMEOUT = 15_000;
const DURATIONS = new Set([10, 20, 30, 60, 120]);

export function safeMediaUrl(value, origin = globalThis.location?.origin) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value, origin);
    if (url.protocol === 'blob:') return origin && url.origin === origin ? url.href : null;
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    // Content-addressed media often has no file extension. Native video still
    // verifies that the response is a playable video, never an embedded page.
    if (/\.(?:html?|svg|jpe?g|png|gif|avif|pdf|js)(?:$)/i.test(url.pathname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function shuffleWorks(works, previousId, random = Math.random) {
  const result = [...works];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  if (result.length > 1 && result[0].id === previousId) {
    const other = result.findIndex((work) => work.id !== previousId);
    if (other > 0) [result[0], result[other]] = [result[other], result[0]];
  }
  return result;
}

function button(label, text, action) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'player-button';
  element.setAttribute('aria-label', label);
  element.title = label;
  element.textContent = text;
  element.addEventListener('click', action);
  return element;
}

/** A two-video, in-browser exhibition. No remote code or iframe is executed. */
export class ExhibitionPlayer {
  constructor({ onClose, onStatus } = {}) {
    this.onClose = onClose;
    this.onStatus = onStatus;
    this.session = 0;
    this.opened = false;
    this.fullscreenOwned = false;
    this.fullscreenRequest = null;
  }

  open(works, settings = {}) {
    if (this.opened) this.close();
    this.session += 1;
    const session = this.session;
    this.settings = {
      duration: DURATIONS.has(Number(settings.duration)) ? Number(settings.duration) : 30,
      fit: settings.fit === 'cover' ? 'cover' : 'contain',
      captions: settings.captions !== false,
      shuffle: settings.shuffle === true,
    };
    const ids = new Set();
    this.works = (Array.isArray(works) ? works : []).filter((work) => {
      if (!work || work.kind !== 'video' || !work.id || ids.has(work.id)) return false;
      ids.add(work.id);
      return Boolean(safeMediaUrl(work.mediaUrl) || safeMediaUrl(work.alternateMediaUrl));
    });
    this.order = this.settings.shuffle ? shuffleWorks(this.works) : [...this.works];
    this.position = 0;
    this.failed = new Set();
    this.active = null;
    this.pending = null;
    this.nextPlan = null;
    this.paused = false;
    this.elapsed = 0;
    this.startedAt = null;
    this.opened = true;
    this.controller = new AbortController();
    this.previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const dialog = document.createElement('dialog');
    dialog.className = 'exhibition-player controls-visible';
    dialog.setAttribute('aria-label', 'ArtDrops exhibition player');
    dialog.tabIndex = -1;
    this.dialog = dialog;
    const stage = document.createElement('div');
    stage.className = 'player-stage';
    this.slots = [0, 1].map(() => {
      const video = document.createElement('video');
      video.className = 'player-video';
      video.muted = true;
      video.defaultMuted = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.style.objectFit = this.settings.fit;
      video.setAttribute('aria-hidden', 'true');
      video.setAttribute('disablepictureinpicture', '');
      const slot = { video, work: null, sourceIndex: 0, watchdog: null };
      for (const name of ['playing', 'loadeddata', 'error', 'waiting', 'stalled']) {
        video.addEventListener(name, () => {
          if (this.opened && this.session === session) this.videoEvent(slot, name);
        }, { signal: this.controller.signal });
      }
      stage.append(video);
      return slot;
    });
    dialog.append(stage);

    const top = document.createElement('div');
    top.className = 'player-top player-chrome';
    const brand = document.createElement('span');
    brand.className = 'player-brand';
    brand.textContent = 'ARTDROPS / ON DISPLAY';
    this.counter = document.createElement('span');
    this.counter.className = 'player-counter';
    this.counter.setAttribute('aria-label', 'Exhibition position');
    top.append(brand, this.counter);
    dialog.append(top);

    this.message = document.createElement('div');
    this.message.className = 'player-message';
    this.message.setAttribute('role', 'status');
    this.message.textContent = 'Preparing your exhibition…';
    dialog.append(this.message);

    this.caption = document.createElement('div');
    this.caption.className = 'player-caption';
    this.caption.hidden = !this.settings.captions;
    this.title = document.createElement('h2');
    this.artist = document.createElement('p');
    this.caption.append(this.title, this.artist);
    dialog.append(this.caption);

    const controls = document.createElement('div');
    controls.className = 'player-controls player-chrome';
    controls.setAttribute('role', 'group');
    controls.setAttribute('aria-label', 'Exhibition controls');
    this.pauseButton = button('Pause exhibition (Space)', 'Pause', () => this.togglePause());
    this.pauseButton.setAttribute('aria-pressed', 'false');
    controls.append(
      button('Previous artwork (Left arrow)', '←', () => this.advance(-1)),
      this.pauseButton,
      button('Next artwork (Right arrow)', '→', () => this.advance(1)),
      button('Toggle fullscreen (F)', 'Fullscreen', () => this.fullscreen()),
      button('Close exhibition (Escape)', 'Close ×', () => this.close()),
    );
    dialog.append(controls);
    this.progress = document.createElement('div');
    this.progress.className = 'player-progress';
    this.progress.setAttribute('aria-hidden', 'true');
    dialog.append(this.progress);

    const signal = this.controller.signal;
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); this.close(); }, { signal });
    dialog.addEventListener('close', () => { if (this.opened) this.close(); }, { signal });
    dialog.addEventListener('pointermove', () => this.showControls(), { signal });
    dialog.addEventListener('pointerdown', () => this.showControls(), { signal });
    dialog.addEventListener('focusin', () => this.showControls(), { signal });
    dialog.addEventListener('keydown', (event) => {
      this.showControls();
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'Escape') { event.preventDefault(); this.close(); }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); this.advance(-1); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); this.advance(1); }
      else if (event.key === ' ') {
        event.preventDefault(); this.togglePause();
      } else if (event.key.toLowerCase() === 'f') { event.preventDefault(); this.fullscreen(); }
    }, { signal });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.opened) {
        this.requestWakeLock();
        if (this.active) this.active.lastProgressAt = performance.now();
        // Advance at most once on return; never race through a background queue.
        this.tick();
      }
    }, { signal });
    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement) {
        this.fullscreenOwned = false;
        if (!this.fullscreenRequest?.pending) this.fullscreenRequest = null;
      }
    }, { signal });
    document.body.append(dialog);
    dialog.showModal();
    dialog.focus();
    this.enterFullscreen();
    this.requestWakeLock();
    this.showControls();
    this.interval = setInterval(() => this.tick(), 100);
    if (this.order.length) this.requestWork(0);
    else this.unavailable('There are no playable videos in this exhibition. Close the player and add an artwork.');
  }

  sources(work) {
    return [...new Set([work.mediaUrl, work.alternateMediaUrl].map((url) => safeMediaUrl(url)).filter(Boolean))];
  }

  freezeClock() {
    if (this.startedAt !== null) this.elapsed += performance.now() - this.startedAt;
    this.startedAt = null;
  }

  resumeClock() {
    if (!this.paused && !this.pending && this.active && !this.active.buffering && this.startedAt === null) {
      this.startedAt = performance.now();
    }
  }

  clockElapsed() {
    return this.elapsed + (this.startedAt === null ? 0 : performance.now() - this.startedAt);
  }

  plan(direction) {
    if (!this.order.length || this.failed.size >= this.order.length) return null;
    let order = this.order;
    let position = this.position;
    for (let attempt = 0; attempt < order.length; attempt++) {
      position += direction;
      if (position >= order.length) {
        if (this.settings.shuffle) {
          order = shuffleWorks(order, this.active?.work.id);
          const first = order.findIndex((work) => !this.failed.has(work.id) && work.id !== this.active?.work.id);
          if (first > 0) [order[0], order[first]] = [order[first], order[0]];
        }
        position = 0;
      }
      if (position < 0) position = order.length - 1;
      if (!this.failed.has(order[position].id)) return { order, position };
    }
    return null;
  }

  advance(direction) {
    if (!this.opened) return;
    const cached = direction === 1 && !this.pending ? this.nextPlan : null;
    const plan = cached && !this.failed.has(cached.order[cached.position].id) ? cached : this.plan(direction);
    if (!plan) return this.unavailable();
    this.order = plan.order;
    this.requestWork(plan.position);
  }

  requestWork(position, sourceIndex = 0) {
    if (!this.opened) return;
    this.freezeClock();
    clearTimeout(this.fadeTimer);
    this.nextPlan = null;
    const work = this.order[position];
    if (!work) return this.unavailable();
    const slot = this.slots.find((candidate) => candidate !== this.active);
    this.position = position;
    this.pending = { slot, work, position, sourceIndex, token: Symbol('playback') };
    this.loadPending();
  }

  loadPending() {
    const pending = this.pending;
    if (!pending) return;
    const { slot, work, sourceIndex } = pending;
    const source = this.sources(work)[sourceIndex];
    if (!source) return this.failPending();
    this.clearWatch(slot);
    slot.video.pause();
    slot.work = work;
    slot.sourceIndex = sourceIndex;
    slot.buffering = true;
    if (slot.video.getAttribute('src') !== source || slot.video.error) {
      slot.video.src = source;
      slot.video.load();
    }
    if (!this.active) {
      this.message.hidden = false;
      this.message.textContent = `Loading ${work.title || 'artwork'}…`;
    }
    this.watch(slot);
    if (!this.paused) this.play(slot, pending.token);
    else if (slot.video.readyState >= 2 && slot.video.videoWidth) this.promote();
  }

  play(slot, token = null) {
    const session = this.session;
    const playToken = Symbol('play');
    slot.playToken = playToken;
    const promise = slot.video.play();
    promise?.catch((error) => {
      if (!this.opened || this.session !== session || slot.playToken !== playToken || this.paused || error.name === 'AbortError') return;
      if (this.pending?.slot === slot && this.pending.token === token) this.failPending();
      else if (this.active === slot && !this.pending) this.failActive();
    });
  }

  watch(slot) {
    this.clearWatch(slot);
    if (this.paused && this.pending?.slot !== slot) return;
    const session = this.session;
    slot.watchdog = setTimeout(() => {
      slot.watchdog = null;
      if (!this.opened || this.session !== session || (this.paused && this.pending?.slot !== slot)) return;
      if (this.pending?.slot === slot) this.failPending();
      else if (this.active === slot && !this.pending) this.failActive();
    }, LOAD_TIMEOUT);
  }

  clearWatch(slot) {
    clearTimeout(slot.watchdog);
    slot.watchdog = null;
  }

  videoEvent(slot, event) {
    if (event === 'loadeddata') {
      if (this.paused && this.pending?.slot === slot && slot.video.videoWidth) this.promote();
      return;
    }
    if (event === 'playing') {
      if (!slot.video.videoWidth) {
        if (this.pending?.slot === slot) this.failPending();
        else if (this.active === slot && !this.pending) this.failActive();
        return;
      }
      this.clearWatch(slot);
      slot.buffering = false;
      slot.lastTime = slot.video.currentTime;
      slot.lastProgressAt = performance.now();
      if (this.pending?.slot === slot) this.promote();
      else if (this.active === slot) this.resumeClock();
      return;
    }
    if (event === 'error') {
      if (!slot.video.error) return;
      if (this.pending?.slot === slot) this.failPending();
      else if (this.active === slot && !this.pending) this.failActive();
      return;
    }
    // A stalled download can still have enough buffered video to keep playing.
    if (event === 'stalled' && slot.video.readyState >= 3) return;
    if (slot === this.active || slot === this.pending?.slot) {
      slot.buffering = true;
      if (slot === this.active) this.freezeClock();
      if (!slot.watchdog) this.watch(slot);
    }
  }

  promote() {
    const pending = this.pending;
    if (!pending) return;
    const previous = this.active;
    const slot = pending.slot;
    this.clearWatch(slot);
    slot.position = pending.position;
    this.active = slot;
    this.pending = null;
    this.elapsed = 0;
    this.startedAt = null;
    this.message.hidden = true;
    this.title.textContent = slot.work.title || 'Untitled';
    this.artist.textContent = slot.work.artist || 'Artist unknown';
    slot.video.classList.add('is-active');
    if (this.paused) slot.video.pause();
    this.resumeClock();
    this.tick();
    const session = this.session;
    clearTimeout(this.fadeTimer);
    if (previous && previous !== slot) previous.video.classList.remove('is-active');
    // Let the outgoing moving image finish its fade before reusing its element.
    this.fadeTimer = setTimeout(() => {
      if (!this.opened || this.session !== session) return;
      if (previous && previous !== this.active) {
        previous.video.pause();
        this.clearWatch(previous);
      }
      if (!this.pending) this.preloadNext();
    }, previous ? 650 : 0);
  }

  preloadNext() {
    this.nextPlan = this.plan(1);
    if (!this.nextPlan) return;
    const work = this.nextPlan.order[this.nextPlan.position];
    if (work.id === this.active?.work.id) return;
    const slot = this.slots.find((candidate) => candidate !== this.active);
    slot.video.pause();
    slot.work = work;
    slot.sourceIndex = 0;
    const source = this.sources(work)[0];
    if (slot.video.getAttribute('src') !== source) {
      slot.video.src = source;
      slot.video.load();
    }
  }

  failPending() {
    const pending = this.pending;
    if (!pending) return;
    this.clearWatch(pending.slot);
    if (pending.sourceIndex + 1 < this.sources(pending.work).length) {
      pending.sourceIndex += 1;
      pending.token = Symbol('fallback');
      this.loadPending();
      return;
    }
    this.failed.add(pending.work.id);
    this.onStatus?.(`Skipped “${pending.work.title || 'Untitled'}”: its video could not play.`);
    this.pending = null;
    this.advance(1);
  }

  failActive() {
    const slot = this.active;
    if (!slot) return;
    this.clearWatch(slot);
    const sourceIndex = slot.sourceIndex + 1;
    if (sourceIndex < this.sources(slot.work).length) {
      const index = this.order.findIndex((work) => work.id === slot.work.id);
      this.requestWork(index, sourceIndex);
      return;
    }
    this.failed.add(slot.work.id);
    this.onStatus?.(`Skipped “${slot.work.title || 'Untitled'}”: playback stopped responding.`);
    this.nextPlan = null;
    this.advance(1);
  }

  unavailable(message = 'These videos are unavailable right now. Check your connection, then close and relaunch the exhibition.') {
    this.freezeClock();
    this.pending = null;
    this.active = null;
    this.nextPlan = null;
    for (const slot of this.slots) {
      this.clearWatch(slot);
      slot.video.pause();
      slot.video.classList.remove('is-active');
      slot.video.removeAttribute('src');
      slot.video.load();
    }
    this.message.textContent = message;
    this.message.hidden = false;
    this.caption.hidden = true;
    this.counter.textContent = 'Playback unavailable';
    this.progress.style.setProperty('--player-progress', '0%');
    this.pauseButton.disabled = true;
    this.showControls();
  }

  tick() {
    if (!this.opened || !this.active) return;
    if (!this.paused && !this.pending && !document.hidden) {
      if (this.active.video.currentTime !== this.active.lastTime) {
        this.active.lastTime = this.active.video.currentTime;
        this.active.lastProgressAt = performance.now();
      } else if (performance.now() - this.active.lastProgressAt >= LOAD_TIMEOUT) {
        this.failActive();
        return;
      }
    }
    const elapsed = this.clockElapsed();
    const duration = this.settings.duration * 1000;
    const remaining = Math.max(0, Math.ceil((duration - elapsed) / 1000));
    this.counter.textContent = `${this.active.position + 1} / ${this.order.length}  ·  ${this.paused ? 'Paused' : `${remaining}s`}`;
    this.progress.style.setProperty('--player-progress', `${Math.min(100, elapsed / duration * 100)}%`);
    if (!this.paused && !this.pending && !document.hidden && elapsed >= duration) this.advance(1);
  }

  togglePause() {
    if (!this.opened || (!this.active && !this.pending)) return;
    this.paused = !this.paused;
    this.pauseButton.textContent = this.paused ? 'Resume' : 'Pause';
    this.pauseButton.setAttribute('aria-label', `${this.paused ? 'Resume' : 'Pause'} exhibition (Space)`);
    this.pauseButton.setAttribute('aria-pressed', String(this.paused));
    if (this.paused) {
      this.freezeClock();
      for (const slot of this.slots) { slot.video.pause(); this.clearWatch(slot); }
      if (this.pending) {
        const slot = this.pending.slot;
        if (slot.video.readyState >= 2 && slot.video.videoWidth) this.promote();
        else this.watch(slot);
      }
    } else if (this.pending) {
      this.watch(this.pending.slot);
      this.play(this.pending.slot, this.pending.token);
    } else if (this.active) {
      this.active.lastProgressAt = performance.now();
      this.watch(this.active);
      this.play(this.active);
    }
    this.showControls();
    this.tick();
  }

  showControls() {
    if (!this.opened) return;
    this.dialog.classList.add('controls-visible');
    clearTimeout(this.controlsTimer);
    this.controlsTimer = setTimeout(() => {
      if (!this.opened || !this.active || this.paused) return;
      if (this.dialog.querySelector('button:focus-visible')) return;
      this.dialog.classList.remove('controls-visible');
    }, 2800);
  }

  fullscreen() {
    if (!this.opened) return;
    if (document.fullscreenElement) {
      this.fullscreenOwned = false;
      if (this.fullscreenRequest) this.fullscreenRequest.ownerSession = null;
      document.exitFullscreen?.().catch(() => {});
    } else this.enterFullscreen();
  }

  enterFullscreen() {
    const element = document.documentElement;
    // A modal dialog cannot itself be a fullscreen element. Fullscreen its
    // document instead; the native dialog remains above it in the top layer.
    if (document.fullscreenElement) {
      if (this.fullscreenRequest?.pending && document.fullscreenElement === element) {
        this.fullscreenRequest.ownerSession = this.session;
        this.fullscreenOwned = true;
      }
      return;
    }
    if (this.fullscreenRequest?.pending) {
      this.fullscreenRequest.ownerSession = this.session;
      return;
    }
    if (!element.requestFullscreen) return;
    const request = { ownerSession: this.session, pending: true };
    this.fullscreenRequest = request;
    return element.requestFullscreen().then(() => {
      request.pending = false;
      if (this.fullscreenRequest !== request) return;
      if (this.opened && request.ownerSession === this.session) {
        this.fullscreenOwned = document.fullscreenElement === element;
      } else if (document.fullscreenElement === element) {
        document.exitFullscreen?.().catch(() => {});
      }
    }).catch(() => {
      if (this.fullscreenRequest === request) this.fullscreenRequest = null;
    });
  }

  releaseFullscreen() {
    const ownsRequest = this.fullscreenRequest?.ownerSession === this.session;
    if (ownsRequest) this.fullscreenRequest.ownerSession = null;
    const owned = this.fullscreenOwned || ownsRequest;
    this.fullscreenOwned = false;
    if (owned && document.fullscreenElement === document.documentElement) {
      document.exitFullscreen?.().catch(() => {});
    }
    if (!this.fullscreenRequest?.pending) this.fullscreenRequest = null;
  }

  async requestWakeLock() {
    if (!this.opened || document.hidden || this.wakeLock || this.wakeRequest || !navigator.wakeLock) return;
    const session = this.session;
    this.wakeRequest = true;
    try {
      const lock = await navigator.wakeLock.request('screen');
      if (!this.opened || this.session !== session) { await lock.release(); return; }
      this.wakeLock = lock;
      lock.addEventListener('release', () => { if (this.wakeLock === lock) this.wakeLock = null; }, { once: true });
    } catch { /* Playback remains usable when a browser declines wake lock. */ }
    finally { if (this.session === session) this.wakeRequest = false; }
  }

  close() {
    if (!this.opened) return;
    this.releaseFullscreen();
    this.opened = false;
    this.session += 1;
    this.controller.abort();
    clearInterval(this.interval);
    clearTimeout(this.controlsTimer);
    clearTimeout(this.fadeTimer);
    for (const slot of this.slots) {
      this.clearWatch(slot);
      slot.video.pause();
      slot.video.removeAttribute('src');
      slot.video.load();
    }
    this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
    this.wakeRequest = false;
    this.dialog.close();
    this.dialog.remove();
    document.body.style.overflow = this.previousOverflow;
    this.active = null;
    this.pending = null;
    this.onClose?.();
  }
}
