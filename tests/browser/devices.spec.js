import { test, expect, trackDecodes, decodesSettled } from './fixtures.js';
import { encode } from '../../src/payload.js';

// Runs only in the iPhone and Android projects; docs/retro-output.md describes them.

const fitsWidth = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

async function expectInViewport(page, selector) {
  const box = await page.locator(selector).boundingBox(),
    viewport = page.viewportSize();
  expect(box.x, selector).toBeGreaterThanOrEqual(0);
  expect(box.y, selector).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, selector).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height, selector).toBeLessThanOrEqual(viewport.height);
}

test('the introduction fits the phone and keeps screenshots as plain images', async ({
  page,
}, testInfo) => {
  await trackDecodes(page);
  await page.goto('/playload/');
  await expect(page.locator('.introduction:visible')).toHaveCount(1);
  await expect(page.locator('.introduction:visible > h1 img')).toBeVisible();
  expect(await fitsWidth(page)).toBe(true);
  const links = page.locator('.introduction:visible .screenshots a');
  await expect(links).toHaveCount(4);
  // The enlarged preview needs a fine pointer that can hover; phones keep thumbnails.
  for (const link of await links.all()) {
    expect(await link.getAttribute('href')).toBeNull();
    expect(await link.getAttribute('aria-haspopup')).toBeNull();
  }
  const before = page.url();
  await links.first().locator('img').tap();
  // A preview opens only after its image decodes, so none may have started.
  await decodesSettled(page);
  await expect(page.getByRole('dialog')).toBeHidden();
  expect(page.url()).toBe(before);
  await page.screenshot({ path: testInfo.outputPath('introduction.png'), fullPage: true });
  await page.getByRole('link', { name: 'Open Playload' }).tap();
  await expect(page).toHaveURL(/\/playload\/app\/$/);
  await expect(page.locator('#start-game')).toBeVisible();
});

test('a shared game starts with a tap and responds to the on-screen controls', async ({
  page,
}, testInfo) => {
  // btnp keeps a short tap until the next tick, so each tap changes the state once.
  const { hash } = await encode(
    '// @title Phone\nlet x = 72, a = false;\nfunction tick() {\n  cls(1);\n' +
      '  if (btnp(3)) x += 8;\n  if (btnp(4)) a = !a;\n' +
      '  if (a) put(1, 1, "A", 6);\n  spr(x, 68, "👾", 6);\n}',
  );
  await page.goto('/playload/app/' + hash);
  await expect(page.locator('body')).toHaveAttribute('data-touch', 'true');
  await expect(page.locator('#start-game')).toHaveText('Tap to play');
  await expect(page.locator('#start-game')).toBeVisible();
  for (const selector of ['#display', '.dpad', '.ab', '#tools-toggle'])
    await expectInViewport(page, selector);
  expect(await fitsWidth(page)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('ready.png') });
  await page.locator('#screen').tap();
  await expect(page.locator('#start-game')).toBeHidden();
  await expect(page.locator('#pause')).toBeEnabled();
  // A short digest keeps failure messages readable.
  const picture = () =>
    page.locator('#display').evaluate((canvas) => {
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let hash = 0;
      for (let i = 0; i < data.length; i++) hash = (Math.imul(hash, 31) + data[i]) | 0;
      return hash;
    });
  for (const control of ['[data-input="3"]', '[data-input="4"]']) {
    const before = await picture();
    await page.locator(control).tap();
    await expect.poll(picture, control).not.toBe(before);
  }
  await page.screenshot({ path: testInfo.outputPath('playing.png') });
  await page.locator('#tools-toggle').tap();
  await expect(page.locator('#workspace-toolbar')).toBeVisible();
  await expect(page.locator('#pause')).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('tools.png') });
  await page.locator('#code-toggle').tap();
  await expect(page.locator('#editor')).toBeVisible();
  expect(await fitsWidth(page)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('code.png'), fullPage: true });
});

test('every Info tab fits the phone width', async ({ page }, testInfo) => {
  await page.goto('/playload/app/');
  await page.getByRole('tab', { name: 'Info', exact: true }).tap();
  const hover = await page.evaluate(() => matchMedia('(hover: hover)').matches);
  for (const name of ['About', 'API', 'Emoji', 'Symbols', 'Alphabet', 'Kana', 'Examples']) {
    const tab = page.getByRole('tab', { name, exact: true });
    await tab.scrollIntoViewIfNeeded();
    await tab.tap();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    // Touch screens keep :hover on the tapped element; it must not look highlighted.
    if (!hover) await expect(tab).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    expect(await fitsWidth(page), name).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`info-${name.toLowerCase()}.png`) });
  }
});

test('late stylesheets still give a finished player and introduction', async ({
  page,
}, testInfo) => {
  // WebKit can run scripts before a slow stylesheet applies, so values read
  // from CSS at startup must wait for it.
  await page.route(/\/bundles\/(?:app|site)-style\.css$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await page.goto('/playload/app/');
  await expect(page.locator('#start-game')).toBeVisible();
  for (const selector of ['#display', '.dpad', '.ab']) await expectInViewport(page, selector);
  await page.locator('#screen').tap();
  await expect(page.locator('#pause')).toBeEnabled();
  // The CRT surround takes the player's background color from CSS.
  expect(
    await page
      .locator('#display')
      .evaluate((canvas) => [...canvas.getContext('2d').getImageData(0, 0, 1, 1).data]),
  ).toEqual([33, 28, 41, 255]);
  await page.screenshot({ path: testInfo.outputPath('late-styles-player.png') });
  await page.goto('/playload/');
  await expect(page.locator('.introduction:visible')).toHaveCount(1);
  await expect(page.locator('.introduction:visible > h1 img')).toBeVisible();
  expect(await fitsWidth(page)).toBe(true);
});
