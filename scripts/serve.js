import { createServer as createHTTP } from 'node:http';
import { createServer as createHTTPS } from 'node:https';
import { mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { watch } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, sep, extname, relative } from 'node:path';
import { spawn } from 'node:child_process';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { buildSite } from './build.js';

const production = process.argv.includes('--dist');
const secure = process.argv.includes('--https');
const host = option('--host', '127.0.0.1');
const cert = option('--cert');
const key = option('--key');
if (secure && (!cert || !key))
  throw new Error('HTTPS requires --cert <certificate> and --key <private key>.');
if (!secure && (cert || key)) throw new Error('Use --https with --cert and --key.');
const privateKey = secure ? await realpath(key) : null;
const sourceRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const server = secure
  ? createHTTPS({ cert: await readFile(cert), key: await readFile(key) }, serve)
  : createHTTP(serve);
const root = production
  ? await realpath(resolve(sourceRoot, 'dist')).catch((error) => {
      if (error.code === 'ENOENT')
        throw new Error('Build Playload with npm run build before previewing.');
      throw error;
    })
  : await realpath(await mkdtemp(resolve(tmpdir(), 'playload-dev-')));
const compress = promisify(gzip);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.woff': 'font/woff',
  '.json': 'application/json; charset=utf-8',
};
if (!production) {
  try {
    await buildSite({ minify: false, directory: root });
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}`);
  return value;
}

function redirect(response, url, pathname) {
  response.writeHead(307, { Location: pathname + url.search, 'Cache-Control': 'no-store' });
  response.end();
}

async function assetHeaders(pathname) {
  const headers = {};
  let matches = false;
  const rules = await readFile(resolve(root, '_headers'), 'utf8');
  for (const line of rules.split('\n')) {
    if (!line.trim()) continue;
    if (!line.startsWith(' ')) {
      matches = line.endsWith('*') ? pathname.startsWith(line.slice(0, -1)) : pathname === line;
    } else if (matches) {
      const index = line.indexOf(':');
      headers[line.slice(0, index).trim()] = line.slice(index + 1).trim();
    }
  }
  return headers;
}

async function serve(request, response) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    return response.end();
  }
  try {
    const url = new URL(request.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    if (pathname === '/playload') return redirect(response, url, '/playload/');
    const source = !production && pathname.startsWith('/src/');
    if (!source && !pathname.startsWith('/playload/')) throw new Error('Outside Playload');
    const directory = source ? sourceRoot : root;
    let path = resolve(directory, '.' + pathname);
    const details = await stat(path);
    if (details.isDirectory()) {
      if (!pathname.endsWith('/')) return redirect(response, url, pathname + '/');
      path = resolve(path, 'index.html');
    } else if (pathname.endsWith('/index.html'))
      return redirect(response, url, pathname.slice(0, -10));
    path = await realpath(path);
    if (!path.startsWith(directory + sep)) throw new Error('Outside root');
    if (path === privateKey || /\.(pem|key|p12|pfx)$/i.test(path)) throw new Error('Private file');
    if (
      relative(directory, path)
        .split(sep)
        .some((part) => part.startsWith('.'))
    )
      throw new Error('Hidden file');
    let data = await readFile(path);
    const headers = {
      'Content-Type': types[extname(path)] ?? 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
      ...(source ? {} : await assetHeaders(pathname)),
    };
    if (!production) headers['Cache-Control'] = 'no-store';
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
    response.writeHead(404, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    const data = await readFile(resolve(root, 'playload/404.html')).catch(() => 'Not found');
    response.end(request.method === 'HEAD' ? undefined : data);
  }
}
const watchers = [];
let timer,
  rebuildTask,
  pending = false,
  stopping = false;
async function shutdown(code) {
  if (stopping) return;
  stopping = true;
  clearTimeout(timer);
  for (const watcher of watchers) watcher.close();
  server.close();
  await rebuildTask;
  if (!production) await rm(root, { recursive: true, force: true });
  process.exit(code);
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => shutdown(0));
server.on('error', (error) => {
  console.error(
    error.code === 'EADDRINUSE'
      ? 'Port is already in use. Stop the other server or choose a different PORT.'
      : error.message,
  );
  shutdown(1);
});
server.listen(Number(process.env.PORT ?? (secure ? 8766 : 8765)), host, () => {
  const address = ['0.0.0.0', '::'].includes(host) ? '127.0.0.1' : host;
  const hostname = address.includes(':') ? `[${address}]` : address;
  const url = `${secure ? 'https' : 'http'}://${hostname}:${server.address().port}/playload/`;
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

if (!production && !process.argv.includes('--no-watch')) {
  function rebuild() {
    pending = true;
    if (rebuildTask || stopping) return;
    rebuildTask = (async () => {
      while (pending && !stopping) {
        pending = false;
        try {
          await buildSite({ minify: false, directory: root });
          console.log('Rebuilt Playload. Refresh the browser to see changes.');
        } catch (error) {
          console.error(error.message);
        }
      }
    })().finally(() => {
      rebuildTask = null;
    });
  }
  for (const path of [
    'src',
    'assets',
    'package.json',
    'data/reference.json',
    'data/fonts/unicode-LICENSE.txt',
  ]) {
    const watcher = watch(resolve(sourceRoot, path), { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(rebuild, 150);
    });
    watcher.on('error', (error) => console.error(error.message));
    watchers.push(watcher);
  }
}
