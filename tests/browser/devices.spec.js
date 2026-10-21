import { test, expect } from './fixtures.js';

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

test('the touch workspace stays centered and keeps controls accessible through resizing', async ({
  page,
}) => {
  await page.goto('/playload/app/');
  await expect(page.locator('#start-game')).toBeVisible();
  for (const [width, height] of [
    [320, 568],
    [393, 520],
    [390, 844],
    [844, 390],
    [768, 1024],
    [1024, 768],
  ]) {
    await page.setViewportSize({ width, height });
    await expect
      .poll(() =>
        page.locator('#viewport').evaluate((element) => {
          const box = element.getBoundingClientRect();
          return Math.abs(box.x + box.width / 2 - innerWidth / 2);
        }),
      )
      .toBeLessThanOrEqual(1);
    for (const selector of ['#screen', '.dpad', '.ab', '#tools-toggle', '#site-link']) {
      const box = await page.locator(selector).boundingBox();
      expect(box.x, selector).toBeGreaterThanOrEqual(0);
      expect(box.y, selector).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, selector).toBeLessThanOrEqual(width);
      expect(box.y + box.height, selector).toBeLessThanOrEqual(height);
    }
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <= innerWidth &&
          document.documentElement.scrollHeight <= innerHeight,
      ),
    ).toBe(true);
  }
  await page.locator('#tools-toggle').tap();
  await expect(page.locator('#workspace-toolbar')).toBeVisible();
  await page.locator('#code-toggle').tap();
  await expect(page.locator('#editor')).toBeVisible();
  await page.locator('#info-tab').tap();
  for (const name of ['About', 'API', 'Emoji', 'Symbols', 'Alphabet', 'Kana', 'Examples']) {
    const tab = page.getByRole('tab', { name, exact: true });
    await tab.scrollIntoViewIfNeeded();
    await tab.tap();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.locator('#site-link').tap();
  await expect(page).toHaveURL(/\/playload\/$/);
  await expect(page.locator('.introduction:visible')).toBeVisible();
});
