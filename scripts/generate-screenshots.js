import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { exampleLinks } from '../src/example-links.js';

const viewport = { width: 1600, height: 900 };
const directory = new URL('../docs/images/', import.meta.url);
const server = spawn(
  process.execPath,
  [fileURLToPath(new URL('serve.js', import.meta.url)), '--no-open'],
  {
    env: { ...process.env, PORT: '0' },
    stdio: ['ignore', 'pipe', 'inherit'],
  },
);
let browser;
try {
  const url = await new Promise((resolve, reject) => {
    let output = '';
    server.stdout.on('data', (data) => {
      output += data;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+\//);
      if (match) resolve(match[0]);
    });
    server.once('error', reject);
    server.once('exit', (code) => reject(new Error(`Screenshot server stopped (${code})`)));
  });
  browser = await chromium.launch({
    channel: process.env.PLAYLOAD_BROWSER_CHANNEL,
    ignoreDefaultArgs: ['--hide-scrollbars'],
  });
  const images = [];
  for (const [name, tab] of [
    ['info-api', 'API'],
    ['info-emoji', 'Emoji'],
    ['info-symbols', 'Symbols'],
    ['info-alphabet', 'Alphabet'],
    ['info-kana', 'Kana'],
    ['info-examples', 'Examples'],
  ]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url);
    await page.getByRole('tab', { name: 'Info', exact: true }).click();
    await page.getByRole('tab', { name: tab, exact: true }).click();
    if (!['API', 'Examples'].includes(tab)) await page.locator('#catalog button').first().waitFor();
    await page.evaluate(async () => {
      await globalThis.document.fonts.ready;
      await new Promise((resolve) =>
        globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve)),
      );
    });
    if (errors.length) throw new Error(errors.join('\n'));
    if (await page.locator('#error-notice').isVisible())
      throw new Error(await page.locator('#error').textContent());
    if (['API', 'Emoji', 'Examples'].includes(tab)) {
      const panel = tab === 'Emoji' ? '#catalog' : tab === 'API' ? '#api' : '#examples';
      const clipped = await page
        .locator(panel)
        .evaluate(
          (element) =>
            element.scrollHeight > element.clientHeight + 1 ||
            element.scrollWidth > element.clientWidth + 1,
        );
      if (clipped) throw new Error(`${tab} does not fit the README screenshot`);
    }
    await page.mouse.move(viewport.width - 1, viewport.height - 1);
    images.push([`${name}.jpg`, await page.screenshot({ type: 'jpeg', quality: 90 })]);
    await page.close();
  }
  for (const entry of exampleLinks) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.clock.install();
    await page.goto(url);
    await page.evaluate(async () => {
      await globalThis.document.fonts.ready;
      await new Promise((resolve) =>
        globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve)),
      );
    });
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    if (entry.id !== 'starter') {
      const source = await readFile(new URL(`../examples/${entry.id}.js`, import.meta.url), 'utf8');
      await page.locator('#editor').fill(source);
    }
    await page.locator('#editor').evaluate((editor) => {
      editor.setSelectionRange(0, 0);
      editor.scrollTop = editor.scrollLeft = 0;
    });
    // Settle layout and payload before Run; its first game frame stays frozen without inputs.
    await page.clock.runFor(300);
    await page.waitForFunction(
      (size) => globalThis.document.querySelector('#size-current').textContent === size,
      (entry.bytes / 1024).toFixed(2) + ' KB',
      { polling: 50 },
    );
    await page.locator('#run').click({ force: true });
    await page.waitForFunction(
      () => globalThis.document.querySelector('#pause:not(:disabled)'),
      null,
      { polling: 50 },
    );
    if (errors.length) throw new Error(`${entry.name}: ${errors.join('\n')}`);
    if (await page.locator('#error-notice').isVisible())
      throw new Error(`${entry.name}: ${await page.locator('#error').textContent()}`);
    await page.locator('#display').evaluate((canvas) => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      if (!pixels.some((value, index) => index % 4 !== 3 && value > 200))
        throw new Error('The initial game screen is empty.');
    });
    await page.mouse.move(viewport.width - 1, viewport.height - 1);
    images.push([`example-${entry.id}.jpg`, await page.screenshot({ type: 'jpeg', quality: 90 })]);
    await page.close();
  }
  for (const [name, image] of images) await writeFile(new URL(name, directory), image);
  console.log(
    `Updated ${images.length} tool screenshots at ${viewport.width} × ${viewport.height}.`,
  );
} finally {
  server.kill();
  await browser?.close();
}
