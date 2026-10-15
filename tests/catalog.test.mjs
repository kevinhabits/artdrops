import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateCatalog } from '../scripts/refresh-catalog.mjs';

const catalog = JSON.parse(await readFile(new URL('../public/catalog.json', import.meta.url), 'utf8'));

test('curated catalog has real source links, motion media, dimensions, and artist diversity', () => {
  const counts = validateCatalog(catalog);
  assert.ok(counts.works >= 24);
  assert.ok(counts.artists >= 24);
  assert.equal(new Set(catalog.works.slice(0, 6).map(work => work.artistKey)).size, 6);
  for (const work of catalog.works) {
    if (work.source === 'objkt') {
      assert.match(work.sourceUrl, /^https:\/\/objkt\.com\/tokens\/KT1[1-9A-HJ-NP-Za-km-z]{33}\/\d+$/);
      assert.match(work.mediaUrl, /^https:\/\/assets\.objkt\.media\/file\/assets-003\/(Qm[a-zA-Z0-9]+|bafy[a-z0-9]+)\/artifact$/);
    }
  }
});

test('failed or empty refresh cannot pass catalog validation', () => {
  assert.throws(() => validateCatalog({ version: 1, works: [] }), /incomplete catalog/);
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
