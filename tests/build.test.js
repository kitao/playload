import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cp,
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
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { buildSite } from '../scripts/build.js';

async function files(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
    const path = join(prefix, entry.name);
    result.push(...(entry.isDirectory() ? await files(directory, path) : [path]));
  }
  return result;
}

test('the complete publication stays under Playload and every local document link resolves', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'playload-build-test-'));
  const directory = join(parent, 'dist');
  try {
    await buildSite({ directory });
    const output = await files(directory);
    assert(output.every((path) => path === '_headers' || path.startsWith('playload/')));
    assert(
      !output.some(
        (path) => path.startsWith('playload/user-guide/') || path === 'playload/README.md',
      ),
    );
    assert(
      output.every((path) =>
        /^(?:_headers|playload\/(?:index\.html|app\/index\.html|404\.html|LICENSE|assets\/(?:logo\.svg|favicon\.svg|images\/(?:example-glyph-quest|info-api|info-emoji|info-examples)(?:@2x)?\.png|bundles\/[^/]+\.(?:js|css|woff))))$/.test(
          path,
        ),
      ),
      'Only the introduction, app, required assets, fallback and project license are published.',
    );
    const home = await readFile(join(directory, 'playload/index.html'), 'utf8');
    const app = await readFile(join(directory, 'playload/app/index.html'), 'utf8');
    const headers = await readFile(join(directory, '_headers'), 'utf8');
    for (const [path, document] of [
      ['/playload/', home],
      ['/playload/app/', app],
    ]) {
      const rule = headers.split('\n' + path + '\n')[1].split('\n\n')[0];
      assert.equal(
        /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(document)[1],
        /Content-Security-Policy: ([^\n]+)/.exec(rule)[1].replace("; frame-ancestors 'none'", ''),
        'The document and HTTP response permit the same sources at ' + path,
      );
    }
    assert.doesNotMatch(home, /id="editor"|\/bundles\/app-/);
    assert.match(home, /href="\/playload\/app\/">Open Playload/);
    assert.doesNotMatch(home, /Run locally|ローカルで実行する|git clone|npm run dev/);
    assert.match(
      home,
      /href="https:\/\/github.com\/kitao\/playload\/blob\/main\/data\/fonts\/unicode-LICENSE.txt"/,
    );
    assert.match(app, /id="about-tab"[\s\S]*id="api-tab"/);
    assert.equal((home.match(/<script /g) || []).length, 1);
    assert.match(home, /src="\/playload\/assets\/bundles\/site-[A-Z0-9]+\.js"/);
    assert.equal((app.match(/<script /g) || []).length, 1);
    assert.match(app, /src="\/playload\/assets\/bundles\/app-[A-Z0-9]+\.js"/);
    assert.match(home, /https:\/\/ko-fi.com\/H2H27VDKD/);
    assert.match(home, /href="https:\/\/github.com\/kitao\/playload"/);
    assert.match(home, /href="https:\/\/github.com\/sponsors\/kitao"/);
    assert.doesNotMatch(home, /NOTICE|Resource notices|制作履歴|Test material/);
    const script = await readFile(
      join(
        directory,
        output.find((path) => /\/app-[A-Z0-9]+\.js$/.test(path)),
      ),
      'utf8',
    );
    for (const path of [
      'data/fonts/unicode-LICENSE.txt',
      'node_modules/prismjs/LICENSE',
      'node_modules/prettier/LICENSE',
    ]) {
      const license = await readFile(new URL('../' + path, import.meta.url), 'utf8');
      assert(script.includes(license), 'The bundle retains the original notice: ' + path);
    }
    assert.match(script, /Twemoji color reference: Twitter and contributors\./);
    assert.match(script, /https:\/\/creativecommons.org\/licenses\/by\/4\.0\//);
    const styles = output.filter((path) => path.endsWith('.css'));
    for (const path of styles) {
      const css = await readFile(join(directory, path), 'utf8');
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
        if (target.origin !== 'https://kitao.dev') continue;
        assert(target.pathname.startsWith('/playload/'), target.href);
        const destination = target.pathname.endsWith('/')
          ? target.pathname + 'index.html'
          : target.pathname;
        assert((await stat(join(directory, destination))).isFile(), target.href);
        if (target.hash && destination.endsWith('.html')) {
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

test('build rejects source directories and preserves existing output when source compilation fails', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'playload-build-failure-'));
  const fixture = join(parent, 'repository');
  try {
    await mkdir(join(fixture, 'scripts'), { recursive: true });
    for (const path of ['scripts/build.js', 'scripts/reference.js', 'package.json']) {
      await cp(new URL('../' + path, import.meta.url), join(fixture, path));
    }
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
    const { buildSite } = await import(pathToFileURL(join(fixture, 'scripts/build.js')));
    await mkdir(join(fixture, 'src'));
    await writeFile(join(fixture, 'src/keep.txt'), 'Original source');
    for (const directory of [fixture, join(fixture, 'src'), parent]) {
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
