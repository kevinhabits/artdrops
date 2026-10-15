#!/usr/bin/env node
// Revalidate the curated selection. No accounts, API keys, or runtime API calls.
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const catalogPath = fileURLToPath(new URL('../public/catalog.json', import.meta.url));

export function validateCatalog(catalog) {
  if (catalog?.version !== 1 || !Array.isArray(catalog.works) || catalog.works.length < 24) {
    throw new Error('Refusing an empty or incomplete catalog (minimum 24 selected works).');
  }
  const ids = new Set();
  const media = new Set();
  const artists = new Map();
  for (const work of catalog.works) {
    for (const key of ['id', 'title', 'artist', 'artistKey', 'description', 'verifiedAt']) {
      if (typeof work[key] !== 'string' || !work[key].trim()) throw new Error(`${work.id}: missing ${key}`);
    }
    if (ids.has(work.id) || media.has(work.mediaUrl)) throw new Error(`${work.id}: duplicate work or media`);
    ids.add(work.id);
    media.add(work.mediaUrl);
    artists.set(work.artistKey, (artists.get(work.artistKey) ?? 0) + 1);
    if (artists.get(work.artistKey) > 2) throw new Error(`${work.artist}: more than two works`);
    if (!['objkt', 'Verse'].includes(work.source) || work.kind !== 'video') throw new Error(`${work.id}: unexpected source or media kind`);
    if (![work.width, work.height].every(n => Number.isInteger(n) && n > 0)) throw new Error(`${work.id}: invalid dimensions`);
    const orientation = work.width > work.height ? 'landscape' : work.width < work.height ? 'portrait' : 'square';
    if (work.orientation !== orientation) throw new Error(`${work.id}: incorrect orientation`);
    if (!Number.isInteger(work.year) || work.year < 1900 || !Number.isFinite(Date.parse(work.verifiedAt))) throw new Error(`${work.id}: invalid dates`);
    for (const key of ['sourceUrl', 'mediaUrl', 'posterUrl']) {
      const url = new URL(work[key]);
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error(`${work.id}: unsafe ${key}`);
    }
    const sourceHost = work.source === 'objkt' ? 'objkt.com' : 'verse.works';
    if (new URL(work.sourceUrl).hostname !== sourceHost) throw new Error(`${work.id}: incorrect source attribution`);
  }
  if (artists.size < 24) throw new Error('The selection must represent at least 24 distinct artists.');
  return { works: ids.size, artists: artists.size };
}

async function checkUrl(url, expectedType, useRange = false) {
  try {
    return await checkUrlOnce(url, expectedType, useRange);
  } catch {
    // A single retry covers transient CDN errors without masking persistent failures.
    await new Promise(resolveRetry => setTimeout(resolveRetry, 500));
    return checkUrlOnce(url, expectedType, useRange);
  }
}

async function checkUrlOnce(url, expectedType, useRange = false) {
  const response = await fetch(url, {
    method: useRange ? 'GET' : 'HEAD',
    headers: useRange ? { Range: 'bytes=0-511' } : {},
    signal: AbortSignal.timeout(25000),
  });
  const type = response.headers.get('content-type') ?? '';
  if (!response.ok || !type.startsWith(expectedType)) {
    await response.body?.cancel();
    throw new Error(`HTTP ${response.status}, ${type || 'missing content type'}: ${url}`);
  }
  if (useRange) {
    // Stop after the header even if a server ignores Range; never download a whole artwork.
    const reader = response.body.getReader();
    let header = Buffer.alloc(0);
    try {
      while (header.length < 128) {
        const { done, value } = await reader.read();
        if (done) break;
        header = Buffer.concat([header, Buffer.from(value).subarray(0, 512)]);
      }
    } finally {
      await reader.cancel();
    }
    if (!header.includes(Buffer.from('ftyp'))) throw new Error(`Missing MP4 file signature: ${url}`);
  }
}

function sampleMotion(url, start = 0) {
  return new Promise((resolveSample, reject) => {
    const child = spawn(process.env.FFMPEG_BIN || 'ffmpeg', [
      '-hide_banner', '-nostats', '-rw_timeout', '15000000',
      ...(start ? ['-ss', String(start)] : []), '-i', url,
      '-an', '-vf', 'fps=2,scale=96:96:force_original_aspect_ratio=decrease',
      '-frames:v', '3', '-f', 'framemd5', '-',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let diagnostic = '';
    const timeout = setTimeout(() => child.kill('SIGKILL'), 65000);
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { diagnostic += data; });
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('close', code => {
      clearTimeout(timeout);
      if (code !== 0) return reject(new Error(`FFmpeg failed (${code}): ${diagnostic.slice(-400)}`));
      const hashes = [...output.matchAll(/^0,.*?,\s*([a-f0-9]{32})$/gm)].map(match => match[1]);
      const dimensions = diagnostic.match(/Video: .*?, (\d{2,5})x(\d{2,5})(?:\D|$)/);
      resolveSample({ changing: new Set(hashes).size > 1, width: Number(dimensions?.[1]), height: Number(dimensions?.[2]) });
    });
  });
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if ([...args].some(arg => !['--check', '--motion', '--write'].includes(arg))) {
    throw new Error('Usage: node scripts/refresh-catalog.mjs [--check] [--motion] [--write]');
  }
  const write = args.has('--write');
  const motion = write || args.has('--motion');
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  const counts = validateCatalog(catalog);
  const failures = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (cursor < catalog.works.length) {
      const work = catalog.works[cursor++];
      try {
        await checkUrl(work.mediaUrl, 'video/mp4', true);
        await checkUrl(work.posterUrl, 'image/');
        await checkUrl(work.sourceUrl, 'text/html');
        if (motion) {
          let sample = await sampleMotion(work.mediaUrl);
          if (!sample.changing) sample = await sampleMotion(work.mediaUrl, 8);
          if (!sample.changing) throw new Error('No changing frames in sampled video.');
          if (sample.width !== work.width || sample.height !== work.height) throw new Error('Decoded dimensions differ from the catalog; review the artwork.');
        }
        console.log(`OK ${work.artist} — ${work.title}`);
      } catch (error) {
        failures.push({ id: work.id, reason: error.message });
        console.error(`FAIL ${work.id}: ${error.message}`);
      }
    }
  }));
  if (failures.length) {
    console.error(JSON.stringify({ ...counts, failures, written: false }, null, 2));
    process.exitCode = 1;
    return;
  }
  if (write) {
    const now = new Date().toISOString();
    catalog.updatedAt = now;
    catalog.works.forEach(work => { work.verifiedAt = now; });
    const temporary = `${catalogPath}.${process.pid}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(catalog, null, 2)}\n`, { flag: 'wx' });
      await rename(temporary, catalogPath);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
  console.log(JSON.stringify({ ...counts, http: 'passed', motion: motion ? 'passed' : 'not run', written: write }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
