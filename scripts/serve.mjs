import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const production = process.argv.includes('--production');
const root = resolve(production ? 'dist' : 'public');
const port = Number(process.env.PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const base = !production && path.startsWith('/src/') ? resolve('.') : root;
    const file = resolve(base, `.${path === '/' ? '/index.html' : path}`);
    if (!file.startsWith(base + sep) || !(await stat(file)).isFile()) throw new Error('Not found');
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`ArtDrops: http://127.0.0.1:${port}`));
