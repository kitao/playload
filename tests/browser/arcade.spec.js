import { test, expect, watchPolicyViolations, policyViolations } from './fixtures.js';

test('Arcade opens games and author profiles separately under the site content policy', async ({
  page,
  context,
}) => {
  await watchPolicyViolations(page);
  const response = await page.goto('/playload/arcade/');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-security-policy']).not.toContain("'unsafe-eval'");
  await expect(page).toHaveTitle('Playload Arcade');
  const game = page.locator('.game-link').first();
  const title = await game.locator('.game-title').textContent();
  const opened = context.waitForEvent('page');
  await game.locator('img').click();
  const player = await opened;
  await expect(player.locator('#editor')).toHaveValue(new RegExp('// @title ' + title));
  await player.locator('#start-game').click();
  await expect(player.locator('#pause')).toBeEnabled();
  await player.close();
  // Verify the author destination without contacting X.
  await context.route('https://x.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<title>Author profile</title>' }),
  );
  const author = page.locator('.game-author a').first();
  const profileURL = await author.getAttribute('href');
  const authorOpened = context.waitForEvent('page');
  await author.click();
  const profile = await authorOpened;
  await expect(profile).toHaveURL(profileURL);
  await profile.close();
  expect(await policyViolations(page)).toEqual([]);
  await page.getByRole('link', { name: 'Playload', exact: true }).click();
  await expect(page.locator('.introduction:visible')).toBeVisible();
});

test('Arcade stays readable without JavaScript across desktop, tablet and phone widths', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    for (const [width, columns] of [
      [1280, 3],
      [768, 2],
      [375, 1],
      [320, 1],
    ]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/playload/arcade/');
      const grid = page.locator('.games');
      expect(
        await grid.evaluate(
          (element) => getComputedStyle(element).gridTemplateColumns.split(' ').length,
        ),
      ).toBe(columns);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      for (const card of await page.locator('.games li').all()) {
        await card.scrollIntoViewIfNeeded();
        const image = card.locator('img');
        await expect(image).toBeVisible();
        await expect
          .poll(() => image.evaluate((element) => element.complete && element.naturalWidth > 0))
          .toBe(true);
      }
    }
  } finally {
    await context.close();
  }
});
