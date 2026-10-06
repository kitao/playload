import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep, extname } from 'node:path';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const path = await realpath(resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname)));
    if (!path.startsWith(root + sep) && path !== root) throw new Error('Outside root');
    if (path.split(sep).some(s => s.startsWith('.'))) throw new Error('Hidden file');
    const data = await readFile(path);
    response.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : data);
  } catch { response.writeHead(404); response.end('Not found'); }
});
server.listen(Number(process.env.PORT || 8000), '127.0.0.1', () => console.log(`Playload · http://localhost:${server.address().port}`));
