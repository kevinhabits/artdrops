// Merge verified review artifacts into the static library, never unverified metadata.
import { readFile, writeFile, rename } from 'node:fs/promises';
import { validateReferences } from './validate-references.mjs';

const targets = [
  ['Still MS Painting', 'https://superrare.com/collection/1-0x4573cfc6cd3bf62000c1b0b55ce1beeee0b8cbd8'],
  ['20 tales from dreadland', 'https://superrare.com/collection/1-0xa930ef880909b589a525ffd9bd8e60854a2e0a02'],
  ['Untitled', 'https://orkhan.art/untitled/gallery'],
  ['Faceprint', 'https://superrare.com/collection/0x0b41706c0d7660842a54e573014e8d0fe388d58f'],
  ...[['hazed', 'Hazed'], ['botto', 'Botto'], ['intrepid', 'Intrepid'], ['beverlykillsartist', 'Beverly Kills'], ['newlightvisuals', 'New Light Visuals'], ['bookofbee', 'Book of Bee']].map(([slug, name]) => [name, `https://superrare.com/${slug}`]),
  ['Endless Cherry Blossom Loop', 'https://www.reddit.com/r/blender/comments/fm6t8y/endless_cherry_blossom_loop_made_in_blender_1_hr/'],
];
const works = [];
for (const name of ['superrare', 'orkhan', 'drive']) {
  try {
    const candidate = JSON.parse(await readFile(new URL(`../artifacts/${name}-candidates.json`, import.meta.url), 'utf8'));
    if (candidate.version !== 1 || !Array.isArray(candidate.works)) throw new Error(`Invalid ${name} candidates`);
    works.push(...candidate.works);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
if (!works.length) throw new Error('No verified new artworks. The public reference catalog was not changed.');
const collections = new Set(works.map(work => work.collection));
const references = targets.map(([name, url]) => {
  const matching = [...collections].filter(collection => collection.toLocaleLowerCase() === name.toLocaleLowerCase());
  const available = works.filter(work => matching.includes(work.collection)).length;
  const note = name === 'Endless Cherry Blossom Loop' && available
    ? 'Silent 1080p copy · creator permits reuse · source was upscaled from 540p.'
    : name === 'Untitled' && available === 828
    ? '414 episodes + 414 mask variants · 560 × 560 gallery images.'
    : available ? 'Verified file links; source totals may differ.' : 'Not added yet · file verification pending.';
  return { name, url, collections: matching, available, note };
});
const output = { version: 1, updatedAt: new Date().toISOString(), works, references };
const original = JSON.parse(await readFile(new URL('../public/catalog.json', import.meta.url), 'utf8'));
const counts = validateReferences(output, original);
const destination = new URL('../public/references.json', import.meta.url);
const temporary = new URL('../public/references.json.tmp', import.meta.url);
await writeFile(temporary, `${JSON.stringify(output, null, 2)}\n`);
await rename(temporary, destination);
console.log(JSON.stringify(counts, null, 2));
