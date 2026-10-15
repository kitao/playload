import { build } from 'esbuild';
import { cp, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { marked } from 'marked';
import { escapeHTML, renderReference } from './reference.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

function fill(template, values) {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_, name) => {
    if (!(name in values)) throw new Error('Unknown template field: ' + name);
    return values[name];
  });
}

async function canonicalPath(path) {
  try {
    return await realpath(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return join(await canonicalPath(dirname(path)), basename(path));
  }
}

export async function buildSite({ minify = true, directory = join(root, 'dist') } = {}) {
  directory = await canonicalPath(resolve(directory));
  if (
    directory === root ||
    root.startsWith(directory + sep) ||
    (directory.startsWith(root + sep) && directory !== join(root, 'dist'))
  )
    throw new Error('Build output must be dist/ or outside the repository.');
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

    const { metafile } = await build({
      absWorkingDir: root,
      entryPoints: {
        app: 'src/app/main.js',
        formatter: 'src/app/formatter.js',
        'app-style': 'src/app/style.css',
        'site-style': 'src/site/style.css',
        site: 'src/site/main.js',
      },
      outdir: join(stage, 'playload/assets/bundles'),
      entryNames: '[name]-[hash]',
      assetNames: '[name]-[hash]',
      bundle: true,
      minify,
      format: 'esm',
      target: 'es2022',
      charset: 'utf8',
      loader: { '.woff': 'file' },
      define: { module: 'undefined' },
      legalComments: 'inline',
      banner: {
        js:
          '/*!\n' +
          (await readFile(new URL('../data/fonts/unicode-LICENSE.txt', import.meta.url), 'utf8')) +
          '\nTwemoji color reference: Twitter and contributors.\n' +
          'https://github.com/jdecked/twemoji\n' +
          'Used to derive emoji colors. Licensed under CC BY 4.0, provided as-is:\n' +
          'https://creativecommons.org/licenses/by/4.0/\n\n' +
          (await readFile(new URL('../node_modules/prettier/LICENSE', import.meta.url), 'utf8')) +
          '\n*/',
      },
      metafile: true,
    });
    function asset(entry) {
      const match = Object.entries(metafile.outputs).find(
        ([, details]) => details.entryPoint === entry,
      );
      if (!match) throw new Error('Missing bundled entry: ' + entry);
      return base + 'assets/bundles/' + basename(match[0]);
    }
    for (const name of ['logo.svg', 'favicon.svg'])
      await cp(
        new URL('../assets/' + name, import.meta.url),
        new URL('playload/assets/' + name, output),
      );
    await cp(new URL('../LICENSE', import.meta.url), new URL('playload/LICENSE', output));
    await cp(new URL('../src/site/_headers', import.meta.url), new URL('_headers', output));
    const common = {
      HOME_URL: escapeHTML(homepage.href),
      APP_URL: escapeHTML(new URL(app, homepage).href),
      APP_PATH: app,
      VERSION: escapeHTML(project.version),
      DESCRIPTION: escapeHTML(project.description),
      REPOSITORY: escapeHTML(repository),
      SOURCE_LINK: `<a href="${escapeHTML(repository)}" target="_blank" rel="noopener">Source code</a>`,
      SITE_STYLE: asset('src/site/style.css'),
    };
    async function page(source, destination, values) {
      const template = await readFile(new URL('../' + source, import.meta.url), 'utf8');
      const target = new URL('playload/' + destination, output);
      await mkdir(new URL('.', target), { recursive: true });
      await writeFile(target, fill(template, { ...common, ...values }));
    }
    const reference = await renderReference();
    await page('src/app/index.html', 'app/index.html', {
      APP_SCRIPT: asset('src/app/main.js'),
      FORMAT_SCRIPT: asset('src/app/formatter.js'),
      APP_STYLE: asset('src/app/style.css'),
      REFERENCE: reference.html,
    });
    const images = new Set();
    const readme = marked
      .parse(await readFile(new URL('../README.md', import.meta.url), 'utf8'))
      .replace(/<h2>Run locally<\/h2>[\s\S]*?(?=<h2>|$)/, '')
      .replace(/\b(href|src)="([^"]+)"/g, (attribute, name, href) => {
        if (href === new URL(app, homepage).href) return `${name}="${app}"`;
        if (/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(href)) return attribute;
        if (href.startsWith('assets/')) {
          images.add(href);
          return `${name}="${base + href}"`;
        }
        return `${name}="${escapeHTML(href === 'LICENSE' ? base + href : repository + '/blob/main/' + href)}"`;
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
      README: readme,
      SITE_SCRIPT: asset('src/site/main.js'),
    });
    await page('src/site/404.html', '404.html', {});
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await buildSite();
  console.log('Built Playload in dist/playload/.');
}
