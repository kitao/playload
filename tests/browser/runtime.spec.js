import { baseURL } from '../../playwright.config.js';
import { test as base, expect } from '@playwright/test';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { encode, formatPayloadSize } from '../../src/payload.js';
import { sharedGameSource } from '../fixtures/shared-game.js';
import { WebMBuffer } from '../../src/app/webm.js';
import { request } from 'node:http';

const test = base.extend({
  runtimeErrors: [
    async ({ browser, context }, use) => {
      const errors = [],
        contexts = new Set(),
        report = (error) => errors.push(error.error().message),
        watch = (created) => {
          contexts.add(created);
          created.on('weberror', report);
        };
      watch(context);
      browser.on('context', watch);
      try {
        await use(errors);
        expect(errors).toEqual([]);
      } finally {
        browser.off('context', watch);
        for (const created of contexts) created.off('weberror', report);
      }
    },
    { auto: true },
  ],
});
const execute = promisify(execFile);
const root = fileURLToPath(new URL('../..', import.meta.url));

async function exposeCapture(page) {
  await page.route('**/playload/assets/bundles/app-*.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: (await response.text()) + '\nglobalThis.testCapture = Capture;',
    });
  });
}

async function startServer(...args) {
  const server = spawn(process.execPath, ['scripts/serve.js', '--no-open', ...args], {
    cwd: root,
    env: { ...process.env, PORT: '0' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const url = await new Promise((resolve, reject) => {
    let output = '';
    server.stdout.on('data', (data) => {
      output += data;
      const address = output.match(/https?:\/\/127\.0\.0\.1:\d+\/playload\/app\//);
      if (address) resolve(address[0]);
    });
    server.once('error', reject);
    server.once('exit', () => reject(new Error('Local server stopped')));
  });
  return { server, url };
}

test('an occupied development port exits promptly and removes its temporary build', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'playload-server-failure-'));
  try {
    await expect(
      execute(process.execPath, ['scripts/serve.js', '--no-open'], {
        cwd: root,
        env: { ...process.env, PORT: new URL(baseURL).port, TMPDIR: temporary },
        timeout: 10000,
      }),
    ).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('Port is already in use') });
    expect(await readdir(temporary)).toEqual([]);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('a malformed request returns an error without stopping the development server', async ({
  page,
}) => {
  const status = await new Promise((resolve, reject) => {
    const outgoing = request(baseURL, { path: 'http://[' }, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
  expect(status).toBe(404);
  await page.goto('/playload/app/');
  await expect(page.locator('#display')).toBeVisible();
});

test('the production build plays games and audio with one compressed, cached script', async ({
  browser,
}, testInfo) => {
  await execute(process.execPath, ['scripts/build.js'], { cwd: root });
  const { server, url } = await startServer('--dist');
  try {
    const source = `// @title Built Game
cls(1);
pcg['①'].pat = [24, 60, 126, 24, 24, 24, 24, 0];
pcg['①'].col = [6, 1];
put(1, 1, 'BUILD', null, 1);
scr[1][1].chr = '①';
let x = 76;
play(0, 'T120M35V12O5N8c');
play(1, 'V10O3N8c');
play(2, 'UX300W0O3N8c');
function tick() {
  x = Math.max(0, Math.min(152, x + btn(3) - btn(2)));
  if (btnp(4)) put(1, 2, 'PRESSED', 6, 1);
  spr(x, 68, '👾', 4);
  spr(8, 32, 'AB\\nCD', 6);
}`;
    const { hash } = await encode(source);
    for (const touch of [false, true]) {
      const page = await browser.newPage({
        viewport: touch ? { width: 390, height: 844 } : { width: 1280, height: 800 },
        hasTouch: touch,
        isMobile: touch,
      });
      try {
        await page.addInitScript(() => {
          const Context = window.AudioContext;
          window.AudioContext = class extends Context {
            createMediaStreamDestination() {
              const destination = super.createMediaStreamDestination();
              window.buildAnalyser = this.createAnalyser();
              this.createMediaStreamSource(destination.stream).connect(window.buildAnalyser);
              return destination;
            }
          };
        });
        const scripts = [];
        page.on('response', (response) => {
          if (new URL(response.url()).pathname.endsWith('.js')) scripts.push(response);
        });
        const navigation = await page.goto(url + hash);
        expect(navigation.headers()['cache-control']).toBe('public, max-age=0, must-revalidate');
        await expect(page.locator('#start-game')).toBeVisible();
        await expectCenteredWelcome(page);
        expect(scripts).toHaveLength(1);
        expect(scripts[0].headers()['content-encoding']).toBe('gzip');
        expect(scripts[0].headers()['cache-control']).toContain('immutable');
        expect(await scripts[0].text()).toContain('Copyright (c) 2012 Lea Verou');
        const uncompressed = await page.request.get(scripts[0].url(), {
          headers: { 'Accept-Encoding': 'gzip;q=0, identity' },
        });
        expect(uncompressed.headers()['content-encoding']).toBeUndefined();
        expect(uncompressed.headers().vary).toBe('Accept-Encoding');
        await page.locator('#start-game').click();
        await expect(page.locator('#pause')).toBeEnabled();
        await expect(page.locator('#error-notice')).toBeHidden();
        await expect
          .poll(() =>
            page.evaluate(() => {
              if (!window.buildAnalyser) return 0;
              const samples = new Float32Array(window.buildAnalyser.fftSize);
              window.buildAnalyser.getFloatTimeDomainData(samples);
              return Math.max(...samples.map(Math.abs));
            }),
          )
          .toBeGreaterThan(0.02);
        const before = await page.locator('#display').evaluate((canvas) => canvas.toDataURL());
        await page.keyboard.press('z');
        await expect
          .poll(() => page.locator('#display').evaluate((canvas) => canvas.toDataURL()))
          .not.toBe(before);
        if (touch) {
          await page.locator('#tools-toggle').click();
          await page.locator('#code-toggle').click();
        }
        await expect(page.locator('#editor-highlight .token.comment').first()).toHaveText(
          '// @title Built Game',
        );
        await page.screenshot({
          path: testInfo.outputPath(`built-${touch ? 'phone' : 'desktop'}.png`),
        });
        await page.locator('#editor').fill('function tick() { throw new Error("Built error") }');
        if (touch) await page.locator('#tools-toggle').click();
        await page.locator('#run').click();
        await expect(page.locator('#error')).toHaveText('Built error');
        await expect(page.locator('#error-line')).toBeVisible();
      } finally {
        await page.close();
      }
    }
  } finally {
    server.kill();
  }
});

test('the HTTPS server opens a stable secure player and never serves its private key', async ({
  browser,
}, testInfo) => {
  await expect(
    execute(process.execPath, ['scripts/serve.js', '--cert', 'cert.pem', '--key', 'key.pem'], {
      cwd: root,
    }),
  ).rejects.toThrow('Use --https with --cert and --key.');
  try {
    await execute('openssl', ['version']);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    test.skip(true, 'OpenSSL is required to generate the temporary test certificate.');
  }
  await mkdir(testInfo.outputDir, { recursive: true });
  const config = testInfo.outputPath('certificate.cnf');
  const cert = testInfo.outputPath('certificate.pem');
  const key = testInfo.outputPath('key.pem');
  await writeFile(
    config,
    '[req]\nprompt=no\ndistinguished_name=subject\nx509_extensions=extensions\n' +
      '[subject]\nCN=localhost\n[extensions]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n',
  );
  let server;
  try {
    await execute('openssl', [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-config',
      config,
      '-keyout',
      key,
      '-out',
      cert,
    ]);
    const started = await startServer('--https', '--cert', cert, '--key', key);
    server = started.server;
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      ignoreHTTPSErrors: true,
    });
    try {
      await page.goto(started.url);
      expect(await page.evaluate(() => isSecureContext)).toBe(true);
      await expectCenteredWelcome(page);
      await expect(page.locator('#editor')).toBeHidden();
      await page.screenshot({ path: testInfo.outputPath('https-phone-ready.png') });
      const response = await page.request.get(
        started.url + relative(root, key).split(sep).join('/'),
      );
      expect(response.status()).toBe(404);
      await page.locator('#start-game').click();
      await expect(page.locator('#pause')).toBeEnabled();
      await expect(page.locator('#sound')).toBeEnabled();
      await expect(page.locator('#error-notice')).toBeHidden();
      await expect(page.locator('#status')).not.toHaveText(/^Sound:/);
    } finally {
      await page.close();
    }
  } finally {
    server?.kill();
    for (const path of [config, cert, key]) await rm(path, { force: true });
  }
});

async function run(page, source, flat = false) {
  await page.goto('/playload/app/');
  await page.getByRole('tab', { name: 'Play' }).click();
  await page.getByRole('textbox', { name: 'JavaScript code' }).fill(source);
  await page.getByRole('button', { name: 'Run', exact: false }).click();
  if (flat) await page.getByRole('button', { name: 'CRT', exact: true }).click();
  await page.locator('#screen').click();
}

async function pixel(page, x = 0, y = 0) {
  return page
    .locator('#display')
    .evaluate(
      (canvas, [x, y]) => [...canvas.getContext('2d').getImageData(x, y, 1, 1).data],
      [x, y],
    );
}

async function expectCenteredWelcome(page) {
  const { width, height, lines } = await page.locator('#display').evaluate((canvas) => {
    const { width, height } = canvas;
    const pixels = canvas.getContext('2d').getImageData(0, 0, width, height).data;
    const lines = [0, 1].map(() => ({ left: width, right: -1, top: height, bottom: -1 }));
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4;
        if (pixels[offset] < 150 || pixels[offset + 1] < 125 || pixels[offset + 2] > 150) continue;
        const line = lines[y < height / 2 ? 0 : 1];
        line.left = Math.min(line.left, x);
        line.right = Math.max(line.right, x);
        line.top = Math.min(line.top, y);
        line.bottom = Math.max(line.bottom, y);
      }
    return { width, height, lines };
  });
  for (const line of lines) {
    expect(line.right).toBeGreaterThan(line.left);
    expect(Math.abs((line.left + line.right) / 2 - width / 2)).toBeLessThanOrEqual(4);
    expect(line.bottom - line.top).toBeLessThan(32);
  }
  expect(lines[1].top - lines[0].bottom).toBeGreaterThanOrEqual(4);
  expect(Math.abs((lines[0].top + lines[1].bottom) / 2 - height / 2)).toBeLessThanOrEqual(4);
}

async function touchStartCanceled(page, selector) {
  return page
    .locator(selector)
    .first()
    .evaluate(
      (element) =>
        !element.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true })),
    );
}

async function loadFileHandle(page, source = 'function tick() { cls(4) }') {
  await page.addInitScript((source) => {
    window.testFileSource = source;
    window.fileReads = 0;
    window.pickerOpens = 0;
    window.testFileHandle = {
      getFile: async () => {
        window.fileReads++;
        return new File([window.testFileSource], 'native-game.js', { type: 'text/javascript' });
      },
    };
    window.showOpenFilePicker = async () => {
      window.pickerOpens++;
      return [window.testFileHandle];
    };
  }, source);
  await page.goto('/playload/app/');
  await page.locator('#load').click();
  await expect(page.locator('#pause')).toBeEnabled();
}

test('startup shows a finished layout and welcome screen even when styles and scripts load slowly', async ({
  browser,
}, testInfo) => {
  const { hash } = await encode('// @title Shared\nfunction tick() { spr(76, 68, "👾", 6) }');
  for (const [name, width, height, touch, fragment] of [
    ['phone', 390, 844, true, ''],
    ['shared-phone', 390, 844, true, hash],
    ['invalid-phone', 390, 844, true, '#invalid'],
    ['tablet-landscape', 1024, 768, true, hash],
    ['desktop', 1280, 800, false, ''],
  ]) {
    for (const delayed of ['styles', 'scripts', 'both']) {
      const page = await browser.newPage({
        viewport: { width, height },
        hasTouch: touch,
        isMobile: touch,
      });
      const criticalRequests = [];
      page.on('request', (request) => {
        const file = new URL(request.url()).pathname.split('/').pop();
        if (/^app-[A-Z0-9]+\.js$/.test(file)) criticalRequests.push(file);
      });
      let release;
      const gate = new Promise((resolve) => (release = resolve));
      if (delayed !== 'scripts')
        await page.route('**/playload/assets/bundles/app-style-*.css', async (route) => {
          await gate;
          await route.continue();
        });
      if (delayed !== 'styles')
        await page.route('**/playload/assets/bundles/app-*.js', async (route) => {
          await gate;
          await route.continue();
        });
      await page.addInitScript(() => {
        requestAnimationFrame(function firstPaint() {
          const app = document.querySelector('#app');
          const game = document.querySelector('#game');
          if (
            !app ||
            app.hidden ||
            getComputedStyle(app).visibility === 'hidden' ||
            !game ||
            getComputedStyle(game).visibility === 'hidden'
          ) {
            requestAnimationFrame(firstPaint);
            return;
          }
          window.firstWorkspacePaint = {
            welcome: !document.querySelector('#start-game').hidden,
            error: !document.querySelector('#error-notice').hidden,
            screen: document.querySelector('#display').getBoundingClientRect().toJSON(),
          };
        });
      });
      const loading = page.goto(baseURL + '/playload/app/' + fragment);
      try {
        await page.locator('#display').waitFor({ state: 'attached' });
        await expect(page.locator('#app')).toBeHidden();
        await expect.poll(() => criticalRequests.length).toBe(1);
        release();
        await loading;
        expect(criticalRequests.length).toBe(1);
        await expect(page.locator('#app')).toBeVisible();
        await page.waitForFunction(() => window.firstWorkspacePaint);
        const first = await page.evaluate(() => window.firstWorkspacePaint);
        if (fragment === '#invalid') {
          expect(first.error).toBe(true);
          await expect(page.locator('#error')).toHaveText('Invalid game URL');
        } else {
          expect(first.welcome).toBe(true);
          await expectCenteredWelcome(page);
        }
        expect(
          await page.locator('#display').evaluate((canvas) =>
            canvas
              .getContext('2d')
              .getImageData(0, 0, canvas.width, canvas.height)
              .data.some((value, index) => index % 4 !== 3 && value !== 0),
          ),
        ).toBe(true);
        const screen = await page.locator('#display').boundingBox();
        for (const key of ['x', 'y', 'width', 'height']) {
          expect(Math.abs(first.screen[key] - screen[key])).toBeLessThanOrEqual(1);
        }
        await page.screenshot({ path: testInfo.outputPath(`${name}-${delayed}-ready.png`) });
      } finally {
        release();
        await loading;
        await page.close();
      }
    }
  }
});

base('a missing or empty stylesheet keeps the uninitialized workspace hidden', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const status of [404, 200]) {
    errors.length = 0;
    await page.route('**/playload/assets/bundles/app-style-*.css', (route) =>
      route.fulfill({ status, contentType: 'text/css', body: '' }),
    );
    await page.goto('/playload/app/');
    await expect(page.locator('#app')).toBeHidden();
    expect(await page.locator('#display').getAttribute('data-crt')).toBeNull();
    expect(errors.every((message) => message === 'The stylesheet could not load.')).toBe(true);
    await page.unroute('**/playload/assets/bundles/app-style-*.css');
  }
  await page.goto('/playload/app/');
  await expect(page.locator('#app')).toBeVisible();
  await expectCenteredWelcome(page);
});

test('a new page focuses the game and selecting the editor keeps playback waiting', async ({
  browser,
}, testInfo) => {
  for (const [width, height, touch] of [
    [1400, 900, false],
    [1024, 768, false],
    [375, 812, false],
    [375, 812, true],
    [768, 1024, true],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      hasTouch: touch,
      isMobile: touch,
    });
    try {
      await page.goto(baseURL + '/playload/app/');
      const editor = page.locator('#editor');
      if (!touch && width >= 600) {
        await expect(page.locator('#screen')).toBeFocused();
        await expect(page.locator('#start-game')).toBeVisible();
        await expectCenteredWelcome(page);
        await editor.click();
        await expect(page.locator('#start-game')).toBeVisible();
        await expect(page.locator('#pause')).toBeDisabled();
        await expect(editor).toBeFocused();
        const starter = await editor.inputValue();
        await page.keyboard.press('End');
        await page.keyboard.insertText(' ');
        await expect(editor).not.toHaveValue(starter);
        await expect(editor).toBeFocused();
        await expect(page.locator('#start-game')).toBeVisible();
      } else {
        await expect(page.locator('#start-game')).toBeVisible();
        await expectCenteredWelcome(page);
        await expect(page.locator('#screen')).toBeFocused();
        await expect(editor).toBeHidden();
        await expect(page.locator('#pause')).toBeDisabled();
        if (!touch) {
          await page.keyboard.press('ArrowRight');
          await expect(page.locator('#start-game')).toBeHidden();
          await expect(page.locator('#pause')).toBeEnabled();
        }
      }
      await page.screenshot({
        path: testInfo.outputPath(`initial-focus-${width}-${touch ? 'touch' : 'desktop'}.png`),
      });
    } finally {
      await page.close();
    }
  }
});

test('the untouched starter keeps a plain URL until one character changes, including after Run', async ({
  page,
}) => {
  await page.goto('/playload/app/');
  const editor = page.getByRole('textbox', { name: 'JavaScript code' });
  const starter = await editor.inputValue();
  await expect(page.locator('#size')).toBeVisible();
  await expect(page).toHaveTitle('Playload');
  expect(new URL(page.url()).hash).toBe('');
  await page.locator('#run').click();
  await expect(page.locator('#pause')).toBeEnabled();
  await page.waitForTimeout(300);
  await expect(page).toHaveTitle('Playload');
  expect(new URL(page.url()).hash).toBe('');
  await editor.focus();
  await editor.evaluate((element) =>
    element.setSelectionRange(element.value.length, element.value.length),
  );
  await page.keyboard.insertText(' ');
  await expect(editor).toHaveValue(starter + ' ');
  await expect(page).toHaveTitle('My Game — Playload');
  await expect
    .poll(() =>
      page.evaluate(async () => {
        if (!location.hash) return null;
        const { decode } = await import('/src/payload.js');
        return decode(location.hash);
      }),
    )
    .toBe(starter + ' ');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(editor).toHaveValue(starter);
  await expect(page).toHaveTitle('My Game — Playload');
  await expect
    .poll(() =>
      page.evaluate(async () => {
        if (!location.hash) return null;
        const { decode } = await import('/src/payload.js');
        return decode(location.hash);
      }),
    )
    .toBe(starter);
  expect(new URL(page.url()).hash).not.toBe('');
});

test('workspace tabs do not change the URL or select the opening screen', async ({ page }) => {
  await page.goto('/playload/app/');
  await expect(page.getByRole('tab', { name: 'Play', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const url = page.url();
  await page.getByRole('tab', { name: 'Info', exact: true }).click();
  await page.getByRole('tab', { name: 'Examples', exact: true }).click();
  expect(page.url()).toBe(url);
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Play', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.goto('/playload/app/?ref=examples');
  await expect(page.getByRole('tab', { name: 'Play', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.locator('#info')).toBeHidden();
});

for (const width of [1400, 375]) {
  test(`bookmark sharing recovers after exceeding 3 KB at ${width}px`, async ({
    page,
  }, testInfo) => {
    let seed = 1;
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
      noise = Array.from({ length: 6000 }, () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return alphabet[seed % alphabet.length];
      }).join(''),
      large = `// @title Large\n// ${noise}\nfunction tick() { cls(4); }`,
      small = '// @title Small\nfunction tick() { cls(5); }';
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/playload/app/');
    if (width < 720) await page.locator('#code-toggle').click();
    const encoded = await page.evaluate(
      async (source) => (await import('/src/payload.js')).encode(source),
      large,
    );
    expect(encoded.bytes).toBeGreaterThan(3000);

    const editor = page.locator('#editor');
    await editor.fill(large);
    await expect(page.locator('#size-current')).toHaveText(formatPayloadSize(encoded.bytes));
    const message = 'Code exceeds 3 KB compressed.';
    await expect(page.locator('#error')).toHaveText(message);
    await expect(page.locator('#error-notice')).toBeVisible();
    await expect(page.locator('#error-line')).toBeHidden();
    await expect(page.locator('#status')).toBeEmpty();
    expect(new URL(page.url()).hash).toBe('');
    await expect(editor).toHaveValue(large);
    await page.locator('#run').click();
    await expect(page.locator('#pause')).toBeEnabled();
    await expect(page.locator('#error')).toHaveText(message);
    await expect(page.locator('#error-notice')).toBeVisible();
    const player = await page.locator('#viewport').boundingBox(),
      notice = await page.locator('#error-notice').boundingBox();
    expect(notice.x).toBeCloseTo(player.x + 7, 1);
    expect(notice.y).toBeCloseTo(player.y + 3, 1);
    await page.screenshot({ path: testInfo.outputPath('bookmark-too-large.png') });

    await editor.fill(small);
    await expect
      .poll(() =>
        page.evaluate(async () => {
          if (!location.hash) return null;
          return (await import('/src/payload.js')).decode(location.hash);
        }),
      )
      .toBe(small);
    await expect(page.locator('#error-notice')).toBeHidden();
    await expect(page).toHaveTitle('Small — Playload');
    await page.screenshot({ path: testInfo.outputPath('bookmark-recovered.png') });
    {
      const failing = large.replace('cls(4);', 'cls(4); throw new Error("Game failure");');
      await editor.fill(failing);
      await page.locator('#run').click();
      await expect(page.locator('#error')).toHaveText('Game failure');
      await expect(page.locator('#error-line')).toBeVisible();
      await expect(page.locator('#error-line')).toBeEnabled();
      await expect(page).toHaveURL(baseURL + '/playload/app/');

      await editor.fill(small);
      await expect
        .poll(() =>
          page.evaluate(async () => {
            if (!location.hash) return null;
            return (await import('/src/payload.js')).decode(location.hash);
          }),
        )
        .toBe(small);
      await expect(page.locator('#error')).toHaveText('Game failure');
      await expect(page.locator('#error-line')).toBeVisible();
      await expect(page.locator('#error-line')).toBeDisabled();
      await page.locator('#run').click();
      await expect(page.locator('#pause')).toBeEnabled();
      await expect(page.locator('#error-notice')).toBeHidden();
    }
    await page.reload();
    await expect(editor).toHaveValue(small);
    await page.locator('#start-game').click();
    await expect(page.locator('#pause')).toBeEnabled();
  });
}

for (const width of [1400, 375]) {
  test(`a full 3 KB game fits X and restores after sharing at ${width}px`, async ({
    page,
  }, testInfo) => {
    const source = sharedGameSource(3906),
      path = width < 720 ? '/playload/app/?padding=' + 'x'.repeat(3500) : '/playload/app/';
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(path);
    if (width < 720) await page.locator('#code-toggle').click();
    const editor = page.locator('#editor');
    await editor.fill(source);
    await expect(page.locator('#size-current')).toHaveText('3.00 KB');
    await expect
      .poll(() =>
        page.evaluate(async () => {
          if (!location.hash) return null;
          return (await import('/src/payload.js')).decode(location.hash);
        }),
      )
      .toBe(source);
    expect(await page.locator('#size').getAttribute('title')).toMatch(/^3000 bytes · /);
    expect(page.url().length).toBeLessThanOrEqual(4088);
    expect(new URL(page.url()).search).toBe('');
    await expect(page.locator('#error-notice')).toBeHidden();
    await expect(page).toHaveTitle('Share test — Playload');
    await editor.fill(sharedGameSource(3908));
    await expect(page.locator('#size-current')).toHaveText('3.01 KB');
    await expect(page.locator('#error')).toHaveText('Code exceeds 3 KB compressed.');
    expect(new URL(page.url()).hash).toBe('');
    await editor.fill(source);
    await expect.poll(() => new URL(page.url()).hash).not.toBe('');
    await expect(page.locator('#error-notice')).toBeHidden();
    const sharedURL = page.url();
    await page.reload();
    await expect(editor).toHaveValue(source);
    await expect(page).toHaveURL(sharedURL);
    await page.locator('#start-game').click();
    await expect(page.locator('#pause')).toBeEnabled();
    await expect(page.locator('#error-notice')).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath('full-payload-shared.png') });
  });
}

test('an older 3 KiB URL keeps its source and remains playable', async ({ page }) => {
  const source = sharedGameSource(4003),
    payload = await encode(source);
  await page.goto('/playload/app/' + payload.hash);
  await expect(page.locator('#editor')).toHaveValue(source);
  await expect(page.locator('#size-current')).toHaveText('3.08 KB');
  await expect(page.locator('#error')).toHaveText('Code exceeds 3 KB compressed.');
  expect(new URL(page.url()).hash).toBe(payload.hash);
  await page.locator('#start-game').click();
  await expect(page.locator('#pause')).toBeEnabled();
  expect(new URL(page.url()).hash).toBe(payload.hash);
});

test('Starter opens a plain URL in a new tab and preserves the current code and URL', async ({
  browser,
}, testInfo) => {
  for (const touch of [false, true]) {
    const page = await browser.newPage({
      viewport: touch ? { width: 375, height: 812 } : { width: 1280, height: 800 },
      hasTouch: touch,
      isMobile: touch,
    });
    try {
      const path = touch ? '/playload/app/' : '/playload/app/index.html?test=starter';
      await page.goto(baseURL + path);
      const editor = page.locator('#editor'),
        starter = await editor.inputValue(),
        source = '// @title Starter link test\nfunction tick() { cls(4) }';
      const hash = await page.evaluate(async (code) => {
        const { encode } = await import('/src/payload.js');
        return (await encode(code)).hash;
      }, source);
      await page.goto(baseURL + path + hash);
      await expect(editor).toHaveValue(source);
      await expect(page).toHaveTitle('Starter link test — Playload');
      const draft = touch ? source : source + '\n// Unrun draft';
      if (!touch) {
        const sharedURL = page.url();
        await editor.fill(draft);
        await expect(page).not.toHaveURL(sharedURL);
      }
      const originalURL = page.url();
      await page.locator('#info-tab').click();
      await page.getByRole('tab', { name: 'Examples', exact: true }).click();
      const home = page.getByRole('link', { name: 'Play Starter', exact: true });
      await expect(home).toHaveAttribute('href', baseURL + '/playload/app/');
      for (const keyboard of [false, true]) {
        const opened = page.waitForEvent('popup');
        if (keyboard) {
          await home.focus();
          await page.keyboard.press('Enter');
        } else if (touch) await home.tap();
        else await home.click();
        const fresh = await opened;
        try {
          await expect(fresh).toHaveURL(baseURL + '/playload/app/');
          await expect(fresh.locator('#editor')).toHaveValue(starter);
          await expect(fresh).toHaveTitle('Playload');
          await expect(fresh.locator('#play-tab')).toHaveAttribute('aria-selected', 'true');
          if (touch) await expect(fresh.locator('#start-game')).toBeVisible();
          else await expect(fresh.locator('#screen')).toBeFocused();
          expect(await fresh.evaluate(() => window.opener)).toBeNull();
          await expect(page).toHaveURL(originalURL);
          await expect(editor).toHaveValue(draft);
          await expect(page.locator('#info-tab')).toHaveAttribute('aria-selected', 'true');
          await fresh.screenshot({
            path: testInfo.outputPath(`starter-link-${touch ? 'touch' : 'desktop'}.png`),
          });
        } finally {
          await fresh.close();
          await page.bringToFront();
        }
      }
    } finally {
      await page.close();
    }
  }
});

test('a shared URL containing the starter remains a playable bookmark', async ({ page }) => {
  await page.goto('/playload/app/');
  const editor = page.getByRole('textbox', { name: 'JavaScript code' });
  const starter = await editor.inputValue();
  const hash = await page.evaluate(async (code) => {
    const { encode } = await import('/src/payload.js');
    return (await encode(code)).hash;
  }, starter);
  await page.goto('/playload/app/' + hash);
  await expect(editor).toHaveValue(starter);
  await expect(page).toHaveTitle('My Game — Playload');
  await page.locator('#start-game').click();
  await expect(page.locator('#pause')).toBeEnabled();
  await expect(page.locator('#size')).toBeVisible();
  expect(new URL(page.url()).hash).toBe(hash);
  await page.reload();
  await expect(editor).toHaveValue(starter);
  await expect(page).toHaveTitle('My Game — Playload');
  await page.locator('#start-game').click();
  await expect(page.locator('#pause')).toBeEnabled();
  expect(new URL(page.url()).hash).toBe(hash);
});

test('loading a file starts bookmark URLs even when its code matches the starter', async ({
  page,
}) => {
  await page.goto('/playload/app/');
  await page.evaluate(() => {
    window.showOpenFilePicker = undefined;
  });
  const starter = await page.locator('#editor').inputValue();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#load').click();
  await (
    await chooser
  ).setFiles({
    name: 'starter.js',
    mimeType: 'text/javascript',
    buffer: Buffer.from(starter),
  });
  await expect(page.locator('#pause')).toBeEnabled();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        if (!location.hash) return null;
        const { decode } = await import('/src/payload.js');
        return decode(location.hash);
      }),
    )
    .toBe(starter);
});

