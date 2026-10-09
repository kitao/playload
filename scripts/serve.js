import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep, extname, relative } from 'node:path';
import { spawn } from 'node:child_process';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
};
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const path = await realpath(resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname)));
    if (!path.startsWith(root + sep) && path !== root) throw new Error('Outside root');
    if (
      relative(root, path)
        .split(sep)
        .some((s) => s.startsWith('.'))
    )
      throw new Error('Hidden file');
    const data = await readFile(path);
    response.writeHead(200, {
      'Content-Type': types[extname(path)] ?? 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end(request.method === 'HEAD' ? undefined : data);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
});
server.on('error', (error) => {
  console.error(
    error.code === 'EADDRINUSE'
      ? 'Port is already in use. Stop the other server or choose a different PORT.'
      : error.message,
  );
  process.exitCode = 1;
});
server.listen(Number(process.env.PORT ?? 8765), '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}/`;
  console.log(`Playload · ${url}`);
  if (process.argv.includes('--no-open')) return;
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd.exe', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  const browser = spawn(command, args, { stdio: 'ignore' });
  const failed = () => console.error(`Could not open your browser. Open ${url}`);
  browser.on('error', failed);
  browser.on('exit', (code) => {
    if (code) failed();
  });
});
