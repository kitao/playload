import { build, formatMessages } from 'esbuild';
import { realpathSync } from 'node:fs';
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, parse, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { marked } from 'marked';
import { formatPayloadSize } from '../src/payload.js';
import { escapeHTML, renderReference } from './reference.js';

// Module URLs keep the letter case they were loaded with. Native realpath
// canonicalizes it, like the fs/promises realpath used for build outputs.
const root = realpathSync.native(fileURLToPath(new URL('..', import.meta.url)));

export async function buildSite({ directory = join(root, 'dist') } = {}) {
  directory = await outputDirectory(directory);
  await mkdir(dirname(directory), { recursive: true });
  const stage = await mkdtemp(join(dirname(directory), '.playload-build-'));
  const output = pathToFileURL(stage + '/');
  try {
    const project = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    const homepage = new URL(project.homepage);
    if (homepage.pathname !== '/playload/')
      throw new Error('The stable publication path must remain /playload/.');
    const base = homepage.pathname;
    const app = base + 'app/';
    const repository = project.repository.url.replace(/\.git$/, '');
    await mkdir(new URL('playload/', output), { recursive: true });

    const options = {
      absWorkingDir: root,
      outdir: join(stage, 'playload/assets/bundles'),
      // Fixed names: responses revalidate, so content hashes are unnecessary.
      entryNames: '[name]',
      assetNames: '[name]',
      bundle: true,
      minify: true,
      // The oldest browsers with every platform feature the app uses: the file input's cancel
      // event in Chrome 113, Intl.Segmenter in Firefox 125 and CompressionStream('deflate-raw')
      // in Safari 16.4. esbuild then adds the vendor prefixes they require.
      target: ['chrome113', 'firefox125', 'safari16.4'],
      charset: 'utf8',
      legalComments: 'inline',
      // The caller reports failures once, and warnings fail the build below.
      logLevel: 'silent',
    };
    const notice = async (path) => readFile(new URL('../' + path, import.meta.url), 'utf8');
    const unicodeNotice = await notice('data/fonts/unicode-LICENSE.txt'),
      prismNotice = await notice('node_modules/prismjs/LICENSE'),
      prettierNotice = await notice('node_modules/prettier/LICENSE');
    // Each bundle carries the notices for the third-party material it contains.
    // Let every build settle before the stage can be removed, even after a failure.
    const builds = await Promise.allSettled([
      build({
        ...options,
        entryPoints: {
          app: 'src/app/main.js',
          'app-style': 'src/app/style.css',
          'site-style': 'src/site/style.css',
          'arcade-style': 'src/arcade/style.css',
        },
        format: 'esm',
        loader: { '.woff': 'file', '.woff2': 'file' },
        banner: {
          js:
            '/*!\n' +
            unicodeNotice +
            '\nPrism: https://prismjs.com/\n' +
            prismNotice +
            '\nTwemoji color reference: Twitter and contributors.\n' +
            'https://github.com/jdecked/twemoji\n' +
            'Used to derive emoji colors. Licensed under CC BY 4.0, provided as-is:\n' +
            'https://creativecommons.org/licenses/by/4.0/\n*/',
        },
      }),
      build({
        ...options,
        entryPoints: { formatter: 'src/app/formatter.js' },
        format: 'esm',
        banner: { js: '/*!\n' + prettierNotice + '\n*/' },
      }),
      // The introduction runs this as a classic script before rendering; keep its names local.
      build({ ...options, entryPoints: { site: 'src/site/main.js' }, format: 'iife' }),
    ]);
    const failure = builds.find(({ status }) => status === 'rejected');
    if (failure) throw failure.reason;
    const warnings = builds.flatMap(({ value }) => value.warnings);
    if (warnings.length)
      throw new Error((await formatMessages(warnings, { kind: 'warning' })).join(''));

    for (const name of ['logo.svg', 'arcade-logo.svg', 'favicon.svg'])
      await cp(
        new URL('../assets/' + name, import.meta.url),
        new URL('playload/assets/' + name, output),
      );
    // The .txt extension gives the license its text/plain type without a Content-Type rule.
    await cp(new URL('../LICENSE', import.meta.url), new URL('playload/LICENSE.txt', output));
    await cp(new URL('../src/site/_headers', import.meta.url), new URL('_headers', output));

    // The introduction keeps its screenshot; app/game links identify the tool with its logo.
    const preview = 'assets/images/example-glyph-quest.png';
    const appPreview = 'assets/images/app-card.png';
    const common = {
      HOME_URL: escapeHTML(homepage.href),
      PREVIEW_IMAGE: escapeHTML(new URL(preview, homepage).href),
      APP_URL: escapeHTML(new URL(app, homepage).href),
      ARCADE_URL: escapeHTML(new URL('arcade/', homepage).href),
      VERSION: escapeHTML(project.version),
      DESCRIPTION: escapeHTML(project.description),
    };

    async function page(source, destination, values) {
      const template = await readFile(new URL('../' + source, import.meta.url), 'utf8');
      const target = new URL('playload/' + destination, output);
      await mkdir(new URL('.', target), { recursive: true });
      await writeFile(target, fill(template, { ...common, ...values }));
    }

    await page('src/app/index.html', 'app/index.html', {
      PREVIEW_IMAGE: escapeHTML(new URL(appPreview, homepage).href),
      REFERENCE: await renderReference(),
    });
    const images = new Set([preview, appPreview]);
    const games = JSON.parse(
      await readFile(new URL('../data/arcade.json', import.meta.url), 'utf8'),
    );
    // Date of the selected version's release post, not a later repost of the same URL.
    // Undated built-in samples stay at the end in their original order.
    for (const game of games)
      if (
        game.publishedAt !== undefined &&
        (typeof game.publishedAt !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(game.publishedAt) ||
          !Number.isFinite(Date.parse(game.publishedAt)) ||
          new Date(game.publishedAt).toISOString() !== game.publishedAt)
      )
        throw new Error(`Arcade entry ${game.title} needs a valid UTC publishedAt date.`);
    games.sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
    const cards = games.map((game, index) => {
      for (const field of ['title', 'url', 'image', 'author', 'authorUrl'])
        if (typeof game[field] !== 'string' || !game[field].trim())
          throw new Error(`Arcade entry ${index + 1} needs ${field}.`);
      const url = new URL(game.url, homepage);
      if (
        url.origin !== homepage.origin ||
        url.pathname !== app ||
        url.search ||
        !/^#(?:v1|1)\.[A-Za-z0-9_-]+$/.test(url.hash)
      )
        throw new Error(`Arcade entry ${index + 1} needs a shared Playload game URL.`);
      if (!/^https:\/\/x\.com\/[A-Za-z0-9_]{1,15}$/.test(game.authorUrl))
        throw new Error(`Arcade entry ${index + 1} needs an X profile URL.`);
      if (!/^assets\/images\/arcade\/[a-z0-9-]+\.png$/.test(game.image))
        throw new Error(`Arcade entry ${index + 1} needs a local PNG screenshot.`);
      images.add(game.image);
      const bytes = Buffer.from(url.hash.split('.')[1], 'base64url').length;
      return `<li>
        <a class="game-link" href="${escapeHTML(url.pathname + url.hash)}" target="_blank" rel="noopener">
          <img src="${escapeHTML(base + game.image)}" alt="" width="160" height="144" loading="lazy" decoding="async" />
          <span class="game-heading">
            <span class="game-title">${escapeHTML(game.title)}</span>
            <span class="game-size" title="Compressed size: ${bytes} bytes">${formatPayloadSize(bytes)}</span>
          </span>
        </a>
        <div class="game-meta">
          <p class="game-author">by <a href="${escapeHTML(game.authorUrl)}" target="_blank" rel="noopener">${escapeHTML(game.author)}</a></p>
        </div>
      </li>`;
    });
    await page('src/arcade/index.html', 'arcade/index.html', {
      PREVIEW_IMAGE: escapeHTML(new URL(appPreview, homepage).href),
      GAMES: cards.join('\n'),
    });
    const introduction = marked
      .parse(await readFile(new URL('../src/site/index.md', import.meta.url), 'utf8'))
      .replace(
        /<p align="center">(\s*<img\b[^>]*\balt="Playload"[^>]*>\s*)<\/p>/,
        '<h1 align="center">$1</h1>',
      )
      .replace(/<h3 align="center">([\s\S]*?)<\/h3>/, '<p class="app-link" align="center">$1</p>')
      .replace(/\b(href|src)="([^"]+)"/g, (attribute, name, href) => {
        if (href === new URL(app, homepage).href) return `${name}="${app}"`;
        if (/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(href)) return attribute;
        if (href.startsWith('assets/')) {
          images.add(href);
          return `${name}="${base + href}"`;
        }
        return `${name}="${escapeHTML(href === 'LICENSE' ? base + 'LICENSE.txt' : repository + '/blob/main/' + href)}"`;
      })
      .replace(
        /<img src="([^"]*\/images\/[^"]+)"/g,
        '<img loading="lazy" decoding="async" src="$1"',
      );
    for (const image of images) {
      const target = new URL('playload/' + image, output);
      await mkdir(new URL('.', target), { recursive: true });
      await cp(new URL('../' + image, import.meta.url), target);
    }
    await page('src/site/index.html', 'index.html', {
      INTRODUCTION: introduction,
    });

    const backup = stage + '-previous';
    let previous = false;
    try {
      await rename(directory, backup);
      previous = true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    try {
      await rename(stage, directory);
    } catch (error) {
      if (previous) await rename(backup, directory);
      throw error;
    }
    if (previous) await rm(backup, { recursive: true, force: true });
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

function fill(template, values) {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_, name) => {
    if (!(name in values)) throw new Error('Unknown template field: ' + name);
    return values[name];
  });
}

async function canonicalDirectory(path) {
  try {
    return await realpath(path);
  } catch (error) {
    if (error.code !== 'ENOENT' || dirname(path) === path) throw error;
    return join(await canonicalDirectory(dirname(path)), basename(path));
  }
}

// Canonicalize symlinks and letter case so no alias of the sources passes.
// A symlink at the output path itself stays unresolved: the build replaces
// that link and never writes into the directory it points to.
async function outputDirectory(path) {
  const requested = resolve(path);
  let directory = join(await canonicalDirectory(dirname(requested)), basename(requested));
  const details = await lstat(directory).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (details && !details.isSymbolicLink()) directory = await realpath(directory);
  if (
    directory === parse(directory).root ||
    directory === root ||
    root.startsWith(directory + sep) ||
    (directory.startsWith(root + sep) && directory !== join(root, 'dist'))
  )
    throw new Error('Build output must be dist/ or outside the repository.');
  return directory;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [directory = join(root, 'dist'), ...extra] = process.argv.slice(2);
  if (extra.length) throw new Error('Usage: node scripts/build.js [output directory]');
  await buildSite({ directory });
  console.log(`Built Playload in ${join(directory, 'playload')}.`);
}