test('Load and Run shortcuts work; the address follows edits and restores a bookmark', async ({
  page,
}) => {
  await page.goto('/playload/app/');
  await page.evaluate(() => {
    window.showOpenFilePicker = undefined;
  });
  const editor = page.getByRole('textbox', { name: 'JavaScript code' });
  await editor.focus();
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Control+o');
  await (
    await chooser
  ).setFiles({
    name: 'shortcut-game.js',
    mimeType: 'text/javascript',
    buffer: Buffer.from('function tick() { cls(4) }'),
  });
  await expect(page.locator('#pause')).toBeEnabled();
  const historyLength = await page.evaluate(() => history.length);
  const source = 'function tick() { cls(5) }';
  await editor.fill(source);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        if (!location.hash) return null;
        const { decode } = await import('/src/payload.js');
        return decode(location.hash);
      }),
    )
    .toBe(source);
  expect(await page.evaluate(() => history.length)).toBe(historyLength);
  const bookmark = page.url();
  expect(new URL(bookmark).searchParams.has('edit')).toBe(false);
  await expect(page.locator('#share, #save-code, #reset')).toHaveCount(0);
  await page.keyboard.press('Meta+Enter');
  await expect(page.locator('#pause')).toBeEnabled();
  await page.locator('#crt').click();
  await expect.poll(() => pixel(page)).toEqual([100, 185, 100, 255]);
  await page.goto('about:blank');
  await page.goto(bookmark);
  await expect(editor).toHaveValue(source);
  await expect(editor).toBeVisible();
  await page.locator('#start-game').click();
  await expect(page.locator('#pause')).toBeEnabled();
  await page.locator('#crt').click();
  await expect.poll(() => pixel(page)).toEqual([100, 185, 100, 255]);
});

test('shared games preserve a leading source BOM and restore their title and gameplay', async ({
  page,
}) => {
  const source = '\ufeff// @title BOM Game\nfunction tick() { cls(4) }';
  await page.goto('/playload/app/' + (await encode(source)).hash);
  await expect(page.locator('#editor')).toHaveValue(source);
  await expect(page).toHaveTitle('BOM Game — Playload');
  await page.locator('#start-game').click();
  await expect(page.locator('#pause')).toBeEnabled();
  await page.locator('#crt').click();
  await expect.poll(() => pixel(page)).toEqual([80, 140, 215, 255]);
});

test('title comments update before Run and survive bookmarks, edits and a fresh URL', async ({
  page,
}) => {
  await page.goto('/playload/app/');
  await expect(page).toHaveTitle('Playload');
  const editor = page.getByRole('textbox', { name: 'JavaScript code' });
  const source = '//\n/* A small game. */\n// @title Star Catcher\nfunction tick() { cls(4) }\n';
  await editor.fill(source);
  await expect(page).toHaveTitle('Star Catcher — Playload');
  await expect(page.locator('#pause')).toBeDisabled();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        if (!location.hash) return null;
        const { decode } = await import('/src/payload.js');
        return decode(location.hash);
      }),
    )
    .toBe(source);
  const bookmark = page.url();
  await page.goto('about:blank');
  await page.goto(bookmark);
  await expect(page).toHaveTitle('Star Catcher — Playload');
  await expect(editor).toHaveValue(source);
  await expect(page.locator('#start-game')).toBeVisible();
  await expect(page.locator('#pause')).toBeDisabled();
  await editor.fill(source.replace('Star Catcher', '星の冒険 👾'));
  await expect(page).toHaveTitle('星の冒険 👾 — Playload');
  await editor.fill(source.replace('// @title Star Catcher', '// @title   '));
  await expect(page).toHaveTitle('Playload');
  const fresh = new URL(bookmark);
  fresh.hash = '';
  await page.goto(fresh.href);
  await expect(page).toHaveTitle('Playload');
});

test('title metadata reads opening comments in different styles and keeps literal text', async ({
  page,
}) => {
  await page.goto('/playload/app/');
  const editor = page.getByRole('textbox', { name: 'JavaScript code' });
  for (const [source, title] of [
    [
      'const text = "// @title String";\nconst template = `\n// @title Template\n`;\n/*\n// @title Block\n*/\nfunction tick() { cls(0) }',
      'Playload',
    ],
    ['function tick() { // @title Inside tick\ncls(0) }', 'Playload'],
    [
      '//\n// @title After an empty comment\nfunction tick() {}',
      'After an empty comment — Playload',
    ],
    [
      '// A description\n// @title Below the header\nfunction tick() {}',
      'Below the header — Playload',
    ],
    [
      '/* A description */\n// @title After a block\nfunction tick() {}',
      'After a block — Playload',
    ],
    ['/* @title Single block */\nfunction tick() {}', 'Single block — Playload'],
    [
      '/**\n * A description\n * @title  Starred block  \n */\nfunction tick() {}',
      'Starred block — Playload',
    ],
    ['/*\nA description\n@title Plain block\n*/\nfunction tick() {}', 'Plain block — Playload'],
    ['// Mention @title without declaring one\nfunction tick() {}', 'Playload'],
    ['// A description\nconst x = 1;\n// @title After code', 'Playload'],
    ['/* An unfinished block\n// @title Inside the block', 'Playload'],
    ['// @title First\n// @title Second\nfunction tick() {}', 'First — Playload'],
    ['// @title\n// @title Second\nfunction tick() {}', 'Playload'],
    ['/*\n * @title\n */\n// @title Second\nfunction tick() {}', 'Playload'],
    ['// @titleOther Not a title\nfunction tick() {}', 'Playload'],
    ['// @title <b>Game & Friends</b>\nfunction tick() {}', '<b>Game & Friends</b> — Playload'],
    ['\ufeff\r\n//\t@title\t  Rainy Day  \r\nfunction tick() {}', 'Rainy Day — Playload'],
    [
      '//\r\n\r\n/* Header */\u2028// @title Line separators\u2029function tick() {}',
      'Line separators — Playload',
    ],
  ]) {
    await editor.fill(source);
    await expect(page).toHaveTitle(title);
  }
  await expect(page.locator('title b')).toHaveCount(0);
});

test('file Load restores title metadata rather than the edited title', async ({ page }) => {
  await page.goto('/playload/app/');
  await page.evaluate(() => {
    window.showOpenFilePicker = undefined;
  });
  const editor = page.getByRole('textbox', { name: 'JavaScript code' });
  const file = (title) => ({
    name: 'game.js',
    mimeType: 'text/javascript',
    buffer: Buffer.from(`/**\n * Local game\n * @title ${title}\n */\nfunction tick() { cls(0) }`),
  });
  let chooser = page.waitForEvent('filechooser');
  await page.locator('#load').click();
  await (await chooser).setFiles(file('Loaded Game'));
  await expect(page).toHaveTitle('Loaded Game — Playload');
  await editor.fill('// @title Editor Title\nfunction tick() { cls(3) }');
  await expect(page).toHaveTitle('Editor Title — Playload');
  page.once('dialog', (dialog) => dialog.accept());
  chooser = page.waitForEvent('filechooser');
  await page.locator('#load').click();
  const updated = file('Updated File');
  await (await chooser).setFiles(updated);
  await expect(page).toHaveTitle('Updated File — Playload');
  await expect(editor).toHaveValue(updated.buffer.toString());
});

test('removing the URL hash restores the starter instead of an old browser draft', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem('playload-code-v2', 'function tick() { cls(3) }'),
  );
  await page.goto('/playload/app/');
  const editor = page.getByRole('textbox', { name: 'JavaScript code' });
  await expect(editor).toHaveValue(/spr\(x, y, ['"]👾['"], 6\)/);
  const starter = await editor.inputValue(),
    source = 'function tick() { cls(5) }';
  await editor.fill(source);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        if (!location.hash) return null;
        const { decode } = await import('/src/payload.js');
        return decode(location.hash);
      }),
    )
    .toBe(source);
  const bookmark = page.url();
  await page.reload();
  await expect(editor).toHaveValue(source);
  const freshURL = new URL(bookmark);
  freshURL.hash = '';
  await page.goto(freshURL.href);
  await expect(editor).toHaveValue(starter);
  await expect(page.locator('#pause')).toBeDisabled();
  await expect(page.locator('#size')).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
  await page.goto(bookmark);
  await expect(editor).toHaveValue(source);
  await page.locator('#start-game').click();
  await expect(page.locator('#pause')).toBeEnabled();
});

test('a real game worker draws, receives keyboard input and resets the game', async ({ page }) => {
  await run(page, 'function tick() { cls(btn(4) ? 3 : 4) }', true);
  await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
  await expect.poll(() => pixel(page)).toEqual([80, 140, 215, 255]);
  await page.locator('#screen').click();
  await page.keyboard.down('KeyZ');
  await expect.poll(() => pixel(page)).toEqual([215, 115, 85, 255]);
  await page.keyboard.up('KeyZ');
  await expect.poll(() => pixel(page)).toEqual([80, 140, 215, 255]);
  await page.getByRole('button', { name: 'Run', exact: false }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
  await expect.poll(() => pixel(page)).toEqual([80, 140, 215, 255]);
});

async function mockGamepads(page) {
  await page.addInitScript(() => {
    window.testPads = [];
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => window.testPads,
    });
  });
}

test('WASD and J/K work alongside the original keys and leave editor typing alone', async ({
  page,
}) => {
  await run(
    page,
    'function tick() { cls(0); for (let id = 0; id < 6; id++) if (btn(id)) cls(id + 1); }',
    true,
  );
  const colors = await page.evaluate(async () => {
    const { palette } = await import('/src/engine/engine.js');
    return palette.map((color) =>
      [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)).concat(255),
    );
  });
  for (const [id, key] of ['w', 's', 'a', 'd', 'j', 'k'].entries()) {
    await page.keyboard.down(key);
    await expect.poll(() => pixel(page)).toEqual(colors[id + 1]);
    await page.keyboard.up(key);
    await expect.poll(() => pixel(page)).toEqual(colors[0]);
  }

  await page.keyboard.down('z');
  await page.keyboard.down('j');
  await page.keyboard.up('z');
  await expect.poll(() => pixel(page)).toEqual(colors[5]);
  await page.keyboard.up('j');
  await expect.poll(() => pixel(page)).toEqual(colors[0]);

  const editor = page.locator('#editor');
  const source = await editor.inputValue();
  await editor.focus();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('wasdjk');
  await expect(editor).toHaveValue(source + 'wasdjk');
  await expect.poll(() => pixel(page)).toEqual(colors[0]);
});

async function setGamepad(
  page,
  { buttons = [], axes = [0, 0], mapping = 'standard', connected = true } = {},
) {
  await page.evaluate(
    ({ buttons, axes, mapping, connected }) => {
      window.testPads = [
        null,
        {
          connected,
          mapping,
          axes,
          buttons: Array.from({ length: 16 }, (_, id) => ({ pressed: buttons.includes(id) })),
        },
      ];
    },
    { buttons, axes, mapping, connected },
  );
}

test('standard gamepads map all six buttons and the left stick, ignoring drift and unknown mappings', async ({
  page,
}) => {
  await mockGamepads(page);
  await run(
    page,
    `function tick() {
    cls(0);
    for (let id = 0; id < 6; id++) scr[0][id].col[1] = btn(id) ? 3 : 0;
  }`,
    true,
  );
  await page.locator('#screen').click();
  const held = [215, 115, 85, 255];
  const released = [0, 0, 0, 255];
  for (const [id, button] of [12, 13, 14, 15, 0, 1].entries()) {
    await setGamepad(page, { buttons: [button] });
    await expect.poll(() => pixel(page, id * 32)).toEqual(held);
    await setGamepad(page);
    await expect.poll(() => pixel(page, id * 32)).toEqual(released);
  }
  for (const [id, axes] of [
    [0, [0, -0.8]],
    [1, [0, 0.8]],
    [2, [-0.8, 0]],
    [3, [0.8, 0]],
  ]) {
    await setGamepad(page, { axes });
    await expect.poll(() => pixel(page, id * 32)).toEqual(held);
    await setGamepad(page, { axes: [0.4, -0.4] });
    await expect.poll(() => pixel(page, id * 32)).toEqual(released);
  }
  await setGamepad(page, { buttons: [0], mapping: '' });
  await page.waitForTimeout(100);
  expect(await pixel(page, 128)).toEqual(released);
  await setGamepad(page, { buttons: [0] });
  await expect.poll(() => pixel(page, 128)).toEqual(held);
  await setGamepad(page, { buttons: [0], connected: false });
  await expect.poll(() => pixel(page, 128)).toEqual(released);
  await setGamepad(page, { buttons: [0] });
  await expect.poll(() => pixel(page, 128)).toEqual(held);
  await page.evaluate(() => {
    window.testPads = [];
  });
  await expect.poll(() => pixel(page, 128)).toEqual(released);
});

test('gamepads merge with keyboard input, press once, and release when editing, paused or in Info', async ({
  page,
}) => {
  await mockGamepads(page);
  await run(
    page,
    `let count = 0;
    function tick() {
      if (btnp(4)) count++;
      cls(0);
      scr[0][0].col[1] = btn(4) ? 3 : 0;
      scr[0][1].col[1] = count;
    }`,
    true,
  );
  await page.locator('#screen').click();
  const held = [215, 115, 85, 255];
  const released = [0, 0, 0, 255];
  await setGamepad(page, { buttons: [0] });
  await expect.poll(() => pixel(page)).toEqual(held);
  await expect.poll(() => pixel(page, 32)).toEqual([85, 65, 95, 255]);
  await page.keyboard.down('KeyZ');
  await setGamepad(page);
  await page.waitForTimeout(100);
  expect(await pixel(page)).toEqual(held);
  await setGamepad(page, { buttons: [0] });
  await page.keyboard.up('KeyZ');
  await page.waitForTimeout(100);
  expect(await pixel(page)).toEqual(held);
  expect(await pixel(page, 32)).toEqual([85, 65, 95, 255]);
  await page.locator('#editor').focus();
  await expect.poll(() => pixel(page)).toEqual(released);
  await page.locator('#screen').focus();
  await expect.poll(() => pixel(page)).toEqual(held);
  await expect.poll(() => pixel(page, 32)).toEqual([100, 105, 100, 255]);
  await page.keyboard.press('Escape');
  await expect(page.locator('#editor')).toBeFocused();
  await setGamepad(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('#screen')).toBeFocused();
  await expect.poll(() => pixel(page)).toEqual(released);
  await setGamepad(page, { buttons: [0] });
  await expect.poll(() => pixel(page)).toEqual(held);
  await page.locator('#info-tab').click();
  await setGamepad(page);
  await page.locator('#play-tab').click();
  await page.locator('#screen').focus();
  await expect.poll(() => pixel(page)).toEqual(released);
});

test('unavailable or permission-blocked gamepad access leaves keyboard games working', async ({
  page,
}) => {
  await run(page, 'function tick() { cls(btn(4) ? 3 : 4) }', true);
  await page.locator('#screen').click();
  for (const blocked of [false, true]) {
    await page.evaluate((blocked) => {
      Object.defineProperty(navigator, 'getGamepads', {
        configurable: true,
        value: blocked
          ? () => {
              throw new DOMException('Blocked', 'SecurityError');
            }
          : undefined,
      });
    }, blocked);
    await page.keyboard.down('KeyZ');
    await expect.poll(() => pixel(page)).toEqual([215, 115, 85, 255]);
    await page.keyboard.up('KeyZ');
    await expect.poll(() => pixel(page)).toEqual([80, 140, 215, 255]);
  }
});

for (const hz of [12, 15, 20, 30, 60, 90, 120, 144, 165]) {
  test(`${hz} Hz displays keep 60 game updates per second without catching up after a long pause`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (callback) => {
        if (callback.name === 'animate') {
          window.nextAnimate = callback;
          return 1;
        }
        return raf(callback);
      };
      const NativeWorker = window.Worker;
      window.completedFrames = 0;
      window.renderedFrames = 0;
      window.Worker = class extends NativeWorker {
        constructor(...args) {
          super(...args);
          this.addEventListener('message', ({ data }) => {
            if (data.type === 'frame') {
              window.completedFrames += data.steps;
              window.renderedFrames++;
            }
          });
        }
        postMessage(data, ...args) {
          if (data.type === 'frame')
            window.frameFinished = new Promise((resolve) => {
              this.addEventListener('message', resolve, { once: true });
            });
          super.postMessage(data, ...args);
        }
      };
    });
    await run(page, 'let ticks = 0; function tick() { cls(++ticks % 8); }');
    await expect(page.locator('#pause')).toBeEnabled();
    const frames = await page.evaluate(async (hz) => {
      window.nextAnimate(0);
      for (let i = 1; i <= hz; i++) {
        window.nextAnimate((i * 1000) / hz);
        await window.frameFinished;
      }
      return window.completedFrames;
    }, hz);
    expect(frames).toBe(60);
    expect(await page.evaluate(() => window.renderedFrames)).toBe(Math.min(hz, 60));
    // The initial load already ran one tick. Check actual game state as well
    // as the worker's reported updates, even when rendering only 12 Hz.
    await page.locator('#crt').click();
    expect(await pixel(page, 320, 288)).toEqual([100, 185, 100, 255]);
    await page.locator('#crt').click();
    const afterPause = await page.evaluate(async () => {
      for (const time of [10000, 10000 + 1000 / 60]) {
        window.nextAnimate(time);
        await window.frameFinished;
      }
      return window.completedFrames;
    });
    expect(afterPause).toBe(62);
  });
}

for (const denied of [false, true]) {
  test(`${denied ? 'denied' : 'unavailable'} game workers show an error and Run can retry`, async ({
    page,
  }) => {
    await page.addInitScript((denied) => {
      window.SupportedWorker = window.Worker;
      window.Worker = denied
        ? class {
            constructor() {
              throw new DOMException('Game workers are blocked.', 'SecurityError');
            }
          }
        : undefined;
    }, denied);
    await run(page, 'function tick() { cls(4) }', true);
    await expect(page.locator('#error')).toHaveText(
      denied ? 'Game workers are blocked.' : 'This browser cannot run games.',
    );
    await expect(page.locator('#pause')).toBeDisabled();
    await expect(page.locator('#run')).toBeEnabled();
    await page.evaluate(() => {
      window.Worker = window.SupportedWorker;
    });
    await page.locator('#run').click();
    await expect(page.locator('#pause')).toBeEnabled();
    await expect(page.locator('#error')).toBeHidden();
    await expect.poll(() => pixel(page, 320, 288)).toEqual([80, 140, 215, 255]);
  });
}

test('btnp is consumed once, pause freezes a frame, and reset restores initial state', async ({
  page,
}) => {
  await run(page, 'let color = 1; function tick() { if(btnp(4)) color++; cls(color) }', true);
  await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
  await page.locator('#screen').click();
  await page.keyboard.down('KeyZ');
  await expect.poll(() => pixel(page)).toEqual([100, 105, 100, 255]);
  await page.getByRole('button', { name: 'Pause', exact: false }).click();
  await page.keyboard.up('KeyZ');
  await expect(page.getByRole('button', { name: 'Screenshot', exact: false })).toBeEnabled();
  expect(await pixel(page)).toEqual([100, 105, 100, 255]);
  await page.getByRole('button', { name: 'Run', exact: false }).click();
  await expect.poll(() => pixel(page)).toEqual([85, 65, 95, 255]);
});

test('paused keyboard and touch presses do not become game actions on resume', async ({
  page,
  browser,
}) => {
  const source = 'let presses = 0; function tick() { if (btnp(4)) presses++; cls(presses); }';
  await run(page, source, true);
  await page.locator('#code-toggle').click();
  await page.locator('#pause').click();
  await expect(page.locator('#screen')).toBeFocused();
  await page.keyboard.press('z');
  await page.locator('#pause').click();
  await page.waitForTimeout(100);
  expect(await pixel(page)).toEqual([0, 0, 0, 255]);
  await page.keyboard.press('z');
  await expect.poll(() => pixel(page)).toEqual([85, 65, 95, 255]);

  const phone = await browser.newPage({
    viewport: { width: 375, height: 812 },
    hasTouch: true,
    isMobile: true,
  });
  await phone.goto(baseURL + '/playload/app/');
  const hash = await phone.evaluate(async (source) => {
    const { encode } = await import('/src/payload.js');
    return (await encode(source)).hash;
  }, source);
  await phone.goto(baseURL + '/playload/app/' + hash);
  await phone.locator('#start-game').tap();
  await expect(phone.locator('#pause')).toBeEnabled();
  await phone.locator('#tools-toggle').tap();
  await phone.locator('#crt').click();
  await phone.locator('#pause').click();
  await expect(phone.locator('#pause')).toContainText('Resume');
  await phone.locator('#tools-toggle').tap();
  await phone.locator('[data-input="4"]').tap();
  await phone.locator('#tools-toggle').tap();
  await phone.locator('#pause').click();
  await phone.waitForTimeout(100);
  expect(await pixel(phone)).toEqual([0, 0, 0, 255]);
  await phone.locator('[data-input="4"]').tap();
  await expect.poll(() => pixel(phone)).toEqual([85, 65, 95, 255]);
  await phone.close();
});

for (const [name, source, message] of [
  ['missing tick', 'cls(4)', 'Define function tick()'],
  ['tick exception', 'function tick() { throw new Error("test game error") }', 'test game error'],
  ['string exception', 'function tick() { throw "Game over" }', 'Game over'],
  ['number exception', 'function tick() { throw 42 }', '42'],
  ['null exception', 'function tick() { throw null }', 'null'],
  ['syntax error', 'function tick( {', 'SyntaxError'],
  ['nonresponsive game', 'function tick() { while(true) {} }', 'The game stopped responding.'],
]) {
  test(`${name} is reported and the editor can run a replacement game`, async ({ page }) => {
    await run(page, source, true);
    if (name === 'syntax error') await expect(page.getByRole('alert')).toBeVisible();
    else await expect(page.getByRole('alert')).toContainText(message);
    await expect(page.getByRole('textbox', { name: 'JavaScript code' })).toHaveValue(source);
    await page.getByRole('textbox', { name: 'JavaScript code' }).fill('function tick() { cls(5) }');
    await page.getByRole('button', { name: 'Run', exact: false }).click();
    await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
    await expect.poll(() => pixel(page)).toEqual([100, 185, 100, 255]);
    await expect(page.getByRole('alert')).toBeHidden();
  });
}

for (const clear of ['cls(9)', 'cls()']) {
  test(`engine validation errors retain the frame without inventing a source line (${clear})`, async ({
    page,
  }) => {
    await run(
      page,
      `let frames = 0;
function tick() {
  cls(4);
  if (++frames === 2) {
    ${clear};
  }
}`,
      true,
    );
    await expect(page.locator('#error')).toHaveText('Color must be 0–7');
    await expect(page.locator('#screen')).toBeVisible();
    expect(await pixel(page)).toEqual([80, 140, 215, 255]);
    const line = page.locator('#error-line');
    if (await line.isVisible()) await expect(line).toHaveText('Line 5');
  });
}

