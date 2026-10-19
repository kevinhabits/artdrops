#!/usr/bin/env node
// Public, read-only SuperRare importer. Writes review artifacts, never the live catalog.
import { readFile, writeFile, mkdir, rename, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const api = 'https://api.superrare.com/graphql';
const targets = [
  { key: 'still-ms-painting', label: 'Still MS Painting', contract: '0x4573cfc6cd3bf62000c1b0b55ce1beeee0b8cbd8', expected: 51 },
  { key: 'dreadland', label: '20 tales from dreadland', contract: '0xa930ef880909b589a525ffd9bd8e60854a2e0a02', expected: 20 },
  { key: 'faceprint', label: 'Faceprint', contract: '0x0b41706c0d7660842a54e573014e8d0fe388d58f', expected: 212 },
  ...[['hazed', 'Hazed', 42], ['botto', 'Botto', 249], ['intrepid', 'Intrepid', 98], ['beverlykillsartist', 'Beverly Kills', 88], ['newlightvisuals', 'New Light Visuals', 52], ['bookofbee', 'Book of Bee', 18]].map(([key, label, expected]) => ({ key, label, expected, slug: key })),
].map(target => ({ ...target, sourceUrl: target.slug ? `https://superrare.com/${target.slug}` : `https://superrare.com/collection/${target.key === 'faceprint' ? '' : '1-'}${target.contract}` }));

async function request(url, options = {}) {
  let failure;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30000) });
      if (response.status === 429 && attempt < 3) {
        const seconds = Number(response.headers.get('retry-after'));
        const message = (await response.text()).slice(0, 240);
        if (message.includes('service worker gateway only')) throw new Error('This IPFS endpoint requires a browser service worker; trying the source-hosted original instead.');
        const delay = Math.min(60000, seconds > 0 ? seconds * 1000 : 10000 * 2 ** attempt);
        console.error(`Rate limited at ${new URL(url).hostname}; retrying in ${delay / 1000}s. ${message}`);
        await new Promise(done => setTimeout(done, delay));
        continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}: ${url}`); }
      return response;
    } catch (error) { failure = error; if (attempt < 3) await new Promise(done => setTimeout(done, 750)); }
  }
  throw failure;
}
let lastApiCall = 0;
async function graphql(query) {
  await new Promise(done => setTimeout(done, Math.max(0, lastApiCall + 5000 - Date.now())));
  lastApiCall = Date.now();
  const response = await request(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
  const body = await response.json();
  if (body.errors?.length) throw new Error(body.errors.map(error => error.message).join('; '));
  return body.data;
}
async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n');
  await rename(temporary, path);
}
async function publicPage(target, cache) {
  const path = resolve(cache, `${target.key}.html`);
  try {
    const saved = await stat(path);
    if (Date.now() - saved.mtimeMs < 86400000) return await readFile(path, 'utf8');
  } catch { /* Read the public page if there is no recent successful copy. */ }
  const page = await request(target.sourceUrl);
  if (!(page.headers.get('content-type') ?? '').includes('text/html')) throw new Error('Source did not return an HTML page.');
  const html = await page.text();
  await writeFile(path, html);
  return html;
}
export function readEmbeddedJson(text, key) {
  const start = text.indexOf(`"${key}":`);
  if (start < 0) return null;
  let at = start + key.length + 3;
  while (/\s/.test(text[at])) at++;
  const begin = at;
  let depth = 0, quoted = false, escaped = false;
  for (; at < text.length; at++) {
    const char = text[at];
    if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; }
    else if (char === '"') quoted = true;
    else if (char === '{' || char === '[') depth++;
    else if (char === '}' || char === ']') { if (--depth === 0) return JSON.parse(text.slice(begin, at + 1)); }
  }
  return null;
}
export function parsePage(html) {
  const chunks = [...html.matchAll(/self\.__next_f\.push\((.*?)\)<\/script>/gs)].flatMap(match => {
    try { const value = JSON.parse(match[1]); return typeof value[1] === 'string' ? [value[1]] : []; } catch { return []; }
  }).join('');
  const records = new Map((readEmbeddedJson(chunks, 'initialArtworksData') ?? []).map(work => [work.universalTokenId, work]));
  // Collection pages embed their first page in the public dehydrated query state.
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (value.universalTokenId && value.metadata?.name && value.creator?.defaultAddress) records.set(value.universalTokenId, value);
    for (const child of Object.values(value)) visit(child);
  }
  for (const line of chunks.split('\n')) {
    try { visit(JSON.parse(line.slice(line.indexOf(':') + 1))); } catch { /* Non-JSON RSC transport record. */ }
  }
  return { user: readEmbeddedJson(chunks, 'initialUserData'), works: [...records.values()] };
}
function typeName(type) { return type ? type.name || typeName(type.ofType) : null; }
function metadataSelection(types, name, depth = 0) {
  const type = types.get(name);
  return (type?.fields ?? []).filter(field => !(field.args?.some(arg => arg.type.kind === 'NON_NULL'))).flatMap(field => {
    const child = types.get(typeName(field.type));
    if (child?.kind === 'SCALAR' || child?.kind === 'ENUM') return [field.name];
    if (depth >= 3 || /owner|event|state|collection|creator/i.test(field.name)) return [];
    const nested = metadataSelection(types, child?.name, depth + 1);
    return nested ? [`${field.name}{${nested}}`] : [];
  }).join(' ');
}
async function discoverSchema(cache) {
  let schema;
  try { schema = JSON.parse(await readFile(resolve(cache, 'schema.json'), 'utf8')); } catch { /* Discover on the first run. */ }
  if (!schema?.__schema?.types) {
    schema = await graphql('{__schema{types{name kind fields{name args{name type{kind name}} type{kind name ofType{kind name ofType{kind name ofType{kind name}}}}} inputFields{name type{kind name ofType{kind name ofType{kind name}}}}}}}');
    await atomicJson(resolve(cache, 'schema.json'), schema);
  }
  const types = new Map(schema.__schema.types.map(type => [type.name, type]));
  const response = types.get('NftWithPaginationResponse');
  const nftName = typeName(response.fields.find(field => field.name === 'nfts').type);
  const nft = types.get(nftName);
  const metadataName = typeName(nft.fields.find(field => field.name === 'metadata').type);
  const scalarFields = ['universalTokenId', 'contractAddress', 'tokenId', 'createdAt', 'mintedAt'].filter(name => nft.fields.some(field => field.name === name));
  const selection = `${scalarFields.join(' ')} creator{defaultAddress profile{username}} metadata{${metadataSelection(types, metadataName)}}`;
  const paginationFields = new Set(types.get('PaginationInput').inputFields.map(field => field.name));
  return { selection, paginationFields };
}
async function discoverTarget(target, schema, cache) {
  const html = await publicPage(target, cache);
  const embedded = parsePage(html);
  const address = target.contract ?? embedded.user?.defaultAddress;
  if (!address) throw new Error('No creator address in the public profile page.');
  const records = [], seen = new Set();
  let total = null, offset = 0;
  for (let pageNumber = 1; pageNumber <= 100; pageNumber++) {
    let pagination = 'take:100';
    if (schema.paginationFields.has('skip')) pagination += `,skip:${offset}`;
    else if (schema.paginationFields.has('offset')) pagination += `,offset:${offset}`;
    else if (schema.paginationFields.has('page')) pagination += `,page:${pageNumber}`;
    else if (offset) throw new Error('Unsupported pagination schema; refusing to silently repeat the first page.');
    const filter = target.contract ? 'contractAddress' : 'creatorAddress';
    const data = await graphql(`{getNfts(filter:{${filter}:{equals:${JSON.stringify(address)}}},pagination:{${pagination}}){nfts{${schema.selection}} pagination{total hasNextPage}}}`);
    const batch = data.getNfts.nfts;
    total = data.getNfts.pagination.total;
    let added = 0;
    for (const work of batch) if (!seen.has(work.universalTokenId)) { seen.add(work.universalTokenId); records.push(work); added++; }
    if (!data.getNfts.pagination.hasNextPage) break;
    if (!added) throw new Error('Pagination repeated records without progressing.');
    offset += batch.length;
  }
  if (total !== null && records.length < total) throw new Error(`Incomplete discovery: ${records.length} of ${total}.`);
  await atomicJson(resolve(cache, `${target.key}-raw.json`), records);
  return { records, reportedTotal: total, profileCreated: embedded.user?.created ?? null };
}
export function imageDimensions(bytes) {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), mime: 'image/png' };
  if (bytes.length >= 10 && /^GIF8[79]a/.test(bytes.toString('ascii', 0, 6))) return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8), mime: 'image/gif' };
  if (bytes.length >= 30 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = bytes.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1, mime: 'image/webp' };
    if (chunk === 'VP8L') { const packed = bytes.readUInt32LE(21); return { width: (packed & 0x3fff) + 1, height: ((packed >>> 14) & 0x3fff) + 1, mime: 'image/webp' }; }
    if (chunk === 'VP8 ' && bytes.length >= 30) return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff, mime: 'image/webp' };
  }
  if (bytes.length > 4 && bytes[0] === 255 && bytes[1] === 216) {
    let at = 2, orientation = 1;
    while (at + 4 < bytes.length) {
      if (bytes[at] !== 255) break;
      const marker = bytes[at + 1];
      if (marker === 255) { at++; continue; }
      if (marker === 217 || marker === 218) break;
      const size = bytes.readUInt16BE(at + 2);
      if (size < 2 || at + 2 + size > bytes.length) return null;
      if (marker === 225 && bytes.toString('ascii', at + 4, at + 10) === 'Exif\0\0') {
        const tiff = at + 10, le = bytes.toString('ascii', tiff, tiff + 2) === 'II';
        const u16 = index => le ? bytes.readUInt16LE(index) : bytes.readUInt16BE(index);
        const u32 = index => le ? bytes.readUInt32LE(index) : bytes.readUInt32BE(index);
        if (tiff + 8 <= at + 2 + size) {
          const ifd = tiff + u32(tiff + 4);
          if (ifd + 2 < at + 2 + size) for (let i = 0; i < u16(ifd); i++) {
            const entry = ifd + 2 + 12 * i;
            if (entry + 12 > at + 2 + size) break;
            if (u16(entry) === 274) orientation = u16(entry + 8);
          }
        }
      }
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) {
        const width = bytes.readUInt16BE(at + 7), height = bytes.readUInt16BE(at + 5);
        return { width: orientation >= 5 ? height : width, height: orientation >= 5 ? width : height, mime: 'image/jpeg', exifOrientation: orientation };
      }
      at += 2 + size;
    }
  }
  if (bytes.length >= 32 && bytes.toString('ascii', 4, 8) === 'ftyp' && /avif|avis/.test(bytes.toString('ascii', 8, 32))) {
    const index = bytes.indexOf('ispe');
    if (index >= 0 && index + 16 <= bytes.length) return { width: bytes.readUInt32BE(index + 8), height: bytes.readUInt32BE(index + 12), mime: 'image/avif' };
  }
  return null;
}
function publicUrl(uri) {
  if (typeof uri !== 'string') return null;
  // SuperRare metadata also uses this public Pixura gateway directly; ipfs.io now requires a browser service worker.
  if (uri.startsWith('ipfs://')) return `https://ipfs.pixura.io/ipfs/${uri.slice(7).replace(/^ipfs\//, '')}`;
  if (uri.startsWith('ar://')) return `https://arweave.net/${uri.slice(5)}`;
  try { const url = new URL(uri); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
}
async function readMediaHeader(url) {
  const response = await request(url, { headers: { Range: 'bytes=0-1048575' } });
  const type = (response.headers.get('content-type') ?? '').split(';')[0];
  if (!/^(image\/(png|jpeg|gif|webp|avif)|video\/mp4|application\/octet-stream)$/.test(type)) { await response.body?.cancel(); throw new Error(`Unsupported content type ${type}`); }
  const reader = response.body.getReader();
  let bytes = Buffer.alloc(0), dimensions;
  try {
    while (bytes.length < 1048576) {
      const next = await reader.read(); if (next.done) break;
      bytes = Buffer.concat([bytes, Buffer.from(next.value)]);
      dimensions = imageDimensions(bytes);
      const mp4 = bytes.length >= 128 && bytes.toString('ascii', 4, 8) === 'ftyp' && !/avif|avis/.test(bytes.toString('ascii', 8, 32));
      if (dimensions || mp4) break;
    }
  } finally { await reader.cancel(); }
  if (dimensions) return { ...dimensions, kind: 'image', httpType: type, httpStatus: response.status };
  if (bytes.toString('ascii', 4, 8) === 'ftyp' && !/avif|avis/.test(bytes.toString('ascii', 8, 32))) return { kind: 'video', mime: 'video/mp4', httpType: type, httpStatus: response.status };
  throw new Error('Unsupported or incomplete media signature/dimensions.');
}
function decodeSample(url, naturalFrames = false) {
  return new Promise((resolveSample, reject) => {
    const child = spawn(process.env.FFMPEG_BIN || 'ffmpeg', ['-hide_banner', '-nostats', '-rw_timeout', '15000000', '-i', url, '-an', '-vf', `${naturalFrames ? '' : 'fps=2,'}scale=96:96:force_original_aspect_ratio=decrease`, '-frames:v', '3', '-f', 'framemd5', '-']);
    let output = '', diagnostic = '';
    const timeout = setTimeout(() => child.kill('SIGKILL'), 70000);
    child.stdout.on('data', value => { output += value; }); child.stderr.on('data', value => { diagnostic += value; });
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('close', code => {
      clearTimeout(timeout);
      const hashes = [...output.matchAll(/^0,.*?,\s*([a-f0-9]{32})$/gm)].map(match => match[1]);
      const stream = diagnostic.split('\n').find(line => line.includes('Video:')) ?? '';
      const dimensions = stream.match(/, (\d{2,5})x(\d{2,5})(?:\D|$)/);
      if (code !== 0 || !hashes.length || !dimensions) return reject(new Error(`Media decode failed: ${diagnostic.slice(-240)}`));
      resolveSample({ width: Number(dimensions[1]), height: Number(dimensions[2]), changing: new Set(hashes).size > 1, frames: hashes.length, codec: stream.match(/Video:\s*(\w+)/)?.[1], pixelFormat: stream.match(/\b(yuv[a-z0-9]+|gbr[a-z0-9]+)\b/)?.[1] });
    });
  });
}
function mediaChoices(raw) {
  const metadata = raw.metadata ?? {}, details = metadata.mediaDetails ?? {}, proxy = metadata.proxyMedia ?? {};
  const token = metadata.rawMetadata ?? {};
  const videos = [details.original?.video?.uri, details.videoUri, metadata.animationUri, metadata.animation_url, proxy.video?.full];
  if (videos.some(Boolean)) videos.push(token.animation_url, token.animation, details.proxy?.video?.full);
  const images = [details.proxy?.image?.full, details.original?.image?.uri, proxy.image?.full, details.imageUri, metadata.imageUri, metadata.image, metadata.image_url, token.image, token.image_url];
  if (token.media?.mimeType?.startsWith('image/')) images.push(token.media.uri);
  // Some legacy source hosts are gone. The API may still supply a complete motion rendition of an animated image.
  if (details.original?.image?.isAnimated === true) images.push(details.proxy?.video?.full);
  const videoUrls = videos.map(publicUrl).filter(Boolean);
  // A video's poster is not a substitute for its original artwork.
  return [...new Set(videoUrls.length ? videoUrls : images.map(publicUrl).filter(Boolean))];
}
async function verifyWork(raw, target) {
  const title = raw.metadata?.name?.trim();
  const artist = raw.creator?.profile?.username || raw.creator?.fullName || raw.creator?.username;
  const artistKey = raw.creator?.defaultAddress?.toLowerCase();
  if (!title || !artist || !artistKey || !raw.universalTokenId) throw new Error('Missing public title, artist, or token identity.');
  const failures = [];
  for (const mediaUrl of mediaChoices(raw)) {
    try {
      const media = await readMediaHeader(mediaUrl);
      let sample;
      if (media.kind === 'video' || media.mime === 'image/gif') sample = await decodeSample(mediaUrl, media.mime === 'image/gif');
      if (media.kind === 'video' && (sample.codec !== 'h264' || !['yuv420p','yuvj420p'].includes(sample.pixelFormat))) throw new Error('Video requires browser-compatible 8-bit H.264 4:2:0.');
      const width = sample?.width ?? media.width, height = sample?.height ?? media.height;
      if (![width, height].every(value => Number.isInteger(value) && value > 0)) throw new Error('Invalid decoded media dimensions.');
      let posterUrl = media.kind === 'image' ? mediaUrl : null;
      if (!posterUrl) for (const candidate of [raw.metadata?.mediaDetails?.proxy?.image?.medium, raw.metadata?.mediaDetails?.proxy?.image?.full, raw.metadata?.proxyMedia?.image?.medium, raw.metadata?.proxyMedia?.image?.full, raw.metadata?.mediaDetails?.imageUri].map(publicUrl).filter(Boolean)) {
        try { if ((await readMediaHeader(candidate)).kind === 'image') { posterUrl = candidate; break; } } catch { /* Try another public poster. */ }
      }
      const created = raw.createdAt ?? raw.mintedAt;
      const date = typeof created === 'number' ? new Date(created * (created < 1e12 ? 1000 : 1)) : new Date(created);
      const year = Number.isFinite(date.getTime()) ? date.getUTCFullYear() : null;
      return { work: { id: `superrare-${raw.universalTokenId}`, title, artist, artistKey, source: 'SuperRare', collection: target.label, sourceUrl: target.sourceUrl, mediaUrl, posterUrl, width, height, orientation: width > height ? 'landscape' : width < height ? 'portrait' : 'square', kind: media.kind, animated: media.mime === 'image/gif' && sample?.changing === true, year, description: `Artwork by ${artist}. Public SuperRare token ${raw.universalTokenId}.`, verifiedAt: new Date().toISOString() }, evidence: { id: raw.universalTokenId, ...media, ...(sample ? { sample } : {}) } };
    } catch (error) { failures.push(`${mediaUrl}: ${error.message}`); }
  }
  throw new Error(failures.join(' | ') || 'No supported original media URI.');
}
export function annotateRepresentations(works, report, rawById) {
  report.sourceRepresentations = [];
  for (const work of works) {
    const raw = rawById.get(work.id), original = raw?.metadata?.mediaDetails?.original;
    const alternate = ['html', 'audio', 'threeD'].find(kind => original?.[kind]?.uri);
    if (work.kind !== 'image' || !alternate) continue;
    const sourceTitle = raw.metadata.name;
    work.title = `${sourceTitle} (image view)`;
    work.description = `Artist-supplied image representation of ${sourceTitle}. The original ${alternate} artwork is linked from its SuperRare source page.`;
    report.sourceRepresentations.push({ id: work.id, sourceTitle, displayedTitle: work.title, originalType: alternate, originalUrl: publicUrl(original[alternate].uri), playback: 'artist-supplied image' });
  }
}
async function updatePosters(cache, works, report) {
  const rawById = new Map();
  for (const target of targets) {
    try {
      const records = JSON.parse(await readFile(resolve(cache, `${target.key}-raw.json`), 'utf8'));
      for (const raw of records) rawById.set(`superrare-${raw.universalTokenId}`, raw);
    } catch { /* Some sources may not yet be enumerated. */ }
  }
  annotateRepresentations(works, report, rawById);
  const candidates = works.filter(work => work.kind === 'image');
  report.mediaProvenance = {
    note: 'Dimensions describe the actual verified public media file. SuperRare source-hosted full media can differ from older token metadata; full does not guarantee original resolution.',
    dimensionDiscrepancies: works.flatMap(work => {
      const metadata = rawById.get(work.id)?.metadata?.rawMetadata;
      const details = work.kind === 'video' ? metadata?.animation_details : metadata?.image_details;
      const dimensions = metadata?.media?.dimensions?.match(/^(\d+)\s*[x×]\s*(\d+)$/i);
      const width = Number(dimensions?.[1] ?? details?.width), height = Number(dimensions?.[2] ?? details?.height);
      return width > 0 && height > 0 && (width !== work.width || height !== work.height) ? [{ id: work.id, title: work.title, served: `${work.width}x${work.height}`, metadata: `${width}x${height}` }] : [];
    }),
  };
  const previousPosters = new Map((report.posterVerification?.evidence ?? []).map(entry => [entry.id, entry]));
  const result = { checkedAt: new Date().toISOString(), supplied: 0, verified: 0, reused: 0, failures: [], evidence: [] };
  let cursor = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (cursor < candidates.length) {
      const work = candidates[cursor++], raw = rawById.get(work.id);
      const poster = publicUrl(raw?.metadata?.mediaDetails?.proxy?.image?.medium ?? raw?.metadata?.proxyMedia?.image?.medium);
      if (!poster || poster === work.mediaUrl) continue;
      result.supplied++;
      const previous = previousPosters.get(work.id);
      if (previous?.url === poster && work.posterUrl === poster) {
        result.verified++; result.reused++; result.evidence.push(previous);
        continue;
      }
      try {
        const probe = await readMediaHeader(poster);
        if (probe.kind !== 'image') throw new Error('Poster is not an image.');
        work.posterUrl = poster;
        result.verified++;
        result.evidence.push({ id: work.id, url: poster, ...probe });
        if (result.verified % 100 === 0) console.log(`POSTERS ${result.verified} checked.`);
      } catch (error) { result.failures.push({ id: work.id, reason: error.message }); }
    }
  }));
  report.posterVerification = result;
  await atomicJson(resolve(project, 'artifacts/superrare-candidates.json'), { version: 1, generatedAt: report.generatedAt, works });
  await atomicJson(resolve(project, 'artifacts/superrare-report.json'), { ...report, verifiedTotal: works.length });
  console.log(`POSTERS ${result.verified}/${result.supplied} verified; playback media URLs preserved.`);
}
async function main() {
  const args = process.argv.slice(2), cacheAt = args.indexOf('--cache');
  const cache = resolve(cacheAt >= 0 ? args[cacheAt + 1] : '/tmp/artdrops-superrare');
  await mkdir(cache, { recursive: true });
  if (args.includes('--posters-only')) {
    const candidates = JSON.parse(await readFile(resolve(project, 'artifacts/superrare-candidates.json'), 'utf8'));
    const existingReport = JSON.parse(await readFile(resolve(project, 'artifacts/superrare-report.json'), 'utf8'));
    await updatePosters(cache, candidates.works, existingReport);
    return;
  }
  const report = { generatedAt: new Date().toISOString(), api, documentation: 'https://help.superrare.com/en/articles/10683308-superrare-public-api-documentation', verification: 'Public source media image signatures and dimensions; GIF/video frame decode; per-group public attribution page; browser-compatible H.264 for videos. No media files copied to the repository.', groups: [], failures: [], evidence: [] };
  let schema;
  if (!args.includes('--cached-only')) {
    try { schema = await discoverSchema(cache); }
    catch (error) { report.discoveryError = error.message; console.error(`API schema unavailable: ${error.message}. Trying available public page records.`); }
  }
  let works = [];
  let previousGroups = new Map();
  try {
    const previous = JSON.parse(await readFile(resolve(project, 'artifacts/superrare-candidates.json'), 'utf8'));
    works = (previous.works ?? []).filter(work => work.source === 'SuperRare' && work.verifiedAt && work.mediaUrl?.startsWith('https://'));
    const previousReport = JSON.parse(await readFile(resolve(project, 'artifacts/superrare-report.json'), 'utf8'));
    report.evidence = previousReport.evidence ?? [];
    if (previousReport.posterVerification) report.posterVerification = previousReport.posterVerification;
    previousGroups = new Map((previousReport.groups ?? []).map(group => [group.key, group]));
  } catch { /* No previous verified candidates to retain. */ }
  const seen = new Set(works.map(work => work.id.replace(/^superrare-/, '')));
  for (const target of targets) {
    const group = { key: target.key, collection: target.label, sourceUrl: target.sourceUrl, requestedCount: target.expected, discovered: 0, verified: works.filter(work => work.collection === target.label).length };
    report.groups.push(group);
    const previous = previousGroups.get(target.key);
    if (args.includes('--resume') && previous?.partialDiscovery === false && previous.discovered === previous.verified && group.verified === previous.verified) {
      Object.assign(group, previous);
      continue;
    }
    try {
      let discovery;
      if (args.includes('--cached-only')) {
        const records = JSON.parse(await readFile(resolve(cache, `${target.key}-raw.json`), 'utf8'));
        await publicPage(target, cache);
        const previous = previousGroups.get(target.key);
        discovery = { records, reportedTotal: previous?.reportedTotal ?? null, profileCreated: previous?.profileCreated ?? null, partial: previous?.partialDiscovery !== false, reason: previous?.discoveryReason };
      } else {
        try {
          if (!schema) throw new Error(report.discoveryError);
          discovery = await discoverTarget(target, schema, cache);
        } catch (error) {
          const embedded = parsePage(await publicPage(target, cache));
          if (!embedded.works.length) throw error;
          discovery = { records: embedded.works, reportedTotal: embedded.user?.created ?? null, profileCreated: embedded.user?.created ?? null, partial: true, reason: error.message };
        }
      }
      Object.assign(group, { discovered: discovery.records.length, reportedTotal: discovery.reportedTotal, profileCreated: discovery.profileCreated ?? null, partialDiscovery: discovery.partial === true || discovery.cached === true, ...(discovery.reason ? { discoveryReason: discovery.reason } : {}) });
      let cursor = 0;
      await Promise.all(Array.from({ length: 6 }, async () => {
        while (cursor < discovery.records.length) {
          const raw = discovery.records[cursor++];
          if (seen.has(raw.universalTokenId)) continue;
          seen.add(raw.universalTokenId);
          try {
            const result = await verifyWork(raw, target); works.push(result.work); report.evidence.push(result.evidence); group.verified++;
            console.log(`OK ${target.label}: ${result.work.title}`);
          } catch (error) { report.failures.push({ group: target.key, id: raw.universalTokenId, title: raw.metadata?.name, reason: error.message }); console.error(`SKIP ${raw.universalTokenId}: ${error.message}`); }
        }
      }));
    } catch (error) { group.error = error.message; console.error(`GROUP ${target.key}: ${error.message}`); }
    // A failed refresh must not erase a previously verified candidate set.
    if (works.length) await atomicJson(resolve(project, 'artifacts/superrare-candidates.json'), { version: 1, generatedAt: report.generatedAt, works });
    await atomicJson(resolve(project, 'artifacts/superrare-report.json'), { ...report, verifiedTotal: works.length });
  }
  if (args.includes('--posters')) await updatePosters(cache, works, report);
  console.log(JSON.stringify({ verified: works.length, failures: report.failures.length, groups: report.groups }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
