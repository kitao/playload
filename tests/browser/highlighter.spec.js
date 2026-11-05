import { test, expect } from './fixtures.js';
import { encode } from '../../src/payload.js';

test('large comments and blank-line runs stay editable with correctly aligned line numbers', async ({
  page,
}) => {
  for (const prefix of [
    '//' + ' '.repeat(200000) + '\n',
    '\n'.repeat(200000),
    '\n'.repeat(1000000),
  ]) {
    const source = prefix + 'function tick() { cls(4); }';
    const { hash } = await encode(source);
    await page.goto('about:blank');
    const started = Date.now();
    await page.goto('/playload/app/' + hash);
    await expect(page.locator('#start-game')).toBeVisible({ timeout: 3000 });
    expect(Date.now() - started).toBeLessThan(6000);
    await expect(page.locator('#editor')).toHaveValue(source);
    expect(
      await page.locator('#editor').evaluate((editor) => getComputedStyle(editor).color),
    ).not.toBe('rgba(0, 0, 0, 0)');
    const numbers = page.locator('#editor-line-numbers');
    if (prefix.length < 1000000)
      expect((await numbers.textContent()).split('\n').length).toBeLessThan(100);
    await page.locator('#editor').evaluate((editor) => {
      editor.scrollTop = editor.scrollHeight;
    });
    const count = source.split('\n').length;
    await expect(numbers).toHaveText(new RegExp(`(?:^|\\n)${count}$`));
    expect(
      await numbers.evaluate((numbers) => {
        const text = numbers.lastChild;
        const range = document.createRange();
        range.setStart(text, text.textContent.lastIndexOf('\n') + 1);
        range.setEnd(text, text.textContent.length);
        const label = range.getBoundingClientRect(),
          editor = document.getElementById('editor').getBoundingClientRect();
        return label.top >= editor.top && label.bottom <= editor.bottom;
      }),
    ).toBe(true);
    await page.locator('#editor').fill('function tick() { cls(5); }');
    await expect(page.locator('#editor-highlight .token.keyword')).toHaveCount(1);
    await expect(numbers).toHaveText('1');
  }
});

test('a pathological shared source cannot block the editor before Play', async ({ page }) => {
  const source = `let ${'a'.repeat(40000)} = 1; function tick() { cls(4); }`;
  const { hash } = await encode(source);
  await page.addInitScript(() => {
    window.longTasks = [];
    if (PerformanceObserver.supportedEntryTypes.includes('longtask'))
      new PerformanceObserver((list) =>
        window.longTasks.push(...list.getEntries().map((entry) => entry.duration)),
      ).observe({ type: 'longtask', buffered: true });
  });
  const started = Date.now();
  await page.goto('/playload/app/' + hash);
  await expect(page.locator('#start-game')).toBeVisible({ timeout: 3000 });
  expect(Date.now() - started).toBeLessThan(3000);
  await expect(page.locator('#editor')).toHaveValue(source);
  await page.locator('#info-tab').click({ timeout: 1000 });
  await expect(page.locator('#info')).toBeVisible();
  await page.waitForTimeout(650);
  expect(await page.evaluate(() => Math.max(0, ...window.longTasks))).toBeLessThan(500);
  await page.locator('#play-tab').click();
  const replacement = 'function tick() { cls(4); } // <img src=x onerror=alert(1)>';
  await page.locator('#editor').fill(replacement);
  await expect(page.locator('#editor-highlight .token.keyword')).toHaveCount(1);
  await expect(page.locator('#editor-highlight')).toHaveText(replacement + '\n');
  await expect(page.locator('#editor-highlight img')).toHaveCount(0);
  await page.locator('#run').click();
  await expect(page.locator('#pause')).toBeEnabled();
});