test('a shared URL starts the player with the same game', async ({ page }) => {
  await page.goto('/playload/app/');
  const hash = await page.evaluate(async () => {
    const { encode } = await import('/src/payload.js');
    return (await encode('let color = 6; function tick() { if (btnp(4)) color = 5; cls(color) }'))
      .hash;
  });
  await page.goto('/playload/app/' + hash);
  await expect(page.locator('#start-game')).toHaveText('Click to play');
  await expect(page.getByRole('button', { name: 'Pause' })).toBeDisabled();
  await expect(page.getByRole('tab', { name: 'Play' })).toBeVisible();
  await expect(page.locator('#editor')).toBeVisible();
  await expect(page.locator('#screen')).toBeFocused();
  await expect(page.getByRole('button', { name: 'CRT', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Sound', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(await pixel(page)).toEqual([33, 28, 41, 255]);
  await page.keyboard.press('z');
  await expect(page.locator('#start-game')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
  await page.getByRole('button', { name: 'CRT', exact: true }).click();
  await expect.poll(() => pixel(page)).toEqual([230, 200, 110, 255]);
  await page.keyboard.press('z');
  await expect.poll(() => pixel(page)).toEqual([100, 185, 100, 255]);
  await page.keyboard.press('Control+Enter');
  await expect.poll(() => pixel(page)).toEqual([230, 200, 110, 255]);
});

test('the welcome screen starts with ordinary keys or a mouse click and uses editor changes', async ({
  page,
}) => {
  for (const key of ['Enter', 'Space', 'q']) {
    await page.goto('/playload/app/');
    await expect(page.locator('#start-game')).toBeVisible();
    await page.locator('#screen').focus();
    await page.keyboard.press(key);
    await expect(page.locator('#start-game')).toBeHidden();
    await expect(page.locator('#pause')).toBeEnabled();
    await expect(page.locator('#screen')).toBeFocused();
  }

  for (const button of ['left', 'middle', 'right']) {
    await page.goto('/playload/app/');
    await page.locator('#editor').fill('function tick() { cls(5) }');
    await expect(page.locator('#start-game')).toBeVisible();
    await expect(page.locator('#editor')).toBeFocused();
    await page.locator('#viewport').click({ button, position: { x: 3, y: 3 } });
    await expect(page.locator('#start-game')).toBeHidden();
    await expect(page.locator('#pause')).toBeEnabled();
    await expect(page.locator('#screen')).toBeFocused();
    await page.locator('#crt').click();
    await expect.poll(() => pixel(page)).toEqual([100, 185, 100, 255]);
  }

  for (const selector of ['#editor', '#crt', '#sound', '#play-tab']) {
    await page.goto('/playload/app/');
    await expect(page.locator('#start-game')).toBeVisible();
    await page.locator(selector).click();
    await expect(page.locator('#start-game')).toBeVisible();
    await expect(page.locator('#pause')).toBeDisabled();
    if (selector === '#editor') await expect(page.locator('#editor')).toBeFocused();
  }

  await page.goto('/playload/app/');
  await expect(page.locator('#start-game')).toBeVisible();
  const original = await page.locator('#editor').inputValue();
  await page.locator('#editor').focus();
  await page.locator('#editor').evaluate((editor) => editor.setSelectionRange(0, 0));
  await page.keyboard.type(' ');
  await expect(page.locator('#start-game')).toBeVisible();
  await expect(page.locator('#pause')).toBeDisabled();
  await expect(page.locator('#editor')).toBeFocused();
  await expect(page.locator('#editor')).toHaveValue(' ' + original);
});

test('Play keeps its input pane through margins, toolbar actions, Info and resizing', async ({
  page,
}) => {
  await page.goto('/playload/app/');
  const editor = page.locator('#editor'),
    screen = page.locator('#screen');
  await expect(screen).toBeFocused();
  const starter = await editor.inputValue();
  for (const key of ['Tab', 'Shift+Tab', 'Shift', 'Control', 'Alt', 'Meta', 'Escape']) {
    await page.keyboard.press(key);
    await expect(screen).toBeFocused();
    await expect(page.locator('#start-game')).toBeVisible();
  }
  await page.keyboard.press('z');
  await expect(page.locator('#pause')).toBeEnabled();
  await expect(screen).toBeFocused();
  await expect(editor).toHaveValue(starter);

  for (const pane of [screen, editor]) {
    await pane.click();
    if (pane === editor) await editor.evaluate((element) => element.setSelectionRange(4, 12));
    for (const target of [
      '.brand small',
      '.intro p',
      '#play-tab',
      '#crt',
      '#sound',
      '#run',
      '#pause',
      '#pause',
    ]) {
      await page.locator(target).click();
      await expect(pane).toBeFocused();
      await page.waitForTimeout(100);
      await expect(pane).toBeFocused();
      if (pane === editor)
        expect(
          await editor.evaluate((element) => [element.selectionStart, element.selectionEnd]),
        ).toEqual([4, 12]);
    }
    await page.locator('#workspace-toolbar').click({ position: { x: 1, y: 1 } });
    await expect(pane).toBeFocused();
    const divider = await page.locator('#divider').boundingBox();
    await page.mouse.move(divider.x + divider.width / 2, divider.y + 30);
    await page.mouse.down();
    await page.mouse.move(divider.x + 20, divider.y + 30);
    await page.mouse.up();
    await expect(pane).toBeFocused();
    await page.locator('#info-tab').click();
    await expect(page.locator('#info')).toBeVisible();
    await page.locator('#play-tab').click();
    await expect(pane).toBeFocused();
  }

  await editor.click();
  const before = await editor.inputValue();
  await page.keyboard.press('Tab');
  await expect(editor).toBeFocused();
  expect((await editor.inputValue()).length).toBe(before.length + 2);
  await page.keyboard.press('Shift+Tab');
  await expect(editor).toBeFocused();
  await page.locator('#code-toggle').click();
  await expect(editor).toBeHidden();
  await expect(screen).toBeFocused();
  await page.locator('#code-toggle').click();
  await expect(editor).toBeVisible();
  await expect(screen).toBeFocused();
});

test('the activation key is consumed until released, including repeats', async ({ page }) => {
  const source = `let color = 6;
function tick() {
  if (btn(3)) color = 4;
  if (btnp(4)) color = 5;
  cls(color);
}`;
  const { hash } = await encode(source);
  for (const [key, color] of [
    ['ArrowRight', [80, 140, 215, 255]],
    ['z', [100, 185, 100, 255]],
  ]) {
    await page.goto('about:blank');
    await page.goto('/playload/app/' + hash);
    await expect(page.locator('#start-game')).toBeVisible();
    await page.locator('#crt').evaluate((button) => button.click());
    await page.keyboard.down(key);
    await expect(page.locator('#start-game')).toBeHidden();
    await expect.poll(() => pixel(page)).toEqual([230, 200, 110, 255]);
    await page.keyboard.down(key);
    await page.waitForTimeout(100);
    expect(await pixel(page)).toEqual([230, 200, 110, 255]);
    await page.keyboard.press('Escape');
    await expect(page.locator('#editor')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#screen')).toBeFocused();
    await page.keyboard.down(key);
    await page.waitForTimeout(100);
    expect(await pixel(page)).toEqual([230, 200, 110, 255]);
    await page.keyboard.up(key);
    await page.keyboard.down(key);
    await expect.poll(() => pixel(page)).toEqual(color);
    await page.keyboard.up(key);
  }

  await page.goto('about:blank');
  await page.goto('/playload/app/' + hash);
  await expect(page.locator('#start-game')).toBeVisible();
  await page.locator('#crt').evaluate((button) => button.click());
  await page.mouse.click(2, 2);
  await expect(page.locator('#screen')).toBeFocused();
  await expect(page.locator('#start-game')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#start-game')).toBeHidden();
  await expect.poll(() => pixel(page)).toEqual([230, 200, 110, 255]);
  await page.keyboard.down('ArrowRight');
  await expect.poll(() => pixel(page)).toEqual([80, 140, 215, 255]);
  await page.keyboard.up('ArrowRight');

  for (const key of ['Space', 'Enter']) {
    await page.goto('about:blank');
    await page.goto('/playload/app/' + hash);
    await expect(page.locator('#start-game')).toBeVisible();
    await page.locator('#crt').evaluate((button) => button.click());
    await page.locator('#start-game').focus();
    await page.keyboard.press(key);
    await expect(page.locator('#screen')).toBeFocused();
    await expect.poll(() => pixel(page)).toEqual([230, 200, 110, 255]);
    await page.keyboard.down('ArrowRight');
    await expect.poll(() => pixel(page)).toEqual([80, 140, 215, 255]);
    await page.keyboard.up('ArrowRight');
  }
});

test('activation on the game pad is consumed through a tap, hold or drag', async ({
  browser,
  browserName,
}) => {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    // Firefox's mobile emulation does not emit PointerEvents for mouse input.
    isMobile: browserName !== 'firefox',
  });
  const { hash } = await encode(`let color = 6;
function tick() {
  if (btn(3)) color = 4;
  if (btnp(4)) color = 5;
  cls(color);
}`);
  try {
    for (const [selector, color] of [
      ['.dpad [data-input="3"]', [80, 140, 215, 255]],
      ['.ab [data-input="4"]', [100, 185, 100, 255]],
    ]) {
      await page.goto('about:blank');
      await page.goto('/playload/app/' + hash);
      await expect(page.locator('#start-game')).toBeVisible();
      await page.locator('#crt').evaluate((button) => button.click());
      const pad = page.locator(selector);
      const bounds = await pad.boundingBox();
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await page.mouse.down();
      await expect(page.locator('#start-game')).toBeHidden();
      await expect.poll(() => pixel(page)).toEqual([230, 200, 110, 255]);
      await page.mouse.move(bounds.x + bounds.width / 2 + 2, bounds.y + bounds.height / 2);
      await page.waitForTimeout(100);
      expect(await pixel(page)).toEqual([230, 200, 110, 255]);
      await page.mouse.up();
      await page.mouse.down();
      await expect.poll(() => pixel(page)).toEqual(color);
      await page.mouse.up();
      await page.goto('about:blank');
      await page.goto('/playload/app/' + hash);
      await expect(page.locator('#start-game')).toBeVisible();
      await page.locator('#crt').evaluate((button) => button.click());
      await pad.tap();
      await expect(page.locator('#start-game')).toBeHidden();
      await expect.poll(() => pixel(page)).toEqual([230, 200, 110, 255]);
    }
  } finally {
    await page.close();
  }
});

test('malformed worker frames are rejected before display or playback', async ({ page }) => {
  await page.goto('/playload/app/');
  const result = await page.evaluate(async () => {
    const { Runtime } = await import('/src/app/runtime.js');
    return await new Promise((resolve) => {
      let frames = 0;
      const runtime = new Runtime(
        () => frames++,
        (error) => resolve({ message: error.message, frames, stopped: runtime.worker === null }),
      );
      runtime.load(
        'postMessage({type:"frame",pixels:new Uint8Array(160*144).fill(8),sounds:[]}); function tick() {}',
      );
    });
  });
  expect(result).toEqual({ message: 'Invalid game frame.', frames: 0, stopped: true });
});

test('the game worker keeps running after the content policy rejects fetch', async ({ page }) => {
  let requests = 0;
  await page.route('**/LICENSE', (route) => {
    requests++;
    return route.fulfill({ body: 'Network access should be blocked' });
  });
  await run(
    page,
    `let color = 0;
fetch('${baseURL}/playload/LICENSE').then(
  () => { color = 5; },
  () => { color = 3; },
);
function tick() { cls(color); }`,
    true,
  );
  await expect.poll(() => pixel(page)).toEqual([215, 115, 85, 255]);
  expect(requests).toBe(0);
  await expect(page.locator('#pause')).toBeEnabled();
  await expect(page.locator('#error')).toBeHidden();
});

test('hidden pages keep music playing while freezing game updates and recording', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.testHidden = false;
    Object.defineProperty(document, 'hidden', { get: () => window.testHidden });
    window.recorders = [];
    const Recorder = window.MediaRecorder;
    window.MediaRecorder = class extends Recorder {
      constructor(...args) {
        super(...args);
        window.recorders.push(this);
      }
    };
    window.frameRequests = 0;
    const Worker = window.Worker;
    window.Worker = class extends Worker {
      postMessage(message, ...args) {
        if (message.type === 'frame') window.frameRequests++;
        super.postMessage(message, ...args);
      }
    };
    const Node = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends Node {
      constructor(context, ...args) {
        super(context, ...args);
        window.gameAnalyser = context.createAnalyser();
        this.connect(window.gameAnalyser);
      }
    };
  });
  await run(
    page,
    `
let frames = 0;
play(0, 'T240V12O5N9c))');
function tick() { put(1, 1, String(frames++)); }
`,
    true,
  );
  const recorderState = () => page.evaluate(() => window.recorders.at(-1)?.state);
  const sound = () =>
    page.evaluate(() => {
      if (!window.gameAnalyser) return -1;
      const samples = new Float32Array(window.gameAnalyser.fftSize);
      window.gameAnalyser.getFloatTimeDomainData(samples);
      return Math.max(...samples.map(Math.abs));
    });
  const visibility = (hidden) =>
    page.evaluate((hidden) => {
      window.testHidden = hidden;
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
  await expect.poll(recorderState).toBe('recording');
  await expect.poll(sound).toBeGreaterThan(0.001);
  const recorderCount = await page.evaluate(() => window.recorders.length);
  await visibility(true);
  await expect.poll(recorderState).toBe('paused');
  await expect.poll(sound).toBeGreaterThan(0.001);
  const requests = await page.evaluate(() => window.frameRequests);
  const frame = await page.locator('#display').evaluate((canvas) => canvas.toDataURL());
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.frameRequests)).toBe(requests);
  expect(await page.locator('#display').evaluate((canvas) => canvas.toDataURL())).toBe(frame);
  await expect.poll(sound).toBeGreaterThan(0.001);
  await page.locator('#sound').click();
  await expect(page.locator('#sound')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(sound).toBeGreaterThan(0.001);

  await visibility(false);
  await expect.poll(recorderState).toBe('recording');
  await expect.poll(sound).toBeGreaterThan(0.001);
  await expect.poll(() => page.evaluate(() => window.frameRequests)).toBeGreaterThan(requests);
  await expect(page.locator('#sound')).toHaveAttribute('aria-pressed', 'false');

  await page.locator('#pause').click();
  await expect.poll(sound).toBe(0);
  await visibility(true);
  await expect.poll(recorderState).toBe('paused');
  await visibility(false);
  await expect.poll(recorderState).toBe('recording');
  await expect(page.locator('#pause')).toContainText('Resume');
  const pausedRequests = await page.evaluate(() => window.frameRequests);
  await page.waitForTimeout(100);
  expect(await sound()).toBe(0);
  expect(await page.evaluate(() => window.frameRequests)).toBe(pausedRequests);

  await page.getByRole('tab', { name: 'Info', exact: true }).click();
  await visibility(true);
  await visibility(false);
  await expect.poll(recorderState).toBe('paused');
  expect(await sound()).toBe(0);
  expect(await page.evaluate(() => window.recorders.length)).toBe(recorderCount);
});

test('CRT and sound preserve pane focus and the editor selection before Run, while playing and while paused', async ({
  page,
}) => {
  await page.goto('/playload/app/');
  const editor = page.locator('#editor');
  for (const state of ['ready', 'playing', 'paused']) {
    if (state === 'playing') {
      await page.locator('#run').click();
      await expect(page.locator('#pause')).toBeEnabled();
    }
    if (state === 'paused') await page.locator('#pause').click();

    for (const pane of ['editor', 'screen']) {
      await page.locator('#' + pane).focus();
      if (pane === 'editor') await editor.evaluate((element) => element.setSelectionRange(4, 12));

      for (const id of ['crt', 'sound']) {
        const toggle = page.locator('#' + id);
        for (const pressed of ['false', 'true']) {
          await toggle.click();
          await expect(toggle).toHaveAttribute('aria-pressed', pressed);
          await expect(page.locator('#' + pane)).toBeFocused();
          if (pane === 'editor')
            expect(
              await editor.evaluate((element) => [element.selectionStart, element.selectionEnd]),
            ).toEqual([4, 12]);
        }
      }
    }
  }

  for (const id of ['crt', 'sound']) {
    const toggle = page.locator('#' + id);
    await toggle.focus();
    await toggle.press('Enter');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(toggle).toBeFocused();
    await toggle.press('Space');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle).toBeFocused();
  }
});

test('CRT and sound default to on, the screenshot is curved, and CRT toggles back exactly', async ({
  page,
}) => {
  await run(page, 'function tick() { cls(7) }');
  await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'CRT', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Sound', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(await pixel(page)).toEqual([33, 28, 41, 255]);
  expect((await pixel(page, 320, 288))[0]).toBeGreaterThan(100);
  const curved = await page.locator('#display').evaluate((canvas) => canvas.toDataURL());
  await page.getByRole('button', { name: 'CRT', exact: true }).click();
  const before = await page.locator('#display').evaluate((canvas) => canvas.toDataURL());
  expect(await pixel(page)).toEqual([220, 245, 255, 255]);
  expect(curved).not.toBe(before);
  await page.getByRole('button', { name: 'CRT', exact: true }).click();
  expect(await page.locator('#display').evaluate((canvas) => canvas.toDataURL())).toBe(curved);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Screenshot', exact: false }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('playload.png');
  const stream = await download.createReadStream(),
    chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  expect(Buffer.concat(chunks).toString('base64')).toBe(curved.split(',')[1]);
  await page.getByRole('button', { name: 'CRT', exact: true }).click();
  expect(await page.locator('#display').evaluate((canvas) => canvas.toDataURL())).toBe(before);
});

test('the first Run unlocks audio for both a click and the keyboard shortcut', async ({ page }) => {
  await page.addInitScript(() => {
    const Context = window.AudioContext;
    window.gameAudioContexts = [];
    window.AudioContext = class extends Context {
      constructor(...args) {
        super(...args);
        window.gameAudioContexts.push(this);
      }
    };
  });
  for (const method of ['click', 'shortcut']) {
    await page.goto('/playload/app/');
    await page.locator('#editor').fill('play(0, "V15O5N9a))");\nfunction tick() { cls(0); }');
    if (method === 'click') await page.locator('#run').click();
    else await page.keyboard.press('ControlOrMeta+Enter');
    await expect(page.locator('#pause')).toBeEnabled();
    await expect
      .poll(() => page.evaluate(() => window.gameAudioContexts.map((context) => context.state)))
      .toEqual(['running']);
    await expect
      .poll(() => page.evaluate(() => window.gameAudioContexts[0].currentTime))
      .toBeGreaterThan(0);
  }
});

test('the serialized synthesizer runs in a real AudioWorklet and mute leaves capture audio connected', async ({
  page,
}) => {
  await page.goto('/playload/app/');
  const result = await page.evaluate(async () => {
    const { Sound } = await import('/src/app/runtime.js');
    const { compileScore } = await import('/src/engine/sound.js');
    const errors = [],
      sound = new Sound((error) => errors.push(error));
    sound.play([{ ch: 0, score: compileScore('O5V15N9a))') }]);
    await sound.init();
    await sound.context.resume();
    const analyser = sound.context.createAnalyser();
    analyser.fftSize = 2048;
    sound.node.connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    const active = await new Promise((resolve) => {
      let tries = 0;
      const poll = () => {
        analyser.getFloatTimeDomainData(data);
        if (data.some((value) => Math.abs(value) > 0.01)) resolve(true);
        else if (++tries === 100) resolve(false);
        else setTimeout(poll, 10);
      };
      poll();
    });
    sound.mute(true);
    const muted = await new Promise((resolve) => {
      const deadline = performance.now() + 1000;
      const poll = () => {
        if (sound.monitor.gain.value < 0.001) resolve(true);
        else if (performance.now() > deadline) resolve(false);
        else setTimeout(poll, 5);
      };
      poll();
    });
    const result = {
      active,
      muted,
      tracks: sound.destination.stream.getAudioTracks().length,
      queued: sound.queue.length,
      errors,
    };
    await sound.context.close();
    return result;
  });
  expect(result).toEqual({ active: true, muted: true, tracks: 1, queued: 0, errors: [] });
});

test('an error during sound initialization cannot start a recording after the game stops', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Context = window.AudioContext;
    window.AudioContext = class extends Context {
      constructor(...args) {
        super(...args);
        const addModule = this.audioWorklet.addModule.bind(this.audioWorklet);
        this.audioWorklet.addModule = async (...args) => {
          await new Promise((resolve) => {
            window.finishSoundInit = resolve;
          });
          return addModule(...args);
        };
      }
    };
    const Node = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends Node {
      constructor(...args) {
        super(...args);
        window.soundReady = true;
      }
    };
    window.recordingStarts = 0;
    const start = MediaRecorder.prototype.start;
    MediaRecorder.prototype.start = function (...args) {
      window.recordingStarts++;
      return start.apply(this, args);
    };
  });
  await run(
    page,
    'let frame = 0; function tick() { if (frame++ === 1) throw new Error("Early error"); cls(4) }',
  );
  await expect(page.locator('#error')).toContainText('Early error');
  await page.evaluate(() => window.finishSoundInit());
  await expect.poll(() => page.evaluate(() => !!window.soundReady)).toBe(true);
  expect(await page.evaluate(() => window.recordingStarts)).toBe(0);
  await expect(page.locator('#record')).toBeDisabled();
  await page.locator('#editor').fill('function tick() { cls(4) }');
  await page.locator('#run').click();
  await expect.poll(() => page.evaluate(() => window.recordingStarts)).toBeGreaterThan(0);
  await expect(page.locator('#error-notice')).toBeHidden();
});

test('desktop controls stay visible and wrap through editing, play and window resizing', async ({
  page,
}) => {
  for (const [width, height] of [
    [1280, 800],
    [1200, 800],
    [1024, 768],
    [800, 600],
    [600, 700],
    [375, 650],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto('/playload/app/');
    await expect(page.locator('#tools-toggle')).toBeHidden();
    await expect(page.locator('#workspace-toolbar')).toBeVisible();
    await expect(page.locator('.touch')).toBeHidden();
    if (width < 600) {
      await expect(page.locator('#start-game')).toHaveText('Click to play');
      await page.locator('#code-toggle').click();
    }
    await page.locator('#editor').fill('function tick() { cls(btn(4) ? 3 : 4) }');
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(page.locator('#screen')).toBeFocused();
    await expect(page.locator('#workspace-toolbar')).toBeVisible();
    await page.locator('#crt').click();
    const buttons = await page.locator('#workspace-toolbar button').evaluateAll((elements) =>
      elements.map((element) => {
        const bounds = element.getBoundingClientRect();
        const label = document.createRange();
        label.selectNode(element.firstChild);
        return {
          left: bounds.left,
          right: bounds.right,
          width: bounds.width,
          top: bounds.top,
          labelHeight: label.getBoundingClientRect().height,
          lineHeight: parseFloat(getComputedStyle(element).lineHeight),
        };
      }),
    );
    for (const button of buttons) {
      expect(button.left).toBeGreaterThanOrEqual(0);
      expect(button.right).toBeLessThanOrEqual(width);
      expect(button.width).toBe(buttons[0].width);
      expect(button.labelHeight).toBeLessThanOrEqual(button.lineHeight + 2);
    }
    if (width <= 800) expect(new Set(buttons.map((button) => button.top)).size).toBeGreaterThan(1);
    await page.locator('#screen').click();
    await page.keyboard.down('z');
    await expect.poll(() => pixel(page)).toEqual([215, 115, 85, 255]);
    await page.keyboard.up('z');
    await page.keyboard.press('Escape');
    await expect(page.locator('#editor')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#screen')).toBeFocused();
    await expect(page.locator('#workspace-toolbar')).toBeVisible();
    await page.locator('#info-tab').click();
    await expect(page.locator('#workspace-toolbar')).toBeHidden();
    await page.locator('#play-tab').click();
    await expect(page.locator('#workspace-toolbar')).toBeVisible();
  }
  for (const width of [1280, 1279, 1024, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(page.locator('#tools-toggle')).toBeHidden();
    await expect(page.locator('#workspace-toolbar')).toBeVisible();
  }
});

test('mouse capture controls preserve editor focus, including while Save video is disabled', async ({
  page,
}) => {
  await run(page, 'function tick() { cls(btn(4) ? 3 : 4) }', true);
  const supported = await page.evaluate(() =>
    ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus'].some((type) =>
      MediaRecorder.isTypeSupported(type),
    ),
  );
  test.skip(!supported, 'This browser does not support the WebM recording format.');

  for (const id of ['screenshot', 'record', 'video']) {
    await page.locator('#editor').focus();
    if (id === 'video') await page.waitForTimeout(400);
    const pending = id === 'record' ? null : page.waitForEvent('download');
    await page.locator('#' + id).click();
    if (pending) {
      const download = await pending;
      expect(download.suggestedFilename()).toBe(id === 'video' ? 'playload.webm' : 'playload.png');
      expect(await download.failure()).toBeNull();
    }
    await expect(page.locator('#editor')).toBeFocused();
    await page.locator('#screen').click();
    await page.keyboard.down('z');
    await expect.poll(() => pixel(page)).toEqual([215, 115, 85, 255]);
    await page.keyboard.up('z');
    await expect.poll(() => pixel(page)).toEqual([80, 140, 215, 255]);
  }
});

test('Run during a pending video save keeps the new game free of stale recording errors', async ({
  page,
}) => {
  await run(page, 'function tick() { cls(btn(4) ? 3 : 4) }', true);
  await expect(page.locator('#video')).toBeEnabled();
  await page.evaluate(() => {
    const read = FileReader.prototype.readAsArrayBuffer;
    FileReader.prototype.readAsArrayBuffer = function (blob) {
      FileReader.prototype.readAsArrayBuffer = read;
      window.finishVideoRead = () => read.call(this, blob);
    };
  });
  await page.locator('#video').click();
  await expect.poll(() => page.evaluate(() => !!window.finishVideoRead)).toBe(true);
  await expect(page.locator('#video')).toBeDisabled();
  await page.locator('#run').click();
  await expect(page.locator('#pause')).toBeEnabled();
  await page.evaluate(() => window.finishVideoRead());
  await expect(page.locator('#status')).toBeEmpty();
  await expect(page.locator('#screen')).toBeFocused();
  await page.keyboard.down('z');
  await expect.poll(() => pixel(page)).toEqual([215, 115, 85, 255]);
  await page.keyboard.up('z');

  await expect(page.locator('#video')).toBeEnabled();
  const pending = page.waitForEvent('download');
  await page.locator('#video').click();
  expect((await pending).suggestedFilename()).toBe('playload.webm');
  await expect(page.locator('#status')).toBeEmpty();
});

test('touch tools enable Save only after frames arrive and preserve keyboard focus after saving', async ({
  browser,
}) => {
  const page = await browser.newPage({
    viewport: { width: 1366, height: 768 },
    hasTouch: true,
  });
  try {
    await exposeCapture(page);
    await page.addInitScript(() => {
      const Worker = window.Worker;
      window.Worker = class extends Worker {
        postMessage(message, ...args) {
          if (message.type === 'load')
            window.finishGameLoad = () => super.postMessage(message, ...args);
          else super.postMessage(message, ...args);
        }
      };
    });
    await page.goto(baseURL + '/playload/app/');
    await page.locator('#start-game').tap();
    await page.locator('#tools-toggle').tap();
    await expect.poll(() => page.evaluate(() => typeof window.finishGameLoad)).toBe('function');
    await expect(page.locator('#video')).toBeDisabled();
    await page.evaluate(() => window.finishGameLoad());
    await page.locator('#tools-toggle').tap();
    await expect(page.locator('#start-game')).toBeHidden();
    await expect(page.locator('#video')).toBeEnabled();
    await page.locator('#tools-toggle').tap();
    await page.locator('#video').focus();
    const pending = page.waitForEvent('download');
    await page.keyboard.press('Enter');
    expect((await pending).suggestedFilename()).toBe('playload.webm');
    await expect(page.locator('#video')).toBeFocused();
    await expect(page.locator('#workspace-toolbar')).toBeVisible();
    await expect(page.locator('#status')).toBeEmpty();

    await page.evaluate(async () => {
      const Capture = window.testCapture,
        save = Capture.prototype.save;
      Capture.prototype.save = function () {
        Capture.prototype.save = save;
        return save.call(this).then(
          (blob) =>
            new Promise((resolve) => {
              window.finishVideoSave = () => resolve(blob);
            }),
        );
      };
    });
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => !!window.finishVideoSave)).toBe(true);
    await page.locator('#crt').focus();
    const next = page.waitForEvent('download');
    await page.evaluate(() => window.finishVideoSave());
    await next;
    await expect(page.locator('#crt')).toBeFocused();
    await page.locator('#tools-toggle').tap();
    await expect(page.locator('#screen')).toBeFocused();
  } finally {
    await page.close();
  }
});

test('a failed New clip reports the video error without stopping the game and Run can retry', async ({
  page,
}) => {
  await run(page, 'function tick() { cls(btn(5) ? 5 : 4) }', true);
  await expect(page.locator('#record')).toBeEnabled();
  await expect.poll(() => pixel(page)).toEqual([80, 140, 215, 255]);
  await page.evaluate(() => {
    const start = MediaRecorder.prototype.start;
    MediaRecorder.prototype.start = function () {
      MediaRecorder.prototype.start = start;
      throw new DOMException('Encoder unavailable', 'NotSupportedError');
    };
  });

  await page.locator('#record').click();
  await expect(page.locator('#status')).toHaveText('Video: Encoder unavailable');
  await expect(page.locator('#record')).toBeDisabled();
  await expect(page.locator('#video')).toBeDisabled();
  await expect(page.locator('#pause')).toBeEnabled();
  await expect(page.locator('#error')).toBeHidden();
  await page.locator('#screen').focus();
  await page.keyboard.down('x');
  await expect.poll(() => pixel(page)).toEqual([100, 185, 100, 255]);
  await page.keyboard.up('x');
  await expect.poll(() => pixel(page)).toEqual([80, 140, 215, 255]);

  await page.locator('#run').click();
  await expect(page.locator('#record')).toBeEnabled();
  await expect(page.locator('#video')).toBeEnabled();
  await expect(page.locator('#status')).toBeEmpty();
});

test('successful video retries clear the previous capture error without restarting the game', async ({
  page,
}) => {
  await exposeCapture(page);
  await run(page, 'function tick() { cls(4) }');
  await expect(page.locator('#video')).toBeEnabled();
  await page.waitForTimeout(400);
  for (const newClip of [true, false]) {
    await page.evaluate(async () => {
      const Capture = window.testCapture,
        save = Capture.prototype.save;
      Capture.prototype.save = function () {
        Capture.prototype.save = save;
        throw new Error('Video export failed');
      };
    });
    await page.locator('#video').click();
    await expect(page.locator('#status')).toHaveText('Video export failed');
    await expect(page.locator('#pause')).toBeEnabled();
    if (newClip) {
      await page.locator('#record').click();
      await expect(page.locator('#status')).toBeEmpty();
      await page.waitForTimeout(400);
    }
    const pending = page.waitForEvent('download');
    await page.locator('#video').click();
    expect((await pending).suggestedFilename()).toBe('playload.webm');
    await expect(page.locator('#status')).toBeEmpty();
    await expect(page.locator('#pause')).toBeEnabled();
    await expect(page.locator('#screen')).toBeFocused();
    await expect(page.locator('#error')).toBeHidden();
  }
});

