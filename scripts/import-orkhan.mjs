import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const GALLERY = 'https://orkhan.art/untitled/gallery';
const ARTIST = 'Orkhan Mammadov';
const EXPECTED_EPISODES = 414;
const MAX_IMAGE_BYTES = 12_000_000;

export function webpDimensions(bytes) {
  const data = Buffer.from(bytes);
  if (data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WEBP') throw new Error('Response is not a WebP image');
  for (let offset = 12; offset + 8 <= data.length;) {
    const type = data.toString('ascii', offset, offset + 4);
    const size = data.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > data.length) throw new Error('Truncated WebP image');
    if (type === 'VP8X' && size >= 10) return { width: data.readUIntLE(start + 4, 3) + 1, height: data.readUIntLE(start + 7, 3) + 1 };
    if (type === 'VP8 ' && size >= 10 && data.toString('hex', start + 3, start + 6) === '9d012a') return { width: data.readUInt16LE(start + 6) & 0x3fff, height: data.readUInt16LE(start + 8) & 0x3fff };
    if (type === 'VP8L' && size >= 5 && data[start] === 0x2f) {
      const bits = data.readUInt32LE(start + 1);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    offset = start + size + (size % 2);
  }
  throw new Error('WebP dimensions are missing');
}

async function response(url, method = 'GET') {
  const result = await fetch(url, { method, signal: AbortSignal.timeout(25_000), headers: { 'User-Agent': 'ArtDrops source verifier' } });
  if (!result.ok) throw new Error(`HTTP ${result.status}: ${url}`);
  return result;
}

async function discoverGallery() {
  const html = await (await response(GALLERY)).text();
  const scripts = [...new Set([...html.matchAll(/(?:src|href)="([^"<>]+\.js)"/g)].map(match => new URL(match[1], GALLERY).href))];
  const sources = await Promise.all(scripts.map(async url => ({ url, text: await (await response(url)).text() })));
  const ipfs = sources.flatMap(source => [...source.text.matchAll(/https:\/\/ipfs\.orkhan\.art\/ipfs\/([A-Za-z0-9]+)\//g)]);
  const cid = ipfs[0]?.[1];
  if (!cid || !sources.some(source => source.text.includes('/untitled/episodes/'))) throw new Error('Official gallery structure changed; review source before importing');
  return { cid, scripts, metadataUrl: `https://ipfs.orkhan.art/ipfs/${cid}/episodes.json` };
}

async function readEpisodes(discovery, metadataFile, gateway) {
  if (metadataFile) return { episodes: JSON.parse(await readFile(metadataFile, 'utf8')), metadataUrl: discovery.metadataUrl, retrievedFrom: `local snapshot: ${metadataFile}` };
  const urls = gateway ? [new URL(`${discovery.cid}/episodes.json`, gateway.endsWith('/') ? gateway : `${gateway}/`).href] : [discovery.metadataUrl, `https://ipfs.io/ipfs/${discovery.cid}/episodes.json`];
  const errors = [];
  for (const url of urls) {
    try { return { episodes: await (await response(url)).json(), metadataUrl: discovery.metadataUrl, retrievedFrom: url }; }
    catch (error) { errors.push(`${url}: ${error.message}`); }
  }
  throw new Error(`Episode metadata unavailable. ${errors.join('; ')}`);
}

export function validateEpisodes(episodes) {
  if (!Array.isArray(episodes) || episodes.length !== EXPECTED_EPISODES) throw new Error(`Expected ${EXPECTED_EPISODES} official episodes`);
  const numbers = new Set();
  for (const episode of episodes) {
    if (!Number.isInteger(episode.n) || episode.n < 1 || episode.n > EXPECTED_EPISODES || numbers.has(episode.n)) throw new Error('Episode numbers are invalid or duplicated');
    if (typeof episode.title !== 'string' || !episode.title.trim() || typeof episode.panel !== 'string') throw new Error(`Episode ${episode.n} has incomplete attribution`);
    numbers.add(episode.n);
  }
  return [...episodes].sort((a, b) => a.n - b.n);
}

async function verifyImage(url) {
  const result = await response(url);
  const contentType = result.headers.get('content-type')?.split(';')[0] || '';
  if (contentType !== 'image/webp') throw new Error(`Expected image/webp, received ${contentType}`);
  if (Number(result.headers.get('content-length')) > MAX_IMAGE_BYTES) throw new Error('Image exceeds verification size limit');
  const buffer = Buffer.from(await result.arrayBuffer());
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error('Image exceeds verification size limit');
  const dimensions = webpDimensions(buffer);
  if (!dimensions.width || !dimensions.height) throw new Error('Invalid image dimensions');
  return { url, status: result.status, contentType, bytes: buffer.length, ...dimensions, sha256: createHash('sha256').update(buffer).digest('hex') };
}

export async function importOrkhan({ outputDirectory = 'artifacts', metadataFile, gateway, concurrency = 8 } = {}) {
  const checkedAt = new Date().toISOString();
  const discovery = await discoverGallery();
  const metadata = await readEpisodes(discovery, metadataFile, gateway);
  const episodes = validateEpisodes(metadata.episodes);
  const jobs = episodes.flatMap(episode => ['standard', 'mask'].map(variant => ({ episode, variant })));
  const works = [], assets = [], failures = [];
  let index = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(12, concurrency)) }, async () => {
    while (index < jobs.length) {
      const { episode, variant } = jobs[index++];
      const number = String(episode.n).padStart(3, '0');
      const mediaUrl = `https://orkhan.art/untitled/episodes/${variant === 'mask' ? 'm' : 'g'}/${number}.webp`;
      try {
        const asset = await verifyImage(mediaUrl);
        assets.push({ episode: episode.n, variant, ...asset });
        works.push({
          id: `orkhan:untitled:${number}:${variant}`, title: `${episode.title}${variant === 'mask' ? ' — Mask' : ''}`,
          artist: ARTIST, artistKey: 'orkhan-mammadov', kind: 'image', source: 'Orkhan', collection: 'Untitled', year: '2026',
          sourceUrl: `${GALLERY}?token=${episode.n}&mask=${variant === 'mask' ? 1 : 0}`, mediaUrl, posterUrl: mediaUrl,
          width: asset.width, height: asset.height,
          orientation: asset.width / asset.height > 1.08 ? 'landscape' : asset.width / asset.height < .92 ? 'portrait' : 'square',
          description: `Episode ${number} from Untitled (2026), ${episode.panel}. ${variant === 'mask' ? 'Official mask view isolating the painted subject.' : 'Official gallery view of the episode in its place on the wall.'}`,
          episode: episode.n, variant, panel: episode.panel, verifiedAt: checkedAt,
        });
      } catch (error) { failures.push({ episode: episode.n, variant, mediaUrl, error: error.message }); }
      const completed = works.length + failures.length;
      if (completed % 100 === 0 || completed === jobs.length) console.log(`Verified ${completed}/${jobs.length} Orkhan images (${failures.length} failed)`);
    }
  }));
  const sort = (a, b) => a.episode - b.episode || Number(a.variant === 'mask') - Number(b.variant === 'mask');
  works.sort(sort); assets.sort(sort); failures.sort(sort);
  const dimensions = [...new Set(assets.map(asset => `${asset.width}×${asset.height}`))];
  const report = {
    checkedAt, source: GALLERY, artist: ARTIST, collection: 'Untitled', sourceScripts: discovery.scripts,
    metadataUrl: metadata.metadataUrl, metadataRetrievedFrom: metadata.retrievedFrom,
    expectedEpisodes: EXPECTED_EPISODES, episodes: episodes.length, expectedVariants: jobs.length, verifiedVariants: works.length,
    standard: works.filter(work => work.variant === 'standard').length, masked: works.filter(work => work.variant === 'mask').length,
    dimensions, totalVerifiedBytes: assets.reduce((sum, asset) => sum + asset.bytes, 0),
    suitability: 'Static WebP image files used by the official gallery. Native img rendering; no remote scripts, iframe, or wall/parallax engine required. These are gallery-resolution images, not the complete 32768×13312 mural.',
    failures, assets,
  };
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(resolve(outputDirectory, 'orkhan-candidates.json'), `${JSON.stringify({ version: 1, updatedAt: checkedAt, works }, null, 2)}\n`);
  await writeFile(resolve(outputDirectory, 'orkhan-import-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ episodes: episodes.length, works: works.length, dimensions, failures: failures.length }));
  if (failures.length) process.exitCode = 1;
  return { works, report };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const value = flag => { const index = process.argv.indexOf(flag); return index >= 0 ? process.argv[index + 1] : undefined; };
  await importOrkhan({ outputDirectory: value('--out') || 'artifacts', metadataFile: value('--metadata-file'), gateway: value('--gateway'), concurrency: Number(value('--concurrency')) || 8 });
}
