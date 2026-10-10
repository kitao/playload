import { test, expect } from '@playwright/test';

const messages = {
  short: 'Player position is outside the map',
  twoLines:
    "Cannot read properties of undefined (reading 'chr'). Check the character at the player position.",
  long: 'Missing character pattern: ' + 'X'.repeat(600) + '\nEnd of details.',
  multiline:
    'Sprite update failed\n' +
    Array.from(
      { length: 12 },
      (_, i) => `Frame ${i + 1}: no character at the requested position`,
    ).join('\n') +
    '\nEnd of details.',
  unicode: 'キャラクターが見つかりません 👾\nÉchec du déplacement · 이동 실패',
  markup: '<img src=x onerror=alert(1)> & <script>bad()</script>',
  empty: '',
};

for (const scenario of [
  { name: 'short-dark', message: messages.short, width: 1440, height: 900, color: 0 },
  { name: 'two-lines', message: messages.twoLines, width: 1440, height: 900, color: 7 },
  { name: 'long-white', message: messages.long, width: 1440, height: 900, color: 7 },
  {
    name: 'multiline-pattern',
    message: messages.multiline,
    width: 1200,
    height: 800,
    color: 4,
    pattern: true,
  },
  {
    name: 'unicode-phone',
    message: messages.unicode,
    width: 375,
    height: 812,
    color: 7,
    touch: true,
  },
  {
    name: 'long-small-phone',
    message: messages.long,
    width: 320,
    height: 568,
    color: 7,
    touch: true,
  },
  {
    name: 'multiline-landscape',
    message: messages.multiline,
    width: 844,
    height: 390,
    color: 6,
    touch: true,
  },
  { name: 'literal-markup', message: messages.markup, width: 1200, height: 800, color: 0 },
  { name: 'empty-message', message: messages.empty, width: 1200, height: 800, color: 0 },
]) {
  test(`error overlay: ${scenario.name}`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({
      viewport: { width: scenario.width, height: scenario.height },
      hasTouch: !!scenario.touch,
      isMobile: !!scenario.touch,
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await page.goto('http://127.0.0.1:8765/');
      const compact = await page.locator('#tools-toggle').isVisible();
      if ((await page.locator('#code-toggle').getAttribute('aria-pressed')) === 'false') {
        if (compact) await page.locator('#tools-toggle').click();
        await page.locator('#code-toggle').click();
      }
      const source = [
        '// @title Overlay Check',
        'function tick() {',
        `  cls(${scenario.color})`,
        scenario.pattern
          ? '  for (let y = 0; y < 18; y++) put(0, y, "▓".repeat(20), y % 8, (y + 1) % 8)'
          : '  put(1, 1, "LAST GAME FRAME", 6)',
        `  if (btnp(4)) throw new Error(${JSON.stringify(scenario.message)})`,
        '}',
      ].join('\n');
      await page.locator('#editor').fill(source);
      if (compact) await page.locator('#tools-toggle').click();
      await page.locator('#run').click();
      await expect(page.locator('#pause')).toBeEnabled();
      if (compact) await page.locator('#tools-toggle').click();
      await page.locator('#crt').click();
      if (
        scenario.touch &&
        (await page.locator('#code-toggle').getAttribute('aria-pressed')) === 'true'
      )
        await page.locator('#code-toggle').click();
      if (compact && (await page.locator('#workspace-toolbar').isVisible()))
        await page.locator('#tools-toggle').click();
      await page.locator('#screen').click();
      await page.waitForFunction(() => document.getElementById('display').dataset.crt === 'false');
      const before = await page.locator('#screen').boundingBox();
      const pixels = await page.locator('#display').evaluate((canvas) => canvas.toDataURL());
      if (scenario.touch) await page.locator('[data-input="4"]').tap();
      else await page.keyboard.press('z');
      await expect(page.locator('#error')).toHaveText(scenario.message || 'Game error');
      await expect(page.getByRole('alert')).toContainText('Line 5');
      await expect(page.locator('#error-line')).toBeEnabled();
      await expect(page.locator('#pause')).toBeDisabled();
      const after = await page.locator('#screen').boundingBox();
      expect(after).toEqual(before);
      expect(await page.locator('#display').evaluate((canvas) => canvas.toDataURL())).toBe(pixels);
      const notice = await page.locator('#error-notice').boundingBox();
      const anchor = await page.locator('#error-notice').evaluate((element) => {
        const bounds = element.parentElement.getBoundingClientRect();
        return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
      });
      expect(anchor).toEqual(await page.locator('#viewport').boundingBox());
      expect(notice.x).toBeCloseTo(anchor.x + 7, 1);
      expect(notice.y).toBeCloseTo(anchor.y + 3, 1);
      expect(notice.x + notice.width).toBeLessThanOrEqual(anchor.x + anchor.width + 1);
      expect(notice.y + notice.height).toBeLessThanOrEqual(anchor.y + anchor.height + 1);
      const text = await page.locator('#error').boundingBox();
      expect(text.width).toBeGreaterThan(
        Math.min(100, (scenario.message || 'Game error').length * 7),
      );
      expect(text.height).toBeGreaterThanOrEqual(20);
      if (scenario.message === messages.twoLines) {
        expect(text.height).toBe(40);
        const line = await page.locator('#error-line').boundingBox();
        expect(line.height).toBe(20);
        expect(line.y).toBe(text.y);
      }
      await expect(page.locator('#error-notice img,#error-notice script')).toHaveCount(0);
      if (scenario.touch) {
        await expect(page.locator('.touch')).toBeVisible();
        await expect(page.locator('[data-input="4"]')).toBeDisabled();
      }
      await page.screenshot({ path: testInfo.outputPath(`${scenario.name}.png`), fullPage: true });
      await page
        .locator('#viewport')
        .screenshot({ path: testInfo.outputPath(`${scenario.name}-play.png`) });
      if (scenario.message === messages.long || scenario.message === messages.multiline) {
        const dimensions = await page.locator('#error').evaluate((element) => ({
          scroll: element.scrollHeight,
          visible: element.clientHeight,
        }));
        expect(dimensions.scroll).toBeGreaterThan(dimensions.visible);
        await page.locator('#error').focus();
        await page.keyboard.press('End');
        await expect
          .poll(() => page.locator('#error').evaluate((element) => element.scrollTop))
          .toBeGreaterThan(0);
      }
      await page.locator('#error').focus();
      await page.keyboard.press('Alt+KeyE');
      await expect(page.locator('#editor')).toBeFocused();
      expect(
        await page
          .locator('#editor')
          .evaluate((element) => element.value.slice(element.selectionStart, element.selectionEnd)),
      ).toContain('throw new Error');
      await page.locator('#editor').fill('function tick() { cls(3) }');
      await expect(page.locator('#error-line')).toBeDisabled();
      if (compact) await page.locator('#tools-toggle').click();
      await page.locator('#run').click();
      await expect(page.locator('#pause')).toBeEnabled();
      await expect(page.getByRole('alert')).toBeHidden();
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
}

test('syntax and title-less URL errors preserve the image and have no invented source link', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await page.locator('#editor').fill('function tick() { cls(3) }');
  await page.locator('#run').click();
  await expect(page.locator('#pause')).toBeEnabled();
  const image = await page.locator('#display').evaluate((canvas) => canvas.toDataURL());
  const bounds = await page.locator('#screen').boundingBox();
  await page.locator('#editor').fill('function tick( {');
  await page.locator('#run').click();
  await expect(page.locator('#error')).toBeVisible();
  await expect(page.locator('#error-line')).toBeHidden();
  expect(await page.locator('#display').evaluate((canvas) => canvas.toDataURL())).toBe(image);
  expect(await page.locator('#screen').boundingBox()).toEqual(bounds);
  await page.screenshot({ path: testInfo.outputPath('syntax.png') });
  await page.goto('/#invalid-payload');
  await expect(page.getByRole('alert')).toContainText('Invalid game URL');
  await expect(page.locator('#error-line')).toBeHidden();
});
