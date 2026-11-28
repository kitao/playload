import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { execFile, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { runInNewContext } from 'node:vm';
import { deflateRawSync } from 'node:zlib';
import { buildSite } from '../scripts/build.js';
import { decode } from '../src/payload.js';

async function files(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
    const path = join(prefix, entry.name);
    result.push(...(entry.isDirectory() ? await files(directory, path) : [path]));
  }
  return result;
}

test('a script on standard input can import the site builder', () => {
  const url = new URL('../scripts/build.js', import.meta.url);
  execFileSync(process.execPath, ['--input-type=module', '-'], {
    input: `import { buildSite } from ${JSON.stringify(url.href)};\n`,
  });
});

test('the complete publication stays under Playload and every local document link resolves', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'playload-build-test-'));
  const directory = join(parent, 'dist');
  try {
    await buildSite({ directory });
    const output = await files(directory);
    assert(
      output.every((path) =>
        /^(?:_headers|playload\/(?:index\.html|(?:app|arcade(?:\/page\/[1-9]\d*)?|app\/sandbox)\/index\.html|LICENSE\.txt|assets\/(?:(?:arcade-)?logo\.svg|favicon\.svg|images\/(?:(?:example-glyph-quest|info-api|info-emoji|info-examples)(?:@2x)?|app-card|arcade\/[a-z0-9-]+)\.png|bundles\/[^/]+\.(?:js|css|woff2?))))$/.test(
          path,
        ),
      ),
      'Only the introduction, app, arcade, required assets, fonts and project license are published.',
    );
    const home = await readFile(join(directory, 'playload/index.html'), 'utf8');
    const app = await readFile(join(directory, 'playload/app/index.html'), 'utf8');
    const arcade = await readFile(join(directory, 'playload/arcade/index.html'), 'utf8');
    // Content policies come only from _headers, which the browser checks serve as Cloudflare does.
    for (const document of [home, app, arcade])
      assert.doesNotMatch(document, /http-equiv="Content-Security-Policy"/);
    // App links use the logo while the introduction retains its screenshot; both are static.
    for (const document of [home, app, arcade]) {
      const meta = (property) =>
        new RegExp(`<meta (?:property|name)="${property}" content="([^"]+)"`).exec(document)?.[1];
      assert.equal(meta('twitter:card'), 'summary_large_image');
      assert.equal(meta('og:url'), /rel="canonical" href="([^"]+)"/.exec(document)[1]);
      const image = new URL(meta('og:image'));
      assert.equal(
        image.href,
        `https://kitao.dev/playload/assets/images/${document === home ? 'example-glyph-quest' : 'app-card'}.png`,
      );
      const png = await readFile(join(directory, image.pathname));
      assert.deepEqual(
        [png.readUInt32BE(16), png.readUInt32BE(20)],
        [Number(meta('og:image:width')), Number(meta('og:image:height'))],
      );
    }
    assert.doesNotMatch(home, /id="editor"/);
    // The introduction loads Noto Sans JP from Google Fonts; the app bundles its font.
    assert.match(home, /href="https:\/\/fonts\.googleapis\.com\/css2\?family=Noto\+Sans\+JP/);
    assert.doesNotMatch(app, /fonts\.googleapis\.com/);
    assert.match(home, /href="\/playload\/app\/">Open Playload/);
    assert.doesNotMatch(home, /Run locally|ローカルで実行する|git clone|npm run dev/);
    assert.match(home, /href="https:\/\/www.unicode.org\/license.txt"/);
    assert.match(app, /id="about-tab"[\s\S]*id="api-tab"/);
    assert.equal((home.match(/<script /g) || []).length, 1);
    assert.match(home, /src="\/playload\/assets\/bundles\/site\.js"/);
    assert.equal((app.match(/<script /g) || []).length, 1);
    assert.match(app, /src="\/playload\/assets\/bundles\/app\.js"/);
    const font =
      /rel="preload"\s+href="([^"]+\.woff2)"\s+as="font"\s+type="font\/woff2"\s+crossorigin/.exec(
        app,
      )?.[1];
    assert(font, 'The app preloads its bundled UI font.');
    assert.deepEqual(
      await readFile(join(directory, font)),
      await readFile(new URL('../src/app/jetbrains-mono.woff2', import.meta.url)),
    );
    assert.match(home, /https:\/\/ko-fi.com\/H2H27VDKD/);
    assert.match(home, /href="https:\/\/github.com\/kitao\/playload"/);
    assert.match(home, /href="https:\/\/github.com\/sponsors\/kitao"/);
    assert.doesNotMatch(home, /NOTICE|Resource notices|制作履歴|Test material/);

    const bundle = (name) =>
      readFile(
        join(
          directory,
          output.find((path) => new RegExp(`/${name}\\.js$`).test(path)),
        ),
        'utf8',
      );

    const notices = Object.fromEntries(
      await Promise.all(
        [
          'data/fonts/unicode-LICENSE.txt',
          'node_modules/prismjs/LICENSE',
          'node_modules/prettier/LICENSE',
        ].map(async (path) => [
          path,
          await readFile(new URL('../' + path, import.meta.url), 'utf8'),
        ]),
      ),
    );
    // Each bundle retains the original notices for the material it contains, and only those.
    for (const [name, included] of [
      ['app', ['data/fonts/unicode-LICENSE.txt']],
      ['highlighter', ['node_modules/prismjs/LICENSE']],
      ['formatter', ['node_modules/prettier/LICENSE']],
      ['site', []],
    ]) {
      const script = await bundle(name);
      for (const [path, license] of Object.entries(notices))
        assert.equal(script.includes(license), included.includes(path), `${name} bundle: ${path}`);
      assert.equal(
        /Twemoji color reference: Twitter and contributors\.[^]*creativecommons\.org\/licenses\/by\/4\.0\//.test(
          script,
        ),
        name === 'app',
        `${name} bundle: Twemoji`,
      );
    }
    // The introduction runs its script before rendering as a classic script, which
    // shares one global scope with every other script on the page.
    const site = await bundle('site');
    const page = {
      navigator: { languages: ['ja-JP'] },
      localStorage: { getItem: () => null },
      location: { hash: '' },
      document: { documentElement: {}, querySelectorAll: () => [], addEventListener() {} },
      addEventListener() {},
    };
    page.window = page;
    const globals = Object.keys(page);
    runInNewContext(site, page);
    assert.equal(page.document.documentElement.lang, 'ja');
    assert.deepEqual(Object.keys(page), globals, 'The introduction script adds no global names.');
    const styles = output.filter((path) => path.endsWith('.css'));
    for (const path of styles) {
      const css = await readFile(join(directory, path), 'utf8');
      // The browser targets give Safari the prefixed user-select it still needs.
      assert.equal(
        css.match(/(?<!-)user-select:/g)?.length,
        css.match(/-webkit-user-select:/g)?.length,
      );
      // Both stylesheets bundle JetBrains Mono, so both carry its notice.
      if (path.endsWith('-style.css')) {
        assert.match(css, /Copyright 2020 The JetBrains Mono Project Authors/);
        assert.match(css, /SIL OPEN FONT LICENSE Version 1\.1 - 26 February 2007/);
      }
      for (const [, url] of css.matchAll(/url\(([^)]+)\)/g)) {
        const target = new URL(url.replaceAll('"', ''), 'https://kitao.dev/' + path);
        assert((await stat(join(directory, target.pathname))).isFile(), target.href);
      }
    }
    for (const path of output.filter((path) => path.endsWith('.html'))) {
      const html = await readFile(join(directory, path), 'utf8');
      assert.doesNotMatch(html, /\{\{[A-Z_]+\}\}/);
      const ids = Array.from(html.matchAll(/\bid="([^"]+)"/g), (match) => match[1]);
      assert.equal(new Set(ids).size, ids.length, 'Duplicate document IDs in ' + path);
      for (const [, href] of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
        const target = new URL(href.replaceAll('&amp;', '&'), 'https://kitao.dev/' + path);
        // The root homepage is hosted separately from Playload's published files.
        if (target.origin !== 'https://kitao.dev' || target.href === 'https://kitao.dev/') continue;
        assert(target.pathname.startsWith('/playload/'), target.href);
        const destination = target.pathname.endsWith('/')
          ? target.pathname + 'index.html'
          : target.pathname;
        assert((await stat(join(directory, destination))).isFile(), target.href);
        if (target.hash && destination.endsWith('.html')) {
          if (target.pathname === '/playload/app/') {
            assert((await decode(target.hash)).length, 'Arcade game URLs contain readable code.');
            continue;
          }
          const document = await readFile(join(directory, destination), 'utf8');
          assert(
            document.includes('id="' + decodeURIComponent(target.hash.slice(1)) + '"'),
            target.href,
          );
        }
      }
    }
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test('every license list links the bundled Prism and Prettier releases', async () => {
  for (const [name, link] of [
    ['prismjs', (version) => `https://github.com/PrismJS/prism/blob/v${version}/LICENSE`],
    ['prettier', (version) => `https://github.com/prettier/prettier/blob/${version}/LICENSE`],
  ]) {
    const { version } = JSON.parse(
      await readFile(new URL(`../node_modules/${name}/package.json`, import.meta.url), 'utf8'),
    );
    for (const source of ['src/site/index.md', 'src/site/index.html', 'src/app/index.html']) {
      const document = await readFile(new URL('../' + source, import.meta.url), 'utf8');
      assert(document.includes(link(version)), `${source} links ${name} ${version}`);
    }
  }
});

