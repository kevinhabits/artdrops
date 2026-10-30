import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as core from '../../src/core.js';
import * as playlists from '../../src/playlists.js';

const source = await readFile(new URL('../../src/app.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../../public/index.html', import.meta.url), 'utf8');
export const STORAGE_KEY = 'artdrops:exhibition:v1';
export const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Execute the application unchanged except for module imports, which are bound
// to the real core exports. DOM/media/download APIs are inert in-memory objects.
export async function appHarness({ stored, storage = new Map(), catalog = [], catalogGate, inertMedia = false } = {}) {
  if (stored) storage.set(STORAGE_KEY, JSON.stringify(stored));
  const nodes = new Map(), blobs = new Map(), downloads = [], timers = new Map(), observers = new Set(), mediaEvents = [];
  let sequence = 0, player;
  const document = { hidden: !inertMedia, activeElement: null, addEventListener() {} };
  class Element {
    constructor(tag = 'div') {
      Object.assign(this, { tagName: tag.toUpperCase(), children: [], parentElement: null, attributes: new Map(), listeners: new Map(), dataset: {}, style: {}, className: '', textContent: '', value: '', checked: false, disabled: false, hidden: false, open: false, files: [], paused: true });
      this.classList = {
        contains: name => this.className.split(/\s+/).includes(name),
        add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
        remove: (...names) => { this.className = this.className.split(/\s+/).filter(name => !names.includes(name)).join(' '); },
        toggle: (name, on) => { if (on ?? !this.classList.contains(name)) this.classList.add(name); else this.classList.remove(name); },
      };
    }
    get value() { return this._value || ''; }
    set value(value) { this._value = String(value); }
    get src() { return this.getAttribute('src') || ''; }
    set src(value) { this.setAttribute('src', value); }
    append(...children) { for (const child of children) { child.remove(); child.parentElement = this; this.children.push(child); } }
    replaceChildren(...children) { for (const child of [...this.children]) child.remove(); this.append(...children); }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; }
    replaceWith(replacement) { const parent = this.parentElement, index = parent?.children.indexOf(this); if (parent) { this.remove(); replacement.parentElement = parent; parent.children.splice(index, 0, replacement); } }
    contains(node) { return this === node || this.children.some(child => child.contains(node)); }
    get isConnected() { return document.body.contains(this); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    addEventListener(type, listener) { const listeners = this.listeners.get(type) || []; listeners.push(listener); this.listeners.set(type, listeners); }
    async dispatch(type, details = {}) { const event = { target: this, currentTarget: this, preventDefault() {}, ...details }; for (const listener of this.listeners.get(type) || []) await listener(event); }
    click() {
      if (this.disabled) return Promise.resolve();
      if (this.tagName === 'A' && this.download) downloads.push({ filename: this.download, href: this.href, blob: blobs.get(this.href), connected: this.isConnected });
      return this.dispatch('click');
    }
    focus() { document.activeElement = this; }
    showModal() { this.open = true; }
    close() { this.open = false; return this.dispatch('close'); }
    pause() { this.paused = true; }
    load() { if (inertMedia) mediaEvents.push({ type: 'load', target: this, src: this.src }); }
    play() {
      if (!inertMedia) throw new Error('Persistence tests must never start media playback');
      if (!this.muted) throw new Error('Inert preview tests require muted media');
      this.paused = false;
      mediaEvents.push({ type: 'play', target: this, src: this.src, muted: this.muted });
      return Promise.resolve();
    }
    matches(selector) {
      const attrs = [...selector.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)];
      if (attrs.some(([, key, value]) => !this.attributes.has(key) || (value !== undefined && this.getAttribute(key) !== value))) return false;
      const simple = selector.replace(/\[[^\]]+\]/g, '').replace(/:(?:first|last)-child/g, '');
      if (selector.endsWith(':first-child') && this.parentElement?.children[0] !== this) return false;
      if (selector.endsWith(':last-child') && this.parentElement?.children.at(-1) !== this) return false;
      if (simple.startsWith('#')) return this.id === simple.slice(1);
      if (simple.startsWith('.')) return this.classList.contains(simple.slice(1));
      return !simple || this.tagName.toLowerCase() === simple;
    }
    querySelectorAll(selector) {
      const [first, ...rest] = selector.split(/\s+/);
      const result = [];
      for (const child of this.children) {
        if (child.matches(first)) result.push(...(rest.length ? child.querySelectorAll(rest.join(' ')) : [child]));
        result.push(...child.querySelectorAll(selector));
      }
      return [...new Set(result)];
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  }
  document.body = new Element('body');
  document.createElement = tag => new Element(tag);
  for (const [, tag, attributes, id] of html.matchAll(/<(\w+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const node = new Element(tag); node.id = id;
    node.className = attributes.match(/\bclass="([^"]*)"/)?.[1] || '';
    node.value = attributes.match(/\bvalue="([^"]*)"/)?.[1] || '';
    if (id.endsWith('-filter')) node.value = 'all';
    if (id === 'mix-format') node.value = 'portrait';
    if (node.classList.contains('content-dialog')) { const close = new Element('button'); close.setAttribute('data-close', ''); node.append(close); }
    nodes.set(id, node); document.body.append(node);
  }
  document.querySelector = selector => selector.startsWith('#') ? nodes.get(selector.slice(1)) || null : document.body.querySelector(selector);
  document.querySelectorAll = selector => document.body.querySelectorAll(selector);
  class MemoryURL extends URL {
    static createObjectURL(blob) { const url = `blob:https://artdrops.example/${++sequence}`; blobs.set(url, blob); return url; }
    static revokeObjectURL(url) { blobs.delete(url); }
  }
  const context = vm.createContext({
    ...core, ...playlists, document, Blob, URL: MemoryURL, TextEncoder, AbortController, AbortSignal, DOMException, console,
    crypto: { randomUUID: () => `fixture-${++sequence}` },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    setTimeout: callback => { const id = ++sequence; timers.set(id, callback); return id; }, clearTimeout: id => timers.delete(id),
    matchMedia: () => ({ matches: !inertMedia, addEventListener() {} }),
    ResizeObserver: class { observe() {} unobserve() {} },
    IntersectionObserver: class {
      constructor(callback) { this.callback = callback; this.targets = new Set(); observers.add(this); }
      observe(target) { this.targets.add(target); }
      unobserve(target) { this.targets.delete(target); }
    },
    Option: function Option(text, value) { const option = new Element('option'); option.textContent = text; option.value = value; return option; },
    ExhibitionPlayer: class {
      constructor(options) { this.options = options; this.opens = []; player = this; }
      open(works, settings) {
        if (!inertMedia) throw new Error('Persistence tests must not open the player');
        this.opens.push({ works, settings });
      }
      close() { if (inertMedia) this.options.onClose(); }
    },
    fetch: async url => {
      if (url === '/catalog.json' && catalogGate) await catalogGate.promise;
      return { ok: true, json: async () => ({ version: 1, updatedAt: '2026-10-26T00:00:00Z', works: url === '/catalog.json' ? catalog : [] }) };
    },
  });
  context.window = context;
  context.addEventListener = () => {};
  vm.runInContext(source.replace(/^import .*?;\s*$/gm, ''), context, { filename: 'src/app.js' });
  await flush();
  const node = id => { const result = nodes.get(id); if (!result) throw new Error(`Unknown application element: ${id}`); return result; };
  return {
    node, storage, downloads, blobs, flush, player, mediaEvents,
    async setInView(targets, isIntersecting = true) {
      for (const observer of observers) {
        const entries = targets.filter(target => observer.targets.has(target)).map(target => ({ target, isIntersecting }));
        if (entries.length) observer.callback(entries);
      }
      await flush();
    },
    click: id => node(id).click(),
    change: async (id, value) => { const target = node(id); if (typeof value === 'boolean') target.checked = value; else target.value = value; await target.dispatch('change'); },
    importFile(file) { const target = node('import-file'); target.files = [file]; target.value = 'chosen.json'; return target.dispatch('change'); },
    importText(text) { return this.importFile(new Blob([text], { type: 'application/json' })); },
    async exportFile() {
      const count = downloads.length; await node('export-queue').click();
      if (downloads.length !== count + 1) throw new Error('Export did not create exactly one download');
      const download = downloads.at(-1);
      return { ...download, text: await download.blob.text(), json: JSON.parse(await download.blob.text()) };
    },
  };
}
