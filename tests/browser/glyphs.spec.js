import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('the curated game catalog scrolls continuously without search or pagination', async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1710, height: 895 });
  await page.goto('/');
  await page.getByRole('tab', { name: 'Info', exact: true }).click();
  await page.getByRole('tab', { name: 'Emoji', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Emoji', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.locator('#categories, #all-tab')).toHaveCount(0);
  await expect(page.locator('#catalog button').first()).toBeVisible();
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await page.screenshot({ path: testInfo.outputPath('emoji-readme.jpg'), quality: 90 });
  await page.getByRole('tab', { name: 'API', exact: true }).click();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Emoji', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('searchbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Next page' })).toHaveCount(0);
  for (const category of ['letters', 'symbols', 'emoji', 'kana']) {
    await page.locator('[data-category="' + category + '"]').click();
    await expect(page.locator('#catalog button').first()).toBeVisible();
    const first = await page.locator('#catalog button').first().getAttribute('data-glyph');
    const scrollable = await page
      .locator('#catalog')
      .evaluate((el) => el.scrollHeight > el.clientHeight);
    if (scrollable) {
      await page
        .locator('#catalog')
        .evaluate((el) => (el.scrollTop = el.scrollHeight - el.clientHeight));
      await expect
        .poll(() => page.locator('#catalog button').first().getAttribute('data-glyph'))
        .not.toBe(first);
    }
    expect(await page.locator('#catalog button').count()).toBeLessThan(500);
    await page.locator('#catalog button').last().focus();
    await page.keyboard.press('Home');
    await expect
      .poll(() => page.locator('#catalog button').first().getAttribute('data-glyph'))
      .toBe(first);
  }
  expect(errors).toEqual([]);
});

test('scrolling a focused virtual catalog retains keyboard navigation', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 400 });
  await page.goto('/');
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
  await page.goto('/');
  await page.getByRole('tab', { name: 'Info', exact: true }).click();
  await page.getByRole('tab', { name: 'Emoji', exact: true }).click();
  const result = await page.evaluate(async () => {
    const { glyphs } = await import('/src/glyphs.js');
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
  expect(result.count).toBe(290);
  expect(result.wrong).toEqual([]);
  expect(errors).toEqual([]);
});

test('catalog artwork matches real worker output, including European accents, kana and emoji selectors', async ({
  page,
}) => {
  await page.goto('/');
  const samples = [
    'é',
    'Ґ',
    'ά',
    '👾',
    '👻',
    'が',
    'ガ',
    '━',
    '▇',
    '◉',
    '🦆',
    '⇦',
    '⣿',
    'א',
    'שׁ',
    'Ϣ',
    'Ș',
    '元',
    '円',
  ];
  const expected = await page.evaluate(async (samples) => {
    const { glyphs } = await import('/src/glyphs.js');
    const { palette } = await import('/src/engine.js');
    return samples.map((ch) => {
      const g = glyphs.find((g) => g.ch.replace(/[\uFE0E\uFE0F]/g, '') === ch);
      return Array.from({ length: 64 }, (_, i) => {
        const hex = palette[g.rows[i >> 3] & (128 >> (i % 8)) ? (g.ink ?? 7) : (g.paper ?? 0)];
        return [1, 3, 5].map((x) => parseInt(hex.slice(x, x + 2), 16)).concat(255);
      }).flat();
    });
  }, samples);
  await page.getByRole('tab', { name: 'Play' }).click();
  await page
    .getByRole('textbox', { name: 'JavaScript code' })
    .fill(
      'function tick(){cls(0);put(1,1,"e\\u0301Ґα\\u0301👾️👻か\\u3099カ\\u3099━▇◉🦆⇦⣿א\\u05e9\\u05c1ϢS\\u0326元円")}',
    );
  await page.getByRole('button', { name: 'Run', exact: false }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
  await page.getByRole('button', { name: 'CRT', exact: true }).click();
  await expect
    .poll(() =>
      page.locator('#display').evaluate((canvas, count) => {
        const ctx = canvas.getContext('2d');
        return Array.from({ length: count }, (_, g) =>
          Array.from({ length: 64 }, (_, i) => [
            ...ctx.getImageData((8 + g * 8 + (i % 8)) * 4, (8 + (i >> 3)) * 4, 1, 1).data,
          ]).flat(),
        );
      }, samples.length),
    )
    .toEqual(expected);
});

test('CRT reconstruction scales smoothly at fractional sizes while flat pixels remain sharp', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Play' }).click();
  await page
    .getByRole('textbox', { name: 'JavaScript code' })
    .fill('function tick(){cls(0);put(1,1,"STARS → 👾")}');
  await page.getByRole('button', { name: 'Run', exact: false }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
  for (const width of [375, 513, 863]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('#display')).toHaveCSS('image-rendering', 'auto');
    await page.getByRole('button', { name: 'CRT', exact: true }).click();
    await expect(page.locator('#display')).toHaveCSS('image-rendering', 'pixelated');
    await page.getByRole('button', { name: 'CRT', exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});

test('all 108 algorithm-colored emoji retain their default ink in a real game worker', async ({
  page,
}) => {
  await page.goto('/');
  const { code, expected } = await page.evaluate(async () => {
    const { glyphs } = await import('/src/glyphs.js');
    const { palette } = await import('/src/engine.js');
    const emoji = glyphs.filter((g) => g.group === 'emoji');
    const rows = Array.from({ length: 6 }, (_, y) =>
      emoji
        .slice(y * 18, y * 18 + 18)
        .map((g) => g.ch)
        .join(''),
    );
    const code = `function tick(){cls(0);put(0,0,${JSON.stringify(rows.join('\n'))})}`;
    const expected = emoji.map((g) =>
      Array.from({ length: 64 }, (_, i) => {
        const hex = palette[g.rows[i >> 3] & (128 >> (i % 8)) ? g.ink : g.paper];
        return [1, 3, 5].map((x) => parseInt(hex.slice(x, x + 2), 16)).concat(255);
      }).flat(),
    );
    return { code, expected };
  });
  await page.getByRole('textbox', { name: 'JavaScript code' }).fill(code);
  await page.getByRole('button', { name: 'Run', exact: false }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
  await page.getByRole('button', { name: 'CRT', exact: true }).click();
  await expect
    .poll(() =>
      page.locator('#display').evaluate((canvas) => {
        const ctx = canvas.getContext('2d');
        return Array.from({ length: 108 }, (_, g) =>
          Array.from({ length: 64 }, (_, i) => [
            ...ctx.getImageData(
              ((g % 18) * 8 + (i % 8)) * 4,
              (Math.floor(g / 18) * 8 + (i >> 3)) * 4,
              1,
              1,
            ).data,
          ]).flat(),
        );
      }),
    )
    .toEqual(expected);
});

test('a shared pictogram dungeon starts with CRT and sound', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1710, height: 895 });
  const source = await readFile(new URL('../../examples/glyph-quest.js', import.meta.url), 'utf8');
  await page.goto('/');
  const hash = await page.evaluate(async (source) => {
    const { encode } = await import('/src/payload.js');
    return (await encode(source)).hash;
  }, source);
  expect(hash.length).toBeLessThan(4096);
  await page.goto('/' + hash);
  await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'CRT', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Sound', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('alert')).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('play-readme.jpg'), quality: 90 });
});