test('a failed output replacement restores every previous publication file', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'playload-build-rollback-'));
  const directory = join(await realpath(parent), 'dist');
  try {
    await buildSite({ directory });

    const snapshot = async () =>
      Promise.all(
        (await files(directory))
          .sort()
          .map(async (path) => [path, await readFile(join(directory, path))]),
      );

    const previous = await snapshot();
    // Inject the filesystem failure in a separate process, without changing other tests' imports.
    await promisify(execFile)(process.execPath, [
      '--input-type=module',
      '-e',
      `
      import assert from 'node:assert/strict';
      import fs from 'node:fs/promises';
      import { syncBuiltinESMExports } from 'node:module';
      import { buildSite } from ${JSON.stringify(new URL('../scripts/build.js', import.meta.url).href)};
      const directory = process.argv[1];
      const rename = fs.rename;
      fs.rename = async (source, target) => {
        if (target === directory && !source.endsWith('-previous')) {
          fs.rename = rename;
          syncBuiltinESMExports();
          throw new Error('Simulated output replacement failure');
        }
        return rename(source, target);
      };
      syncBuiltinESMExports();
      await assert.rejects(buildSite({ directory }), /Simulated output replacement failure/);
    `,
      directory,
    ]);
    assert.deepEqual(await snapshot(), previous);
    assert.deepEqual(await readdir(parent), ['dist']);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

// A copy whose build fails before replacing anything, so a broken guard cannot remove real files.
async function fixtureRepository(parent) {
  const fixture = join(parent, 'repository');
  await mkdir(join(fixture, 'scripts'), { recursive: true });
  for (const path of [
    'scripts/build.js',
    'scripts/reference.js',
    'scripts/arcade-pages.js',
    'package.json',
  ])
    await cp(new URL('../' + path, import.meta.url), join(fixture, path));
  await mkdir(join(fixture, 'data/fonts'), { recursive: true });
  await cp(
    new URL('../data/fonts/unicode-LICENSE.txt', import.meta.url),
    join(fixture, 'data/fonts/unicode-LICENSE.txt'),
  );
  await symlink(
    fileURLToPath(new URL('../node_modules', import.meta.url)),
    join(fixture, 'node_modules'),
    'dir',
  );
  await mkdir(join(fixture, 'src'));
  await mkdir(join(fixture, 'src/engine'));
  await cp(
    new URL('../src/engine/glyphs.js', import.meta.url),
    join(fixture, 'src/engine/glyphs.js'),
  );
  await cp(new URL('../src/payload.js', import.meta.url), join(fixture, 'src/payload.js'));
  await writeFile(join(fixture, 'src/keep.txt'), 'Original source');
  return fixture;
}

test('an Arcade build rejects unreadable and over-budget links before replacing the site', async (t) => {
  const parent = await mkdtemp(join(tmpdir(), 'playload-arcade-build-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const fixture = await fixtureRepository(parent);
  await mkdir(join(fixture, 'assets'));
  for (const path of [
    'src',
    'assets/logo.svg',
    'assets/arcade-logo.svg',
    'assets/favicon.svg',
    'data/reference.json',
    'LICENSE',
  ])
    await cp(new URL('../' + path, import.meta.url), join(fixture, path), { recursive: true });
  const { buildSite } = await import(pathToFileURL(join(fixture, 'scripts/build.js')));
  const [game] = JSON.parse(
    await readFile(new URL('../data/arcade.json', import.meta.url), 'utf8'),
  );
  const directory = join(fixture, 'dist');
  await mkdir(directory);
  await writeFile(join(directory, 'keep.txt'), 'Previous publication');
  // This stored deflate block is 3001 bytes. A legacy reader still accepts it.
  const oversized = deflateRawSync(' '.repeat(2996), { level: 0 });
  assert.equal(oversized.length, 3001);
  for (const [hash, reason] of [
    ['#v1.A', /unreadable game URL/],
    ['#1.' + oversized.toString('base64url'), /exceeds the shared game limit/],
  ]) {
    await writeFile(
      join(fixture, 'data/arcade.json'),
      JSON.stringify([{ ...game, url: '/playload/app/' + hash }]),
    );
    await assert.rejects(buildSite({ directory }), reason);
    assert.equal(await readFile(join(directory, 'keep.txt'), 'utf8'), 'Previous publication');
  }
});

test('an Arcade catalog crossing a page boundary builds linked static documents', async (t) => {
  const parent = await mkdtemp(join(tmpdir(), 'playload-arcade-pages-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const fixture = await fixtureRepository(parent);
  for (const path of ['src', 'assets', 'data/reference.json', 'LICENSE'])
    await cp(new URL('../' + path, import.meta.url), join(fixture, path), { recursive: true });
  const { ARCADE_PAGE_SIZE } = await import('../scripts/arcade-pages.js');
  const [game] = JSON.parse(
    await readFile(new URL('../data/arcade.json', import.meta.url), 'utf8'),
  );
  const games = Array.from({ length: ARCADE_PAGE_SIZE + 1 }, (_, i) => ({
    ...game,
    title: `Game ${i + 1}`,
  }));
  await writeFile(join(fixture, 'data/arcade.json'), JSON.stringify(games));
  const { buildSite: buildFixture } = await import(
    pathToFileURL(join(fixture, 'scripts/build.js'))
  );
  const directory = join(parent, 'dist');
  await buildFixture({ directory });
  const first = await readFile(join(directory, 'playload/arcade/index.html'), 'utf8');
  const second = await readFile(join(directory, 'playload/arcade/page/2/index.html'), 'utf8');
  assert.equal((first.match(/class="game-link"/g) || []).length, ARCADE_PAGE_SIZE);
  assert.equal((second.match(/class="game-link"/g) || []).length, 1);
  assert.match(first, /href="\/playload\/arcade\/page\/2\/" rel="next"/);
  assert.match(second, /href="\/playload\/arcade\/" rel="prev"/);
  assert.match(second, /<title>Playload Arcade — Page 2<\/title>/);
  assert.match(second, /rel="canonical" href="https:\/\/kitao.dev\/playload\/arcade\/page\/2\/"/);
  assert.match(
    second,
    /property="og:url" content="https:\/\/kitao.dev\/playload\/arcade\/page\/2\/"/,
  );
  assert.equal((second.match(/aria-current="page"/g) || []).length, 2);
  assert.match(second, new RegExp(`game-title">Game ${ARCADE_PAGE_SIZE + 1}<`));
  assert(!existsSync(join(directory, 'playload/arcade/page/1')));
  assert(!existsSync(join(directory, 'playload/arcade/page/3')));
});

test('build rejects source directories and preserves existing output when source compilation fails', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'playload-build-failure-'));
  try {
    const fixture = await fixtureRepository(parent);
    const { buildSite } = await import(pathToFileURL(join(fixture, 'scripts/build.js')));
    for (const directory of [fixture, join(fixture, 'src'), parent, parse(parent).root]) {
      await assert.rejects(
        buildSite({ directory }),
        /Build output must be dist\/ or outside the repository/,
      );
    }
    assert.equal(await readFile(join(fixture, 'src/keep.txt'), 'utf8'), 'Original source');
    const directory = join(fixture, 'dist');
    await mkdir(directory);
    await writeFile(join(directory, 'keep.txt'), 'Previous publication');
    await assert.rejects(buildSite({ directory }), /Build failed/);
    assert.equal(await readFile(join(directory, 'keep.txt'), 'utf8'), 'Previous publication');
    assert(!(await readdir(fixture)).some((path) => path.startsWith('.playload-build-')));
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test('a failing bundle leaves no staging directory behind its slower sibling builds', async (t) => {
  const parent = await mkdtemp(join(tmpdir(), 'playload-build-partial-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const fixture = await fixtureRepository(parent);
  // The real sources, with only the quickly bundled introduction script broken.
  await cp(new URL('../src/', import.meta.url), join(fixture, 'src'), { recursive: true });
  await writeFile(join(fixture, 'src/site/main.js'), 'export const broken = ;\n');
  const { buildSite } = await import(pathToFileURL(join(fixture, 'scripts/build.js')));
  await assert.rejects(buildSite({ directory: join(fixture, 'dist') }), /Build failed/);
  // Nothing may write into the removed stage after the failure is reported.
  await new Promise((resolve) => setTimeout(resolve, 1000));
  assert.deepEqual(
    (await readdir(fixture)).filter((name) => name.startsWith('.playload-build-')),
    [],
  );
});

test('a bundler warning fails the build and is reported once, without esbuild logs', async (t) => {
  const parent = await mkdtemp(join(tmpdir(), 'playload-build-warning-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const fixture = await fixtureRepository(parent);
  await cp(new URL('../src/', import.meta.url), join(fixture, 'src'), { recursive: true });
  await writeFile(join(fixture, 'src/site/main.js'), 'export const value = { a: 1, a: 2 };\n');
  const failure = await promisify(execFile)(process.execPath, [
    join(fixture, 'scripts/build.js'),
    join(parent, 'output'),
  ]).catch((error) => error);
  assert.equal(failure.code, 1);
  assert.equal(failure.stderr.match(/Duplicate key "a" in object literal/g)?.length, 1);
  assert(!existsSync(join(parent, 'output')));
});

test('build output checks see through letter-case aliases of the repository', async (t) => {
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'playload-build-alias-')));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const fixture = await fixtureRepository(parent);
  const alias = join(parent, 'REPOSITORY');
  if (!existsSync(alias)) {
    t.skip('This file system distinguishes letter case.');
    return;
  }
  // Import through the alias, like a shell whose working directory differs only in case.
  const { buildSite } = await import(pathToFileURL(join(alias, 'scripts/build.js')));
  for (const directory of [
    fixture,
    alias,
    join(fixture, 'src'),
    join(alias, 'src'),
    join(fixture, 'SRC'),
    join(fixture, 'missing'),
    parent.toUpperCase(),
  ]) {
    await assert.rejects(
      buildSite({ directory }),
      /Build output must be dist\/ or outside the repository/,
      directory,
    );
  }
  assert.equal(await readFile(join(fixture, 'src/keep.txt'), 'utf8'), 'Original source');
});

test('a symlinked output path is replaced as a link, never written through', async (t) => {
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'playload-build-link-')));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const outside = join(parent, 'outside'),
    directory = join(parent, 'dist');
  await mkdir(outside);
  await writeFile(join(outside, 'keep.txt'), 'Unrelated files');
  await symlink(outside, directory, 'dir');
  await buildSite({ directory });
  assert((await lstat(directory)).isDirectory());
  assert((await stat(join(directory, 'playload/index.html'))).isFile());
  assert.deepEqual(await readdir(outside), ['keep.txt']);
  assert.deepEqual((await readdir(parent)).sort(), ['dist', 'outside']);
});
