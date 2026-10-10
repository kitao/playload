import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { exampleLinks } from '../src/example-links.js';

const viewport = { width: 1600, height: 900 };
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
    ['play', null],
    ['cheat-sheet', 'API'],
    ['emoji', 'Emoji'],
    ['examples', 'Examples'],
  ]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(
      url + (tab ? '' : exampleLinks.find((entry) => entry.id === 'glyph-quest').hash),
    );
    if (tab) {
      await page.getByRole('tab', { name: 'Info', exact: true }).click();
      await page.getByRole('tab', { name: tab, exact: true }).click();
      if (tab === 'Emoji') await page.locator('#catalog button').first().waitFor();
    } else {
      await page.locator('#pause:not(:disabled)').waitFor();
      await page.waitForFunction(() => {
        const canvas = globalThis.document.querySelector('#display');
        return canvas
          .getContext('2d')
          .getImageData(0, 0, canvas.width, canvas.height)
          .data.some((value, index) => index % 4 !== 3 && value > 200);
      });
    }
    await page.evaluate(async () => {
      await globalThis.document.fonts.ready;
      await new Promise((resolve) =>
        globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve)),
      );
    });
    if (errors.length) throw new Error(errors.join('\n'));
    if (await page.locator('#error-notice').isVisible())
      throw new Error(await page.locator('#error').textContent());
    if (tab) {
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
    images.push([name, await page.screenshot({ type: 'jpeg', quality: 90 })]);
    await page.close();
  }
  for (const [name, image] of images)
    await writeFile(new URL(`../docs/images/${name}.jpg`, import.meta.url), image);
  console.log(`Updated four README screenshots at ${viewport.width} × ${viewport.height}.`);
} finally {
  server.kill();
  await browser?.close();
}
