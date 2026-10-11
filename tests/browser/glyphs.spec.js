import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

test('alphabet previews and clipboard preserve the original letter case', async ({ page }) => {
  await page.addInitScript(() => {
    window.copied = [];
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (text) => window.copied.push(text) },
    });
  });
  await page.goto('/');
  await page.getByRole('tab', { name: 'Info', exact: true }).click();
  await page.getByRole('tab', { name: 'Alphabet', exact: true }).click();
  for (const chr of ['A', 'a', 'µ']) {
    await page.locator('#catalog').evaluate(async (catalog, chr) => {
      const { glyphs } = await import('/src/glyphs.js'),
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

test('landscape phone Info leaves readable palette labels and space to browse every category', async ({
  browser,
}) => {
  const page = await browser.newPage({
    viewport: { width: 568, height: 320 },
    hasTouch: true,
    isMobile: true,
  });
  try {
    await page.goto('http://127.0.0.1:8765/');
    await page.locator('#info-tab').tap();
    for (const [width, height] of [
      [568, 320],
      [667, 375],
      [932, 430],
    ]) {
      await page.setViewportSize({ width, height });
      await expect
        .poll(() => page.locator('#api').evaluate((element) => element.clientHeight))
        .toBeGreaterThanOrEqual(80);
      const labelsFit = await page.locator('#palette .hex').evaluateAll((labels) =>
        labels.every((label) => {
          const range = document.createRange();
          range.selectNodeContents(label);
          const text = range.getBoundingClientRect(),
            button = label.parentElement.getBoundingClientRect();
          return text.left >= button.left && text.right <= button.right;
        }),
      );
      expect(labelsFit).toBe(true);
      for (const name of ['Emoji', 'Symbols', 'Alphabet', 'Kana']) {
        await page.getByRole('tab', { name, exact: true }).tap();
        const catalog = page.locator('#catalog'),
          first = page.locator('#catalog button').first();
        await expect(first).toBeVisible();
        expect(
          await first.evaluate((element) => {
            const tile = element.getBoundingClientRect(),
              catalog = document.getElementById('catalog').getBoundingClientRect();
            return tile.top >= catalog.top && tile.bottom <= catalog.bottom;
          }),
        ).toBe(true);
        await catalog.evaluate((element) => (element.scrollTop = element.scrollHeight));
        await expect
          .poll(() => catalog.evaluate((element) => element.scrollTop + element.clientHeight))
          .toBeGreaterThanOrEqual(await catalog.evaluate((element) => element.scrollHeight - 1));
      }
      await page.getByRole('tab', { name: 'Examples', exact: true }).tap();
      await expect(page.locator('#examples')).toBeVisible();
      await page.getByRole('tab', { name: 'API', exact: true }).tap();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth && scrollY === 0,
        ),
      ).toBe(true);
    }
  } finally {
    await page.close();
  }
});

test('catalog browsing position survives rotating while API, Examples or Play is visible', async ({
  browser,
}) => {
  const page = await browser.newPage({
    viewport: { width: 844, height: 390 },
    hasTouch: true,
    isMobile: true,
  });
  try {
    await page.goto('http://127.0.0.1:8765/');
    await page.locator('#info-tab').tap();
    for (const away of ['API', 'Examples', 'Play']) {
      await page.setViewportSize({ width: 844, height: 390 });
      await page.getByRole('tab', { name: 'Emoji', exact: true }).tap();
      const catalog = page.locator('#catalog');
      await catalog.evaluate((element) => (element.scrollTop = element.scrollHeight));
      const index = await catalog.evaluate((element) => {
        const columns = parseInt(
          getComputedStyle(document.getElementById('catalog-window')).getPropertyValue('--columns'),
        );
        return Math.floor(element.scrollTop / 44) * columns;
      });
      expect(index).toBeGreaterThan(0);
      await page.getByRole('tab', { name: away, exact: true }).tap();
      await page.setViewportSize({ width: 390, height: 844 });
      if (away === 'Play') await page.locator('#info-tab').tap();
      else await page.getByRole('tab', { name: 'Emoji', exact: true }).tap();
      const restored = await catalog.evaluate((element, index) => {
        const columns = parseInt(
          getComputedStyle(document.getElementById('catalog-window')).getPropertyValue('--columns'),
        );
        return {
          actual: element.scrollTop,
          expected: Math.min(
            Math.floor(index / columns) * 44,
            element.scrollHeight - element.clientHeight,
          ),
        };
      }, index);
      expect(restored.actual).toBeCloseTo(restored.expected, 0);
      await page.getByRole('tab', { name: 'Symbols', exact: true }).tap();
      expect(await catalog.evaluate((element) => element.scrollTop)).toBe(0);
    }
  } finally {
    await page.close();
  }
});

for (const touch of [false, true]) {
  test(`copy confirmation sits below its source without hiding its contents (${touch ? 'touch' : 'desktop'})`, async ({
    browser,
  }, testInfo) => {
    const page = await browser.newPage({
      viewport: touch ? { width: 390, height: 844 } : { width: 1280, height: 800 },
      hasTouch: touch,
      isMobile: touch,
    });
    await page.clock.install();
    await page.addInitScript(() =>
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: async () => {} },
      }),
    );
    await page.goto('http://127.0.0.1:8765/');
    await page.getByRole('tab', { name: 'Info', exact: true }).click();
    const color = page.locator('#palette button').first(),
      colorBox = await color.boundingBox(),
      colorText = await color.textContent(),
      panelBox = await page.locator('#info').boundingBox(),
      apiBox = await page.locator('#api').boundingBox();
    if (touch) await color.tap();
    else await color.click({ position: { x: 5, y: 5 } });
    const notice = page.locator('#status');
    await expect(notice).toHaveText('Copied');
    await expect(notice).toBeVisible();
    await expect(color).toHaveText(colorText);
    expect(await color.evaluate((element) => getComputedStyle(element, '::after').content)).toBe(
      'none',
    );
    expect(await color.boundingBox()).toEqual(colorBox);
    expect(await page.locator('#info').boundingBox()).toEqual(panelBox);
    expect(await page.locator('#api').boundingBox()).toEqual(apiBox);
    let noticeBox = await notice.boundingBox();
    expect(noticeBox.y).toBeCloseTo(colorBox.y + colorBox.height, 1);
    expect(noticeBox.x + noticeBox.width / 2).toBeCloseTo(colorBox.x + colorBox.width / 2, 1);
    expect(await notice.evaluate((element) => getComputedStyle(element).position)).toBe('fixed');
    expect(noticeBox.x).toBeGreaterThanOrEqual(8);
    expect(noticeBox.x + noticeBox.width).toBeLessThanOrEqual(page.viewportSize().width - 8);
    expect(await notice.evaluate((element) => getComputedStyle(element).borderTopColor)).toBe(
      'rgb(230, 200, 110)',
    );

    await page.getByRole('tab', { name: 'Emoji', exact: true }).click();
    const glyph = page.locator('#catalog button').first(),
      glyphBox = await glyph.boundingBox(),
      glyphText = await glyph.textContent(),
      artwork = await glyph.locator('canvas').evaluate((canvas) => canvas.toDataURL()),
      catalogBox = await page.locator('#catalog').boundingBox();
    if (touch) await glyph.tap();
    else {
      await glyph.focus();
      await page.keyboard.press('Enter');
    }
    await expect(notice).toHaveText('Copied');
    await expect(glyph).toHaveText(glyphText);
    expect(await glyph.evaluate((element) => getComputedStyle(element, '::after').content)).toBe(
      'none',
    );
    expect(await glyph.locator('canvas').evaluate((canvas) => canvas.toDataURL())).toBe(artwork);
    expect(await glyph.boundingBox()).toEqual(glyphBox);
    expect(await page.locator('#catalog').boundingBox()).toEqual(catalogBox);
    noticeBox = await notice.boundingBox();
    expect(noticeBox.y).toBeCloseTo(glyphBox.y + glyphBox.height - 5, 1);
    const artworkBox = await glyph.locator('canvas').boundingBox();
    expect(noticeBox.y).toBeGreaterThan(artworkBox.y + artworkBox.height);
    expect(noticeBox.x + noticeBox.width / 2).toBeCloseTo(glyphBox.x + glyphBox.width / 2, 1);
    expect(noticeBox.height).toBeGreaterThanOrEqual(30);
    expect(noticeBox.x).toBeGreaterThanOrEqual(8);
    expect(noticeBox.x + noticeBox.width).toBeLessThanOrEqual(page.viewportSize().width - 8);
    await expect(notice).toHaveCSS('opacity', '1');
    await page.screenshot({ path: testInfo.outputPath('copied.png') });
    const opacity = await notice.evaluate((element) => {
      const animation = element.getAnimations()[0];
      animation.pause();
      animation.currentTime = 875;
      return Number(getComputedStyle(element).opacity);
    });
    expect(opacity).toBeGreaterThan(0);
    expect(opacity).toBeLessThan(1);
    await page.screenshot({ path: testInfo.outputPath('copied-fading.png') });
    if (touch) await glyph.tap();
    else await page.keyboard.press('Enter');
    await expect(notice).toHaveCSS('opacity', '1');
    await page.clock.fastForward(950);
    await expect(notice).toHaveText('');
    await expect(glyph.locator('canvas')).toBeVisible();
    await page.close();
  });
}

