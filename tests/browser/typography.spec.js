import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('the introduction loads the shared same-origin font without a content-policy violation', async ({
  page,
}) => {
  // A bundled webfont tests the shared-font transport without depending on the live site.
  const fixture = await readFile(new URL('../../src/app/jetbrains-mono.woff2', import.meta.url));
  const requests = [];
  await page.addInitScript(() => {
    window.fontPolicyViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      if (event.violatedDirective.startsWith('font-src'))
        window.fontPolicyViolations.push(event.blockedURI);
    });
  });
  await page.route('**/assets/fonts/noto-sans-jp.css', (route) => {
    requests.push(new URL(route.request().url()).pathname);
    return route.fulfill({
      contentType: 'text/css',
      body: `@font-face {
        font-family: 'Noto Sans JP';
        font-weight: 300 700;
        src: url('./noto-sans-jp/123.woff2') format('woff2');
      }`,
    });
  });
  await page.route('**/assets/fonts/noto-sans-jp/123.woff2', (route) => {
    requests.push(new URL(route.request().url()).pathname);
    return route.fulfill({ contentType: 'font/woff2', body: fixture });
  });
  await page.goto('/playload/');
  await page.evaluate(() => document.fonts.ready);
  expect(requests).toEqual([
    '/assets/fonts/noto-sans-jp.css',
    '/assets/fonts/noto-sans-jp/123.woff2',
  ]);
  await expect(page.locator('.readme:visible')).toHaveCSS(
    'font-family',
    '"Noto Sans JP", sans-serif',
  );
  expect(
    await page.evaluate(() =>
      [...document.fonts].some(
        (face) => face.family === 'Noto Sans JP' && face.status === 'loaded',
      ),
    ),
  ).toBe(true);
  expect(await page.evaluate(() => window.fontPolicyViolations)).toEqual([]);
  const code = page.locator('.readme:visible code').first();
  await code.scrollIntoViewIfNeeded();
  await expect(code).toHaveCSS('font-family', '"JetBrains Mono", monospace');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const touch of [false, true]) {
  test(`the workspace uses one bundled face for controls, code and reference text on ${touch ? 'phone' : 'desktop'}`, async ({
    browser,
  }) => {
    const page = await browser.newPage({
      viewport: touch ? { width: 390, height: 844 } : { width: 1400, height: 900 },
      hasTouch: touch,
      isMobile: touch,
    });
    try {
      const fonts = [];
      page.on('response', (response) => {
        if (response.url().endsWith('.woff2')) fonts.push(response);
      });
      await page.goto('/playload/app/');
      await expect(page.locator('#app')).toBeVisible();
      expect(fonts).toHaveLength(1);
      expect(new URL(fonts[0].url()).origin).toBe(new URL(page.url()).origin);
      expect(fonts[0].status()).toBe(200);
      expect(fonts[0].headers()['content-type']).toBe('font/woff2');
      expect(
        await page.evaluate(() =>
          [...document.fonts].some(
            (face) =>
              face.family === 'JetBrains Mono' &&
              face.weight === '100 800' &&
              face.status === 'loaded',
          ),
        ),
      ).toBe(true);
      if (touch) {
        await page.locator('#tools-toggle').click();
        await page.locator('#code-toggle').click();
      }
      const code = '// @title Typography\nconst operators = a !== b && c <= d;\n';
      await page.locator('#editor').fill(code);
      await expect(page.locator('#editor-highlight')).toHaveText(code + '\n');
      const metrics = await page.evaluate(() => {
        const selectors = ['#editor', '#editor-highlight', '#editor-line-numbers'];
        const styles = selectors.map((selector) => {
          const style = getComputedStyle(document.querySelector(selector));
          return [style.fontFamily, style.fontSize, style.lineHeight, style.fontVariantLigatures];
        });
        const context = document.createElement('canvas').getContext('2d');
        context.font = '14px "JetBrains Mono"';
        const width = (text) => context.measureText(text).width;
        return {
          styles,
          advances: ['iiii', 'WWWW', '0000', '!==>', '{}[]'].map(width),
        };
      });
      expect(
        metrics.styles.every(
          (style) => JSON.stringify(style) === JSON.stringify(metrics.styles[0]),
        ),
      ).toBe(true);
      expect(metrics.styles[0][3]).toBe('none');
      for (const width of metrics.advances) expect(width).toBeCloseTo(33.6, 1);
      for (const selector of ['body', '#run', '#run kbd', '#format', '#size']) {
        await expect(page.locator(selector)).toHaveCSS(
          'font-family',
          '"JetBrains Mono", monospace',
        );
      }
      await page.getByRole('tab', { name: 'Info', exact: true }).click();
      await page.getByRole('tab', { name: 'API', exact: true }).click();
      for (const selector of [
        '.api-guide dt',
        '.api-example code',
        '.mml-group code',
        '.note-lengths code',
      ]) {
        await expect(page.locator(selector).first()).toHaveCSS(
          'font-family',
          '"JetBrains Mono", monospace',
        );
      }
      for (const weight of [400, 600, 700]) {
        expect(
          await page.evaluate(
            (weight) => document.fonts.check(`${weight} 14px "JetBrains Mono"`),
            weight,
          ),
        ).toBe(true);
      }
      expect(fonts).toHaveLength(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.getByRole('tab', { name: 'Symbols', exact: true }).click();
      await expect(page.locator('.glyph span').first()).toHaveCSS(
        'font-family',
        'system-ui, "Playload Symbol Fallback", sans-serif',
      );
    } finally {
      await page.close();
    }
  });
}

test('a slow UI font keeps the first workspace layout hidden until its real metrics are available', async ({
  page,
}) => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  let arrived;
  const requested = new Promise((resolve) => (arrived = resolve));
  await page.route('**/jetbrains-mono-*.woff2', async (route) => {
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
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/jetbrains-mono-*.woff2', (route) => route.abort());
  await page.goto('/playload/app/');
  await expect(page.locator('#app')).toBeVisible();
  await page.locator('#editor').fill('function tick() { cls(4); }');
  await page.locator('#run').click();
  await expect(page.locator('#pause')).toBeEnabled();
  await expect(page.locator('#error-notice')).toBeHidden();
  expect(errors).toEqual([]);
});
