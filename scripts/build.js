import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { basename } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = new URL('../dist/', import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

const { metafile } = await build({
  absWorkingDir: root,
  entryPoints: ['src/app.js', 'src/style.css'],
  outdir: 'dist',
  entryNames: '[name]-[hash]',
  assetNames: '[name]-[hash]',
  bundle: true,
  minify: true,
  format: 'esm',
  target: 'es2022',
  charset: 'utf8',
  loader: { '.woff': 'file' },
  define: { module: 'undefined' },
  legalComments: 'inline',
  metafile: true,
});

function asset(entry) {
  const [path] = Object.entries(metafile.outputs).find(
    ([, details]) => details.entryPoint?.replaceAll('\\', '/') === entry,
  );
  return basename(path);
}

const html = (await readFile(new URL('../index.html', import.meta.url), 'utf8'))
  .replace(/^\s*<link rel="modulepreload"[^>]+>\s*$/gm, '')
  .replace(/src\/app\.js\?v=\d+/, asset('src/app.js'))
  .replace(/src\/style\.css\?v=\d+/, asset('src/style.css'));
await writeFile(new URL('index.html', output), html);
for (const name of ['logo.svg', 'favicon.svg', 'LICENSE']) {
  await cp(new URL('../' + name, import.meta.url), new URL(name, output));
}

const notices = [
  'data/fonts/public-pixel-LICENSE.txt',
  'data/fonts/unscii-README.md',
  'data/fonts/unscii-sources.txt',
  'data/fonts/misaki.txt',
  'data/fonts/twemoji-color-LICENSE.txt',
  'data/fonts/unicode-LICENSE.txt',
  'data/fonts/press-start-2p-OFL.txt',
  'data/fonts/press-start-2p-FONTLOG.txt',
  'node_modules/prismjs/LICENSE',
];
const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
let notice =
  'Playload resources and source: https://github.com/kitao/playload\n\n' +
  readme.slice(readme.indexOf('## License\n'));
for (const path of notices) {
  notice += '\n' + path + '\n\n' + (await readFile(new URL('../' + path, import.meta.url), 'utf8'));
}
await writeFile(new URL('NOTICE.txt', output), notice);
console.log('Built Playload in dist/.');