test('CRT video exports the curved frame with the same surround as the player', async ({
  page,
}) => {
  await run(page, 'function tick() { cls(7) }');
  for (const [x, y] of [
    [0, 0],
    [639, 0],
    [0, 575],
    [639, 575],
  ])
    expect(await pixel(page, x, y)).toEqual([33, 28, 41, 255]);
  await expect(page.getByRole('button', { name: 'New clip', exact: false })).toBeEnabled();
  await page.getByRole('button', { name: 'New clip', exact: false }).click();
  // A media export check needs a real interval of recorded frames/audio.
  await page.waitForTimeout(1200);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save video', exact: false }).click();
  const download = await pending,
    chunks = [],
    stream = await download.createReadStream();
  for await (const chunk of stream) chunks.push(chunk);
  expect(download.suggestedFilename()).toBe('playload.webm');
  const bytes = [...Buffer.concat(chunks)];
  const expectedPatches = await page.locator('#display').evaluate((canvas) => {
    const ctx = canvas.getContext('2d');
    return [
      [0, 0],
      [624, 0],
      [0, 560],
      [624, 560],
    ].map(([x, y]) => [...ctx.getImageData(x, y, 16, 16).data]);
  });
  const result = await page.evaluate(
    async ({ bytes, expectedPatches }) => {
      const video = document.createElement('video'),
        url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'video/webm' }));
      video.muted = true;
      video.style.cssText = 'position: fixed; right: 0; bottom: 0; width: 160px';
      document.body.append(video);
      try {
        await new Promise((resolve, reject) => {
          video.onloadeddata = resolve;
          video.onerror = () => reject(new Error('Exported video could not be decoded'));
          video.src = url;
          video.load();
        });
        await video.play();
        await new Promise((resolve) => video.requestVideoFrameCallback(resolve));
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0);
        // Compare the rendered corners, including the glass edge; video quantizes RGB.
        const surroundErrors = [
          [0, 0],
          [624, 0],
          [0, 560],
          [624, 560],
        ].map(([x, y], patch) => {
          const pixels = ctx.getImageData(x, y, 16, 16).data,
            expected = expectedPatches[patch];
          let squaredError = 0;
          for (let i = 0; i < pixels.length; i += 4)
            for (let channel = 0; channel < 3; channel++)
              squaredError += (pixels[i + channel] - expected[i + channel]) ** 2;
          return Math.sqrt(squaredError / (256 * 3));
        });
        return {
          width: canvas.width,
          height: canvas.height,
          duration: video.duration,
          surroundErrors,
          top: [...ctx.getImageData(320, 16, 1, 1).data],
          center: [...ctx.getImageData(320, 288, 1, 1).data],
        };
      } finally {
        video.pause();
        video.removeAttribute('src');
        video.load();
        video.remove();
        URL.revokeObjectURL(url);
      }
    },
    { bytes, expectedPatches },
  );
  expect(result.width).toBe(640);
  expect(result.height).toBe(576);
  expect(result.duration).toBeGreaterThan(0.5);
  for (const error of result.surroundErrors) expect(error).toBeLessThanOrEqual(8);
  expect(result.top[0]).toBeGreaterThan(100);
  expect(result.center[0]).toBeGreaterThan(100);
});

test('static and paused CRT games keep recording recent frames without repeating the shader', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const draw = WebGLRenderingContext.prototype.drawArrays;
    window.crtPaints = 0;
    WebGLRenderingContext.prototype.drawArrays = function (...args) {
      window.crtPaints++;
      return draw.apply(this, args);
    };
  });
  await run(page, 'function tick() { cls(7) }');
  await expect(page.locator('#record')).toBeEnabled();
  await page.locator('#record').click();
  const paints = await page.evaluate(() => window.crtPaints);
  expect(paints).toBeGreaterThan(0);
  // Cross the rolling limit, including several seconds of a paused game.
  await page.waitForTimeout(6500);
  await page.locator('#pause').click();
  await page.waitForTimeout(6850);
  expect(await page.evaluate(() => window.crtPaints)).toBe(paints);
  const pending = page.waitForEvent('download');
  await page.locator('#video').click();
  const chunks = [];
  for await (const chunk of await (await pending).createReadStream()) chunks.push(chunk);
  const buffer = new WebMBuffer();
  buffer.begin(0);
  buffer.append(Buffer.concat(chunks));
  const pictures = buffer.frames.filter((frame) => frame.kind === 1);
  expect(pictures.length).toBeGreaterThan(100);
  expect(pictures.at(-1).time - pictures[0].time).toBeGreaterThan(7800);
  expect(pictures.at(-1).time - pictures[0].time).toBeLessThanOrEqual(10000);
  for (let i = 1; i < pictures.length; i++)
    expect(pictures[i].time - pictures[i - 1].time).toBeLessThan(500);
  await expect(page.locator('#status')).toBeEmpty();
});

test('a black CRT screen retains a visible curved contour without recoloring game black', async ({
  page,
}) => {
  await run(page, 'function tick() { cls(0) }');
  await expect(page.locator('#pause')).toBeEnabled();
  for (const [x, y] of [
    [0, 0],
    [639, 575],
    [639, 0],
    [0, 575],
  ])
    expect(await pixel(page, x, y)).toEqual([33, 28, 41, 255]);
  // The widest sections now reach the canvas edges. Past the outer half-pixel
  // transition, game black stays black even beside those four boundaries.
  for (const [x, y] of [
    [320, 4],
    [320, 571],
    [4, 288],
    [635, 288],
  ])
    expect(await pixel(page, x, y)).toEqual([0, 0, 0, 255]);
  expect(await pixel(page, 320, 288)).toEqual([0, 0, 0, 255]);
  await page.locator('#crt').click();
  expect(await pixel(page)).toEqual([0, 0, 0, 255]);
});

test('the shared chiptune demo exports audible music while speaker monitoring is muted', async ({
  page,
}) => {
  const source = await readFile(new URL('../../examples/chiptune.js', import.meta.url), 'utf8');
  await page.goto('/playload/app/');
  const hash = await page.evaluate(
    async (source) => (await (await import('/src/payload.js')).encode(source)).hash,
    source,
  );
  await page.goto('/playload/app/' + hash);
  await page.locator('#start-game').click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
  await page.locator('#screen').click();
  await page.getByRole('button', { name: 'Sound', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sound', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.getByRole('button', { name: 'New clip', exact: false }).click();
  // A media export check needs a real interval of recorded frames/audio.
  await page.waitForTimeout(1200);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save video', exact: false }).click();
  const download = await pending,
    chunks = [],
    stream = await download.createReadStream();
  for await (const chunk of stream) chunks.push(chunk);
  const result = await page.evaluate(
    async (bytes) => {
      const context = new AudioContext();
      try {
        const audio = await context.decodeAudioData(new Uint8Array(bytes).buffer);
        const samples = audio.getChannelData(0);
        let energy = 0;
        for (const value of samples) energy += value * value;
        return { duration: audio.duration, rms: Math.sqrt(energy / samples.length) };
      } finally {
        await context.close();
      }
    },
    [...Buffer.concat(chunks)],
  );
  expect(result.duration).toBeGreaterThan(0.5);
  expect(result.rms).toBeGreaterThan(0.005);
});

test('video keeps the latest ten seconds with continuous sound and advances after saving', async ({
  page,
}, testInfo) => {
  await run(
    page,
    'let frame = 0; play(0, "V15O5N9a))"); function tick() { cls(Math.floor(frame++ / 60) % 8); }',
    true,
  );
  await expect(page.locator('#pause')).toBeEnabled();
  await page.getByRole('button', { name: 'New clip', exact: false }).click();
  // Cross the rolling limit and several recorder flushes.
  await page.waitForTimeout(13350);
  const recordings = [];
  for (const name of ['rolling.webm', 'rolling-continued.webm']) {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save video', exact: false }).click();
    const download = await pending;
    await download.saveAs(testInfo.outputPath(name));
    const chunks = [];
    for await (const chunk of await download.createReadStream()) chunks.push(chunk);
    const result = await page.evaluate(
      async (bytes) => {
        const context = new AudioContext(),
          video = document.createElement('video'),
          buffer = new Uint8Array(bytes).buffer,
          url = URL.createObjectURL(new Blob([buffer], { type: 'video/webm' }));
        video.muted = true;
        // WebKit can skip presentation callbacks for a detached video.
        video.style.cssText = 'position: fixed; right: 0; bottom: 0; width: 160px';
        document.body.append(video);
        try {
          const audio = await context.decodeAudioData(buffer.slice(0)),
            samples = audio.getChannelData(0),
            window = Math.round(audio.sampleRate * 0.02);
          let minimumRMS = Infinity;
          // Exclude codec start/end padding; a sustained tone must span every join.
          for (let start = window * 5; start + window * 5 < samples.length; start += window) {
            let energy = 0;
            for (let i = start; i < start + window; i++) energy += samples[i] * samples[i];
            minimumRMS = Math.min(minimumRMS, Math.sqrt(energy / window));
          }
          await new Promise((resolve, reject) => {
            video.onloadeddata = resolve;
            video.onerror = () => reject(new Error('Exported video could not be decoded'));
            video.src = url;
            video.load();
          });
          await video.play();
          await new Promise((resolve) => video.requestVideoFrameCallback(resolve));
          video.pause();
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(video, 0, 0);
          return {
            duration: video.duration,
            audioDuration: audio.duration,
            minimumRMS,
            firstColor: [...ctx.getImageData(320, 240, 1, 1).data],
          };
        } finally {
          await context.close();
          video.removeAttribute('src');
          video.load();
          video.remove();
          URL.revokeObjectURL(url);
        }
      },
      [...Buffer.concat(chunks)],
    );
    // WebKit emits keyframes about two seconds apart, despite the one-second hint.
    expect(result.duration).toBeGreaterThan(7.8);
    expect(result.duration).toBeLessThanOrEqual(10.1);
    expect(Math.abs(result.audioDuration - result.duration)).toBeLessThan(0.25);
    expect(result.minimumRMS).toBeGreaterThan(0.001);
    recordings.push(result);
    if (recordings.length === 1) {
      await page.getByRole('tab', { name: 'Info', exact: true }).click();
      await page.waitForTimeout(500);
      await page.getByRole('tab', { name: 'Play', exact: true }).click();
      await page.waitForTimeout(2200);
    }
  }
  expect(recordings[1].firstColor).not.toEqual(recordings[0].firstColor);
});

test('the CRT shader reconstructs glowing phosphors while retaining black and a readable white level', async ({
  page,
}) => {
  await page.goto('/playload/app/');
  const result = await page.evaluate(async () => {
    const { createCRT } = await import('/src/app/crt.js'),
      { palette } = await import('/src/engine/engine.js');
    const renderer = createCRT(palette);
    if (!renderer) return { available: false };
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 576;
    const ctx = canvas.getContext('2d'),
      pixels = new Uint8Array(160 * 144);
    const read = () => {
      ctx.drawImage(renderer.canvas, 0, 0);
      return ctx.getImageData(0, 0, 640, 576).data;
    };
    pixels[72 * 160 + 80] = 7;
    renderer.render(pixels);
    const dot = read();
    let glow = 0,
      peak = 0;
    for (let y = 280; y < 301; y++)
      for (let x = 312; x < 333; x++) {
        const value = dot[(y * 640 + x) * 4];
        peak = Math.max(peak, value);
        if (x < 320 || x > 324 || y < 288 || y > 292) glow = Math.max(glow, value);
      }
    pixels.fill(7);
    renderer.render(pixels);
    const white = read();
    let total = 0;
    for (let y = 200; y < 376; y++)
      for (let x = 200; x < 440; x++) total += white[(y * 640 + x) * 4];
    const average = total / (176 * 240);
    const sample = (offset) => [...white.slice(offset, offset + 3)];
    const stripes = [0, 1, 2].map((dx) => sample((288 * 640 + 300 + dx) * 4));
    pixels.fill(0);
    renderer.render(pixels);
    const black = read();
    return {
      available: true,
      peak,
      glow,
      average,
      stripes,
      black: black.every((value, index) => value === (index % 4 === 3 ? 255 : 0)),
    };
  });
  expect(result.available).toBe(true);
  expect(result.peak).toBeGreaterThan(150);
  expect(result.glow).toBeGreaterThan(5);
  expect(result.average).toBeGreaterThan(190);
  expect(result.average).toBeLessThan(250);
  expect(result.stripes.some(([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b) > 5)).toBe(true);
  expect(result.black).toBe(true);
});

test('WebGL being unavailable disables CRT and retains a flat captured picture', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return type === 'webgl' ? null : getContext.call(this, type, ...args);
    };
  });
  await run(page, 'function tick() { cls(7) }');
  await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
  await expect(page.locator('#crt')).toBeDisabled();
  await expect(page.locator('#crt')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#display')).toHaveAttribute('data-crt', 'false');
  expect(await pixel(page, 320, 288)).toEqual([220, 245, 255, 255]);
  expect(await pixel(page)).toEqual([220, 245, 255, 255]);
});

test('losing the WebGL context disables CRT and keeps the game drawing flat frames', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      const context = getContext.call(this, type, ...args);
      if (type === 'webgl') window.gameGL = context;
      return context;
    };
  });
  await run(page, 'function tick() { cls(7); }');
  await expect(page.locator('#pause')).toBeEnabled();
  await page.evaluate(async () => {
    const { createDisplay } = await import('/src/app/display.js'),
      { palette } = await import('/src/engine/engine.js'),
      canvas = document.querySelector('#display'),
      display = createDisplay(palette, canvas.width, canvas.height);
    window.flatFrame = display.render(new Uint8Array(160 * 144).fill(7)).slice();
    if (!window.gameGL) throw new Error('Expected an active WebGL context');
    const loss = window.gameGL.getExtension('WEBGL_lose_context');
    if (!loss) throw new Error('Expected WEBGL_lose_context');
    loss.loseContext();
  });
  await expect.poll(() => page.evaluate(() => window.gameGL.isContextLost())).toBe(true);
  await expect
    .poll(() =>
      page.locator('#display').evaluate((canvas) => {
        const actual = canvas.getContext('2d').getImageData(0, 0, 640, 576).data;
        return actual.every((value, index) => value === window.flatFrame[index]);
      }),
    )
    .toBe(true);
  await expect(page.locator('#error')).toBeHidden();
  await expect(page.locator('#crt')).toBeDisabled();
  await expect(page.locator('#crt')).toHaveAttribute('aria-pressed', 'false');
  expect(await pixel(page)).toEqual([220, 245, 255, 255]);
});

for (const fallback of [false, true]) {
  test(`the waiting screen uses ${fallback ? 'a flat picture without WebGL' : 'CRT'} before Run`, async ({
    page,
  }) => {
    if (fallback)
      await page.addInitScript(() => {
        const getContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, ...args) {
          return type === 'webgl' ? null : getContext.call(this, type, ...args);
        };
      });
    await page.goto('/playload/app/');
    await expect(page.locator('#screen')).toBeFocused();
    await expect(page.locator('#display')).toBeVisible();
    await expect(page.locator('#pause')).toBeDisabled();
    expect(await pixel(page)).toEqual(fallback ? [0, 0, 0, 255] : [33, 28, 41, 255]);
    await expectCenteredWelcome(page);
    if (fallback) {
      await expect(page.locator('#crt')).toBeDisabled();
      await expect(page.locator('#crt')).toHaveAttribute('aria-pressed', 'false');
      await expect(page.locator('#start-game')).toBeVisible();
      return;
    }
    const widths = await page.locator('#display').evaluate((canvas) => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, 640, 576).data;
      return [8, 288].map((y) => {
        let width = 0;
        for (let x = 0; x < 640; x++) {
          const i = (y * 640 + x) * 4;
          if (pixels[i] !== 33 || pixels[i + 1] !== 28 || pixels[i + 2] !== 41) width++;
        }
        return width;
      });
    });
    expect(widths[1]).toBeGreaterThan(widths[0]);
    await page.locator('#crt').click();
    expect(await pixel(page)).toEqual([0, 0, 0, 255]);
    await page.locator('#crt').click();
    expect(await pixel(page)).toEqual([33, 28, 41, 255]);
    await expect(page.locator('#pause')).toBeDisabled();
    await expect(page.locator('#start-game')).toBeVisible();
  });
}

