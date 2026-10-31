import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateCatalog } from '../scripts/refresh-catalog.mjs';
import { isPortraitScreenWork } from '../src/core.js';
import { EXCLUDED_WORKS, isExcludedWork } from '../src/curation.js';

const catalog = JSON.parse(await readFile(new URL('../public/catalog.json', import.meta.url), 'utf8'));

test('curated catalog has real source links, motion media, dimensions, and artist diversity', () => {
  const counts = validateCatalog(catalog);
  assert.ok(counts.works >= 120 && counts.works <= 300);
  assert.ok(counts.artists >= 60);
  assert.ok(counts.works * 30 >= 60 * 60, 'At 30 seconds per work, the catalog must fill at least one distinct hour');
  assert.equal(new Set(catalog.works.slice(0, 6).map(work => work.artistKey)).size, 6);
  for (const work of catalog.works) {
    if (work.source === 'objkt') {
      assert.match(work.sourceUrl, /^https:\/\/objkt\.com\/tokens\/KT1[1-9A-HJ-NP-Za-km-z]{33}\/\d+$/);
      assert.match(work.mediaUrl, /^https:\/\/assets\.objkt\.media\/file\/assets-003\/(Qm[a-zA-Z0-9]+|bafy[a-z0-9]+)\/artifact$/);
    }
  }
});

test('the curated catalog retains 42 screen-qualified portraits after removing the 4K group', () => {
  const portrait = catalog.works.filter(isPortraitScreenWork);
  assert.equal(portrait.length, 42);
  assert.ok(new Set(portrait.map(work => work.artistKey)).size >= 30);
  assert.equal(portrait.filter(work => work.width >= 2160 && work.height >= 3840).length, 0);
  const reduced = structuredClone(catalog);
  for (const work of reduced.works.filter(isPortraitScreenWork).slice(41)) work.width = 1000;
  assert.throws(() => validateCatalog(reduced), /portrait screen/);
});

test('refresh validation prevents excluded artworks from returning by ID or media URL', () => {
  assert.equal(catalog.works.some(isExcludedWork), false);
  const excluded = EXCLUDED_WORKS.find(work => work.id.startsWith('objkt-'));
  for (const field of ['id', 'mediaUrl']) {
    const restored = structuredClone(catalog);
    restored.works[0][field] = excluded[field];
    assert.throws(() => validateCatalog(restored), /excluded by curation/);
  }
});

test('failed or empty refresh cannot pass catalog validation', () => {
  assert.throws(() => validateCatalog({ version: 1, works: [] }), /incomplete catalog/);
  assert.throws(() => validateCatalog({ ...catalog, works: catalog.works.slice(0, 119) }), /incomplete catalog/);
  const invalid = structuredClone(catalog);
  invalid.works[1].id = invalid.works[0].id;
  assert.throws(() => validateCatalog(invalid), /duplicate/);
});

test('orientation and attribution errors fail before network requests or writes', () => {
  const wrongOrientation = structuredClone(catalog);
  wrongOrientation.works[0].orientation = 'portrait';
  assert.throws(() => validateCatalog(wrongOrientation), /orientation/);
  const wrongSource = structuredClone(catalog);
  wrongSource.works[0].sourceUrl = 'https://example.com/artwork';
  assert.throws(() => validateCatalog(wrongSource), /attribution/);
});

test('two known a-paufler account aliases count as one artist', () => {
  const aliases = catalog.works.filter(work => ['a_paufler', 'a-paufler'].includes(work.artist));
  assert.equal(aliases.length, 2);
  assert.equal(new Set(aliases.map(work => work.artistKey)).size, 1);
});
