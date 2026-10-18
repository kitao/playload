import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { exampleLinks } from '../src/app/examples.js';
import { formatPayloadSize } from '../src/payload.js';

const viewport = { width: 1600, height: 900 };
const directory = new URL('../assets/images/', import.meta.url);
// wrangler dev builds dist/ and serves it as Cloudflare would.
const port = 8766;
const url = `http://127.0.0.1:${port}/playload/app/`;
const server = spawn(
  process.execPath,
  [fileURLToPath(new URL('wrangler.mjs', import.meta.url)), 'dev', '--port', String(port)],
  { stdio: ['ignore', 'ignore', 'inherit'] },
);
let browser;
try {
  await new Promise((resolve, reject) => {
    server.once('exit', (code) => reject(new Error(`Screenshot server stopped (${code})`)));
    const poll = () =>
      fetch(url).then(
        (response) => (response.ok ? resolve() : setTimeout(poll, 500)),
        () => setTimeout(poll, 500),
      );
    poll();
  });
  browser = await chromium.launch({
    // The same full Chromium as the browser checks.
    channel: 'chromium',
    ignoreDefaultArgs: ['--hide-scrollbars'],
  });
  const images = [];
  async function capture(page, name) {
    images.push([`${name}.png`, await page.screenshot({ type: 'png', scale: 'css' })]);
    images.push([`${name}@2x.png`, await page.screenshot({ type: 'png', scale: 'device' })]);
  }
  for (const [name, tab] of [
    ['info-api', 'API'],
    ['info-emoji', 'Emoji'],
    ['info-examples', 'Examples'],
  ]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url);
    await page.getByRole('tab', { name: 'Info', exact: true }).click();
    await page.getByRole('tab', { name: tab, exact: true }).click();
    if (tab === 'Emoji') await page.locator('#catalog button').first().waitFor();
    await page.evaluate(async () => {
      await globalThis.document.fonts.ready;
      await new Promise((resolve) =>
        globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve)),
      );
    });
    if (errors.length) throw new Error(errors.join('\n'));
    if (await page.locator('#error-notice').isVisible())
      throw new Error(await page.locator('#error').textContent());
    const panel = tab === 'Emoji' ? '#catalog' : tab === 'API' ? '#api' : '#examples';
    const clipped = await page
      .locator(panel)
      .evaluate(
        (element) =>
          element.scrollHeight > element.clientHeight + 1 ||
          element.scrollWidth > element.clientWidth + 1,
      );
    if (clipped) throw new Error(`${tab} does not fit the README screenshot`);
    await page.mouse.move(viewport.width - 1, viewport.height - 1);
    await capture(page, name);
    await page.close();
  }
  const entry = exampleLinks.find((example) => example.id === 'glyph-quest');
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
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
  const source = await readFile(new URL(`../examples/${entry.id}.js`, import.meta.url), 'utf8');
  await page.locator('#editor').fill(source);
  await page.locator('#editor').evaluate((editor) => {
    editor.setSelectionRange(0, 0);
    editor.scrollTop = editor.scrollLeft = 0;
  });
  // Settle layout and payload before Run; its first game frame stays frozen without inputs.
  await page.clock.runFor(300);
  await page.waitForFunction(
    (size) => globalThis.document.querySelector('#size-current').textContent === size,
    formatPayloadSize(entry.bytes),
    { polling: 50 },
  );
  await page.locator('#run').click({ force: true });
  await page.waitForFunction(
    () => globalThis.document.querySelector('#pause:not(:disabled)'),
    null,
    { polling: 50 },
  );
  await page.locator('#screen').click({ force: true });
  if (errors.length) throw new Error(`${entry.name}: ${errors.join('\n')}`);
  if (await page.locator('#error-notice').isVisible())
    throw new Error(`${entry.name}: ${await page.locator('#error').textContent()}`);
  await page.locator('#display').evaluate((canvas) => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    if (!pixels.some((value, index) => index % 4 !== 3 && value > 200))
      throw new Error('The initial game screen is empty.');
  });
  await page.mouse.move(viewport.width - 1, viewport.height - 1);
  await capture(page, `example-${entry.id}`);
  await page.close();
  for (const [name, image] of images) await writeFile(new URL(name, directory), image);
  console.log(
    `Updated ${images.length / 2} tool screenshots at ${viewport.width} × ${viewport.height} and 2× density.`,
  );
} finally {
  server.kill();
  await browser?.close();
}