test.describe('touch player', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 375, height: 812 } });
  test.beforeEach(async ({ page }) => {
    // Establish a mobile viewport before resizing the otherwise empty page.
    await page.setContent('<meta name="viewport" content="width=device-width">');
  });
  test('slow glyph loading never exposes the editor or desktop toolbar', async ({
    page,
  }, testInfo) => {
    for (const [width, height] of [
      [375, 812],
      [768, 1024],
    ]) {
      await page.setViewportSize({ width, height });
      let release;
      const blocked = new Promise((resolve) => {
        release = resolve;
      });
      const holdGlyphs = async (route) => {
        await blocked;
        await route.continue();
      };
      await page.route('**/playload/assets/bundles/app-*.js', holdGlyphs);
      try {
        await page.goto('/playload/app/', { waitUntil: 'commit' });
        await page.locator('#logo').waitFor({ state: 'attached' });
        await expect(page.locator('#app')).toBeHidden();
        await expect(page.locator('#editor')).toBeHidden();
        await expect(page.locator('#divider')).toBeHidden();
        await expect(page.locator('#workspace-toolbar')).toBeHidden();
        release();
        await expect(page.locator('#start-game')).toBeVisible();
        await expect(page.locator('#logo')).toBeVisible();
        await expect(page.locator('#editor')).toBeHidden();
        await expect(page.locator('#workspace-toolbar')).toBeHidden();
        await page.screenshot({ path: testInfo.outputPath(`after-initialization-${width}.png`) });
      } finally {
        release();
        await page.unroute('**/playload/assets/bundles/app-*.js', holdGlyphs);
      }
    }
  });

  test('touch controls prevent text selection and long-press menus without blocking the editor', async ({
    page,
  }) => {
    await page.goto('/playload/app/');
    for (const selector of [
      '#app',
      'header',
      '#version',
      '.intro',
      '#viewport',
      '#picture',
      '.stage',
      '.touch',
      '.dpad',
      '.ab',
      '[data-input]',
      '#tools-toggle',
      'button kbd',
    ]) {
      for (const control of await page.locator(selector).all()) {
        const selection = await control.evaluate((element) => {
          // Firefox reports auto on descendants; its used value follows the parent.
          while (element) {
            const style = getComputedStyle(element),
              value = style.userSelect || style.webkitUserSelect;
            if (value && value !== 'auto') return value;
            element = element.parentElement;
          }
        });
        expect(selection).toBe('none');
      }
    }
    await expect(page.locator('.dpad')).toHaveCSS('touch-action', 'none');
    for (const selector of [
      '.dpad',
      '[data-input="0"]',
      '.ab',
      '[data-input="4"]',
      '#viewport',
      '#display',
      'header',
      '#version',
      '#home-link',
      '#start-game',
      '#tools-toggle',
      '#play-tab',
    ])
      expect(await touchStartCanceled(page, selector)).toBe(true);
    expect(
      await page
        .locator('.dpad')
        .evaluate((element) =>
          element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })),
        ),
    ).toBe(false);
    await page.locator('#start-game').tap();
    const version = await page.locator('#version').boundingBox();
    await page.mouse.move(version.x, version.y + version.height / 2);
    await page.mouse.down();
    await page.mouse.move(version.x + version.width, version.y + version.height / 2, { steps: 5 });
    await page.mouse.up();
    expect(await page.evaluate(() => window.getSelection().toString())).toBe('');
    await page.locator('#screen').focus();
    await page.evaluate(() => {
      window.gameFocusTargets = [];
      window.toolClicks = {};
      document.addEventListener('focusin', (event) => {
        window.gameFocusTargets.push(event.target.id || event.target.tagName);
      });
      document.addEventListener('click', (event) => {
        const id = event.target.closest('button')?.id;
        if (id) window.toolClicks[id] = (window.toolClicks[id] || 0) + 1;
      });
    });
    for (const id of [0, 1, 2, 3, 4, 5]) await page.locator(`[data-input="${id}"]`).tap();
    await expect(page.locator('#screen')).toBeFocused();
    expect(
      await page.evaluate(() => window.gameFocusTargets.filter((id) => id !== 'screen')),
    ).toEqual([]);
    await page.locator('#tools-toggle').tap();
    expect(await page.evaluate(() => window.toolClicks['tools-toggle'])).toBe(1);
    const menuScrolls = await page
      .locator('#workspace-toolbar')
      .evaluate(
        (element) =>
          element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight,
      );
    expect(await touchStartCanceled(page, '#workspace-toolbar')).toBe(!menuScrolls);
    expect(await touchStartCanceled(page, '#code-toggle')).toBe(!menuScrolls);
    await page.locator('#code-toggle').tap();
    const editor = page.locator('#editor');
    await expect(page.locator('#screen')).toBeFocused();
    await editor.tap();
    await expect(editor).toBeFocused();
    expect(await touchStartCanceled(page, '#editor')).toBe(false);
    expect(await touchStartCanceled(page, '#viewport')).toBe(false);
    expect(await editor.evaluate((element) => getComputedStyle(element).webkitUserSelect)).not.toBe(
      'none',
    );
    await editor.fill('Editable code');
    await editor.evaluate((element) => element.setSelectionRange(0, 8));
    expect(
      await editor.evaluate((element) =>
        element.value.slice(element.selectionStart, element.selectionEnd),
      ),
    ).toBe('Editable');

    await page.locator('#info-tab').tap();
    expect(await page.evaluate(() => window.toolClicks['info-tab'])).toBe(1);
    expect(await touchStartCanceled(page, '#palette .color')).toBe(true);
    const tabsScroll = await page
      .locator('.reference-scroll')
      .evaluate(
        (element) =>
          element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight,
      );
    expect(await touchStartCanceled(page, '#api-tab')).toBe(!tabsScroll);
    await page.getByRole('tab', { name: 'API', exact: true }).tap();
    const description = page.locator('#api .reference-description').first();
    expect(await touchStartCanceled(page, '#api .reference-description')).toBe(false);
    expect(
      await description.evaluate((element) => getComputedStyle(element).webkitUserSelect),
    ).not.toBe('none');
    const bounds = await description.boundingBox();
    await page.mouse.move(bounds.x + 1, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 160, bounds.y + bounds.height / 2, { steps: 5 });
    await page.mouse.up();
    expect(await page.evaluate(() => window.getSelection().toString())).toContain('character');

    await page.locator('#play-tab').tap();
    await page.locator('#tools-toggle').tap();
    await page.locator('#code-toggle').tap();
    await expect(editor).toBeHidden();
    await expect(page.locator('#app')).toHaveCSS('user-select', 'none');
    expect(
      await page.evaluate(() => ({
        tools: window.toolClicks['tools-toggle'],
        code: window.toolClicks['code-toggle'],
        play: window.toolClicks['play-tab'],
      })),
    ).toEqual({ tools: 2, code: 2, play: 1 });
  });

  test('tapping the play frame padding starts play and returns focus from open tools', async ({
    page,
  }) => {
    await page.goto('/playload/app/');
    await expect(page.locator('#start-game')).toBeVisible();
    await page.locator('#play-tab').focus();
    await page.evaluate(() => {
      window.gameFocusTargets = [];
      document.addEventListener('focusin', (event) => {
        window.gameFocusTargets.push(event.target.id || event.target.tagName);
      });
    });
    const viewport = page.locator('#viewport');
    await viewport.tap({ position: { x: 2, y: 2 } });
    await expect(page.locator('#screen')).toBeFocused();
    await expect(page.locator('#start-game')).toBeHidden();
    await expect(page.locator('#pause')).toBeEnabled();
    expect(await page.evaluate(() => window.gameFocusTargets)).toEqual(['screen']);

    await page.locator('#tools-toggle').tap();
    await page.locator('#code-toggle').click();
    await page.locator('#editor').tap();
    await expect(page.locator('#editor')).toBeFocused();
    await page.locator('#tools-toggle').tap();
    const bounds = await viewport.boundingBox();
    await page.evaluate(() => (window.gameFocusTargets = []));
    await viewport.tap({ position: { x: 2, y: bounds.height - 2 } });
    await expect(page.locator('#tools-toggle')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#screen')).toBeFocused();
    await expect(page.locator('#editor')).toBeVisible();
    expect(await page.evaluate(() => window.gameFocusTargets)).toEqual(['screen']);
  });

  test('CRT and sound taps preserve the focused pane while tools are open', async ({ page }) => {
    await page.goto('/playload/app/');
    await page.locator('#start-game').tap();
    await page.locator('#tools-toggle').tap();
    await page.locator('#code-toggle').tap();
    await page.locator('#tools-toggle').tap();

    for (const pane of ['editor', 'screen']) {
      const focused = page.locator('#' + pane);
      await focused.focus();
      for (const id of ['crt', 'sound']) {
        const toggle = page.locator('#' + id);
        for (const pressed of ['false', 'true']) {
          await toggle.tap();
          await expect(toggle).toHaveAttribute('aria-pressed', pressed);
          await expect(focused).toBeFocused();
          await expect(page.locator('#tools-toggle')).toHaveAttribute('aria-expanded', 'true');
        }
      }
    }
  });

  test('editing, running and returning to play retain the source and visible controls', async ({
    page,
  }) => {
    const source = `// @title Tap test
let color = 4;

function tick() {
  if (btnp(4)) color = 6;
  cls(color);
}
`;
    for (const [width, height] of [
      [375, 568],
      [568, 320],
      [844, 390],
      [768, 1024],
      [1024, 768],
    ]) {
      await page.setViewportSize({ width, height });
      await page.goto('/playload/app/');
      await page.locator('#tools-toggle').tap();
      await page.locator('#code-toggle').tap();
      const editor = page.locator('#editor');
      await expect(page.locator('#screen')).toBeFocused();
      // Native iPhone focus zooms text fields smaller than 16px.
      await editor.tap({ position: { x: 80, y: 24 } });
      await expect(editor).toBeFocused();
      const fonts = await page
        .locator('#editor, #editor-highlight, #editor-line-numbers')
        .evaluateAll((elements) =>
          elements.map((element) => {
            const style = getComputedStyle(element);
            return [parseFloat(style.fontSize), parseFloat(style.lineHeight)];
          }),
        );
      expect(fonts.every(([size]) => size >= 16)).toBe(true);
      expect(new Set(fonts.map(([size, height]) => `${size}/${height}`)).size).toBe(1);
      await editor.fill(source);
      await expect(page).toHaveTitle('Tap test — Playload');
      await expect
        .poll(() =>
          page.evaluate(async () => {
            if (!location.hash) return null;
            return (await import('/src/payload.js')).decode(location.hash);
          }),
        )
        .toBe(source);

      await page.locator('#tools-toggle').tap();
      await page.locator('#crt').tap();
      const menu = await page.locator('#workspace-toolbar').boundingBox();
      expect(menu.y).toBeGreaterThanOrEqual(0);
      expect(menu.y + menu.height).toBeLessThanOrEqual(height);
      await expect(page.locator('#tools-toggle')).toHaveAttribute('aria-expanded', 'true');
      await page.locator('#run').tap();
      await expect(editor).toBeFocused();
      await page.locator('#game').scrollIntoViewIfNeeded();
      await page.locator('#screen').tap();
      await expect(page.locator('#screen')).toBeFocused();
      await expect(page.locator('#start-game')).toBeHidden();
      await expect.poll(() => pixel(page)).toEqual([80, 140, 215, 255]);
      for (const control of await page.locator('[data-input]').all()) {
        const bounds = await control.boundingBox();
        expect(bounds.y).toBeGreaterThanOrEqual(0);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(height + 1);
      }
      await page.locator('[data-input="4"]').tap();
      await expect.poll(() => pixel(page)).toEqual([230, 200, 110, 255]);

      await page.locator('#tools-toggle').tap();
      await page.locator('#pause').tap();
      await expect(page.locator('#screen')).toBeFocused();
      await editor.tap();
      await expect(editor).toBeFocused();
      await expect(page.locator('#pause')).toContainText('Resume');
      expect((await editor.boundingBox()).y).toBeGreaterThanOrEqual(0);
      const pausedImage = await page.locator('#display').evaluate((canvas) => canvas.toDataURL());
      await page.locator('#tools-toggle').tap();
      await page.locator('#tools-toggle').tap();
      await expect(page.locator('#pause')).toContainText('Resume');
      expect(await page.locator('#display').evaluate((canvas) => canvas.toDataURL())).toBe(
        pausedImage,
      );
      await page.locator('#tools-toggle').tap();
      await page.locator('#pause').tap();
      await expect(editor).toBeFocused();
      await page.locator('#screen').tap();
      await expect(page.locator('#screen')).toBeFocused();
      await expect.poll(() => pixel(page)).toEqual([230, 200, 110, 255]);

      await page.locator('#tools-toggle').tap();
      await page.locator('#code-toggle').tap();
      await expect(editor).toBeHidden();
      await expect(page.locator('#screen')).toBeFocused();
      await page.locator('#info-tab').tap();
      await page.locator('#play-tab').tap();
      await expect(editor).toHaveValue(source);
      await expect(editor).toBeHidden();
      await expect(page.locator('#screen')).toBeFocused();
      for (let cycle = 0; cycle < 2; cycle++) {
        await page.locator('#tools-toggle').tap();
        await page.locator('#code-toggle').tap();
        await expect(page.locator('#screen')).toBeFocused();
        await editor.tap({ position: { x: 80, y: 24 } });
        await expect(editor).toBeFocused();
        await editor.evaluate((element) => {
          element.scrollLeft = element.scrollWidth;
          element.scrollTop = element.scrollHeight;
          window.scrollTo(0, document.documentElement.scrollHeight);
        });
        await page.locator('#tools-toggle').tap();
        await page.locator('#code-toggle').tap();
        await expect(editor).toBeHidden();
        await expect(page.locator('#screen')).toBeFocused();

        const layout = await page.evaluate(() => ({
          scroll: [scrollX, scrollY],
          size: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
          controls: [...document.querySelectorAll('header, #viewport, [data-input]')].map(
            (element) => {
              const rect = element.getBoundingClientRect();
              return [rect.left, rect.top, rect.right, rect.bottom];
            },
          ),
        }));
        expect(layout.scroll).toEqual([0, 0]);
        expect(layout.size).toEqual([width, height]);
        for (const [left, top, right, bottom] of layout.controls) {
          expect(left).toBeGreaterThanOrEqual(0);
          expect(top).toBeGreaterThanOrEqual(0);
          expect(right).toBeLessThanOrEqual(width);
          expect(bottom).toBeLessThanOrEqual(height);
        }
      }
      await expect.poll(() => pixel(page)).toEqual([230, 200, 110, 255]);
    }
  });
  test('an error on the first tick is revealed and its line returns to visible editing', async ({
    page,
    browserName,
  }) => {
    for (const [width, height] of [
      [375, 568],
      [375, 350],
      [568, 320],
      [768, 1024],
    ]) {
      await page.setViewportSize({ width, height });
      await page.goto('/playload/app/');
      await page.locator('#tools-toggle').tap();
      await page.locator('#code-toggle').tap();
      await page
        .locator('#editor')
        .fill(
          '// Context\n'.repeat(60) +
            'function tick() {\n  throw new Error("First tick\\n".repeat(20));\n}',
        );
      await page.locator('#tools-toggle').tap();
      await page.locator('#run').tap();
      await expect(page.locator('#error')).toContainText('First tick');
      await expect(page.locator('#editor')).toBeFocused();
      await page.locator('#game').scrollIntoViewIfNeeded();
      const notice = await page.locator('#error-notice').boundingBox();
      expect(notice.y).toBeGreaterThanOrEqual(0);
      expect(notice.y + notice.height).toBeLessThanOrEqual(height);
      for (const selector of ['#error-notice', '#error', '#error-line'])
        expect(await touchStartCanceled(page, selector)).toBe(false);
      const error = page.locator('#error');
      expect(await error.evaluate((element) => element.scrollHeight)).toBeGreaterThan(
        await error.evaluate((element) => element.clientHeight),
      );
      if (browserName === 'chromium' && width === 375 && height === 568) {
        const session = await page.context().newCDPSession(page);
        const bounds = await error.boundingBox();
        const start = bounds.y + bounds.height - 10;
        await session.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [{ id: 0, x: bounds.x + bounds.width / 2, y: start }],
        });
        for (let step = 1; step <= 5; step++)
          await session.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{ id: 0, x: bounds.x + bounds.width / 2, y: start - step * 10 }],
          });
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await expect.poll(() => error.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
        await session.detach();
      }
      await page.locator('#error-line').tap();
      await expect(page.locator('#editor')).toBeFocused();
      expect((await page.locator('#editor').boundingBox()).y).toBeGreaterThanOrEqual(0);
      const line = await page.locator('#editor').evaluate((editor) => {
        const style = getComputedStyle(editor),
          height = parseFloat(style.lineHeight),
          index = editor.value.slice(0, editor.selectionStart).split('\n').length - 1,
          top =
            editor.getBoundingClientRect().top +
            parseFloat(style.paddingTop) +
            index * height -
            editor.scrollTop;
        return { top, bottom: top + height };
      });
      expect(line.top).toBeGreaterThanOrEqual(0);
      expect(line.bottom).toBeLessThanOrEqual(height);
      await page.locator('#editor').fill('function tick() { cls(7) }');
      await page.locator('#tools-toggle').tap();
      await page.locator('#run').tap();
      await expect(page.locator('#error-notice')).toBeHidden();
      await expect(page.locator('#pause')).toBeEnabled();
      await expect(page.locator('#editor')).toBeFocused();
    }
  });
  test('shared games execute no code or sound before their first play action', async ({
    page: phone,
    browser,
  }) => {
    const monitorResources = () => {
      const Worker = window.Worker,
        Context = window.AudioContext;
      window.gameWorkers = 0;
      window.audioContexts = 0;
      window.Worker = class extends Worker {
        constructor(...args) {
          super(...args);
          window.gameWorkers++;
        }
      };
      window.AudioContext = class extends Context {
        constructor(...args) {
          super(...args);
          window.audioContexts++;
        }
      };
      const Node = window.AudioWorkletNode;
      window.AudioWorkletNode = class extends Node {
        constructor(context, ...args) {
          super(context, ...args);
          window.gameAnalyser = context.createAnalyser();
          this.connect(window.gameAnalyser);
        }
      };
    };
    await phone.addInitScript(monitorResources);
    const desktop = await browser.newPage({
      viewport: { width: 1280, height: 800 },
      hasTouch: false,
      isMobile: false,
    });
    try {
      await desktop.addInitScript(monitorResources);
      const { hash } = await encode(
        'let frames = 0; play(0, "T240O5N3c))"); function tick() { cls(0); put(1, 1, String(frames++)); }',
      );
      for (const [width, height, selector, touch = true] of [
        [375, 812, '#start-game'],
        [375, 812, '[data-input="4"]'],
        [375, 812, '#tools-toggle'],
        [768, 1024, '#start-game'],
        [1024, 768, '[data-input="4"]'],
        [1280, 800, '#start-game', false],
        [1280, 800, 'keyboard', false],
      ]) {
        const page = touch ? phone : desktop;
        const sound = () =>
          page.evaluate(() => {
            if (!window.gameAnalyser) return -1;
            const samples = new Float32Array(window.gameAnalyser.fftSize);
            window.gameAnalyser.getFloatTimeDomainData(samples);
            return Math.max(...samples.map(Math.abs));
          });
        await page.setViewportSize({ width, height });
        await page.goto('/playload/app/');
        await page.goto('/playload/app/' + hash);
        await expect(page.locator('#start-game')).toHaveText(
          touch ? 'Tap to play' : 'Click to play',
        );
        await expect(page.locator('#screen')).toBeFocused();
        await expectCenteredWelcome(page);
        await expect.poll(sound).toBe(-1);
        expect(await page.evaluate(() => [window.gameWorkers, window.audioContexts])).toEqual([
          0, 0,
        ]);
        const preview = await page.locator('#display').evaluate((canvas) => canvas.toDataURL());
        await page.waitForTimeout(200);
        expect(await page.locator('#display').evaluate((canvas) => canvas.toDataURL())).toBe(
          preview,
        );
        if (touch) await expect(page.locator('#workspace-toolbar')).toBeHidden();
        else await expect(page.locator('#editor')).toBeVisible();
        await expect(page.locator('#pause')).toBeDisabled();
        if (selector === 'keyboard') await page.keyboard.press('ArrowRight');
        else if (touch) await page.locator(selector).tap();
        else await page.locator(selector).click();
        if (selector === '#tools-toggle') {
          await expect(page.locator('#start-game')).toBeVisible();
          expect(await page.evaluate(() => [window.gameWorkers, window.audioContexts])).toEqual([
            0, 0,
          ]);
          await page.locator('#start-game').tap();
        }
        await expect(page.locator('#start-game')).toBeHidden();
        await expect(page.locator('#pause')).toBeEnabled();
        expect(await page.evaluate(() => [window.gameWorkers, window.audioContexts])).toEqual([
          1, 1,
        ]);
        if (selector === '#tools-toggle')
          await expect(page.locator('#workspace-toolbar')).toBeHidden();
        await expect.poll(sound).toBeGreaterThan(0.001);
        await expect
          .poll(() => page.locator('#display').evaluate((canvas) => canvas.toDataURL()))
          .not.toBe(preview);
      }
    } finally {
      await desktop.close();
    }
  });
  test('the first touch unlocks sound when activation is allowed only on release', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      let phase = '',
        resetPhase;
      for (const name of ['pointerdown', 'pointerup', 'touchend', 'click']) {
        document.addEventListener(
          name,
          (event) => {
            if (!event.isTrusted) return;
            phase = event.type;
            clearTimeout(resetPhase);
            resetPhase = setTimeout(() => {
              phase = '';
            }, 0);
          },
          true,
        );
      }
      const Context = window.AudioContext;
      window.gameAudioContexts = [];
      window.audioResumes = [];
      window.AudioContext = class extends Context {
        constructor(...args) {
          super(...args);
          window.gameAudioContexts.push(this);
          super.suspend();
        }
        get state() {
          return this.released ? super.state : 'suspended';
        }
        resume() {
          window.audioResumes.push(phase);
          if (phase !== window.requiredAudioEvent) return Promise.resolve();
          this.released = true;
          return super.resume();
        }
      };
      const Node = window.AudioWorkletNode;
      window.AudioWorkletNode = class extends Node {
        constructor(context, ...args) {
          super(context, ...args);
          window.gameAnalyser = context.createAnalyser();
          this.connect(window.gameAnalyser);
        }
      };
    });
    const { hash } = await encode('play(0, "T240O5N3c))"); function tick() { cls(0); }');
    for (const event of ['pointerup', 'touchend']) {
      await page.goto('/playload/app/');
      await page.goto('/playload/app/' + hash);
      await expect(page.locator('#start-game')).toBeVisible();
      expect(await page.evaluate(() => window.gameAudioContexts.length)).toBe(0);
      await page.evaluate((event) => {
        window.requiredAudioEvent = event;
      }, event);
      if (event === 'touchend') await page.locator('#viewport').tap({ position: { x: 3, y: 3 } });
      else await page.locator('#start-game').tap();
      await expect(page.locator('#start-game')).toBeHidden();
      await expect
        .poll(() => page.evaluate(() => window.gameAudioContexts.map((context) => context.state)))
        .toEqual(['running']);
      expect(await page.evaluate((event) => window.audioResumes.includes(event), event)).toBe(true);
      await expect
        .poll(() =>
          page.evaluate(() => {
            if (!window.gameAnalyser) return 0;
            const samples = new Float32Array(window.gameAnalyser.fftSize);
            window.gameAnalyser.getFloatTimeDomainData(samples);
            return Math.max(...samples.map(Math.abs));
          }),
        )
        .toBeGreaterThan(0.001);
    }
  });
  test('portrait and landscape players fit all controls without page scrolling', async ({
    page,
    browserName,
  }) => {
    for (const [width, height] of [
      [320, 568],
      [375, 560],
      [375, 350],
      [375, 667],
      [390, 844],
      [844, 390],
      [667, 375],
      [568, 320],
      [768, 1024],
      [820, 1180],
      [1024, 768],
      [1180, 820],
      [1024, 1366],
      [1366, 1024],
    ]) {
      await page.setViewportSize({ width, height });
      await page.goto('/playload/app/');
      await expect(page.locator('#start-game')).toBeVisible();
      await expect(page.locator('#editor')).toBeHidden();
      await expect(page.locator('#pause kbd')).toBeHidden();
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(
        height,
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      const headerBottom = await page
        .locator('header')
        .evaluate((element) => element.getBoundingClientRect().bottom);
      for (const selector of ['#screen', '[data-input]']) {
        const bounds = await page.locator(selector).evaluateAll((elements) =>
          elements.map((element) => {
            const r = element.getBoundingClientRect();
            return {
              left: r.left,
              top: r.top,
              right: r.right,
              bottom: r.bottom,
              width: r.width,
              height: r.height,
            };
          }),
        );
        for (const r of bounds) {
          expect(r.left).toBeGreaterThanOrEqual(0);
          expect(r.top).toBeGreaterThanOrEqual(headerBottom);
          expect(r.right).toBeLessThanOrEqual(width);
          expect(r.bottom).toBeLessThanOrEqual(height);
          expect(Math.min(r.width, r.height)).toBeGreaterThanOrEqual(48);
        }
      }
      if (height > width) {
        const player = await page.locator('#viewport').boundingBox();
        const pad = await page.locator('.dpad').boundingBox();
        expect(
          Math.abs(player.y - headerBottom - (pad.y - player.y - player.height)),
        ).toBeLessThanOrEqual(1);
      }
      const up = await page.locator('[data-input="0"]').boundingBox();
      const down = await page.locator('[data-input="1"]').boundingBox();
      const left = await page.locator('[data-input="2"]').boundingBox();
      const right = await page.locator('[data-input="3"]').boundingBox();
      expect(up.x).toBe(down.x);
      expect(left.y).toBe(right.y);
      expect(up.y + up.height).toBe(left.y);
      expect(left.y + left.height).toBe(down.y);
      await page.locator('#tools-toggle').tap();
      await expect(page.locator('#workspace-toolbar')).toBeVisible();
      await expect(page.locator('.play-tools > #pause')).toBeVisible();
      await expect(page.locator('.touch #pause')).toHaveCount(0);
      const menu = await page.locator('#workspace-toolbar').boundingBox();
      expect(menu.x + menu.width).toBeLessThanOrEqual(width);
      expect(menu.y + menu.height).toBeLessThanOrEqual(height);
    }
    await page.setViewportSize({ width: 568, height: 220 });
    await page.goto('/playload/app/');
    await page.locator('#tools-toggle').tap();
    const toolbar = page.locator('#workspace-toolbar');
    expect(await toolbar.evaluate((element) => element.scrollHeight)).toBeGreaterThan(
      await toolbar.evaluate((element) => element.clientHeight),
    );
    expect(await touchStartCanceled(page, '#workspace-toolbar')).toBe(false);
    if (browserName === 'chromium') {
      const session = await page.context().newCDPSession(page);
      const menu = await toolbar.boundingBox();
      const start = menu.y + menu.height - 14;
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ id: 0, x: menu.x + 8, y: start }],
      });
      for (let step = 1; step <= 5; step++)
        await session.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ id: 0, x: menu.x + 8, y: start - step * 20 }],
        });
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect.poll(() => toolbar.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      await expect(page.locator('#tools-toggle')).toHaveAttribute('aria-expanded', 'true');
      expect(await page.evaluate(() => scrollY)).toBe(0);
      await session.detach();
    }
  });
  test('tools, Info, pause and rotation retain the game and its prior pause state', async ({
    page,
  }) => {
    await page.goto('/playload/app/');
    const hash = await page.evaluate(async () => {
      const { encode } = await import('/src/payload.js');
      return (
        await encode('let frames = 0; function tick() { cls(0); put(1, 1, String(frames++)); }')
      ).hash;
    });
    await page.goto('/playload/app/' + hash);
    await page.locator('#start-game').tap();
    await page.locator('#tools-toggle').tap();
    await page.locator('#pause').tap();
    await expect(page.locator('#workspace-toolbar')).toBeVisible();
    await expect(page.locator('#pause')).toContainText('Resume');
    // Let the worker's already requested frame finish before comparing frozen pictures.
    await page.waitForTimeout(100);
    const frozen = await page.locator('#display').evaluate((canvas) => canvas.toDataURL());
    await page.locator('#tools-toggle').tap();
    await page.locator('#tools-toggle').tap();
    await page.getByRole('tab', { name: 'Info', exact: true }).tap();
    await page.getByRole('tab', { name: 'Play', exact: true }).tap();
    await page.setViewportSize({ width: 812, height: 375 });
    await page.waitForTimeout(200);
    expect(await page.locator('#display').evaluate((canvas) => canvas.toDataURL())).toBe(frozen);
    await expect(page.locator('#pause')).toContainText('Resume');
    await page.locator('#pause').tap();
    await expect(page.locator('#workspace-toolbar')).toBeHidden();
    await expect(page.locator('#screen')).toBeFocused();
    await expect
      .poll(() => page.locator('#display').evaluate((canvas) => canvas.toDataURL()))
      .not.toBe(frozen);
    await page.locator('#tools-toggle').tap();
    await page.waitForTimeout(100);
    const inTools = await page.locator('#display').evaluate((canvas) => canvas.toDataURL());
    await page.waitForTimeout(200);
    expect(await page.locator('#display').evaluate((canvas) => canvas.toDataURL())).toBe(inTools);
    await page.locator('#tools-toggle').tap();
    await expect
      .poll(() => page.locator('#display').evaluate((canvas) => canvas.toDataURL()))
      .not.toBe(inTools);
    expect(new URL(page.url()).hash).toBe(hash);
  });
  test('phone tools keep Resume accessible and Run restarts the source', async ({ page }) => {
    const source = 'let color = 4; function tick() { if (btnp(4)) color = 5; cls(color); }';
    const { hash } = await encode(source);
    await page.goto('/playload/app/' + hash);
    await page.locator('#start-game').tap();
    await page.locator('#tools-toggle').tap();
    await page.locator('#crt').tap();
    await page.locator('#tools-toggle').tap();
    await expect.poll(() => pixel(page)).toEqual([80, 140, 215, 255]);
    await page.locator('[data-input="4"]').tap();
    await expect.poll(() => pixel(page)).toEqual([100, 185, 100, 255]);

    await page.locator('#tools-toggle').tap();
    await page.locator('#pause').tap();
    await expect(page.locator('#workspace-toolbar')).toBeVisible();
    await expect(page.locator('#pause')).toContainText('Resume');
    await page.locator('#tools-toggle').tap();
    await page.locator('[data-input="4"]').tap();
    await page.locator('#tools-toggle').tap();
    await page.locator('#pause').tap();
    await expect(page.locator('#workspace-toolbar')).toBeHidden();
    await expect(page.locator('#screen')).toBeFocused();
    await expect.poll(() => pixel(page)).toEqual([100, 185, 100, 255]);

    await page.locator('#tools-toggle').tap();
    await page.locator('#run').tap();
    await expect(page.locator('#workspace-toolbar')).toBeHidden();
    await expect(page.locator('#screen')).toBeFocused();
    await expect.poll(() => pixel(page)).toEqual([80, 140, 215, 255]);
    await expect(page.locator('#editor')).toHaveValue(source);
    expect(new URL(page.url()).hash).toBe(hash);
  });
  test('video can be saved from the phone tools while recording is temporarily paused', async ({
    page,
  }) => {
    await page.goto('/playload/app/');
    const supported = await page.evaluate(
      () =>
        typeof MediaRecorder !== 'undefined' &&
        ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus'].some((type) =>
          MediaRecorder.isTypeSupported(type),
        ),
    );
    test.skip(!supported, 'This browser does not support the WebM recording format.');
    await page.locator('#start-game').tap();
    await page.waitForTimeout(1200);
    await page.locator('#tools-toggle').tap();
    await expect(page.locator('#video')).toBeEnabled();
    const pending = page.waitForEvent('download');
    await page.locator('#video').tap();
    const download = await pending;
    expect(download.suggestedFilename()).toBe('playload.webm');
    const chunks = [];
    for await (const chunk of await download.createReadStream()) chunks.push(chunk);
    expect(Buffer.concat(chunks).byteLength).toBeGreaterThan(1000);
    await expect(page.locator('#workspace-toolbar')).toBeVisible();
    await page.locator('#tools-toggle').tap();
    await expect(page.locator('#pause')).toContainText('Pause');
  });
  test('a loaded phone game closes tools and receives game focus', async ({ page }) => {
    await page.addInitScript(() => {
      delete window.showOpenFilePicker;
    });
    await page.goto('/playload/app/');
    await page.locator('#tools-toggle').tap();
    await page.locator('#crt').tap();
    const pending = page.waitForEvent('filechooser');
    await page.locator('#load').tap();
    await (
      await pending
    ).setFiles({
      name: 'game.js',
      mimeType: 'text/javascript',
      buffer: Buffer.from('let color = 0; function tick() { if (btnp(4)) color = 5; cls(color); }'),
    });
    await expect(page.locator('#workspace-toolbar')).toBeHidden();
    await expect(page.locator('#screen')).toBeFocused();
    await expect(page.locator('#pause')).toBeEnabled();
    await expect.poll(() => pixel(page)).toEqual([0, 0, 0, 255]);
    await page.locator('[data-input="4"]').tap();
    await expect.poll(() => pixel(page)).toEqual([100, 185, 100, 255]);
    await expect(page.locator('#error')).toBeHidden();
  });
  test('direction and action touches work together and rotation releases a held direction', async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName !== 'chromium',
      'Multiple held touch contacts require the Chromium input protocol.',
    );
    const { hash } = await encode(
      'function tick() { for (let id = 0; id < 6; id++) put(id, 0, " ", 0, btn(id) ? 7 : 0); }',
    );
    await page.goto('/playload/app/' + hash);
    await page.locator('#start-game').tap();
    await page.locator('#tools-toggle').tap();
    await page.locator('#crt').tap();
    await page.locator('#tools-toggle').tap();
    const session = await page.context().newCDPSession(page);
    const contact = async (selector, id) => {
      const bounds = await page.locator(selector).boundingBox();
      return { id, x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    };
    const dispatch = (type, ...touchPoints) =>
      session.send('Input.dispatchTouchEvent', { type, touchPoints });
    const inputMask = () =>
      page.locator('#display').evaluate((canvas) => {
        const context = canvas.getContext('2d');
        let mask = 0;
        for (let id = 0; id < 6; id++) {
          if (context.getImageData(id * 32 + 16, 16, 1, 1).data[0] === 220) mask |= 1 << id;
        }
        return mask;
      });
    await page.evaluate(() => {
      window.touchCancellations = 0;
      window.gameFocusTargets = [];
      document.addEventListener('pointercancel', () => window.touchCancellations++);
      document.addEventListener('focusin', (event) => {
        window.gameFocusTargets.push(event.target.id || event.target.tagName);
      });
    });
    const center = await contact('.dpad', 0);
    const right = await contact('[data-input="3"]', 0);
    const left = await contact('[data-input="2"]', 0);
    const a = await contact('[data-input="4"]', 1);
    const b = await contact('[data-input="5"]', 2);
    await dispatch('touchStart', center, a, b);
    await expect.poll(inputMask).toBe(48);
    await dispatch('touchMove', right, a, b);
    await expect.poll(inputMask).toBe(56);
    for (const selector of ['[data-input="3"]', '[data-input="4"]', '[data-input="5"]']) {
      await expect(page.locator(selector)).toHaveCSS('background-color', 'rgb(230, 200, 110)');
      await expect(page.locator(selector)).toHaveCSS('color', 'rgb(33, 28, 41)');
    }
    await dispatch('touchMove', center, a, b);
    await expect(page.locator('[data-input="3"]')).toHaveAttribute('data-held', 'true');
    await expect.poll(inputMask).toBe(56);
    await dispatch('touchMove', left, a, b);
    await expect(page.locator('[data-input="2"]')).toHaveAttribute('data-held', 'true');
    await expect.poll(inputMask).toBe(52);

    const pad = await page.locator('.dpad').boundingBox();
    for (const [x, y, mask] of [
      [pad.x + 2, center.y - 4, 4],
      [pad.x + 2, pad.y + 2, 5],
      [center.x - 4, pad.y + 2, 1],
      [pad.x + pad.width - 2, pad.y + 2, 9],
      [pad.x + pad.width - 2, center.y - 4, 8],
      [pad.x + pad.width - 2, pad.y + pad.height - 2, 10],
      [center.x + 4, pad.y + pad.height - 2, 2],
      [pad.x + 2, pad.y + pad.height - 2, 6],
    ]) {
      await dispatch('touchMove', { id: 0, x, y }, a, b);
      await expect.poll(inputMask).toBe(mask | 48);
      await dispatch('touchMove', center, a, b);
      await expect.poll(inputMask).toBe(mask | 48);
    }
    await dispatch('touchMove', { id: 0, x: pad.x + 2, y: pad.y + 4 }, a, b);
    await expect(page.locator('.dpad [data-held="true"]')).toHaveCount(2);
    await expect.poll(inputMask).toBe(53);
    await dispatch('touchMove', { id: 0, x: pad.x + pad.width + 12, y: center.y }, a, b);
    await expect(page.locator('.dpad [data-held="true"]')).toHaveCount(0);
    await expect.poll(inputMask).toBe(48);
    await dispatch('touchMove', right, a, b);
    await page.waitForTimeout(800);
    await expect.poll(inputMask).toBe(56);
    expect(await page.evaluate(() => window.getSelection().toString())).toBe('');
    expect(await page.evaluate(() => window.touchCancellations)).toBe(0);
    await dispatch('touchEnd');
    await expect.poll(inputMask).toBe(0);

    await dispatch('touchStart', { id: 0, x: pad.x + 2, y: pad.y + 2 });
    await expect.poll(inputMask).toBe(5);
    await dispatch('touchMove', center);
    await expect.poll(inputMask).toBe(5);
    await dispatch('touchEnd');
    await expect.poll(inputMask).toBe(0);

    await expect(page.locator('#screen')).toBeFocused();
    expect(
      await page.evaluate(() => window.gameFocusTargets.filter((id) => id !== 'screen')),
    ).toEqual([]);

    await page.evaluate(() => {
      window.headerClicks = {};
      document.addEventListener('click', (event) => {
        const id = event.target.closest('header button')?.id;
        if (id) window.headerClicks[id] = (window.headerClicks[id] || 0) + 1;
      });
    });
    const tools = await contact('#tools-toggle', 1);
    await dispatch('touchStart', { ...tools, id: 0 });
    await dispatch('touchMove', { id: 0, x: tools.x, y: tools.y + 70 });
    await dispatch('touchEnd');
    await expect(page.locator('#workspace-toolbar')).toBeHidden();
    expect(await page.evaluate(() => window.headerClicks['tools-toggle'] || 0)).toBe(0);
    await page.locator('#tools-toggle').tap();
    await expect(page.locator('#workspace-toolbar')).toBeVisible();
    expect(await page.evaluate(() => window.headerClicks['tools-toggle'])).toBe(1);
    await page.locator('#tools-toggle').tap();
    await expect(page.locator('#workspace-toolbar')).toBeHidden();
    expect(await page.evaluate(() => window.headerClicks['tools-toggle'])).toBe(2);

    // Secondary touches can open tools without leaving a held direction behind.
    await dispatch('touchStart', right);
    await expect.poll(inputMask).toBe(8);
    await dispatch('touchStart', right, tools);
    await dispatch('touchEnd', tools);
    await expect(page.locator('#workspace-toolbar')).toBeVisible();
    expect(await page.evaluate(() => window.headerClicks['tools-toggle'])).toBe(3);
    await dispatch('touchEnd');
    expect(await page.evaluate(() => window.headerClicks['tools-toggle'])).toBe(3);
    await page.locator('#tools-toggle').tap();
    await expect.poll(inputMask).toBe(0);

    await dispatch('touchStart', right);
    const info = await contact('#info-tab', 1);
    await dispatch('touchStart', right, info);
    await dispatch('touchEnd', info);
    await expect(page.locator('body')).toHaveAttribute('data-view', 'info');
    expect(await page.evaluate(() => window.headerClicks['info-tab'])).toBe(1);
    await dispatch('touchEnd');
    expect(await page.evaluate(() => window.headerClicks['info-tab'])).toBe(1);

    const tabs = page.locator('.reference-scroll');
    const strip = await tabs.boundingBox();
    expect(await tabs.evaluate((element) => element.scrollWidth)).toBeGreaterThan(
      await tabs.evaluate((element) => element.clientWidth),
    );
    expect(await touchStartCanceled(page, '.reference-tabs')).toBe(false);
    const start = { id: 0, x: strip.x + strip.width - 20, y: strip.y + 12 };
    await dispatch('touchStart', start);
    for (let step = 1; step <= 5; step++)
      await dispatch('touchMove', { ...start, x: start.x - step * 30 });
    await dispatch('touchEnd');
    await expect.poll(() => tabs.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    await expect(page.locator('#about-tab')).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('tab', { name: 'API', exact: true }).tap();

    const api = page.locator('#api');
    const content = await api.boundingBox();
    const contentStart = { id: 0, x: content.x + 100, y: content.y + content.height - 40 };
    await dispatch('touchStart', contentStart);
    for (let step = 1; step <= 5; step++)
      await dispatch('touchMove', { ...contentStart, y: contentStart.y - step * 30 });
    await dispatch('touchEnd');
    await expect.poll(() => api.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    expect(await page.evaluate(() => [scrollX, scrollY])).toEqual([0, 0]);
    await page.locator('#play-tab').tap();
    await expect.poll(inputMask).toBe(0);
    await dispatch('touchStart', right);
    await expect.poll(inputMask).toBe(8);
    await page.setViewportSize({ width: 812, height: 375 });
    await expect.poll(inputMask).toBe(0);
    await dispatch('touchEnd');
    await session.detach();
    expect(await page.evaluate(() => scrollY)).toBe(0);
  });
  test('game controls and screen clicks preserve page position after scrolling past the editor', async ({
    page,
    browserName,
  }) => {
    await page.setViewportSize({ width: 375, height: 350 });
    await page.goto('/playload/app/');
    await page.locator('#tools-toggle').tap();
    await page.locator('#code-toggle').click();
    await page
      .locator('#editor')
      .fill('let presses = 0; function tick() { if (btnp(0)) presses++; cls(presses ? 3 : 4) }');
    await page.locator('#tools-toggle').tap();
    await page.locator('#run').tap();
    await expect(page.locator('#editor')).toBeFocused();
    await page.locator('#screen').tap();
    await expect(page.locator('#screen')).toBeFocused();
    await page.locator('#tools-toggle').tap();
    await page.locator('#crt').click();
    await page.locator('#tools-toggle').tap();
    const up = page.locator('[data-input="0"]');
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await up.scrollIntoViewIfNeeded();
    const position = await page.evaluate(() => scrollY);
    expect(position).toBeGreaterThan(0);
    expect((await page.locator('#screen').boundingBox()).y).toBeGreaterThanOrEqual(0);

    await up.tap();
    await expect.poll(() => pixel(page)).toEqual([215, 115, 85, 255]);
    expect(await page.evaluate(() => scrollY)).toBe(position);
    await expect(page.locator('#screen')).toBeFocused();
    for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
      await page.keyboard.press(key);
      await page.keyboard.press(key);
    }
    expect(await page.evaluate(() => scrollY)).toBe(position);

    await page.locator('#editor').evaluate((editor) => editor.focus({ preventScroll: true }));
    const screen = await page.locator('#screen').boundingBox();
    await page.mouse.click(screen.x + 50, screen.y + 50);
    await expect(page.locator('#screen')).toBeFocused();
    expect(await page.evaluate(() => scrollY)).toBe(position);
    expect(await touchStartCanceled(page, '#display')).toBe(false);
    if (browserName === 'chromium') {
      const session = await page.context().newCDPSession(page);
      const start = { id: 0, x: screen.x + 20, y: screen.y + 20 };
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
      for (let step = 1; step <= 5; step++)
        await session.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ ...start, y: start.y + step * 30 }],
        });
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect.poll(() => page.evaluate(() => scrollY)).toBeLessThan(position);
      await expect(page.locator('#editor')).toBeInViewport();
      await session.detach();
    }
  });
  test('CRT and touch input work in the phone player layout', async ({ page }) => {
    await page.goto('/playload/app/');
    const hash = await page.evaluate(async () => {
      const { encode } = await import('/src/payload.js');
      return (await encode('let color = 7; function tick() { if(btnp(4)) color = 6; cls(color) }'))
        .hash;
    });
    await page.goto('/playload/app/' + hash);
    await expect(page.locator('#editor')).toBeHidden();
    await expect(page.locator('#code-toggle')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#start-game')).toBeVisible();
    await expect(page.locator('#pause')).toBeDisabled();
    expect(await pixel(page)).toEqual([33, 28, 41, 255]);
    const display = await page.locator('#display').boundingBox();
    expect(display.width).toBeLessThanOrEqual(375);
    await page.locator('[data-input="4"]').tap();
    await expect(page.locator('#start-game')).toBeHidden();
    await expect(page.locator('#pause')).toBeEnabled();
    await expect.poll(async () => (await pixel(page, 320, 288))[2]).toBeGreaterThan(180);
    await page.locator('[data-input="4"]').tap();
    await expect.poll(async () => (await pixel(page, 320, 288))[2]).toBeLessThan(130);
  });
  test('touch action rows stay aligned and error text and its edit button fit', async ({
    page,
  }) => {
    for (const [width, height] of [
      [375, 812],
      [320, 568],
      [844, 390],
      [812, 375],
    ]) {
      await page.setViewportSize({ width, height });
      await page.goto('/playload/app/');
      await page.locator('#tools-toggle').tap();
      await expect(page.locator('#screenshot')).toHaveAccessibleName('Screenshot');
      if ((await page.locator('#code-toggle').getAttribute('aria-pressed')) === 'false')
        await page.locator('#code-toggle').click();
      await page
        .locator('#editor')
        .fill('function tick() {\n throw new Error("Test error: readable without clipping")\n}');
      await page.locator('#tools-toggle').tap();
      await page.locator('#run').click();
      await expect(page.locator('#error')).toContainText('Test error');
      await page.locator('#tools-toggle').tap();
      await page.locator('#code-toggle').click();
      const viewport = await page.locator('#viewport').boundingBox();
      const notice = await page.locator('#error-notice').boundingBox();
      expect(notice.x).toBeGreaterThanOrEqual(viewport.x);
      expect(notice.x + notice.width).toBeLessThanOrEqual(viewport.x + viewport.width);
      await expect(page.locator('#screen')).toBeVisible();
      const button = await page.locator('#error-line').boundingBox();
      expect(button.x).toBeGreaterThanOrEqual(viewport.x);
      expect(button.x + button.width).toBeLessThanOrEqual(viewport.x + viewport.width);
      const visible = notice;
      expect(button.y).toBeGreaterThanOrEqual(visible.y);
      expect(button.y + button.height).toBeLessThanOrEqual(visible.y + visible.height);
      expect(button.y + button.height).toBeLessThanOrEqual(viewport.y + viewport.height);
      await page.locator('#error-line').click();
      await expect(page.locator('#editor')).toBeFocused();
    }
  });
});

