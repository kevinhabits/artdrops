import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_EXHIBITION_BYTES, cleanWork, makeExhibition, parseExhibition, serializeExhibition, exhibitionFilename } from '../src/core.js';

const video = { id: 'video', title: '夜色', artist: 'A', kind: 'video', source: 'SuperRare', collection: 'Evening', mediaUrl: 'https://example.com/a.mp4', alternateMediaUrl: 'https://example.com/backup.mp4', posterUrl: 'https://example.com/poster.jpg', sourceUrl: 'https://example.com/source', rotation: 90, width: 3840, height: 2160 };
const image = { ...video, id: 'image', title: 'Still', kind: 'image', mediaUrl: 'https://example.com/a.gif', alternateMediaUrl: null, animated: true, rotation: 270 };
const settings = { duration: 120, fit: 'cover', transition: 'none', shuffle: true, captions: false };
const bytes = value => new TextEncoder().encode(value).length;

test('named JSON round trip preserves mixed media, exact order, metadata and every setting', () => {
  const exported = serializeExhibition([image, video], settings, '  台北   evening  ');
  const imported = parseExhibition(exported);
  assert.deepEqual(imported, { works: [cleanWork(image), cleanWork(video)], settings, name: '台北 evening' });
  assert.deepEqual(parseExhibition(serializeExhibition(imported.works, imported.settings, imported.name)), imported);
});

test('legacy unnamed v1 files, UTF-8 BOM and an empty current exhibition remain importable', () => {
  const legacy = JSON.stringify({ format: 'artdrops-exhibition', version: 1, works: [video], settings: { duration: 60 } });
  assert.deepEqual(parseExhibition('\uFEFF' + legacy), parseExhibition(legacy));
  assert.equal('name' in parseExhibition(legacy), false);
  assert.equal(parseExhibition(serializeExhibition([], {})).works.length, 0);
});

test('invalid JSON, unsafe media, duplicates, newer formats and invalid names fail without partial imports', () => {
  const valid = makeExhibition([video], settings);
  for (const invalid of [
    '{broken', 'null', JSON.stringify({ ...valid, version: 2 }),
    JSON.stringify({ ...valid, works: [video, video] }),
    JSON.stringify({ ...valid, works: [video, { ...image, mediaUrl: 'javascript:alert(1)' }] }),
    JSON.stringify({ ...valid, name: 42 }), JSON.stringify({ ...valid, name: 'a'.repeat(81) }),
  ]) assert.throws(() => parseExhibition(invalid));
  assert.throws(() => makeExhibition([video, video], settings), /duplicate/);
  assert.throws(() => makeExhibition(Array.from({ length: 151 }, (_, i) => ({ ...video, id: String(i) })), settings), /150/);
});

test('the exact 2 MB export boundary is importable, while one extra byte is rejected', () => {
  const base = { ...video, mediaUrl: 'https://example.com/media?x=' };
  const extra = MAX_EXHIBITION_BYTES - bytes(serializeExhibition([base], settings));
  const full = { ...base, mediaUrl: base.mediaUrl + 'a'.repeat(extra) };
  const exported = serializeExhibition([full], settings);
  assert.equal(bytes(exported), MAX_EXHIBITION_BYTES);
  assert.equal(parseExhibition(exported).works[0].mediaUrl, full.mediaUrl);
  assert.throws(() => serializeExhibition([{ ...full, mediaUrl: full.mediaUrl + 'a' }], settings), /2 MB/);
  assert.throws(() => parseExhibition(exported + ' '), /2 MB/);
});

test('size limits count UTF-8 bytes and reject inputs whose normalized export grows beyond the limit', () => {
  const input = { format: 'artdrops-exhibition', version: 1, works: [{ ...video, verifiedAt: '漢'.repeat(700_000) }], settings };
  const text = JSON.stringify(input);
  assert.ok(text.length < MAX_EXHIBITION_BYTES);
  assert.throws(() => parseExhibition(text), /2 MB/);
  assert.throws(() => serializeExhibition(input.works, settings), /2 MB/);
  const expanding = JSON.stringify({ ...input, works: [{ ...video, verifiedAt: null, mediaUrl: 'https://example.com/?x=' + '漢'.repeat(230_000) }] });
  assert.ok(bytes(expanding) < MAX_EXHIBITION_BYTES);
  assert.throws(() => parseExhibition(expanding), /2 MB/);
});

test('named exports have safe readable filenames, including non-Latin names', () => {
  assert.equal(exhibitionFilename(), 'artdrops-exhibition.json');
  assert.equal(exhibitionFilename('Friday / evening'), 'artdrops-Friday-evening.json');
  assert.equal(exhibitionFilename('台北 夜色'), 'artdrops-台北-夜色.json');
  assert.equal(exhibitionFilename('../../'), 'artdrops-exhibition.json');
});
