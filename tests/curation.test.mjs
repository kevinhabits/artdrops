import test from 'node:test';
import assert from 'node:assert/strict';
import { EXCLUDED_WORKS, excludeWorks, isExcludedWork } from '../src/curation.js';

test('the removed 4K portrait group stays excluded by identity even if its metadata changes', () => {
  assert.equal(EXCLUDED_WORKS.length, 25);
  assert.equal(new Set(EXCLUDED_WORKS.map(work => work.id)).size, 25);
  for (const work of EXCLUDED_WORKS) {
    assert.equal(isExcludedWork({ id: work.id, width: 1080, height: 1920 }), true);
    assert.equal(isExcludedWork({ id: 'different-id', mediaUrl: work.mediaUrl }), true);
    assert.equal(isExcludedWork({ id: 'different-id', alternateMediaUrl: work.mediaUrl }), true);
    assert.equal(isExcludedWork({ id: 'different-id', mediaUrl: `${work.mediaUrl}#view` }), true);
  }
});

test('exclusions preserve unrelated artwork, order and source snapshots', () => {
  const first = { id: 'unrelated-4k', mediaUrl: 'https://example.com/portrait.mp4', width: 2160, height: 3840 };
  const second = { id: 'second', mediaUrl: 'https://example.com/other.jpg' };
  const works = [first, EXCLUDED_WORKS[0], second];
  assert.deepEqual(excludeWorks(works), [first, second]);
  assert.equal(works.length, 3);
  assert.equal(isExcludedWork(null), false);
  assert.equal(isExcludedWork({}), false);
  assert.equal(isExcludedWork({ mediaUrl: `${EXCLUDED_WORKS[0].mediaUrl}?different-resource=true` }), false);
});