test('the starter reaches every screen edge and keeps collecting gems with short sounds', async ({
  page,
}) => {
  await page.goto('/playload/app/');
  const source = await page.locator('#editor').inputValue();
  const result = await page.evaluate(async (source) => {
    const { createEngine } = await import('/src/engine/engine.js');
    const { glyphs } = await import('/src/engine/glyphs.js');
    const { compileScore } = await import('/src/engine/sound.js');
    const overlaps = [];
    for (const [dx, dy] of [
      [7, 0],
      [6, 0],
      [-6, 0],
      [0, 6],
      [0, -6],
      [5, 0],
      [-5, 0],
      [0, 5],
      [0, -5],
      [5, 5],
      [-5, -5],
    ]) {
      const probe = createEngine(glyphs, compileScore);
      const game = new Function(
        ...Object.keys(probe.api),
        'dx',
        'dy',
        source + '\nx = gx * 8 + dx; y = gy * 8 + dy; return {tick,count:()=>gems};',
      )(...Object.values(probe.api), dx, dy);
      probe.step(game.tick);
      overlaps.push(game.count());
    }
    const repeatEngine = createEngine(glyphs, compileScore);
    const repeatMath = Object.create(Math);
    const repeatRandom = [0.7, 0.375, 0, 0];
    let repeatDraws = 0;
    repeatMath.random = () => repeatRandom[repeatDraws++ % repeatRandom.length];
    const repeatGame = new Function(
      ...Object.keys(repeatEngine.api),
      'Math',
      source + '\nx = gx * 8; y = gy * 8; return {tick,state:()=>({gx,gy,gems})};',
    )(...Object.values(repeatEngine.api), repeatMath);
    repeatEngine.step(repeatGame.tick);
    const sameSpot = repeatGame.state();
    const firstDraws = repeatDraws;
    repeatEngine.step(repeatGame.tick);
    const nextSpot = repeatGame.state();
    const engine = createEngine(glyphs, compileScore);
    const math = Object.create(Math);
    const random = [0.25, 0.5, 0.8, 0.75, 0.7, 0.375];
    let next = 0;
    math.random = () => random[next++ % random.length];
    const game = new Function(
      ...Object.keys(engine.api),
      'Math',
      source + '\nreturn {tick,state:()=>({x,y,gx,gy,gems})};',
    )(...Object.values(engine.api), math);
    const step = (mask, frames = 1) => {
      engine.input(mask);
      for (let i = 0; i < frames; i++) engine.step(game.tick);
    };
    step(0);
    const visible = engine.pixels.filter((color) => color === 6).length;
    const initial = game.state();
    const gem = engine.api.scr[8][14].chr;
    step(1 << 0, 200);
    const top = game.state().y;
    step(1 << 3, 200);
    const right = game.state().x;
    step(1 << 1, 200);
    const bottom = game.state().y;
    step(1 << 2, 200);
    const left = game.state().x;
    const before = engine.sounds().length;
    step(1 << 3, 112);
    step(1 << 0, 72);
    const sounds = engine.sounds();
    const message = engine.api.scr[1]
      .map((cell) => cell.chr)
      .join('')
      .trim();
    const collected = game.state();
    const removed = engine.api.scr[8][14].chr;
    step(0, 60);
    const repeats = engine.sounds().length;
    for (let i = 0; i < 9; i++) {
      const target = game.state();
      const dx = target.gx * 8 - target.x;
      step(dx < 0 ? 1 << 2 : 1 << 3, Math.abs(dx));
      const dy = target.gy * 8 - game.state().y;
      step(dy < 0 ? 1 << 0 : 1 << 1, Math.abs(dy));
    }
    const continued = game.state();
    const moreSounds = engine.sounds();
    return {
      overlaps,
      sameSpot,
      firstDraws,
      nextSpot,
      repeatDraws,
      visible,
      initial,
      gem,
      top,
      right,
      bottom,
      left,
      before,
      sounds,
      message,
      collected,
      removed,
      repeats,
      continued,
      moreSounds,
    };
  }, source);
  expect(source.trimEnd().split('\n').length).toBeLessThanOrEqual(40);
  expect(result.overlaps).toEqual([0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1]);
  expect(result.sameSpot).toEqual({ gx: 14, gy: 8, gems: 1 });
  expect(result.firstDraws).toBe(2);
  expect(result.nextSpot).toEqual({ gx: 0, gy: 2, gems: 2 });
  expect(result.repeatDraws).toBe(4);
  expect(result.visible).toBeGreaterThan(0);
  expect(result.initial).toEqual({ x: 76, y: 68, gx: 14, gy: 8, gems: 0 });
  expect(result.gem).toBe('💎');
  expect([result.top, result.right, result.bottom, result.left]).toEqual([0, 152, 136, 0]);
  expect(result.before).toBe(0);
  expect(result.sounds).toHaveLength(1);
  expect(result.sounds[0].ch).toBe(0);
  expect(result.sounds[0].score.code).toContainEqual({ op: 'T', value: 240 });
  const notes = result.sounds[0].score.code.filter((event) => event.op === 'note');
  expect(notes).toHaveLength(2);
  expect(notes.reduce((beats, note) => beats + note.beats, 0) * (60 / 240)).toBe(0.125);
  expect(result.message).toBe('GEMS 1');
  expect(result.collected).toEqual({ x: 112, y: 64, gx: 5, gy: 10, gems: 1 });
  expect(result.removed).toBe(' ');
  expect(result.repeats).toBe(0);
  expect(result.continued.gems).toBe(10);
  expect(result.moreSounds).toHaveLength(9);
});

test('keyboard bindings do not shrink or displace the centered game', async ({
  page,
}, testInfo) => {
  await run(
    page,
    'function tick() { cls(4); put(0, 16, "SCORE LIVES BOTTOM UI", 7, 3); put(0, 17, "ABCDEFGHIJKLMNOPQRST", 7, 5) }',
    true,
  );
  for (const [width, height] of [
    [1280, 500],
    [1600, 600],
    [640, 480],
    [599, 800],
    [375, 900],
  ]) {
    await page.setViewportSize({ width, height });
    await expect
      .poll(() =>
        page.evaluate(() => {
          const screen = document.getElementById('screen').getBoundingClientRect(),
            guide = document.getElementById('keyboard-controls').getBoundingClientRect(),
            frame = document.getElementById('viewport').getBoundingClientRect();
          return (
            Math.abs(screen.x + screen.width / 2 - (frame.x + frame.width / 2)) <= 1 &&
            Math.abs(screen.y + screen.height / 2 - (frame.y + frame.height / 2)) <= 1 &&
            screen.top >= frame.top &&
            screen.bottom <= frame.bottom &&
            screen.left >= frame.left &&
            screen.right <= frame.right &&
            guide.left >= frame.left &&
            guide.top >= frame.top &&
            guide.right <= frame.right &&
            guide.bottom <= frame.bottom
          );
        }),
      )
      .toBe(true);
    await expect(page.locator('#keyboard-controls')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`keyboard-${width}x${height}.png`) });
  }
});

test('keyboard bindings stay visible in Play without opening code or reference', async ({
  page,
  browser,
}) => {
  await page.goto('/playload/app/');
  const guide = page.locator('#keyboard-controls');
  await expect(guide).toHaveText('MOVE: ↑↓←→·WASDA: Z·J B: X·K');
  await expect(guide).toBeVisible();
  await page.locator('#run').click();
  await expect(page.locator('#pause')).toBeEnabled();
  await page.setViewportSize({ width: 1280, height: 800 });
  const buttons = await page
    .locator('#workspace-toolbar button')
    .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().top));
  expect(Math.max(...buttons) - Math.min(...buttons)).toBeLessThanOrEqual(1);
  await expect(page.locator('#viewport > #keyboard-controls')).toBeVisible();
  await page.locator('#code-toggle').click();
  await expect(page.locator('#editor')).toBeHidden();
  await expect(guide).toBeVisible();
  for (const width of [1400, 1280, 1200, 960, 640]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(guide).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const bounds = await guide.evaluate((element) => {
      const guide = element.getBoundingClientRect(),
        player = element.parentElement.getBoundingClientRect();
      return {
        left: guide.left - player.left,
        right: player.right - guide.right,
        bottom: player.bottom - guide.bottom,
        fits: element.scrollWidth <= element.clientWidth,
      };
    });
    expect(bounds.left).toBeGreaterThanOrEqual(6);
    expect(bounds.right).toBeCloseTo(7, 0);
    expect(bounds.bottom).toBeCloseTo(3, 0);
    expect(bounds.fits).toBe(true);
  }
  await page.locator('#info-tab').click();
  await expect(guide).toBeHidden();
  await page.locator('#play-tab').click();
  await expect(guide).toBeVisible();

  const phone = await browser.newPage({ viewport: { width: 375, height: 800 }, hasTouch: true });
  await phone.goto(baseURL + '/playload/app/');
  await expect(phone.locator('.touch')).toBeVisible();
  await expect(phone.locator('#keyboard-controls')).toBeHidden();
  await phone.close();
});

test('Play opens first, the static retro logo loads, and the starter runs', async ({
  page,
  browser,
}, testInfo) => {
  await page.goto('/playload/app/');
  await expect(page.getByRole('tab', { name: 'Play' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#play')).toBeVisible();
  await expect(page.locator('#info')).toBeHidden();
  await expect(page.locator('#logo')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Playload home' })).toHaveAttribute(
    'href',
    '/playload/',
  );
  await expect(page.locator('#home-link #logo')).toBeVisible();
  await expect(page.locator('#home-link')).not.toHaveAttribute('target');
  await expect(page.locator('.intro a')).toHaveCount(0);
  await expect
    .poll(() =>
      page.locator('#logo').evaluate((image) => image.complete && image.naturalWidth === 64),
    )
    .toBe(true);
  await expect(page.getByRole('textbox', { name: 'JavaScript code' })).toHaveValue(
    /spr\(x, y, ['"]👾['"], 6\)/,
  );
  await expect(page.locator('#workspace-toolbar button[title]')).toHaveCount(0);
  const actions = [
    'load',
    'run',
    'pause',
    'code-toggle',
    'crt',
    'sound',
    'screenshot',
    'record',
    'video',
  ];
  const toolbarBounds = async () =>
    Promise.all(actions.map((id) => page.locator('#' + id).boundingBox()));
  const before = await toolbarBounds();
  expect(before.every(Boolean)).toBe(true);
  for (const id of ['pause', 'screenshot', 'record', 'video'])
    await expect(page.locator('#' + id)).toBeDisabled();
  for (const id of ['crt', 'sound']) await expect(page.locator('#' + id)).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('develop-initial.png') });
  await page.getByRole('button', { name: 'Run', exact: false }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
  await expect(page.getByRole('alert')).toBeHidden();
  expect(await toolbarBounds()).toEqual(before);
  await expect(page.locator('.game-status, .key-hint')).toHaveCount(0);
  await expect(page.locator('#workspace-toolbar #size')).toBeVisible();
  expect(
    await page
      .locator('#size')
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
  ).toBeGreaterThanOrEqual(16);
  expect(
    await page.locator('#editor').evaluate((element) => getComputedStyle(element).borderRightWidth),
  ).toBe('1px');
  expect(
    await page
      .locator('#viewport')
      .evaluate((element) => getComputedStyle(element).borderLeftWidth),
  ).toBe('1px');
  const bottoms = await page
    .locator('#editor, #divider, #viewport')
    .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().bottom));
  expect(Math.max(...bottoms) - Math.min(...bottoms)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('develop-running.png') });
  await page.setViewportSize({ width: 375, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('develop-phone.png') });

  const phone = await browser.newPage({
    viewport: { width: 375, height: 812 },
    hasTouch: true,
    isMobile: true,
  });
  try {
    await phone.goto(baseURL + '/playload/app/');
    for (const [original, touch] of [
      [page, false],
      [phone, true],
    ]) {
      const pages = original.context().pages().length;
      if (touch) await original.locator('#home-link').tap();
      else {
        await original.locator('#home-link').focus();
        await original.keyboard.press('Enter');
      }
      await expect(original).toHaveURL(baseURL + '/playload/');
      await expect(original.locator('.readme:visible')).toBeVisible();
      expect(original.context().pages()).toHaveLength(pages);
    }
  } finally {
    await phone.close();
  }
});

test('the reference documents six functions and two variables; every example runs without copy controls', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1710, height: 895 });
  await page.goto('/playload/app/');
  await page.getByRole('tab', { name: 'Info', exact: true }).click();
  await page.getByRole('tab', { name: 'API', exact: true }).click();
  await expect(page.locator('#info')).toBeVisible();
  await expect(page.locator('.api-guide .api-group').nth(0).locator('.api-example')).toHaveCount(6);
  await expect(page.locator('.api-guide .api-group').nth(1).locator('.api-example')).toHaveCount(2);
  await expect(page.locator('.api-guide .api-group').nth(2).locator('.api-example')).toHaveCount(1);
  await expect(page.locator('.example-label')).toHaveCount(0);
  await expect(page.locator('.api-guide dt')).toHaveText([
    'cls(col)',
    'put(cx, cy, str, col1?, col2?)',
    'spr(x, y, str, col)',
    'btn(id)',
    'btnp(id)',
    'play(ch, str)',
    'pcg[chr]',
    'scr[cy][cx]',
    'tick()',
  ]);
  await expect(page.locator('.score-guide details, .score-guide summary')).toHaveCount(0);
  await expect(page.locator('.score-guide h3')).toHaveText([
    'Notes',
    'Lengths',
    'Tempo',
    'Volume & Envelope',
    'Mixer',
    'Control',
  ]);
  await expect(page.locator('.score-guide')).toContainText('W7');
  await expect(page.locator('#score-heading')).toHaveText('ZX 128 PLAY');
  await expect(page.locator('.api-guide h2')).toHaveText('API');
  await expect(page.locator('.api-guide .api-group').first().locator('dd').last()).toContainText(
    await page.locator('#score-heading').textContent(),
  );
  await page.evaluate(async () => {
    const { compileScore } = await import('/src/engine/sound.js');
    for (const code of document.querySelectorAll('.mml-group dd > code'))
      for (const line of code.textContent.split('\n'))
        compileScore(new Function('return ' + line)());
  });
  await expect(page.locator('.api-guide h3')).toHaveText(['Functions', 'Variables', 'Callback']);
  await expect(page.locator('#api button')).toHaveCount(0);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await page.screenshot({ path: testInfo.outputPath('cheat-sheet-readme.jpg'), quality: 90 });
  const examples = page.locator('#api .api-example');
  for (let i = 0; i < (await examples.count()); i++) {
    const example = examples.nth(i),
      source = await example.locator('code').textContent();
    await page.evaluate(async (source) => {
      const { createEngine } = await import('/src/engine/engine.js');
      const { glyphs } = await import('/src/engine/glyphs.js');
      const { compileScore } = await import('/src/engine/sound.js');
      const engine = createEngine(glyphs, compileScore);
      const tick = new Function(
        ...Object.keys(engine.api),
        source + '\nreturn typeof tick === "function" ? tick : null;',
      )(...Object.values(engine.api));
      if (tick) engine.step(tick);
      if (engine.pixels.some((col) => col > 7)) throw new Error('Invalid example frame');
    }, source);
  }
  for (const width of [1440, 1100, 600, 375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(
      await page
        .locator('.api-guide code')
        .evaluateAll((elements) =>
          elements.every((element) => getComputedStyle(element).whiteSpace === 'pre'),
        ),
    ).toBe(true);
    expect(
      await page
        .locator('.api-guide .api-example')
        .evaluateAll((elements) =>
          elements.every((element) => element.scrollWidth <= element.clientWidth + 1),
        ),
    ).toBe(true);
    const signatureLines = await page
      .locator('.api-guide dt')
      .evaluateAll((elements) =>
        elements.every((element) => getComputedStyle(element).whiteSpace === 'nowrap'),
      );
    expect(signatureLines).toBe(true);
    const exampleLefts = await page
      .locator('.api-guide dd')
      .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().left));
    expect(Math.max(...exampleLefts) - Math.min(...exampleLefts)).toBeLessThanOrEqual(1);
    if (width >= 1100) {
      const headingTops = await page
        .locator('.api-columns h2')
        .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().top));
      expect(Math.max(...headingTops) - Math.min(...headingTops)).toBeLessThanOrEqual(1);
      expect(
        await page
          .locator('.api-guide, .score-guide')
          .evaluateAll((elements) =>
            elements.every((element) => element.scrollWidth <= element.clientWidth + 1),
          ),
      ).toBe(true);
    }
    const mmlExampleLefts = await page
      .locator('.mml-group dd > code')
      .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().left));
    expect(Math.max(...mmlExampleLefts) - Math.min(...mmlExampleLefts)).toBeLessThanOrEqual(1);
    for (const group of ['#views button', '#workspace-toolbar button', '.reference-tabs button']) {
      const widths = await page
        .locator(group)
        .evaluateAll((elements) =>
          elements.map((element) => parseFloat(getComputedStyle(element).width)),
        );
      expect(new Set(widths).size).toBe(1);
    }
    const headerBottoms = await page.evaluate(() => {
      const range = document.createRange(),
        context = document.createElement('canvas').getContext('2d');
      return [
        document.querySelector('#logo').getBoundingClientRect().bottom,
        ...['#info-tab', 'header p']
          .map((selector) => document.querySelector(selector))
          .filter((element) => element.getClientRects().length)
          .map((element) => {
            range.selectNodeContents(element);
            context.font = getComputedStyle(element).font;
            return (
              range.getBoundingClientRect().bottom -
              context.measureText(element.textContent).fontBoundingBoxDescent
            );
          }),
      ];
    });
    expect(Math.max(...headerBottoms) - Math.min(...headerBottoms)).toBeLessThanOrEqual(2);
    await page.locator('#api').evaluate((panel) => (panel.scrollTop = 0));
    await page.locator('#status').evaluate((status) => (status.textContent = ''));
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await page.screenshot({ path: testInfo.outputPath(`api-${width}.png`) });
  }
});

test('the worker retains cells, applies live PCG changes, and draws sprites only for the current tick', async ({
  page,
}) => {
  await run(
    page,
    `
    cls(4); pcg.X.pat = '8000000000000000'; pcg.X.col = [3,1];
    put(0,0,'X');
    let x = 27;
    let visible = true;
    function tick() {
      if (btnp(4)) {
        pcg.X.col = [5,2]; scr[0][1].chr = 'X'; scr[0][1].col = [null,0];
        x = 19;
      }
      if (btnp(5)) visible = false;
      if (visible) {
        spr(x,0,'X',0);
        spr(40,0,'X',6);
        spr(40,0,'X',3);
        put(5,0,'X',5,2);
      }
    }
  `,
    true,
  );
  await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
  await expect.poll(() => pixel(page, 0, 0)).toEqual([215, 115, 85, 255]);
  await expect.poll(() => pixel(page, 108, 0)).toEqual([0, 0, 0, 255]);
  await expect.poll(() => pixel(page, 160, 0)).toEqual([215, 115, 85, 255]);
  await page.locator('#screen').focus();
  await page.keyboard.press('z');
  await expect.poll(() => pixel(page, 0, 0)).toEqual([100, 185, 100, 255]);
  await expect.poll(() => pixel(page, 4, 0)).toEqual([100, 105, 100, 255]);
  await expect.poll(() => pixel(page, 32, 0)).toEqual([100, 185, 100, 255]);
  await expect.poll(() => pixel(page, 44, 0)).toEqual([0, 0, 0, 255]);
  await expect.poll(() => pixel(page, 108, 0)).toEqual([80, 140, 215, 255]);
  await expect.poll(() => pixel(page, 76, 0)).toEqual([0, 0, 0, 255]);
  await page.keyboard.press('x');
  await expect.poll(() => pixel(page, 76, 0)).toEqual([80, 140, 215, 255]);
  await expect.poll(() => pixel(page, 160, 0)).toEqual([100, 185, 100, 255]);
});

