import { test, expect } from './fixtures.js';

import { readFile } from 'node:fs/promises';

test('alphabet previews and clipboard preserve the original letter case', async ({ page }) => {
  await page.addInitScript(() => {
    window.copied = [];
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (text) => window.copied.push(text) },
    });
  });
  await page.goto('/playload/app/');
  await page.getByRole('tab', { name: 'Info', exact: true }).click();
  await page.getByRole('tab', { name: 'Alphabet', exact: true }).click();
  for (const chr of ['A', 'a', 'µ']) {
    await page.locator('#catalog').evaluate(async (catalog, chr) => {
      const { glyphs } = await import('/src/engine/glyphs.js'),
        index = glyphs
          .filter((glyph) => glyph.group === 'letters')
          .findIndex((glyph) => glyph.ch === chr),
        columns = parseInt(
          getComputedStyle(document.getElementById('catalog-window')).getPropertyValue('--columns'),
        );
      catalog.scrollTop = Math.floor(index / columns) * 44;
    }, chr);
    const glyph = page.locator('[data-glyph="' + chr + '"]');
    await expect(glyph.locator('span')).toHaveText(chr);
    await expect(glyph.locator('span')).toHaveCSS('text-transform', 'none');
    await glyph.click();
    await expect(page.locator('#status')).toHaveText('Copied');
  }
  expect(await page.evaluate(() => window.copied)).toEqual(['A', 'a', 'µ']);
});

test('catalog copies clean up the fallback after a recent success', async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    window.copied = [];
    window.fallbackCopies = [];
    document.execCommand = (command) => {
      if (command !== 'copy') return false;
      window.fallbackCopies.push(document.activeElement.value);
      return true;
    };
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async (text) => {
          if (window.copied.length) throw new Error('Clipboard unavailable');
          window.copied.push(text);
        },
      },
    });
  });
  await page.goto('/playload/app/');
  await page.getByRole('tab', { name: 'Info', exact: true }).click();
  await page.getByRole('tab', { name: 'Emoji', exact: true }).click();
  await page.locator('#catalog button').first().click();
  await expect(page.locator('#status')).toHaveText('Copied');
  expect(await page.evaluate(() => window.copied)).toEqual([
    await page.locator('#catalog button').first().getAttribute('data-glyph'),
  ]);

  await page.getByRole('tab', { name: 'Emoji', exact: true }).click();
  const glyph = page.locator('#catalog button').first();
  const character = await glyph.getAttribute('data-glyph');
  await glyph.focus();
  await glyph.press('Enter');
  await expect(page.locator('#status')).toHaveText('Copied');
  expect(await page.evaluate(() => window.fallbackCopies)).toEqual([character]);
  await expect(glyph).toBeFocused();
  await expect(page.locator('.clipboard-field, #status textarea')).toHaveCount(0);

  await page.clock.fastForward(2000);
  await expect(page.locator('#status')).toBeHidden();
  await expect(page.locator('.clipboard-field, #status textarea')).toHaveCount(0);
});

test('a failed copy reports briefly without leaving a field or stealing focus', async ({
  page,
}) => {
  await page.clock.install();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined });
    document.execCommand = () => false;
  });
  await page.goto('/playload/app/');
  await page.getByRole('tab', { name: 'Info', exact: true }).click();
  await page.getByRole('tab', { name: 'Emoji', exact: true }).click();
  const glyph = page.locator('#catalog button').first();
  await glyph.focus();
  await glyph.press('Enter');

  await expect(page.locator('#status')).toHaveText('Could not copy.');
  await expect(page.locator('.clipboard-field, #status textarea')).toHaveCount(0);
  await expect(glyph).toBeFocused();
  await page.clock.fastForward(2000);
  await expect(page.locator('#status')).toBeHidden();
});

test('scrolling a focused virtual catalog retains keyboard navigation', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 400 });
  await page.goto('/playload/app/');
  await page.getByRole('tab', { name: 'Info', exact: true }).click();
  await page.getByRole('tab', { name: 'Emoji', exact: true }).click();
  await page.locator('#catalog button').first().focus();
  await page.locator('#catalog').evaluate((el) => (el.scrollTop = 300));
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.matches('#catalog [data-glyph]')))
    .toBe(true);
  await page.keyboard.press('End');
  await expect
    .poll(() =>
      page.locator('#catalog').evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight),
    )
    .toBeLessThan(44);
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.matches('#catalog [data-glyph]')))
    .toBe(true);
});

test('supplementary catalog symbols have a source-faithful font fallback', async ({ page }) => {
  const errors = [];
  page.on('console', (entry) => {
    if (entry.type() === 'error') errors.push(entry.text());
  });
  await page.goto('/playload/app/');
  await page.getByRole('tab', { name: 'Info', exact: true }).click();
  await page.getByRole('tab', { name: 'Emoji', exact: true }).click();
  const result = await page.evaluate(async () => {
    const { glyphs } = await import('/src/engine/glyphs.js');
    const selected = glyphs.filter((g) => g.group === 'symbols' && g.ch.codePointAt(0) > 0xffff);
    const loaded = await document.fonts.load('64px "Playload Symbol Fallback"', selected[0].ch);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.font = '64px "Playload Symbol Fallback"';
    ctx.fillStyle = '#fff';
    const wrong = [];
    for (const g of selected) {
      ctx.clearRect(0, 0, 64, 64);
      ctx.fillText(g.ch, 0, 64);
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++) {
          const actual = ctx.getImageData(x * 8 + 4, y * 8 + 4, 1, 1).data[3];
          const expected = g.rows[y] & (128 >> x) ? 255 : 0;
          if (actual !== expected) wrong.push(g.ch);
        }
    }
    return { loaded: loaded.map((face) => face.status), wrong, count: selected.length };
  });
  expect(result.loaded).toEqual(['loaded']);
  const report = JSON.parse(
    await readFile(new URL('../../docs/glyph-coverage.json', import.meta.url), 'utf8'),
  );
  expect(result.count).toBe(report.catalogFont.glyphCount);
  expect(result.wrong).toEqual([]);
  expect(errors).toEqual([]);
});
