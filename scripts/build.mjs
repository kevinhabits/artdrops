import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
await rm(`${root}dist`, { recursive: true, force: true });
await mkdir(`${root}dist`, { recursive: true });
await cp(`${root}public`, `${root}dist`, { recursive: true });
await cp(`${root}src`, `${root}dist/src`, { recursive: true });
console.log('Built ArtDrops → dist/ (no runtime dependencies)');