test('the bundled page avoids stale source modules and initializes every toggle', async ({
  page,
}) => {
  // Old source modules must never initialize the bundled page.
  const stale = [];
  await page.route(/\/src\/.*\.js(?:\?.*)?$/, (route) => {
    stale.push(route.request().url());
    return route.fulfill({
      contentType: 'text/javascript',
      body: 'throw new Error("Old cached module loaded")',
    });
  });
  await page.goto('/playload/app/');
  await expect(page.getByRole('tab', { name: 'Play' })).toHaveAttribute('aria-selected', 'true');
  const code = page.locator('#code-toggle');
  await code.click();
  await expect(page.locator('#workbench')).toBeHidden();
  await code.click();
  await expect(page.locator('#workbench')).toBeVisible();
  await page.getByRole('tab', { name: 'Info', exact: true }).click();
  await page.getByRole('tab', { name: 'API', exact: true }).click();
  await expect(page.locator('#info')).toBeVisible();
  await page.getByRole('tab', { name: 'Emoji', exact: true }).click();
  await expect(page.locator('#catalog button').first()).toBeVisible();
  await page.getByRole('tab', { name: 'API', exact: true }).click();
  await expect(page.locator('#api')).toBeVisible();
  await page.getByRole('tab', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Run', exact: false }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
  for (const id of ['crt', 'sound']) {
    const toggle = page.locator('#' + id);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  }
  expect(stale).toEqual([]);
});

test('empty filename rows leave matching side and bottom margins in Play and Info', async ({
  page,
}) => {
  await page.goto('/playload/app/');
  for (const width of [1280, 1024, 800, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('.editor-status')).toBeHidden();
    for (const closed of [false, true]) {
      if ((await page.locator('#code-toggle').getAttribute('aria-pressed')) !== String(!closed))
        await page.locator('#code-toggle').click();
      if (!closed && width >= 600)
        await expect
          .poll(() =>
            page.evaluate(() => {
              const area = document.getElementById('play').getBoundingClientRect(),
                divider = document.getElementById('divider').getBoundingClientRect();
              return Math.abs((area.left + area.right - divider.left - divider.right) / 2);
            }),
          )
          .toBeLessThanOrEqual(0.5);
      const margins = await page.evaluate(() => {
        const app = document.getElementById('app').getBoundingClientRect(),
          player = document.getElementById('viewport').getBoundingClientRect(),
          style = getComputedStyle(document.getElementById('app'));
        return { bottom: app.bottom - player.bottom, side: parseFloat(style.paddingRight) };
      });
      expect(margins.bottom).toBeCloseTo(margins.side, 3);
    }
    await page.locator('#info-tab').click();
    const margins = await page.evaluate(() => {
      const app = document.getElementById('app').getBoundingClientRect(),
        info = document.getElementById('info').getBoundingClientRect();
      return {
        left: info.left - app.left,
        right: app.right - info.right,
        bottom: app.bottom - info.bottom,
      };
    });
    expect(margins.bottom).toBeCloseTo(margins.left, 3);
    expect(margins.bottom).toBeCloseTo(margins.right, 3);
    await page.locator('#play-tab').click();
  }
});

test('panel frames stay rectangular after resizing and focus colors cover all four sides', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('playload-split', '.45127597'));
  await page.goto('/playload/app/');
  const editor = page.locator('#editor'),
    viewport = page.locator('#viewport');
  for (const width of [1401, 999]) {
    await page.setViewportSize({ width, height: 800 });
    await page.locator('#divider').focus();
    await page.keyboard.press('ArrowRight');
    const boxes = await page.locator('#editor,#viewport').evaluateAll((elements) =>
      elements.map((element) => {
        const r = element.getBoundingClientRect();
        return [r.left, r.top, r.right, r.bottom];
      }),
    );
    for (const box of boxes)
      for (const edge of [box[0], box[2]]) expect(edge).toBe(Math.round(edge));
    expect(boxes[0][1]).toBe(boxes[1][1]);
    expect(boxes[0][3]).toBe(boxes[1][3]);
    for (const [key, limit] of [
      ['Home', 'aria-valuemin'],
      ['End', 'aria-valuemax'],
    ]) {
      await page.locator('#divider').focus();
      await page.keyboard.press(key);
      expect(await page.locator('#divider').getAttribute('aria-valuenow')).toBe(
        await page.locator('#divider').getAttribute(limit),
      );
    }
    for (const target of [editor, viewport]) {
      if (target === editor) await editor.focus();
      else {
        await page.keyboard.press('ControlOrMeta+Enter');
        await expect(page.locator('#screen')).toBeFocused();
      }
      const sides = await target.evaluate((element) => {
        const s = getComputedStyle(element);
        return [s.borderTopColor, s.borderRightColor, s.borderBottomColor, s.borderLeftColor];
      });
      expect(new Set(sides).size).toBe(1);
      expect(sides[0]).toBe('rgb(145, 132, 155)');
    }
  }
});

test('page loads center the divider while resizing retains and clamps its current position', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('playload-split', '.45127597'));
  await page.setViewportSize({ width: 1535, height: 1000 });
  await page.goto('/playload/app/');
  const divider = page.locator('#divider');
  await expect(divider).toHaveAttribute('aria-valuenow', '50');
  await divider.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(divider).toHaveAttribute('aria-valuenow', '45');
  await page.setViewportSize({ width: 999, height: 1000 });
  await expect(divider).toHaveAttribute('aria-valuenow', '45');
  const other = await page.context().newPage();
  try {
    await other.goto('/playload/app/');
    await expect(other.locator('#divider')).toHaveAttribute('aria-valuenow', '50');
  } finally {
    await other.close();
  }
  await page.setViewportSize({ width: 1535, height: 1000 });
  for (const [key, limit] of [
    ['Home', 'aria-valuemin'],
    ['End', 'aria-valuemax'],
  ]) {
    await divider.focus();
    await page.keyboard.press(key);
    expect(await divider.getAttribute('aria-valuenow')).toBe(await divider.getAttribute(limit));
    await page.reload();
    await expect(divider).toHaveAttribute('aria-valuenow', '50');
  }
  await divider.focus();
  await page.keyboard.press('Home');
  await page.setViewportSize({ width: 700, height: 1000 });
  await expect
    .poll(async () => {
      return (
        (await divider.getAttribute('aria-valuenow')) ===
        (await divider.getAttribute('aria-valuemin'))
      );
    })
    .toBe(true);
  await page.reload();
  await expect(divider).toHaveAttribute('aria-valuenow', '50');
});

test('Run preserves clicked input focus while editor shortcuts hand input to the game', async ({
  page,
}) => {
  await page.goto('/playload/app/');
  await page.locator('#crt').click();
  const editor = page.locator('#editor'),
    screen = page.locator('#screen');
  const source = 'function tick() { cls(btn(4) ? 3 : 4) }';
  await editor.fill(source);
  for (const action of ['click', 'Control+Enter', 'Meta+Enter']) {
    await editor.focus();
    const idleBorder = await page
      .locator('#viewport')
      .evaluate((element) => getComputedStyle(element).borderColor);
    if (action === 'click') {
      await page.locator('#run').click();
      await expect(editor).toBeFocused();
      await expect(page.locator('#pause')).toBeEnabled();
      await screen.click();
    } else await editor.press(action);
    await expect(screen).toBeFocused();
    expect(
      await page.locator('#viewport').evaluate((element) => getComputedStyle(element).borderColor),
    ).not.toBe(idleBorder);
    await page.keyboard.down('KeyZ');
    await expect.poll(() => pixel(page)).toEqual([215, 115, 85, 255]);
    await page.keyboard.up('KeyZ');
    await expect.poll(() => pixel(page)).toEqual([80, 140, 215, 255]);
    await expect(editor).toHaveValue(source);
  }
  await editor.click();
  await expect(editor).toBeFocused();
  await editor.press('End');
  await editor.press('Space');
  await expect(editor).toHaveValue(source + ' ');
});

test('the whole play frame accepts focus before Run and keeps keyboard input and error links usable', async ({
  page,
}) => {
  await page.goto('/playload/app/');
  const editor = page.locator('#editor'),
    screen = page.locator('#screen'),
    viewport = page.locator('#viewport');
  await expect(screen).toBeFocused();
  await editor.click();
  await expect(editor).toBeFocused();
  const initialBounds = await viewport.boundingBox();
  await page.mouse.move(initialBounds.x + 2, initialBounds.y + 2);
  await page.mouse.down();
  await expect(screen).toBeFocused();
  await page.mouse.up();
  await expect(screen).toBeFocused();
  await expect(page.locator('#pause')).toBeEnabled();
  await expect(page.locator('#display')).toBeVisible();

  await editor.fill(`function tick() {
  if (btnp(5)) throw new Error('Frame input');
  cls(btn(4) ? 3 : 4);
}`);
  await page.locator('#run').click();
  await expect(page.locator('#pause')).toBeEnabled();
  await page.locator('#crt').click();
  const bounds = await viewport.boundingBox();
  for (const [x, y] of [
    [2, 2],
    [bounds.width - 2, 2],
    [2, bounds.height - 2],
    [bounds.width - 2, bounds.height - 2],
    [bounds.width / 2, bounds.height / 2],
  ]) {
    await editor.focus();
    await page.mouse.move(bounds.x + x, bounds.y + y);
    await page.mouse.down();
    await expect(screen).toBeFocused();
    await page.mouse.up();
    await expect(screen).toBeFocused();
    await page.keyboard.down('z');
    await expect.poll(() => pixel(page)).toEqual([215, 115, 85, 255]);
    await page.keyboard.up('z');
    await expect.poll(() => pixel(page)).toEqual([80, 140, 215, 255]);
  }
  await page.keyboard.press('x');
  await expect(page.locator('#error')).toHaveText('Frame input');
  await page.locator('#error').click();
  await expect(page.locator('#error')).toBeFocused();
  await page.locator('#error-line').click();
  await expect(editor).toBeFocused();
});

test('the displayed Pause shortcut resumes the existing game; Run applies edited code', async ({
  page,
}) => {
  await run(page, 'let col = 4; function tick() { if (btnp(4)) col = 3; cls(col) }', true);
  const editor = page.locator('#editor'),
    screen = page.locator('#screen'),
    pause = page.locator('#pause');
  await expect(screen).toBeFocused();
  await expect(pause).toHaveAttribute('aria-keyshortcuts', 'Escape');
  await expect(pause.locator('kbd')).toHaveText('Esc');
  await page.keyboard.press('z');
  await expect.poll(() => pixel(page)).toEqual([215, 115, 85, 255]);

  await page.keyboard.press('Escape');
  await expect(editor).toBeFocused();
  await expect(pause).toHaveText(/^Resume/);
  await expect(pause.locator('kbd')).toHaveText('Esc');
  const source = 'function tick() { cls(5) }';
  await editor.fill(source);
  await editor.press('Escape');
  await expect(screen).toBeFocused();
  await expect(pause).toHaveText(/^Pause/);
  await expect.poll(() => pixel(page)).toEqual([215, 115, 85, 255]);
  await expect(editor).toHaveValue(source);

  await page.keyboard.press('Escape');
  await expect(editor).toBeFocused();
  await editor.press('ControlOrMeta+Enter');
  await expect(pause).toBeEnabled();
  await expect(screen).toBeFocused();
  await expect(pause).toHaveText(/^Pause/);
  await expect.poll(() => pixel(page)).toEqual([100, 185, 100, 255]);
});

test('Escape pauses once, releases held input and moves focus only to a visible editor', async ({
  page,
}) => {
  await page.goto('/playload/app/');
  const editor = page.locator('#editor'),
    screen = page.locator('#screen'),
    pause = page.locator('#pause');
  await expect(screen).toBeFocused();
  const source = 'function tick() { cls(btn(4) ? 3 : 4) }';
  await editor.focus();
  await editor.fill(source);
  await editor.press('ControlOrMeta+Enter');
  await expect(pause).toBeEnabled();
  await expect(screen).toBeFocused();
  await page.locator('#crt').click();
  await expect.poll(() => pixel(page)).toEqual([80, 140, 215, 255]);
  await page.keyboard.down('z');
  await expect.poll(() => pixel(page)).toEqual([215, 115, 85, 255]);
  await page.keyboard.down('Escape');
  await expect(editor).toBeFocused();
  await expect(pause).toHaveText(/^Resume/);
  await expect(editor).toHaveValue(source);
  await page.keyboard.down('Escape');
  await expect(editor).toBeFocused();
  await expect(pause).toHaveText(/^Resume/);
  await expect.poll(() => pixel(page)).toEqual([215, 115, 85, 255]);
  await page.keyboard.up('Escape');
  await page.keyboard.up('z');
  await editor.press('Escape');
  await expect(screen).toBeFocused();
  await expect(pause).toHaveText(/^Pause/);
  await expect.poll(() => pixel(page)).toEqual([80, 140, 215, 255]);
  await page.keyboard.press('Escape');
  await editor.press('End');
  await editor.press('Tab');
  await expect(editor).toHaveValue(source + '  ');
  await editor.press('ControlOrMeta+Enter');
  await expect(pause).toBeEnabled();
  await expect(screen).toBeFocused();
  await expect(editor).toHaveValue(source + '  ');
  await page.keyboard.press('Tab');
  await expect(screen).toBeFocused();

  await page.setViewportSize({ width: 375, height: 650 });
  await screen.click();
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await expect(editor).toBeFocused();
  await expect(pause).toHaveText(/^Resume/);
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await editor.press('Escape');
  await expect(screen).toBeFocused();
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);
  await page.locator('#code-toggle').click();
  await expect(editor).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(editor).not.toBeFocused();
  await expect(screen).toBeFocused();
  await expect(pause).toHaveText(/^Resume/);
  await page.keyboard.press('Escape');
  await expect(screen).toBeFocused();
  await expect(pause).toHaveText(/^Pause/);
  await page.locator('#info-tab').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#info')).toBeVisible();
  await expect(pause).toHaveText(/^Pause/);
});

test('Tab keeps input focus in Play and normal navigation remains available in Info', async ({
  page,
}) => {
  await page.goto('/playload/app/');
  const editor = page.locator('#editor'),
    source = await editor.inputValue();
  await expect(page.locator('#screen')).toBeFocused();
  await editor.click();
  await page.keyboard.press('Shift+Tab');
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue(source);
  await page.locator('#info-tab').click();
  await page.locator('#info-tab').focus();
  await page.keyboard.press('Shift+Tab');
  await expect(editor).not.toBeFocused();
  await expect(page.locator('#screen')).not.toBeFocused();
  await expect(page.locator('#info')).toBeVisible();
  await expect(editor).toHaveValue(source);
});

test('Run applies editor changes and Control+Enter restarts without rereading a file', async ({
  page,
}) => {
  await run(page, 'function tick() { cls(4) }', true);
  await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
  await expect(page.locator('#reload')).toHaveCount(0);
  await expect(page.locator('#run')).toHaveAttribute(
    'aria-keyshortcuts',
    'Control+Enter Meta+Enter',
  );
  await page.getByRole('button', { name: 'Pause', exact: false }).click();
  await page.getByRole('textbox', { name: 'JavaScript code' }).fill('function tick() { cls(5) }');
  await expect(page.locator('#pause')).toBeEnabled();
  await page.locator('#screen').focus();
  await page.keyboard.press('Control+Enter');
  await expect.poll(() => pixel(page)).toEqual([100, 185, 100, 255]);
  await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
  await expect(page.locator('#pause')).toHaveText(/^Pause/);
});

test('disabled Pause ignores Escape and the removed Reload shortcut is no longer intercepted', async ({
  page,
}) => {
  await page.goto('/playload/app/');
  const editor = page.locator('#editor'),
    source = await editor.inputValue();
  await editor.press('Escape');
  await expect(editor).toHaveValue(source);
  await expect(editor).toBeFocused();
  expect(
    await editor.evaluate((element) => {
      const escape = new KeyboardEvent('keydown', {
        code: 'Escape',
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      });
      const reload = new KeyboardEvent('keydown', {
        code: 'KeyR',
        key: '®',
        altKey: true,
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(escape);
      element.dispatchEvent(reload);
      return [escape.defaultPrevented, reload.defaultPrevented];
    }),
  ).toEqual([true, false]);
  await expect(editor).toHaveValue(source);
});

test('external file changes restart the game and update code, title and URL without moving focus', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.gameLoads = 0;
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, ...args) {
      if (message.type === 'load') window.gameLoads++;
      return post.call(this, message, ...args);
    };
  });
  await loadFileHandle(page, '// @title Original\nfunction tick() { cls(4) }');
  const initialLoads = await page.evaluate(() => window.gameLoads);
  await page.locator('#crt').click();
  await expect.poll(() => pixel(page)).toEqual([80, 140, 215, 255]);
  await page.locator('#pause').click();
  const editor = page.locator('#editor');
  await editor.click();
  await expect(editor).toBeFocused();
  const source = '// @title Updated\nfunction tick() { cls(5) }';
  await page.evaluate((source) => (window.testFileSource = source), source);
  await expect(editor).toHaveValue(source);
  await expect(page).toHaveTitle('Updated — Playload');
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { decode } = await import('/src/payload.js');
        return decode(location.hash);
      }),
    )
    .toBe(source);
  await expect(editor).toBeFocused();
  await expect(page.locator('#pause')).toHaveText(/^Pause/);
  await expect.poll(() => pixel(page)).toEqual([100, 185, 100, 255]);
  expect(await page.evaluate(() => window.gameLoads)).toBe(initialLoads + 1);
  expect(await page.evaluate(() => window.pickerOpens)).toBe(1);
  await editor.press('Control+Enter');
  await expect.poll(() => pixel(page)).toEqual([100, 185, 100, 255]);
  await expect(page.locator('#screen')).toBeFocused();
  expect(await page.evaluate(() => window.gameLoads)).toBe(initialLoads + 2);
});

test('declining an external update keeps the draft without repeatedly asking to replace it', async ({
  page,
}) => {
  await loadFileHandle(page);
  const editor = page.locator('#editor'),
    original = await editor.inputValue();
  await page.locator('#crt').click();
  let dialogs = 0;
  page.on('dialog', async (dialog) => {
    expect(dialog.type()).toBe('confirm');
    expect(dialog.message()).toBe('The code was edited in the browser. Replace it with a file?');
    dialogs++;
    await dialog.dismiss();
  });
  const draft = '// @title Draft\nfunction tick() { cls(6) }';
  await editor.fill(draft);
  await page.evaluate(() => (window.testFileSource = 'function tick() { cls(3) }'));
  await page.waitForTimeout(1200);
  await expect(editor).toHaveValue(draft);
  await expect(page).toHaveTitle('Draft — Playload');
  await editor.press('Control+Enter');
  await expect.poll(() => pixel(page)).toEqual([230, 200, 110, 255]);
  expect(dialogs).toBe(1);
  await editor.fill(original);
  await expect(editor).toHaveValue('function tick() { cls(3) }');
  await expect.poll(() => pixel(page)).toEqual([215, 115, 85, 255]);
  expect(dialogs).toBe(1);
});

