import { test, expect, watchPolicyViolations, policyViolations } from './fixtures.js';
import { decode } from '../../src/payload.js';
import { readFile } from 'node:fs/promises';
import { ARCADE_PAGE_SIZE, arcadePages } from '../../scripts/arcade-pages.js';

const catalog = JSON.parse(
  await readFile(new URL('../../data/arcade.json', import.meta.url), 'utf8'),
);
const pages = arcadePages(catalog);

for (const [index, current] of pages.entries()) {
  test(`Arcade page ${index + 1} opens games and author profiles under the site content policy`, async ({
    page,
    context,
  }) => {
    await watchPolicyViolations(page);
    const response = await page.goto('/playload/' + current.path);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-security-policy']).not.toContain("'unsafe-eval'");
    await expect(page).toHaveTitle(
      index === 0 ? 'Playload Arcade' : `Playload Arcade — Page ${index + 1}`,
    );
    const game = page.locator('.game-link').first();
    const gameURL = new URL(await game.getAttribute('href'), page.url());
    const source = await decode(gameURL.hash);
    const opened = context.waitForEvent('page');
    await game.locator('img').click();
    const player = await opened;
    await expect(player.locator('#editor')).toHaveValue(source);
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
}

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
      for (const current of pages) {
        await page.goto('/playload/' + current.path);
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
    }
  } finally {
    await context.close();
  }
});

test('Arcade page links work without JavaScript, preserve order and restore Back position', async ({
  browser,
}) => {
  test.skip(pages.length < 2, 'The catalog fits on a single page.');
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 375, height: 900 },
  });
  const page = await context.newPage();
  try {
    await page.goto('/playload/arcade/');
    await expect(page.locator('.games li')).toHaveCount(ARCADE_PAGE_SIZE);
    const firstTitles = await page.locator('.game-title').allTextContents();
    const navigation = page.getByRole('navigation', { name: 'Arcade pages' });
    await expect(navigation).toHaveCount(2);
    await expect(navigation.first().locator('[aria-current="page"]')).toHaveText('1');
    await expect(navigation.first().getByRole('link', { name: 'Previous page' })).toHaveCount(0);
    const next = navigation.last().getByRole('link', { name: 'Next page' });
    await next.scrollIntoViewIfNeeded();
    const scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY).toBeGreaterThan(0);
    const hitArea = await next.boundingBox();
    expect(hitArea.width).toBeGreaterThanOrEqual(24);
    expect(hitArea.height).toBeGreaterThanOrEqual(24);
    await next.click();
    await expect(page).toHaveURL(/\/playload\/arcade\/page\/2\/$/);
    await expect(page.locator('.games li')).toHaveCount(pages[1].cards.length);
    await expect(page.locator('[aria-current="page"]')).toHaveText(['2', '2']);
    await expect(navigation.first().getByRole('link', { name: 'Next page' })).toHaveCount(
      pages.length > 2 ? 1 : 0,
    );
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect([...firstTitles, ...(await page.locator('.game-title').allTextContents())]).toEqual(
      catalog.slice(0, ARCADE_PAGE_SIZE * 2).map((game) => game.title),
    );
    await page.reload();
    await expect(page.locator('[aria-current="page"]')).toHaveText(['2', '2']);
    await page.goBack();
    await expect(page).toHaveURL(/\/playload\/arcade\/$/);
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThanOrEqual(scrollY - 5);
    await page
      .getByRole('navigation', { name: 'Arcade pages' })
      .first()
      .getByRole('link', { name: 'Page 2', exact: true })
      .focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/playload\/arcade\/page\/2\/$/);
    await page
      .getByRole('navigation', { name: 'Arcade pages' })
      .first()
      .getByRole('link', { name: 'Previous page' })
      .click();
    await expect(page).toHaveURL(/\/playload\/arcade\/$/);
  } finally {
    await context.close();
  }
});