test('reduced motion keeps the copy confirmation still until it disappears', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install();
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async () => {} },
    }),
  );
  await page.goto('/');
  await page.locator('#info-tab').click();
  await page.locator('#palette button').first().click();
  const notice = page.locator('#status');
  await expect(notice).toHaveText('Copied');
  await expect(notice).toHaveCSS('opacity', '1');
  expect(await notice.evaluate((element) => element.getAnimations().length)).toBe(0);
  await page.clock.fastForward(950);
  await expect(notice).toHaveText('');
});

for (const action of ['switch tab', 'scroll']) {
  test(`a delayed copy does not appear over a source hidden by ${action}`, async ({ page }) => {
    await page.addInitScript(() =>
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: () =>
            new Promise((resolve) => {
              window.finishCopy = resolve;
            }),
        },
      }),
    );
    await page.goto('/');
    await page.getByRole('tab', { name: 'Info', exact: true }).click();
    await page.getByRole('tab', { name: 'Alphabet', exact: true }).click();
    await page.locator('#catalog button').first().click();
    if (action === 'switch tab') {
      await page.getByRole('tab', { name: 'API', exact: true }).click();
    } else {
      await page.locator('#catalog').evaluate((catalog) => {
        catalog.scrollTop = 44;
      });
      await expect(page.locator('#catalog')).toHaveJSProperty('scrollTop', 44);
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    await page.evaluate(async () => {
      window.finishCopy();
      await Promise.resolve();
    });
    await expect(page.locator('#status')).toHaveText('');
  });
}

