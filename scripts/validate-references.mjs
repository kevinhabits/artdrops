import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { cleanWork, MAX_CATALOG_WORKS } from '../src/core.js';
import { isExcludedWork } from '../src/curation.js';

const sourceHosts = { SuperRare: 'superrare.com', Orkhan: 'orkhan.art', 'Google Drive': 'drive.google.com', Reddit: 'www.reddit.com' };

export function validateReferences(catalog, original = { works: [] }) {
  if (catalog?.version !== 1 || !Array.isArray(catalog.works) || !Array.isArray(catalog.references)) throw new Error('Invalid reference catalog');
  if (original.works.length + catalog.works.length > MAX_CATALOG_WORKS) throw new Error('Catalog exceeds the library limit');
  const ids = new Set(original.works.map(work => work.id));
  const media = new Set(original.works.map(work => work.mediaUrl));
  const collections = new Map();
  for (const work of catalog.works) {
    if (isExcludedWork(work)) throw new Error(`${work.id}: excluded by curation`);
    if (!cleanWork(work) || !work.collection || !sourceHosts[work.source]) throw new Error(`${work.id}: invalid artwork`);
    if (ids.has(work.id) || media.has(work.mediaUrl)) throw new Error(`${work.id}: duplicate artwork`);
    ids.add(work.id); media.add(work.mediaUrl);
    if (![work.width, work.height].every(value => Number.isInteger(value) && value > 0)) throw new Error(`${work.id}: missing verified dimensions`);
    if (!Number.isFinite(Date.parse(work.verifiedAt))) throw new Error(`${work.id}: missing verification date`);
    if (!work.sourceUrl || new URL(work.sourceUrl).hostname !== sourceHosts[work.source]) throw new Error(`${work.id}: incorrect source attribution`);
    if (work.rotation !== undefined && ![0, 90, 180, 270].includes(work.rotation)) throw new Error(`${work.id}: unsupported rotation`);
    collections.set(work.collection, (collections.get(work.collection) || 0) + 1);
  }
  for (const reference of catalog.references) {
    if (!reference.name || !Number.isInteger(reference.available) || reference.available < 0 || new URL(reference.url).protocol !== 'https:') throw new Error('Invalid reference summary');
    if (!Array.isArray(reference.collections)) throw new Error(`${reference.name}: missing collection mapping`);
    const actual = reference.collections.reduce((count, name) => count + (collections.get(name) || 0), 0);
    if (actual !== reference.available) throw new Error(`${reference.name}: availability count differs from catalog`);
  }
  const mapped = new Set(catalog.references.flatMap(reference => reference.collections));
  for (const name of collections.keys()) if (!mapped.has(name)) throw new Error(`${name}: missing reference summary`);
  return { added: catalog.works.length, total: ids.size, collections: collections.size,
    images: catalog.works.filter(work => work.kind === 'image').length,
    videos: catalog.works.filter(work => work.kind === 'video').length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const base = JSON.parse(await readFile(new URL('../public/catalog.json', import.meta.url)));
  const catalog = JSON.parse(await readFile(new URL('../public/references.json', import.meta.url)));
  console.log(JSON.stringify(validateReferences(catalog, base), null, 2));
}
