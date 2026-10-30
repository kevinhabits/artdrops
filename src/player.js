const LOAD_TIMEOUT = 15_000;
const LOOKAHEAD = 2;
const DURATIONS = new Set([10, 20, 30, 60, 120]);

export function safeMediaUrl(value, origin = globalThis.location?.origin, kind = 'video') {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value, origin);
    if (url.protocol === 'blob:') return origin && url.origin === origin ? url.href : null;
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    // Content-addressed media may have no extension. Native media elements
    // decode its contents without executing a remote page or script.
    if (/\.(?:html?|svg|pdf|js)$/i.test(url.pathname)) return null;
    if (kind !== 'image' && /\.(?:jpe?g|png|webp|gif|avif)$/i.test(url.pathname)) return null;
    if (kind === 'image' && /\.(?:mp4|webm)$/i.test(url.pathname)) return null;
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

/** A bounded, in-browser exhibition. No remote code or iframe is executed. */
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
      transition: settings.transition === 'none' ? 'none' : 'fade',
    };
    const ids = new Set();
    this.works = (Array.isArray(works) ? works : []).filter((work) => {
      if (!work || !['video', 'image'].includes(work.kind) || !work.id || ids.has(work.id)) return false;
      ids.add(work.id);
      return this.sources(work).length > 0;
    });
    this.order = this.settings.shuffle ? shuffleWorks(this.works) : [...this.works];
    this.position = 0;
    this.failed = new Set();
    this.active = null;
    this.pending = null;
    this.nextPlan = null;
    this.nextPlans = [];
    this.fadeState = null;
    this.paused = false;
    this.needsPlayGesture = false;
    this.elapsed = 0;
    this.startedAt = null;
    this.opened = true;
    this.controller = new AbortController();
    this.reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
    this.previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const dialog = document.createElement('dialog');
    dialog.className = 'exhibition-player controls-visible';
    dialog.setAttribute('aria-label', 'ArtDrops exhibition player');
    dialog.tabIndex = -1;
    this.dialog = dialog;
    dialog.style.setProperty('--player-fade-duration', `${this.transitionDuration()}ms`);
    // Fullscreen a regular child of the modal. Fullscreening the page instead
    // can put the page above the modal in the browser's top layer.
    const surface = document.createElement('div');
    surface.className = 'player-surface';
    this.surface = surface;
    dialog.append(surface);
    const stage = document.createElement('div');
    stage.className = 'player-stage';
    this.slots = [0, 1, 2].map(() => {
      const frame = document.createElement('div');
      frame.className = 'player-frame';
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
      const image = document.createElement('img');
      image.className = 'player-image';
      image.alt = '';
      image.decoding = 'async';
      image.hidden = true;
      image.style.objectFit = this.settings.fit;
      const slot = { frame, video, image, work: null, sourceIndex: 0, watchdog: null };
      for (const name of ['playing', 'loadeddata', 'error', 'waiting', 'stalled']) {
        video.addEventListener(name, () => {
          if (this.opened && this.session === session) this.videoEvent(slot, name);
        }, { signal: this.controller.signal });
      }
      for (const name of ['load', 'error']) {
        image.addEventListener(name, () => {
          if (this.opened && this.session === session) this.imageEvent(slot, name);
        }, { signal: this.controller.signal });
      }
      frame.append(video, image);
      stage.append(frame);
      return slot;
    });
    surface.append(stage);

    const top = document.createElement('div');
    top.className = 'player-top player-chrome';
    const brand = document.createElement('span');
    brand.className = 'player-brand';
    brand.textContent = 'ARTDROPS / ON DISPLAY';
    this.counter = document.createElement('span');
    this.counter.className = 'player-counter';
    this.counter.setAttribute('aria-label', 'Exhibition position');
    top.append(brand, this.counter);
    surface.append(top);

    this.message = document.createElement('div');
    this.message.className = 'player-message';
    this.message.setAttribute('role', 'status');
    this.message.textContent = 'Preparing your exhibition…';
    surface.append(this.message);

    this.fullscreenNotice = document.createElement('p');
    this.fullscreenNotice.className = 'player-notice player-chrome';
    this.fullscreenNotice.setAttribute('role', 'status');
    this.fullscreenNotice.hidden = true;
    surface.append(this.fullscreenNotice);

    this.caption = document.createElement('div');
    this.caption.className = 'player-caption';
    this.caption.hidden = !this.settings.captions;
    this.title = document.createElement('h2');
    this.artist = document.createElement('p');
    this.caption.append(this.title, this.artist);
    surface.append(this.caption);

    const controls = document.createElement('div');
    controls.className = 'player-controls player-chrome';
    controls.setAttribute('role', 'group');
    controls.setAttribute('aria-label', 'Exhibition controls');
    this.pauseButton = button('Pause exhibition (Space)', 'Pause', () => this.togglePause());
    this.pauseButton.setAttribute('aria-pressed', 'false');
    this.fullscreenButton = button('Enter fullscreen (F)', 'Fullscreen', () => this.fullscreen());
    controls.append(
      button('Previous artwork (Left arrow)', '←', () => this.advance(-1)),
      this.pauseButton,
      button('Next artwork (Right arrow)', '→', () => this.advance(1)),
      this.fullscreenButton,
      button('Close exhibition (Escape)', 'Close ×', () => this.close()),
    );
    surface.append(controls);
    this.progress = document.createElement('div');
    this.progress.className = 'player-progress';
    this.progress.setAttribute('aria-hidden', 'true');
    surface.append(this.progress);

    const signal = this.controller.signal;
    this.reducedMotion?.addEventListener?.('change', () => {
      dialog.style.setProperty('--player-fade-duration', `${this.transitionDuration()}ms`);
      if (this.reducedMotion.matches) this.finishTransition(true);
    }, { signal });
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); if (this.fullscreenElement()) this.fullscreen(); else this.close(); }, { signal });
    dialog.addEventListener('close', () => { if (this.opened) this.close(); }, { signal });
    dialog.addEventListener('pointermove', () => this.showControls(), { signal });
    dialog.addEventListener('pointerdown', () => this.showControls(), { signal });
    dialog.addEventListener('focusin', () => this.showControls(), { signal });
    dialog.addEventListener('keydown', (event) => {
      this.showControls();
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'Escape') { event.preventDefault(); if (this.fullscreenElement()) this.fullscreen(); else this.close(); }
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
    const fullscreenChanged = () => {
      if (!this.fullscreenElement()) {
        this.fullscreenOwned = false;
        if (!this.fullscreenRequest?.pending) this.fullscreenRequest = null;
      }
      this.layoutMedia();
      this.syncFullscreenButton();
    };
    document.addEventListener('fullscreenchange', fullscreenChanged, { signal });
    globalThis.addEventListener?.('resize', () => this.layoutMedia(), { signal });
    document.body.append(dialog);
    dialog.showModal();
    dialog.focus();
    this.requestWakeLock();
    this.showControls();
    this.interval = setInterval(() => this.tick(), 100);
    if (this.order.length) this.requestWork(0);
    else this.unavailable('There are no playable artworks in this exhibition. Close the player and add an artwork.');
    // Start media while the click still has user activation. Fullscreen may
    // consume that activation, and must never be a prerequisite for playback.
    this.syncFullscreenButton();
    if (this.order.length) this.enterFullscreen();
  }

  sources(work) {
    return [...new Set([work.mediaUrl, work.alternateMediaUrl].map((url) => safeMediaUrl(url, undefined, work.kind)).filter(Boolean))];
  }

  frame(slot) { return slot.frame || slot.video; }

  ready(slot) {
    return slot.work?.kind === 'image' ? slot.imageReady : !slot.video.error && slot.video.readyState >= 2;
  }

  layoutMedia() {
    for (const slot of this.slots || []) {
      if (!slot.frame) continue;
      const rotation = [90, 180, 270].includes(Number(slot.work?.rotation)) ? Number(slot.work.rotation) : 0;
      const quarterTurn = rotation === 90 || rotation === 270;
      const width = slot.frame.clientWidth || this.surface?.clientWidth || globalThis.innerWidth;
      const height = slot.frame.clientHeight || this.surface?.clientHeight || globalThis.innerHeight;
      slot.frame.style.setProperty('--artwork-rotation', `${rotation}deg`);
      slot.frame.style.setProperty('--player-media-width', quarterTurn && height ? `${height}px` : '100%');
      slot.frame.style.setProperty('--player-media-height', quarterTurn && width ? `${width}px` : '100%');
    }
  }

  setMedia(slot, work, source) {
    const element = work.kind === 'image' ? slot.image : slot.video;
    if (slot.work?.id !== work.id || slot.work?.kind !== work.kind || element.getAttribute('src') !== source) {
      slot.playToken = null;
    }
    slot.video.pause();
    slot.work = work;
    const isImage = work.kind === 'image';
    slot.video.hidden = isImage;
    if (slot.image) slot.image.hidden = !isImage;
    this.layoutMedia();
    if (isImage) {
      if (slot.video.getAttribute('src')) { slot.video.removeAttribute('src'); slot.video.load(); }
      if (slot.image.getAttribute('src') !== source || slot.imageFailed) {
        slot.mediaToken = Symbol('image');
        slot.imageReady = false;
        slot.imageFailed = false;
        slot.imageDecoding = null;
        slot.image.src = source;
      }
    } else {
      slot.image?.removeAttribute('src');
      if (slot.video.getAttribute('src') !== source || slot.video.error) {
        slot.mediaToken = Symbol('video');
        slot.video.src = source;
        slot.video.load();
      }
    }
  }

  imageEvent(slot, event) {
    if (slot.work?.kind !== 'image') return;
    const fail = () => {
      slot.imageFailed = true;
      if (this.pending?.slot === slot) this.failPending();
      else if (this.active === slot && !this.pending) this.failActive();
      else if (slot.preloading) this.failPreload(slot);
    };
    if (event === 'error') { fail(); return; }
    if (!slot.image.complete) return;
    if (!slot.image.naturalWidth) { fail(); return; }
    if (slot.imageReady) {
      slot.buffering = false;
      this.clearWatch(slot);
      if (this.pending?.slot === slot) this.promote();
      return;
    }
    const token = slot.mediaToken;
    if (slot.imageDecoding === token) return;
    slot.imageDecoding = token;
    const session = this.session;
    const current = () => this.opened && this.session === session && slot.mediaToken === token && slot.work?.kind === 'image';
    const decoded = () => {
      if (!current()) return;
      slot.imageReady = true;
      slot.buffering = false;
      this.clearWatch(slot);
      if (this.pending?.slot === slot) this.promote();
    };
    try {
      Promise.resolve(slot.image.decode?.()).then(decoded, () => { if (current()) fail(); });
    } catch { if (current()) fail(); }
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

  plan(direction, from = { order: this.order, position: this.position, previousId: this.active?.work.id }) {
    if (!from.order.length || this.failed.size >= from.order.length) return null;
    let order = from.order;
    let position = from.position;
    const previousId = from.previousId ?? order[position]?.id;
    for (let attempt = 0; attempt < order.length; attempt++) {
      position += direction;
      if (position >= order.length) {
        if (this.settings.shuffle) {
          order = shuffleWorks(order, previousId);
          let first = order.findIndex((work) => !this.failed.has(work.id) && work.id !== previousId);
          if (first < 0) first = order.findIndex((work) => !this.failed.has(work.id));
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
    const cached = direction === 1 ? this.nextPlan : null;
    const plan = cached && !this.failed.has(cached.order[cached.position].id) ? cached : this.plan(direction);
    if (!plan) return this.unavailable();
    this.order = plan.order;
    this.requestWork(plan.position, null, plan);
  }

  requestWork(position, sourceIndex = null, plan = null) {
    if (!this.opened) return;
    // Complete the visible blend before reusing an outgoing media slot.
    this.finishTransition();
    this.freezeClock();
    const consumed = plan ? (this.nextPlans || []).indexOf(plan) : -1;
    this.nextPlans = consumed < 0 ? [] : this.nextPlans.slice(consumed + 1);
    this.nextPlan = this.nextPlans[0] || null;
    const work = this.order[position];
    if (!work) return this.unavailable();
    if (work.kind === 'image') {
      this.needsPlayGesture = false;
      this.message.hidden = true;
    }
    if (sourceIndex === null && this.active?.work.id === work.id && !this.failed.has(work.id)
      && !this.active.buffering && this.ready(this.active)) {
      if (this.pending) {
        this.clearWatch(this.pending.slot);
        this.pending.slot.playToken = null;
        this.pending.slot.video.pause();
        this.pending = null;
      }
      this.position = position;
      this.active.position = position;
      this.elapsed = 0;
      this.resumeClock();
      this.tick();
      this.preloadNext();
      return;
    }
    const available = this.slots.filter((candidate) => candidate !== this.active);
    const slot = available.find((candidate) => candidate.work?.id === work.id
      && (sourceIndex === null || candidate.sourceIndex === sourceIndex)) || available[0];
    if (this.pending && this.pending.slot !== slot) {
      this.clearWatch(this.pending.slot);
      this.pending.slot.playToken = null;
      this.pending.slot.video.pause();
    }
    const preparedSource = slot.work?.id === work.id ? slot.sourceIndex : 0;
    this.position = position;
    this.pending = { slot, work, position, sourceIndex: sourceIndex ?? preparedSource ?? 0, token: Symbol('playback') };
    this.loadPending();
    this.preloadNext();
  }

  loadPending() {
    const pending = this.pending;
    if (!pending) return;
    const { slot, work, sourceIndex } = pending;
    const source = this.sources(work)[sourceIndex];
    if (!source) return this.failPending();
    const deadline = slot.preloading && slot.work?.id === work.id && slot.sourceIndex === sourceIndex
      && !this.ready(slot) ? slot.loadDeadline : null;
    this.clearWatch(slot);
    slot.preloading = false;
    slot.sourceIndex = sourceIndex;
    slot.buffering = true;
    this.setMedia(slot, work, source);
    if (!this.active) {
      this.message.hidden = false;
      this.message.textContent = `Loading ${work.title || 'artwork'}…`;
    }
    this.watch(slot, deadline);
    if (work.kind === 'image') { this.imageEvent(slot, 'load'); return; }
    if (!this.paused) this.play(slot, pending.token);
    else if (!this.needsPlayGesture && slot.video.readyState >= 2 && slot.video.videoWidth) this.promote();
  }

  play(slot, token = null) {
    if (slot.work?.kind === 'image') {
      if (this.pending?.slot === slot) this.imageEvent(slot, 'load');
      else { this.clearWatch(slot); this.resumeClock(); }
      return;
    }
    const session = this.session;
    const playToken = Symbol('play');
    slot.playToken = playToken;
    const rejected = (error) => {
      if (!this.opened || this.session !== session || slot.playToken !== playToken
        || (this.paused && !this.needsPlayGesture) || error?.name === 'AbortError') return;
      const pending = this.pending?.slot === slot && this.pending.token === token;
      const active = this.active === slot && !this.pending;
      if (!pending && !active) return;
      if (error?.name === 'NotAllowedError') {
        this.freezeClock();
        this.needsPlayGesture = true;
        this.paused = true;
        for (const candidate of this.slots) { candidate.video.pause(); if (!candidate.preloading) this.clearWatch(candidate); }
        this.pauseButton.disabled = false;
        this.pauseButton.textContent = 'Resume';
        this.pauseButton.setAttribute('aria-label', 'Resume exhibition (Space)');
        this.pauseButton.setAttribute('aria-pressed', 'true');
        this.message.textContent = 'Your browser paused playback. Select Resume to start the artwork.';
        this.message.hidden = false;
        this.showControls();
        this.tick();
        return;
      }
      if (pending) this.failPending();
      else this.failActive();
    };
    try { Promise.resolve(slot.video.play()).catch(rejected); }
    catch (error) { rejected(error); }
  }

  watch(slot, deadline = null) {
    this.clearWatch(slot);
    if (!slot.preloading && (this.needsPlayGesture || (this.paused && this.pending?.slot !== slot))) return;
    const session = this.session;
    const token = slot.mediaToken;
    slot.loadDeadline = deadline ?? performance.now() + LOAD_TIMEOUT;
    const watchdog = setTimeout(() => {
      if (slot.watchdog !== watchdog) return;
      slot.watchdog = null;
      if (!this.opened || this.session !== session || slot.mediaToken !== token) return;
      if (slot.preloading) { if (!this.ready(slot)) this.failPreload(slot); return; }
      if (this.needsPlayGesture || (this.paused && this.pending?.slot !== slot)) return;
      if (this.pending?.slot === slot) this.failPending();
      else if (this.active === slot && !this.pending) this.failActive();
    }, Math.max(0, slot.loadDeadline - performance.now()));
    slot.watchdog = watchdog;
  }

  clearWatch(slot) {
    clearTimeout(slot.watchdog);
    slot.watchdog = null;
  }

  videoEvent(slot, event) {
    if (slot.work?.kind === 'image') return;
    if (event === 'loadeddata') {
      if (slot.preloading && slot.video.videoWidth) this.clearWatch(slot);
      if (this.paused && !this.needsPlayGesture && this.pending?.slot === slot && slot.video.videoWidth) this.promote();
      return;
    }
    if (event === 'playing') {
      if (!slot.video.videoWidth) {
        if (this.pending?.slot === slot) this.failPending();
        else if (this.active === slot && !this.pending) this.failActive();
        return;
      }
      if (this.needsPlayGesture) {
        if (slot !== (this.pending?.slot || this.active) || slot.video.paused) return;
        this.needsPlayGesture = false;
        this.paused = false;
        this.pauseButton.textContent = 'Pause';
        this.pauseButton.setAttribute('aria-label', 'Pause exhibition (Space)');
        this.pauseButton.setAttribute('aria-pressed', 'false');
        this.message.hidden = true;
        this.showControls();
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
      else if (slot.preloading) this.failPreload(slot);
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
    slot.preloading = false;
    this.pending = null;
    this.elapsed = 0;
    this.startedAt = null;
    this.message.hidden = true;
    this.title.textContent = slot.work.title || 'Untitled';
    this.artist.textContent = [slot.work.artist || 'Artist unknown', slot.work.source].filter(Boolean).join(' · ');
    if (this.paused) slot.video.pause();
    this.resumeClock();
    this.tick();
    this.beginTransition(slot, previous);
  }

  transitionDuration() {
    return this.settings.transition === 'none' || this.reducedMotion?.matches ? 0 : 1500;
  }

  beginTransition(incoming, outgoing) {
    const duration = this.transitionDuration();
    const incomingFrame = this.frame(incoming);
    const outgoingFrame = outgoing && this.frame(outgoing);
    this.dialog.style.setProperty('--player-fade-duration', `${duration}ms`);
    incomingFrame.style.transition = 'none';
    incomingFrame.classList.remove('is-active');
    incomingFrame.style.zIndex = '2';
    if (outgoingFrame) {
      outgoingFrame.style.transition = 'none';
      outgoingFrame.style.zIndex = '1';
      outgoingFrame.classList.add('is-active');
    }
    // Flush the incoming layer at opacity zero before enabling its transition.
    // The fully opaque outgoing image stays underneath until the fade ends.
    if (duration) void incomingFrame.offsetWidth;
    incomingFrame.style.transition = duration ? '' : 'none';
    incomingFrame.classList.add('is-active');
    const state = { incoming, outgoing, session: this.session };
    this.fadeState = state;
    this.preloadNext();
    if (!duration) { this.finishTransition(true); return; }
    this.fadeTimer = setTimeout(() => {
      if (this.opened && this.session === state.session && this.fadeState === state) this.finishTransition(true);
    }, duration);
  }

  finishTransition(preload = false) {
    clearTimeout(this.fadeTimer);
    this.fadeTimer = null;
    const state = this.fadeState;
    this.fadeState = null;
    if (state) {
      const incomingFrame = this.frame(state.incoming);
      incomingFrame.style.transition = 'none';
      incomingFrame.classList.add('is-active');
      incomingFrame.style.zIndex = '1';
      if (state.outgoing) {
        const outgoingFrame = this.frame(state.outgoing);
        outgoingFrame.style.transition = 'none';
        outgoingFrame.classList.remove('is-active');
        outgoingFrame.style.zIndex = '0';
        state.outgoing.video.pause();
        this.clearWatch(state.outgoing);
      }
    }
    if (preload && this.opened && !this.pending) this.preloadNext();
  }

  preloadNext() {
    if (!this.opened || (!this.active && !this.pending)) return;
    const previousPlans = this.nextPlans || [];
    this.nextPlans = previousPlans.filter((plan) => !this.failed.has(plan.order[plan.position].id));
    let cursor = previousPlans.at(-1) || { order: this.order, position: this.position };
    const fillPlans = () => {
      while (this.nextPlans.length < LOOKAHEAD) {
        const plan = this.plan(1, { ...cursor, previousId: cursor.order[cursor.position]?.id });
        if (!plan || this.nextPlans.some((queued) => queued.order[queued.position].id === plan.order[plan.position].id)) break;
        this.nextPlans.push(plan);
        cursor = plan;
      }
    };
    fillPlans();
    const anchor = this.pending?.work || this.active?.work;
    const first = this.nextPlans[0];
    if (first && first.order[first.position].id === anchor?.id) {
      const other = first.order.findIndex((work, index) => index > first.position
        && work.id !== anchor.id && !this.failed.has(work.id));
      if (other >= 0) {
        // A failed final work may invalidate a previously valid shuffle boundary.
        const order = [...first.order];
        [order[first.position], order[other]] = [order[other], order[first.position]];
        cursor = { order, position: first.position };
        this.nextPlans = [cursor];
        fillPlans();
      }
    }
    this.nextPlan = this.nextPlans[0] || null;
    const protectedSlots = new Set([this.active, this.pending?.slot, this.fadeState?.outgoing]);
    const wanted = new Set(this.nextPlans.map((plan) => plan.order[plan.position].id));
    for (const slot of this.slots) {
      if (!protectedSlots.has(slot) && slot.work && !wanted.has(slot.work.id)) this.clearSlot(slot);
    }
    const reserved = new Set(protectedSlots);
    for (const plan of this.nextPlans) {
      const work = plan.order[plan.position];
      if ([...protectedSlots].some((slot) => slot?.work?.id === work.id)) continue;
      let slot = this.slots.find((candidate) => !reserved.has(candidate) && candidate.work?.id === work.id);
      if (!slot) slot = this.slots.find((candidate) => !reserved.has(candidate) && !candidate.work)
        || this.slots.find((candidate) => !reserved.has(candidate));
      if (!slot) continue;
      reserved.add(slot);
      if (slot.work?.id === work.id && slot.preloading) continue;
      const sourceIndex = slot.work?.id === work.id ? slot.sourceIndex || 0 : 0;
      this.prepareSlot(slot, work, sourceIndex);
    }
  }

  prepareSlot(slot, work, sourceIndex) {
    this.clearWatch(slot);
    slot.preloading = true;
    slot.sourceIndex = sourceIndex;
    slot.buffering = true;
    this.setMedia(slot, work, this.sources(work)[sourceIndex]);
    if (!this.ready(slot)) this.watch(slot);
    if (work.kind === 'image') this.imageEvent(slot, 'load');
  }

  failPreload(slot) {
    if (!slot.preloading || slot === this.active || slot === this.pending?.slot || slot === this.fadeState?.outgoing) return;
    this.clearWatch(slot);
    const nextSource = slot.sourceIndex + 1;
    if (nextSource < this.sources(slot.work).length) {
      this.prepareSlot(slot, slot.work, nextSource);
      return;
    }
    this.failed.add(slot.work.id);
    this.onStatus?.(`Skipped “${slot.work.title || 'Untitled'}”: its media could not load.`);
    this.clearSlot(slot);
    this.preloadNext();
  }

  clearSlot(slot) {
    this.clearWatch(slot);
    slot.preloading = false;
    slot.playToken = null;
    slot.mediaToken = null;
    slot.work = null;
    slot.imageReady = false;
    slot.image?.removeAttribute('src');
    slot.video.pause();
    if (slot.video.getAttribute('src')) { slot.video.removeAttribute('src'); slot.video.load(); }
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
    this.onStatus?.(`Skipped “${pending.work.title || 'Untitled'}”: its media could not load.`);
    this.pending = null;
    this.preloadNext();
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
    this.nextPlans = (this.nextPlans || []).filter((plan) => !this.failed.has(plan.order[plan.position].id));
    this.nextPlan = this.nextPlans[0] || null;
    this.advance(1);
  }

  unavailable(message = 'These artworks are unavailable right now. Check your connection, then close and relaunch the exhibition.') {
    this.finishTransition();
    this.freezeClock();
    this.pending = null;
    this.active = null;
    this.nextPlan = null;
    this.nextPlans = [];
    for (const slot of this.slots) {
      this.clearWatch(slot);
      slot.preloading = false;
      slot.playToken = null;
      slot.video.pause();
      this.frame(slot).classList.remove('is-active');
      slot.mediaToken = null;
      slot.image?.removeAttribute('src');
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
    if (this.active.work?.kind !== 'image' && !this.paused && !this.pending && !document.hidden) {
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
    if (this.needsPlayGesture) {
      const slot = this.pending?.slot || this.active;
      this.play(slot, this.pending?.token ?? null);
      this.showControls();
      return;
    }
    this.paused = !this.paused;
    this.pauseButton.textContent = this.paused ? 'Resume' : 'Pause';
    this.pauseButton.setAttribute('aria-label', `${this.paused ? 'Resume' : 'Pause'} exhibition (Space)`);
    this.pauseButton.setAttribute('aria-pressed', String(this.paused));
    if (this.paused) {
      this.freezeClock();
      for (const slot of this.slots) { slot.video.pause(); if (!slot.preloading) this.clearWatch(slot); }
      if (this.pending) {
        const slot = this.pending.slot;
        if (slot.work?.kind === 'image' ? slot.imageReady : slot.video.readyState >= 2 && slot.video.videoWidth) this.promote();
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

  fullscreenElement() { return document.fullscreenElement || null; }

  syncFullscreenButton() {
    if (!this.fullscreenButton) return;
    const active = Boolean(this.fullscreenElement());
    const supported = typeof this.surface?.requestFullscreen === 'function' && document.fullscreenEnabled !== false;
    this.fullscreenButton.hidden = !supported && !active;
    this.fullscreenButton.disabled = Boolean(this.fullscreenRequest?.pending || this.fullscreenExit);
    this.fullscreenButton.textContent = active ? 'Exit fullscreen' : 'Fullscreen';
    this.fullscreenButton.setAttribute('aria-label', `${active ? 'Exit' : 'Enter'} fullscreen (F)`);
    this.fullscreenButton.setAttribute('aria-pressed', String(active));
    this.fullscreenButton.title = active ? 'Exit fullscreen (F)' : 'Enter fullscreen (F)';
  }

  fullscreenUnavailable() {
    if (!this.fullscreenNotice || !this.opened) return;
    this.fullscreenNotice.textContent = 'Fullscreen is unavailable here. The exhibition will stay in this window.';
    this.fullscreenNotice.hidden = false;
    this.showControls();
  }

  fullscreen() {
    if (!this.opened || this.fullscreenRequest?.pending || this.fullscreenExit) return;
    if (this.fullscreenElement()) return this.exitFullscreen();
    return this.enterFullscreen(true);
  }

  enterFullscreen(explicit = false) {
    const element = this.surface;
    if (!this.opened || this.fullscreenElement() || this.fullscreenRequest?.pending || this.fullscreenExit) {
      this.syncFullscreenButton();
      return;
    }
    if (typeof element?.requestFullscreen !== 'function' || document.fullscreenEnabled === false) {
      this.syncFullscreenButton();
      if (explicit) this.fullscreenUnavailable();
      return;
    }
    const request = { element, ownerSession: this.session, pending: true };
    this.fullscreenRequest = request;
    this.syncFullscreenButton();
    const failed = () => {
      if (this.fullscreenRequest === request) this.fullscreenRequest = null;
      if (this.opened && request.ownerSession === this.session) this.fullscreenUnavailable();
    };
    let result;
    try { result = element.requestFullscreen(); }
    catch { request.pending = false; failed(); this.syncFullscreenButton(); return; }
    return Promise.resolve(result).then(() => {
      request.pending = false;
      if (this.opened && request.ownerSession === this.session && this.surface === element) {
        this.fullscreenOwned = this.fullscreenElement() === element;
        if (this.fullscreenNotice) this.fullscreenNotice.hidden = true;
      } else if (this.fullscreenElement() === element) {
        // A closed or replaced player must not leave its old surface fullscreen.
        return this.exitFullscreen();
      }
    }).catch(failed).finally(() => {
      request.pending = false;
      this.syncFullscreenButton();
    });
  }

  exitFullscreen() {
    if (this.fullscreenExit || !this.fullscreenElement()) return;
    const operation = { session: this.session };
    this.fullscreenExit = operation;
    this.syncFullscreenButton();
    let result;
    try { result = document.exitFullscreen?.(); }
    catch { result = Promise.reject(new Error('Fullscreen exit failed')); }
    return Promise.resolve(result).catch(() => {
      if (this.opened && operation.session === this.session) this.fullscreenUnavailable();
    }).finally(() => {
      if (this.fullscreenExit === operation) this.fullscreenExit = null;
      this.syncFullscreenButton();
    });
  }

  releaseFullscreen() {
    const request = this.fullscreenRequest;
    const ownsRequest = request?.ownerSession === this.session;
    if (ownsRequest) request.ownerSession = null;
    const owned = this.fullscreenOwned || ownsRequest;
    this.fullscreenOwned = false;
    if (owned && this.fullscreenElement() === this.surface) this.exitFullscreen();
    if (!request?.pending) this.fullscreenRequest = null;
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
    this.finishTransition();
    this.releaseFullscreen();
    this.opened = false;
    this.session += 1;
    this.controller?.abort();
    clearInterval(this.interval);
    clearTimeout(this.controlsTimer);
    clearTimeout(this.fadeTimer);
    for (const slot of this.slots || []) {
      this.clearWatch(slot);
      slot.preloading = false;
      slot.playToken = null;
      slot.mediaToken = null;
      slot.image?.removeAttribute('src');
      slot.video.pause();
      slot.video.removeAttribute('src');
      slot.video.load();
    }
    this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
    this.wakeRequest = false;
    if (this.dialog?.open) this.dialog.close();
    this.dialog?.remove();
    document.body.style.overflow = this.previousOverflow;
    this.active = null;
    this.pending = null;
    this.nextPlan = null;
    this.nextPlans = [];
    this.onClose?.();
  }
}