for (const width of [1400, 375]) {
  test(`accepting an external update replaces the draft and runs without moving focus at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await loadFileHandle(page);
    const editor = page.locator('#editor');
    if (!(await editor.isVisible())) await page.locator('#code-toggle').click();
    await page.locator('#crt').click();
    await editor.fill('// @title Draft\nfunction tick() { cls(6) }');
    let dialogs = 0;
    page.on('dialog', async (dialog) => {
      expect(dialog.message()).toBe('The code was edited in the browser. Replace it with a file?');
      dialogs++;
      if (dialogs === 1) await dialog.dismiss();
      else await dialog.accept();
    });
    await page.evaluate(() => (window.testFileSource = 'function tick() { cls(3) }'));
    await expect.poll(() => dialogs).toBe(1);
    const source = '// @title Updated\nfunction tick() { cls(5) }';
    await page.evaluate((source) => (window.testFileSource = source), source);
    await expect(editor).toHaveValue(source);
    await expect(page).toHaveTitle('Updated — Playload');
    await expect.poll(() => pixel(page)).toEqual([100, 185, 100, 255]);
    await expect(editor).toBeFocused();
    const reads = await page.evaluate(() => window.fileReads);
    await expect.poll(() => page.evaluate(() => window.fileReads)).toBeGreaterThan(reads + 2);
    expect(dialogs).toBe(2);
    expect(new URL(page.url()).hash).toBe((await encode(source)).hash);
    await page.screenshot({ path: testInfo.outputPath('external-update.png') });
  });
}

test('matching editor and external changes run without asking to replace identical code', async ({
  page,
}) => {
  await loadFileHandle(page);
  await page.locator('#crt').click();
  const source = 'function tick() { cls(5) }';
  await page.locator('#editor').fill(source);
  let dialogs = 0;
  page.on('dialog', async (dialog) => {
    dialogs++;
    await dialog.dismiss();
  });
  await page.evaluate((source) => (window.testFileSource = source), source);
  await expect.poll(() => pixel(page)).toEqual([100, 185, 100, 255]);
  await expect(page.locator('#editor')).toBeFocused();
  expect(dialogs).toBe(0);
});

test('unchanged files leave the editor selection, URL and focus intact', async ({ page }) => {
  await loadFileHandle(page);
  const editor = page.locator('#editor');
  await editor.focus();
  await editor.evaluate((element) => element.setSelectionRange(3, 9));
  await expect.poll(() => page.evaluate(() => location.hash.length)).toBeGreaterThan(0);
  const url = page.url(),
    reads = await page.evaluate(() => window.fileReads);
  await expect.poll(() => page.evaluate(() => window.fileReads)).toBeGreaterThan(reads);
  expect(
    await editor.evaluate((element) => [element.selectionStart, element.selectionEnd]),
  ).toEqual([3, 9]);
  await expect(editor).toBeFocused();
  expect(page.url()).toBe(url);
});

test('automatic file reads preserve edits made while the read is pending', async ({ page }) => {
  await loadFileHandle(page);
  await page.evaluate(() => {
    const original = window.testFileHandle.getFile;
    window.testFileHandle.getFile = async () => {
      const file = await original();
      await new Promise((resolve) => (window.finishFileRead = resolve));
      return file;
    };
    window.dispatchEvent(new Event('focus'));
  });
  await expect.poll(() => page.evaluate(() => typeof window.finishFileRead)).toBe('function');
  await expect(page.locator('#run')).toBeEnabled();
  await expect(page.locator('#load')).toBeEnabled();
  const editor = page.locator('#editor');
  await editor.fill('function tick() { cls(6) }');
  await page.evaluate(() => window.finishFileRead());
  await page.waitForTimeout(100);
  await expect(editor).toHaveValue('function tick() { cls(6) }');
});

test('a new Load supersedes a pending automatic read of the old file', async ({ page }) => {
  await loadFileHandle(page);
  await page.evaluate(() => {
    const original = window.testFileHandle.getFile;
    window.testFileHandle.getFile = async () => {
      const file = await original();
      await new Promise((resolve) => (window.finishFileRead = resolve));
      return file;
    };
    window.dispatchEvent(new Event('focus'));
  });
  await expect.poll(() => page.evaluate(() => typeof window.finishFileRead)).toBe('function');
  await page.evaluate(
    () =>
      (window.testFileHandle = {
        getFile: async () =>
          new File(['// @title New File\nfunction tick() { cls(5) }'], 'new-game.js'),
      }),
  );
  await page.locator('#load').click();
  await expect(page).toHaveTitle('New File — Playload');
  await page.evaluate(() => window.finishFileRead());
  await page.waitForTimeout(100);
  await expect(page.locator('#filename')).toHaveText('new-game.js');
  await expect(page.locator('#editor')).toHaveValue(
    '// @title New File\nfunction tick() { cls(5) }',
  );
});

test('Load preserves edits made during a pending file read', async ({ page }) => {
  await page.addInitScript(
    () =>
      (window.showOpenFilePicker = async () => [
        {
          getFile: async () => {
            await new Promise((resolve) => (window.finishFileRead = resolve));
            return new File(['function tick() { cls(4) }'], 'native-game.js');
          },
        },
      ]),
  );
  await page.goto('/playload/app/');
  await page.locator('#load').click();
  await expect(page.locator('#run')).toBeDisabled();
  await expect(page.locator('#load')).toBeDisabled();
  const editor = page.locator('#editor');
  await editor.fill('function tick() { cls(6) }');
  await page.evaluate(() => window.finishFileRead());
  await expect(page.locator('#run')).toBeEnabled();
  await expect(editor).toHaveValue('function tick() { cls(6) }');
  await expect(page.locator('#status')).toHaveText(
    'Code changed while loading. Your edits were kept.',
  );
});

test('a temporary file read failure preserves the game and automatic checks recover', async ({
  page,
}) => {
  await loadFileHandle(page);
  await page.locator('#crt').click();
  await page.evaluate(() => {
    const original = window.testFileHandle.getFile;
    window.testFileHandle.getFile = () => {
      if (window.fileMissing) throw new DOMException('File no longer exists.', 'NotFoundError');
      return original();
    };
    window.fileMissing = true;
    window.dispatchEvent(new Event('focus'));
  });
  await expect(page.locator('#status')).toHaveText('File no longer exists.');
  await expect(page.locator('#editor')).toHaveValue('function tick() { cls(4) }');
  expect(await pixel(page)).toEqual([80, 140, 215, 255]);
  await page.evaluate(() => {
    window.fileMissing = false;
    window.testFileSource = 'function tick() { cls(5) }';
  });
  await expect(page.locator('#editor')).toHaveValue('function tick() { cls(5) }');
  await expect(page.locator('#status')).toHaveText('');
  await expect.poll(() => pixel(page)).toEqual([100, 185, 100, 255]);
});

test('revoked file access stops polling until Load restores access without automatic dialogs', async ({
  page,
}) => {
  await loadFileHandle(page);
  await page.evaluate(() => {
    const original = window.testFileHandle.getFile;
    window.testFileHandle.getFile = () => {
      window.fileReads++;
      if (window.fileDenied) throw new DOMException('Access revoked.', 'NotAllowedError');
      return original();
    };
    window.fileDenied = true;
    window.dispatchEvent(new Event('focus'));
  });
  await expect(page.locator('#status')).toHaveText('Load the file again to restore access.');
  const reads = await page.evaluate(() => window.fileReads);
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => window.fileReads)).toBe(reads);
  expect(await page.evaluate(() => window.pickerOpens)).toBe(1);
  await page.evaluate(() => (window.fileDenied = false));
  await page.locator('#load').click();
  await expect(page.locator('#status')).toHaveText('');
  expect(await page.evaluate(() => window.pickerOpens)).toBe(2);
});

test('file checks stop in hidden pages and check immediately when visible again', async ({
  page,
}) => {
  await loadFileHandle(page);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    window.testFileSource = 'function tick() { cls(5) }';
  });
  const reads = await page.evaluate(() => window.fileReads);
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => window.fileReads)).toBe(reads);
  await expect(page.locator('#editor')).toHaveValue('function tick() { cls(4) }');
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('#editor')).toHaveValue('function tick() { cls(5) }');
});

test('Load confirms only edits to the opened shared game', async ({ page }) => {
  const source = '// @title Shared Game\nfunction tick() { cls(4) }';
  await page.addInitScript(() => {
    window.pickerOpens = 0;
    window.showOpenFilePicker = async () => {
      window.pickerOpens++;
      throw new DOMException('Canceled', 'AbortError');
    };
  });
  await page.goto('/playload/app/' + (await encode(source)).hash);
  const editor = page.locator('#editor');
  await expect(editor).toHaveValue(source);
  await expect(page.locator('#start-game')).toBeVisible();
  await expect(page.locator('#pause')).toBeDisabled();
  let dialogs = 0;
  page.on('dialog', async (dialog) => {
    expect(dialog.message()).toBe('The code was edited in the browser. Replace it with a file?');
    dialogs++;
    await dialog.dismiss();
  });

  await page.locator('#load').click();
  expect(dialogs).toBe(0);
  await expect.poll(() => page.evaluate(() => window.pickerOpens)).toBe(1);
  await expect(page.locator('#run')).toBeEnabled();

  await editor.fill(source + '\n// Edited');
  await page.locator('#load').click();
  expect(dialogs).toBe(1);
  expect(await page.evaluate(() => window.pickerOpens)).toBe(1);
  await expect(editor).toHaveValue(source + '\n// Edited');

  await editor.fill(source);
  await page.locator('#load').click();
  expect(dialogs).toBe(1);
  await expect.poll(() => page.evaluate(() => window.pickerOpens)).toBe(2);
  await expect(editor).toHaveValue(source);
});

test('Load reselects files when handles are unavailable and confirms before replacing edits', async ({
  page,
}) => {
  await page.addInitScript(() => (window.showOpenFilePicker = undefined));
  await page.goto('/playload/app/');
  const select = async (name, source) => {
    const chooser = page.waitForEvent('filechooser');
    await page.locator('#load').click();
    await (
      await chooser
    ).setFiles({ name, mimeType: 'text/javascript', buffer: Buffer.from(source) });
  };
  await select('fallback-game.js', 'function tick() { cls(4) }');
  await expect(page.locator('#pause')).toBeEnabled();
  await expect(page.locator('#screen')).toBeFocused();
  const editor = page.locator('#editor');
  await editor.fill('function tick() { cls(6) }');
  page.once('dialog', (dialog) => {
    expect(dialog.message()).toBe('The code was edited in the browser. Replace it with a file?');
    return dialog.dismiss();
  });
  await page.locator('#load').click();
  await expect(editor).toHaveValue('function tick() { cls(6) }');
  page.once('dialog', (dialog) => {
    expect(dialog.message()).toBe('The code was edited in the browser. Replace it with a file?');
    return dialog.accept();
  });
  await select('fallback-game.js', 'function tick() { cls(5) }');
  await expect(editor).toHaveValue('function tick() { cls(5) }');
  await page.locator('#crt').click();
  await expect.poll(() => pixel(page)).toEqual([100, 185, 100, 255]);
  await select('other-game.js', 'function tick() { cls(3) }');
  await expect(page.locator('#filename')).toHaveText('other-game.js');
});

test('canceling a fallback Load restores controls and preserves the source and URL', async ({
  page,
}) => {
  await page.addInitScript(() => (window.showOpenFilePicker = undefined));
  await page.goto('/playload/app/');
  const source = await page.locator('#editor').inputValue(),
    url = page.url();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#load').click();
  await chooser;
  await expect(page.locator('#run')).toBeDisabled();
  await expect(page.locator('#load')).toBeDisabled();
  await page.locator('#file').dispatchEvent('cancel');
  await expect(page.locator('#run')).toBeEnabled();
  await expect(page.locator('#load')).toBeEnabled();
  await expect(page.locator('#editor')).toHaveValue(source);
  expect(page.url()).toBe(url);
});

test('JavaScript coloring preserves source, literal markup, typing and scrolling', async ({
  page,
}) => {
  await page.goto('/playload/app/');
  const editor = page.locator('#editor');
  const source = '// comment\nlet x = 7\nconst label = "<img src=x>"\nfunction tick() { cls(x) }\n';
  await editor.fill(source);
  await expect(page.locator('#editor-highlight .token.keyword').first()).toHaveText('let');
  const commentColor = await page
    .locator('#editor-highlight .token.comment')
    .evaluate((element) => getComputedStyle(element).color);
  expect(commentColor).toBe('rgb(133, 128, 150)');
  expect(commentColor).not.toBe(
    await page
      .locator('#editor-highlight .token.keyword')
      .first()
      .evaluate((element) => getComputedStyle(element).color),
  );
  const box = await editor.boundingBox();
  await page.mouse.move(box.x + 16, box.y + 24);
  await page.mouse.down();
  await page.mouse.move(box.x + 130, box.y + 65, { steps: 10 });
  await page.mouse.up();
  expect(await editor.evaluate((element) => element.selectionEnd > element.selectionStart)).toBe(
    true,
  );
  expect(await editor.evaluate((element) => getComputedStyle(element, '::selection').color)).toBe(
    'rgb(238, 234, 226)',
  );
  expect(await editor.inputValue()).toBe(source);
  await expect(page.locator('#editor-highlight .token.string')).toHaveText('"<img src=x>"');
  await expect(page.locator('#editor-highlight img')).toHaveCount(0);
  await expect(editor).toHaveValue(source);
  await editor.fill(source);
  await editor.press('Tab');
  await expect(editor).toHaveValue(source + '  ');
  const longLine = 'const label = "' + 'wide source '.repeat(30) + '"';
  await editor.fill(longLine);
  await expect(editor).toHaveAttribute('wrap', 'off');
  expect(await editor.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await editor.evaluate((element) => {
    element.scrollLeft = 140;
    element.dispatchEvent(new Event('scroll'));
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.getElementById('editor-highlight').scrollLeft -
          document.getElementById('editor').scrollLeft,
      ),
    )
    .toBe(0);
  await expect(editor).toHaveValue(longLine);
  await editor.fill('// line\n'.repeat(120) + 'function tick() { cls(7) }');
  await editor.evaluate((element) => {
    element.scrollTop = 800;
    element.dispatchEvent(new Event('scroll'));
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.getElementById('editor-highlight').scrollTop -
          document.getElementById('editor').scrollTop,
      ),
    )
    .toBe(0);
  await page.locator('#run').click();
  await expect(page.locator('#pause')).toBeEnabled();
});

test.describe('visible scrollbars', () => {
  test('editor text and line numbers remain aligned at every scroll edge', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/playload/app/');
    const editor = page.locator('#editor');
    for (const source of [
      'x'.repeat(80),
      '// row\n'.repeat(120),
      ('x'.repeat(300) + '\n').repeat(120),
    ]) {
      await editor.fill(source);
      await editor.evaluate((element) => {
        element.scrollLeft = element.scrollWidth;
        element.scrollTop = element.scrollHeight;
        element.dispatchEvent(new Event('scroll'));
      });
      const geometry = await page.evaluate(() => {
        const editor = document.querySelector('#editor'),
          preview = document.querySelector('#editor-highlight'),
          numbers = document.querySelector('#editor-line-numbers');
        return {
          editor: [editor.clientWidth, editor.clientHeight, editor.scrollLeft, editor.scrollTop],
          preview: [
            preview.clientWidth,
            preview.clientHeight,
            preview.scrollLeft,
            preview.scrollTop,
          ],
          lines: new DOMMatrix(getComputedStyle(numbers).transform).m42,
        };
      });
      expect(geometry.preview).toEqual(geometry.editor);
      expect(geometry.lines + geometry.editor[3]).toBe(0);
      if (!source.includes('\n')) {
        expect(
          await page.evaluate(() => {
            const editor = document.querySelector('#editor'),
              preview = document.querySelector('#editor-highlight'),
              range = document.createRange();
            range.selectNodeContents(preview);
            return (
              range.getBoundingClientRect().right <=
              editor.getBoundingClientRect().left + editor.clientLeft + editor.clientWidth + 1
            );
          }),
        ).toBe(true);
      }
    }
    await editor.click();
    await page.locator('#sound').click();
    await expect(editor).toBeFocused();
  });

  test('reference tabs and API expose usable scrollbars without moving the page', async ({
    page,
    browserName,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/playload/app/');
    await page.getByRole('tab', { name: 'Info', exact: true }).click();
    await page.getByRole('tab', { name: 'API', exact: true }).click();
    const tabGeometry = await page.locator('.reference-scroll').evaluate((element) => ({
      height: element.clientHeight,
      content: element.firstElementChild.offsetHeight,
      scrollHeight: element.scrollHeight,
    }));
    expect(tabGeometry.height).toBeGreaterThanOrEqual(tabGeometry.content + 2);
    expect(tabGeometry.scrollHeight).toBe(tabGeometry.height);
    const api = page.locator('#api'),
      box = await api.boundingBox();
    if (
      browserName === 'firefox' &&
      (await api.evaluate((element) => getComputedStyle(element).scrollbarWidth)) === 'none'
    ) {
      // Firefox's headless driver forcibly hides native scrollbar handles.
      await page.mouse.move(box.x + 100, box.y + 80);
      await page.mouse.wheel(300, 0);
    } else {
      await page.mouse.move(box.x + 60, box.y + box.height - 6);
      await page.mouse.down();
      await page.mouse.move(box.x + 160, box.y + box.height - 6, { steps: 10 });
      await page.mouse.up();
    }
    await expect.poll(() => api.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    await page.mouse.move(box.x + 100, box.y + 80);
    await page.mouse.wheel(0, 300);
    await expect.poll(() => api.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    expect(
      await page
        .locator('.api-guide, .score-guide, .api-example')
        .evaluateAll((elements) =>
          elements.every((element) => !element.scrollTop && !element.scrollLeft),
        ),
    ).toBe(true);
    expect(await page.evaluate(() => [scrollX, scrollY])).toEqual([0, 0]);
    await page.locator('#api-tab').focus();
    await page.keyboard.press('End');
    await expect(page.locator('#examples-tab')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(page.locator('#about-tab')).toBeFocused();
    await expect
      .poll(() => page.locator('.reference-scroll').evaluate((element) => element.scrollLeft))
      .toBe(0);
  });

  test('reference content keeps the same width across short and scrolling categories', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 854, height: 1000 });
    await page.goto('/playload/app/');
    await page.getByRole('tab', { name: 'Info', exact: true }).click();
    const widths = [await page.locator('#about').evaluate((element) => element.clientWidth)];
    await page.getByRole('tab', { name: 'API', exact: true }).click();
    widths.push(await page.locator('#api').evaluate((element) => element.clientWidth));
    for (const name of ['Emoji', 'Symbols', 'Emoji', 'Alphabet', 'Kana', 'Examples']) {
      await page.getByRole('tab', { name, exact: true }).click();
      const selector = name === 'Examples' ? '#examples' : '#catalog';
      widths.push(await page.locator(selector).evaluate((element) => element.clientWidth));
      if (name !== 'Examples') {
        await expect(page.locator('#catalog button').first()).toBeVisible();
        expect(
          await page
            .locator('#catalog button')
            .first()
            .evaluate((element) => element.clientWidth),
        ).toBeGreaterThanOrEqual(66);
      }
    }
    expect(new Set(widths).size).toBe(1);
  });
});

test('line numbers follow edits and scrolling without becoming part of the source', async ({
  page,
}) => {
  await page.goto('/playload/app/');
  const editor = page.locator('#editor'),
    numbers = page.locator('#editor-line-numbers');
  await editor.fill('let x = 1\n\n');
  await expect(numbers).toHaveText('1\n2\n3');
  const source = '// row\n'.repeat(100) + 'function tick() { cls(4) }';
  await editor.fill(source);
  expect((await numbers.textContent()).split('\n').at(-1)).toBe('101');
  expect(
    await page
      .locator('#editor,#editor-highlight,#editor-line-numbers')
      .evaluateAll(
        (elements) => new Set(elements.map((element) => getComputedStyle(element).lineHeight)).size,
      ),
  ).toBe(1);
  const gutter = await page.locator('#editor-lines').boundingBox();
  await editor.evaluate((element) => {
    element.scrollTop = 900;
    element.dispatchEvent(new Event('scroll'));
  });
  expect(
    await numbers.evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).m42),
  ).toBe(-(await editor.evaluate((element) => element.scrollTop)));
  await editor.fill('const wide = "' + 'text '.repeat(200) + '"');
  await editor.evaluate((element) => {
    element.scrollLeft = 500;
    element.dispatchEvent(new Event('scroll'));
  });
  expect((await page.locator('#editor-lines').boundingBox()).x).toBe(gutter.x);
  await editor.selectText();
  const copied = await editor.evaluate((element) =>
    element.value.slice(element.selectionStart, element.selectionEnd),
  );
  expect(copied).toBe(await editor.inputValue());
  await editor.fill('function tick() {}');
  await expect(numbers).toHaveText('1');
});

test('an error preserves the last game picture and marks its editable source line', async ({
  page,
}, testInfo) => {
  const source =
    'let frame = 0\nfunction tick() {\n  cls(4)\n  spr(76, 68, "👾", 6)\n  if (++frame === 5) throw new Error("Ship update failed")\n}';
  await run(page, source, true);
  await expect(page.locator('#error')).toHaveText('Ship update failed');
  await expect(page.locator('#error-line')).toHaveText('Line 5');
  await expect(page.locator('#screen')).toBeVisible();
  await expect(page.locator('#pause')).toBeDisabled();
  expect(await pixel(page)).toEqual([80, 140, 215, 255]);
  await expect(page.locator('.editor-line-error')).toHaveText('5');
  const picture = await page.locator('#viewport').boundingBox(),
    notice = await page.locator('#error-notice').boundingBox();
  expect(notice.x).toBeCloseTo(picture.x + 7, 1);
  expect(notice.y).toBeCloseTo(picture.y + 3, 1);
  expect(notice.x + notice.width).toBeLessThanOrEqual(picture.x + picture.width);
  expect(notice.y + notice.height).toBeLessThanOrEqual(picture.y + picture.height);
  await page.locator('#error-line').click();
  await expect(page.locator('#editor')).toBeFocused();
  expect(
    await page
      .locator('#editor')
      .evaluate((element) => element.value.slice(element.selectionStart, element.selectionEnd)),
  ).toContain('Ship update failed');
  await page.screenshot({ path: testInfo.outputPath('error-with-last-frame.png') });
  const lastFrame = await page.locator('#display').evaluate((canvas) => canvas.toDataURL());
  await page.locator('#editor').fill('function tick( {');
  await expect(page.locator('.editor-line-error')).toHaveCount(0);
  await page.locator('#run').click();
  await expect(page.locator('#error')).toBeVisible();
  expect(await page.locator('#display').evaluate((canvas) => canvas.toDataURL())).toBe(lastFrame);
  await page.locator('#editor').fill('function tick() { cls(5) }');
  await page.locator('#run').click();
  await expect(page.locator('#pause')).toBeEnabled();
  await expect(page.locator('#error-notice')).toBeHidden();
  await expect.poll(() => pixel(page)).toEqual([100, 185, 100, 255]);
});

test('Examples starts with Starter and other game links contain their actual source', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1710, height: 895 });
  await page.goto('/playload/app/');
  await page.getByRole('tab', { name: 'Info', exact: true }).click();
  await page.getByRole('tab', { name: 'Examples', exact: true }).click();
  await expect(page.locator('[data-ref]').last()).toHaveText('Examples');
  const entries = JSON.parse(
    await readFile(new URL('../../data/examples.json', import.meta.url), 'utf8'),
  );
  const rows = page.locator('.example-links li');
  await expect(rows).toHaveCount(entries.length);
  await expect(rows.locator('a')).toHaveText(entries.map((entry) => entry.name));
  await expect(rows.first().locator('a')).toHaveText('Starter');
  await expect(rows.first().locator('.example-description')).toHaveText(
    'Start with the default code.',
  );
  await page.screenshot({ path: testInfo.outputPath('examples-desktop.jpg'), quality: 90 });
  for (let index = 0; index < entries.length; index++) {
    const link = rows.nth(index).locator('a').first();
    await expect(rows.nth(index).locator('a')).toHaveCount(1);
    const id = entries[index].id;
    const source = await readFile(new URL('../../examples/' + id + '.js', import.meta.url), 'utf8');
    const url = await link.getAttribute('href');
    const payload =
      id === 'starter'
        ? { source, bytes: (await encode(source)).bytes }
        : await page.evaluate(async (url) => {
            const { decode } = await import('/src/payload.js');
            const hash = new URL(url).hash;
            const bytes = atob(
              hash
                .slice(hash.indexOf('.') + 1)
                .replaceAll('-', '+')
                .replaceAll('_', '/'),
            ).length;
            return { source: await decode(hash), bytes };
          }, url);
    expect(payload.source).toBe(source);
    await expect(rows.nth(index).locator('.example-size')).toHaveText(
      formatPayloadSize(payload.bytes),
    );
    const opened = page.waitForEvent('popup');
    await link.click();
    const game = await opened;
    if (id === 'starter') {
      await expect(game).toHaveURL(baseURL + '/playload/app/');
      await expect(game).toHaveTitle('Playload');
      await expect(game.locator('#screen')).toBeFocused();
      await expect(game.locator('#start-game')).toBeVisible();
      await expectCenteredWelcome(game);
      await game.locator('#start-game').click();
      await expect(game).toHaveURL(baseURL + '/playload/app/');
    } else {
      await expect(game).toHaveTitle((await link.textContent()) + ' — Playload');
      await game.locator('#start-game').click();
    }
    await expect(game.locator('#pause')).toBeEnabled();
    await expect(game.locator('#screen')).toBeFocused();
    await expect(game.locator('#editor')).toHaveValue(source);
    await expect(game.locator('#crt')).toHaveAttribute('aria-pressed', 'true');
    await expect(game.locator('#error')).toBeHidden();
    if (id === 'gems') {
      const before = await game.locator('#display').evaluate((canvas) => canvas.toDataURL());
      await game.keyboard.down('ArrowRight');
      await expect
        .poll(() => game.locator('#display').evaluate((canvas) => canvas.toDataURL()))
        .not.toBe(before);
      await game.keyboard.up('ArrowRight');
      await expect(game.locator('#editor')).toHaveValue(source);
    }
    if (id !== 'starter') {
      const before = await game.locator('#display').evaluate((canvas) => canvas.toDataURL());
      await game.keyboard.press(id === 'music-box' ? 'ArrowUp' : 'z');
      await expect
        .poll(() => game.locator('#display').evaluate((canvas) => canvas.toDataURL()))
        .not.toBe(before);
      await expect(game.locator('#error')).toBeHidden();
      await game.screenshot({ path: testInfo.outputPath(id + '-desktop.png') });
    }
    await game.close();
  }
});

test('examples respond to touch controls and fit a narrow player', async ({
  browser,
}, testInfo) => {
  const entries = JSON.parse(
    await readFile(new URL('../../data/examples.json', import.meta.url), 'utf8'),
  );
  for (const entry of entries.filter((entry) => entry.id !== 'starter')) {
    const phone = await browser.newPage({
      viewport: { width: 375, height: 812 },
      hasTouch: true,
      isMobile: true,
    });
    await phone.goto(baseURL + '/playload/app/');
    if (entry.id === 'snake') {
      await phone.getByRole('tab', { name: 'Info', exact: true }).click();
      await phone.getByRole('tab', { name: 'Examples', exact: true }).click();
      await expect(phone.locator('header')).toHaveCount(1);
      await expect(phone.locator('.example-links li')).toHaveCount(entries.length);
      await phone.screenshot({ path: testInfo.outputPath('examples-phone.png') });
      const last = phone.locator('.example-links li').last();
      await last.scrollIntoViewIfNeeded();
      await expect(last.locator('a')).toBeVisible();
    }
    const source = await readFile(
      new URL('../../examples/' + entry.id + '.js', import.meta.url),
      'utf8',
    );
    const hash = await phone.evaluate(async (source) => {
      const { encode } = await import('/src/payload.js');
      return (await encode(source)).hash;
    }, source);
    await phone.goto(baseURL + '/playload/app/' + hash);
    await phone.locator('#start-game').tap();
    await expect(phone.locator('#pause')).toBeEnabled();
    await expect(phone.locator('#editor')).toBeHidden();
    await expect(phone.locator('.touch')).toBeVisible();
    const before = await phone.locator('#display').evaluate((canvas) => canvas.toDataURL());
    await phone.locator('[data-input="' + (entry.id === 'music-box' ? 0 : 4) + '"]').tap();
    await expect
      .poll(() => phone.locator('#display').evaluate((canvas) => canvas.toDataURL()))
      .not.toBe(before);
    await expect(phone.locator('#error')).toBeHidden();
    expect(await phone.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      375,
    );
    const screen = await phone.locator('#screen').boundingBox();
    expect(screen.x).toBeGreaterThanOrEqual(0);
    expect(screen.x + screen.width).toBeLessThanOrEqual(375);
    await phone.screenshot({ path: testInfo.outputPath(entry.id + '-phone.png') });
    await phone.close();
  }
});

test('a shared game does not steal editor focus chosen while its worker is starting', async ({
  page,
}) => {
  await page.goto('/playload/app/');
  const hash = await page.evaluate(
    async () => (await (await import('/src/payload.js')).encode('function tick() { cls(4) }')).hash,
  );
  await page.goto('about:blank');
  await page.addInitScript(() => {
    const GameWorker = window.Worker;
    window.Worker = class extends GameWorker {
      postMessage(message, ...args) {
        if (message.type === 'load')
          window.finishInitialLoad = () => super.postMessage(message, ...args);
        else super.postMessage(message, ...args);
      }
    };
  });
  await page.goto('/playload/app/' + hash);
  await page.locator('#start-game').click();
  await expect.poll(() => page.evaluate(() => typeof window.finishInitialLoad)).toBe('function');
  await page.locator('#editor').focus();
  await page.evaluate(() => window.finishInitialLoad());
  await expect(page.locator('#pause')).toBeEnabled();
  await expect(page.locator('#editor')).toBeFocused();
});

test('Info interactions stay in Info when a shared URL finishes decoding', async ({ browser }) => {
  const { hash } = await encode('function tick() { cls(6) }');
  for (const touch of [false, true]) {
    const page = await browser.newPage({
      viewport: touch ? { width: 390, height: 844 } : { width: 1280, height: 800 },
      hasTouch: touch,
      isMobile: touch,
    });
    await page.addInitScript(() => {
      const Stream = DecompressionStream;
      window.DecompressionStream = class {
        constructor(...args) {
          const stream = new Stream(...args);
          this.writable = stream.writable;
          this.readable = stream.readable.pipeThrough(
            new TransformStream({
              async transform(chunk, controller) {
                await new Promise((resolve) => (window.releaseDecode = resolve));
                controller.enqueue(chunk);
              },
            }),
          );
        }
      };
    });
    try {
      for (const action of ['pointer', 'key']) {
        await page.goto('about:blank');
        await page.goto('/playload/app/' + hash);
        await page.waitForFunction(() => typeof window.releaseDecode === 'function');
        await page.locator('#info-tab').click();
        await page.getByRole('tab', { name: 'API', exact: true }).click();
        await page.evaluate(() => window.releaseDecode());
        await page.waitForFunction(() => !document.querySelector('#start-game').hidden);
        if (action === 'pointer') {
          const description = page.locator('#api .reference-description').first();
          if (touch) await description.tap();
          else await description.click();
        } else {
          await page.keyboard.press('ArrowDown');
        }
        await expect(page.locator('#start-game')).toBeHidden();
        await expect(page.locator('#pause')).toBeDisabled();
        await expect(page.locator('#info')).toBeVisible();
        await expect(page.locator('#screen')).not.toBeFocused();
        await expect(page.locator('#error')).toBeHidden();
      }
    } finally {
      await page.close();
    }
  }
});

test('an invalid shared URL focuses the visible player and keeps its error readable', async ({
  page,
}) => {
  await page.goto('/playload/app/#invalid-payload');
  await expect(page.getByRole('alert')).toContainText('Invalid game URL');
  await expect(page.locator('#screen')).toBeFocused();
  await expect(page.locator('#editor')).toBeVisible();
});

test('the tagline stays visible whenever its text fits, without crowding navigation or Tools', async ({
  browser,
}) => {
  for (const touch of [false, true]) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      hasTouch: touch,
      isMobile: touch,
    });
    try {
      const page = await context.newPage();
      await page.goto('/playload/app/');
      const playPositions = new Map();
      for (const view of ['Play', 'Info']) {
        await page.getByRole('tab', { name: view, exact: true }).click();
        for (const width of [
          1280, 1100, 1024, 960, 920, 919, 880, 860, 855, 854, 853, 850, 847, 846, 845, 844, 840,
          820, 800, 600, 599, 580, 375, 320, 845, 846, 854, 880, 919, 1280,
        ]) {
          await page.setViewportSize({ width, height: 900 });
          await page.evaluate(
            () =>
              new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
          );
          const layout = await page.evaluate(() => {
            const tagline = document.querySelector('header p'),
              intro = document.querySelector('.intro'),
              tools = document.querySelector('#tools-toggle'),
              bounds = tagline.getBoundingClientRect(),
              available = intro.getBoundingClientRect(),
              toolsWidth = tools.getBoundingClientRect().width,
              gap = toolsWidth ? parseFloat(getComputedStyle(intro).columnGap) : 0,
              measure = document.createElement('canvas').getContext('2d');
            measure.font = getComputedStyle(tagline).font;
            return {
              fits:
                measure.measureText(tagline.textContent).width <=
                available.width - toolsWidth - gap,
              visible: !!tagline.getClientRects().length,
              top: bounds.top,
              inside: bounds.right <= available.right - toolsWidth - gap + 0.02,
              aligned: !bounds.width || Math.abs(bounds.left - available.left) < 0.02,
              overflow: document.documentElement.scrollWidth > innerWidth,
            };
          });
          expect(layout.visible, `${touch ? 'touch' : 'desktop'} ${view} at ${width}px`).toBe(
            layout.fits,
          );
          expect(layout.inside).toBe(true);
          expect(layout.aligned).toBe(true);
          expect(layout.overflow).toBe(false);
          if (layout.visible) {
            if (view === 'Play') playPositions.set(width, layout.top);
            else if (playPositions.has(width))
              expect(layout.top).toBeCloseTo(playPositions.get(width), 1);
          }
          for (const selector of ['#logo', '#play-tab', '#info-tab', '#home-link'])
            await expect(page.locator(selector)).toBeVisible();
          if (touch && view === 'Play') await expect(page.locator('#tools-toggle')).toBeVisible();
        }
      }
    } finally {
      await context.close();
    }
  }
});

test('Workspace and reference tabs share bar spacing; keyboard focus adds no decoration', async ({
  page,
}) => {
  await page.goto('/playload/app/');
  await page.getByRole('tab', { name: 'Info', exact: true }).click();
  const style = async (selector) =>
    page.locator(selector).evaluate((element) => {
      const s = getComputedStyle(element);
      return [
        s.height,
        s.paddingTop,
        s.paddingBottom,
        s.lineHeight,
        s.fontSize,
        s.borderBottomWidth,
      ];
    });
  expect(await style('#info-tab')).toEqual(await style('#api-tab'));
  await page.locator('#info-tab').focus();
  expect(
    await page.locator('#info-tab').evaluate((element) => getComputedStyle(element).outlineStyle),
  ).toBe('none');
  const logo = await page.locator('#logo').boundingBox(),
    version = await page.locator('#version').boundingBox();
  expect(version.x).toBeGreaterThanOrEqual(logo.x + logo.width);
  const versionInk = await page.locator('#version').evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return range.getBoundingClientRect().bottom;
  });
  expect(Math.abs(logo.y + logo.height - versionInk)).toBeLessThanOrEqual(4);
  const header = await page.locator('header').boundingBox(),
    tabs = await page.locator('#views').boundingBox();
  expect(
    Math.abs(logo.y - header.y - (tabs.y + tabs.height - logo.y - logo.height)),
  ).toBeLessThanOrEqual(2);
});
