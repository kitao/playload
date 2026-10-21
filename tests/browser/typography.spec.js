import { test, expect } from './fixtures.js';

test('a slow UI font keeps the first workspace layout hidden until its real metrics are available', async ({
  page,
}) => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  let arrived;
  const requested = new Promise((resolve) => (arrived = resolve));
  await page.route('**/jetbrains-mono.woff2', async (route) => {
    arrived();
    await gate;
    await route.continue();
  });
  const loading = page.goto('/playload/app/');
  try {
    await requested;
    await page.locator('#app').waitFor({ state: 'attached' });
    await expect(page.locator('#app')).toBeHidden();
    release();
    await loading;
    await expect(page.locator('#app')).toBeVisible();
    expect(await page.evaluate(() => document.fonts.check('14px "JetBrains Mono"'))).toBe(true);
    await expect(page.locator('#start-game')).toBeVisible();
  } finally {
    release();
    await loading;
  }
});

test('a failed UI font request still leaves the editor and Run usable', async ({ page }) => {
  await page.route('**/jetbrains-mono.woff2', (route) => route.abort());
  await page.goto('/playload/app/');
  await expect(page.locator('#app')).toBeVisible();
  await page.locator('#editor').fill('function tick() { cls(4); }');
  await page.locator('#run').click();
  await expect(page.locator('#pause')).toBeEnabled();
  await expect(page.locator('#error-notice')).toBeHidden();
});
