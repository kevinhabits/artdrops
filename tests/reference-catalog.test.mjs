import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateReferences } from '../scripts/validate-references.mjs';
import { cleanWork, displayDimensions, filterWorks, isPortraitScreenWork, uniqueWorks, MAX_CATALOG_WORKS } from '../src/core.js';

function fixture() {
  return { version: 1, works: [{ id: 'sample', title: 'Sample', artist: 'Artist', source: 'SuperRare', collection: 'Sample collection', kind: 'image', mediaUrl: 'https://media.example/image.webp', sourceUrl: 'https://superrare.com/artist', width: 1000, height: 1000, verifiedAt: '2026-10-19T00:00:00Z' }], references: [{ name: 'Sample', url: 'https://superrare.com/artist', collections: ['Sample collection'], available: 1 }] };
}
test('reference summary counts match verified works and every collection is mapped', () => {
  assert.equal(validateReferences(fixture()).added, 1);
  const wrong = fixture(); wrong.references[0].available = 2;
  assert.throws(() => validateReferences(wrong), /count differs/);
  const missing = fixture(); missing.references = [];
  assert.throws(() => validateReferences(missing), /missing reference summary/);
});
test('new references cannot duplicate original catalog IDs or media', () => {
  const candidate = fixture();
  assert.throws(() => validateReferences(candidate, { works: [{ id: 'sample' }] }), /duplicate/);
  assert.throws(() => validateReferences(candidate, { works: [{ id: 'other', mediaUrl: candidate.works[0].mediaUrl }] }), /duplicate/);
});
test('reference data requires dimensions, dates, source attribution, and supported rotation', () => {
  for (const [key, value] of [['width', null], ['verifiedAt', null], ['sourceUrl', 'https://example.com'], ['rotation', 45]]) {
    const candidate = fixture(); candidate.works[0][key] = value;
    assert.throws(() => validateReferences(candidate));
  }
});

const [shipped, original] = await Promise.all(['references.json', 'catalog.json'].map(async name =>
  JSON.parse(await readFile(new URL(`../public/${name}`, import.meta.url), 'utf8'))));

test('the shipped reference library validates and preserves every original work when normalized together', () => {
  const counts = validateReferences(shipped, original);
  assert.equal(counts.added, shipped.works.length);
  assert.equal(counts.total, original.works.length + shipped.works.length);
  const merged = uniqueWorks([...original.works, ...shipped.works], MAX_CATALOG_WORKS);
  assert.equal(merged.length, counts.total);
  assert.deepEqual(merged.slice(0, original.works.length), original.works.map(cleanWork));
  const ids = new Set(merged.map(work => work.id));
  assert.ok(shipped.works.every(work => ids.has(work.id)));
});

test('shipped Untitled contains all 414 standard and 414 mask episodes at their verified square resolution', () => {
  const works = shipped.works.filter(work => work.source === 'Orkhan' && work.collection === 'Untitled');
  assert.equal(works.length, 828);
  const expectedEpisodes = Array.from({ length: 414 }, (_, index) => index + 1);
  for (const [variant, folder, mask] of [['standard', 'g', '0'], ['mask', 'm', '1']]) {
    const editions = works.filter(work => work.variant === variant);
    assert.deepEqual(editions.map(work => work.episode).sort((a, b) => a - b), expectedEpisodes);
    for (const raw of editions) {
      const normalized = cleanWork(raw);
      const number = String(raw.episode).padStart(3, '0');
      assert.equal(raw.id, `orkhan:untitled:${number}:${variant}`);
      assert.equal(normalized.kind, 'image');
      assert.equal(normalized.artist, 'Orkhan Mammadov');
      assert.equal(normalized.mediaUrl, `https://orkhan.art/untitled/episodes/${folder}/${number}.webp`);
      const source = new URL(normalized.sourceUrl);
      assert.equal(source.hostname, 'orkhan.art');
      assert.equal(source.searchParams.get('token'), String(raw.episode));
      assert.equal(source.searchParams.get('mask'), mask);
      assert.deepEqual(displayDimensions(normalized), { width: 560, height: 560 });
      assert.equal(normalized.orientation, 'square');
      assert.equal(normalized.rotation, 0);
      assert.equal(isPortraitScreenWork(normalized), false);
    }
  }
  const normalized = works.map(cleanWork);
  assert.equal(filterWorks(normalized, { collection: 'Untitled', media: 'still', shape: 'square' }).length, 828);
  assert.equal(filterWorks(normalized, { collection: 'Untitled', shape: 'screen-portrait' }).length, 0);
});
