import { createServer as createHTTP } from 'node:http';
import { createServer as createHTTPS } from 'node:https';
import { readFile, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep, extname, relative } from 'node:path';
import { spawn } from 'node:child_process';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';

const production = process.argv.includes('--dist');
const secure = process.argv.includes('--https');
const host = option('--host', '127.0.0.1');
const cert = option('--cert');
const key = option('--key');
if (secure && (!cert || !key)) {
  console.error('HTTPS requires --cert and --key. See CONTRIBUTING.md.');
  process.exit(1);
}
if (!secure && (cert || key)) {
  console.error('Use --https with --cert and --key.');
  process.exit(1);
}
const privateKey = secure ? await realpath(key) : null;
const root = resolve(fileURLToPath(new URL('..', import.meta.url)), production ? 'dist' : '.');
const compress = promisify(gzip);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.woff': 'font/woff',
};
function option(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}`);
  return value;
}

async function serve(request, response) {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const path = await realpath(resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname)));
    if (!path.startsWith(root + sep) && path !== root) throw new Error('Outside root');
    if (path === privateKey || /\.(pem|key|p12|pfx)$/i.test(path)) throw new Error('Private file');
    if (
      relative(root, path)
        .split(sep)
        .some((s) => s.startsWith('.'))
    )
      throw new Error('Hidden file');
    let data = await readFile(path);
    const headers = {
      'Content-Type': types[extname(path)] ?? 'text/plain; charset=utf-8',
      'Cache-Control': !production
        ? 'no-store'
        : /-[A-Z0-9]{8}\./.test(path)
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
    };
    if (production && ['.html', '.js', '.css', '.svg'].includes(extname(path))) {
      headers.Vary = 'Accept-Encoding';
      const encoding = (request.headers['accept-encoding'] ?? '')
        .split(',')
        .find((value) => /^\s*gzip(?:\s*;|\s*$)/i.test(value));
      if (encoding && !/;\s*q=0(?:\.0*)?\s*(?:;|$)/i.test(encoding)) {
        data = await compress(data);
        headers['Content-Encoding'] = 'gzip';
      }
    }
    response.writeHead(200, headers);
    response.end(request.method === 'HEAD' ? undefined : data);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
}
const server = secure
  ? createHTTPS({ cert: await readFile(cert), key: await readFile(key) }, serve)
  : createHTTP(serve);
server.on('error', (error) => {
  console.error(
    error.code === 'EADDRINUSE'
      ? 'Port is already in use. Stop the other server or choose a different PORT.'
      : error.message,
  );
  process.exitCode = 1;
});
server.listen(Number(process.env.PORT ?? (secure ? 8766 : 8765)), host, () => {
  const address = ['0.0.0.0', '::'].includes(host) ? '127.0.0.1' : host;
  const hostname = address.includes(':') ? `[${address}]` : address;
  const url = `${secure ? 'https' : 'http'}://${hostname}:${server.address().port}/`;
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