for (const result of ['success', 'failure']) {
  test(`a late clipboard ${result} preserves the newer fallback copy`, async ({ page }) => {
    await page.addInitScript((result) => {
      let count = 0;
      window.fallbackCopies = [];
      document.execCommand = (command) => {
        if (command !== 'copy') return false;
        window.fallbackCopies.push(document.activeElement.value);
        return true;
      };
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: () => {
            window.copyFocus = document.activeElement;
            if (count++) return Promise.reject(new Error('Clipboard unavailable'));
            return new Promise((resolve, reject) => {
              window.finishCopy = () =>
                result === 'success' ? resolve() : reject(new Error('Clipboard unavailable'));
            });
          },
        },
      });
    }, result);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Info', exact: true }).click();
    await page.locator('#palette button').first().click();
    await page.getByRole('tab', { name: 'Emoji', exact: true }).click();
    const glyph = page.locator('#catalog button').first();
    const character = await glyph.getAttribute('data-glyph');
    await glyph.click();
    await expect(page.locator('#status')).toHaveText('Copied');
    expect(await page.evaluate(() => window.fallbackCopies)).toEqual([character]);
    expect(await page.evaluate(() => document.activeElement === window.copyFocus)).toBe(true);
    await expect(page.locator('.clipboard-field, #status textarea')).toHaveCount(0);

    await page.evaluate(() => window.finishCopy());
    expect(await page.evaluate(() => window.fallbackCopies)).toEqual([character]);
    expect(await page.evaluate(() => document.activeElement === window.copyFocus)).toBe(true);
    await expect(page.locator('.clipboard-field, #status textarea')).toHaveCount(0);
  });
}

test('palette and catalog copies clean up the fallback after a recent success', async ({
  page,
}) => {
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
  await page.goto('/');
  await page.getByRole('tab', { name: 'Info', exact: true }).click();
  await page.locator('#palette button').first().click();
  await expect(page.locator('#status')).toHaveText('Copied');
  expect(await page.evaluate(() => window.copied)).toEqual(['0']);

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
  await page.goto('/');
  await page.getByRole('tab', { name: 'Info', exact: true }).click();
  const palette = page.locator('#palette button').first();
  await palette.focus();
  await palette.press('Enter');

  await expect(page.locator('#status')).toHaveText('Could not copy.');
  await expect(page.locator('.clipboard-field, #status textarea')).toHaveCount(0);
  await expect(palette).toBeFocused();
  await page.clock.fastForward(2000);
  await expect(page.locator('#status')).toBeHidden();
});

test('HTTP glyph taps copy real text without leaving a field', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'Reading the actual clipboard needs Chromium permissions.');
  const context = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const secure = await context.newPage();
  await secure.goto('http://127.0.0.1:8765/');
  const original = await secure.evaluate(() => navigator.clipboard.readText());
  try {
    await context.route('http://playload.test/**', async (route) => {
      const url = new URL(route.request().url());
      const response = await context.request.get(
        'http://127.0.0.1:8765' + url.pathname + url.search,
      );
      await route.fulfill({ response });
    });
    const phone = await context.newPage();
    await phone.goto('http://playload.test/');
    expect(await phone.evaluate(() => isSecureContext)).toBe(false);
    expect(await phone.evaluate(() => typeof navigator.clipboard)).toBe('undefined');
    await phone.getByRole('tab', { name: 'Info', exact: true }).tap();
    await phone.getByRole('tab', { name: 'Emoji', exact: true }).tap();
    const glyph = phone.locator('#catalog button').first();
    const character = await glyph.getAttribute('data-glyph');
    await glyph.tap();

    await expect(phone.locator('#status')).toHaveText('Copied');
    expect(await secure.evaluate(() => navigator.clipboard.readText())).toBe(character);
    await expect(phone.locator('.clipboard-field, #status textarea')).toHaveCount(0);
    await expect(glyph).toBeFocused();
    expect(await phone.evaluate(() => scrollY)).toBe(0);
  } finally {
    await secure.evaluate((text) => navigator.clipboard.writeText(text), original);
    await context.close();
  }
});

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
    await expect(page.locator('#workspace-toolbar')).toBeVisible();
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
  await page.getByRole('button', { name: 'Click to play', exact: true }).click();
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
