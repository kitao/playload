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
import { escapeHTML, renderReference } from './reference.js';

// Module URLs keep the letter case they were loaded with. Native realpath
// canonicalizes it, like the fs/promises realpath used for build outputs.
const root = realpathSync.native(fileURLToPath(new URL('..', import.meta.url)));

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
    // Each bundle carries the notices for the third-party material it contains.
    // Let every build settle before the stage can be removed, even after a failure.
    const builds = await Promise.allSettled([
      build({
        ...options,
        entryPoints: {
          app: 'src/app/main.js',
          'app-style': 'src/app/style.css',
          'site-style': 'src/site/style.css',
        },
        format: 'esm',
        loader: { '.woff': 'file', '.woff2': 'file' },
        banner: {
          js:
            '/*!\n' +
            (await notice('data/fonts/unicode-LICENSE.txt')) +
            '\nPrism: https://prismjs.com/\n' +
            (await notice('node_modules/prismjs/LICENSE')) +
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
        banner: { js: '/*!\n' + (await notice('node_modules/prettier/LICENSE')) + '\n*/' },
      }),
      // The introduction runs this as a classic script before rendering; keep its names local.
      build({ ...options, entryPoints: { site: 'src/site/main.js' }, format: 'iife' }),
    ]);
    const failure = builds.find(({ status }) => status === 'rejected');
    if (failure) throw failure.reason;
    const warnings = builds.flatMap(({ value }) => value.warnings);
    if (warnings.length)
      throw new Error((await formatMessages(warnings, { kind: 'warning' })).join(''));
    for (const name of ['logo.svg', 'favicon.svg'])
      await cp(
        new URL('../assets/' + name, import.meta.url),
        new URL('playload/assets/' + name, output),
      );
    // The .txt extension gives the license its text/plain type without a Content-Type rule.
    await cp(new URL('../LICENSE', import.meta.url), new URL('playload/LICENSE.txt', output));
    await cp(new URL('../src/site/_headers', import.meta.url), new URL('_headers', output));
    // The social preview shows the first homepage screenshot.
    const preview = 'assets/images/example-glyph-quest.png';
    const common = {
      HOME_URL: escapeHTML(homepage.href),
      PREVIEW_IMAGE: escapeHTML(new URL(preview, homepage).href),
      APP_URL: escapeHTML(new URL(app, homepage).href),
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
      REFERENCE: await renderReference(),
    });
    const images = new Set([preview]);
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

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [directory = join(root, 'dist'), ...extra] = process.argv.slice(2);
  if (extra.length) throw new Error('Usage: node scripts/build.js [output directory]');
  await buildSite({ directory });
  console.log(`Built Playload in ${join(directory, 'playload')}.`);
}
