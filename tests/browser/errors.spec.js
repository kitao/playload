import { test, expect } from './fixtures.js';

test('a game error keeps its picture, displays literal text, and selects its source line', async ({
  page,
}) => {
  await page.goto('/playload/app/');
  await page.locator('#crt').click();
  await page.locator('#editor').fill('function tick() { cls(4) }');
  await page.locator('#run').click();
  await expect(page.locator('#pause')).toBeEnabled();
  const picture = () =>
    page
      .locator('#display')
      .evaluate((canvas) => [...canvas.getContext('2d').getImageData(320, 288, 1, 1).data]);
  await expect.poll(picture).toEqual([80, 140, 215, 255]);
  const source = 'function tick() {\n  throw new Error("<img src=x>\\n日本語");\n}';
  await page.locator('#editor').fill(source);
  await page.locator('#run').click();
  await expect(page.locator('#error')).toHaveText('<img src=x>\n日本語');
  await expect(page.locator('#error-notice img')).toHaveCount(0);
  await expect(page.locator('#pause')).toBeDisabled();
  expect(await picture()).toEqual([80, 140, 215, 255]);
  await page.locator('#error-line').click();
  await expect(page.locator('#editor')).toBeFocused();
  expect(
    await page
      .locator('#editor')
      .evaluate((editor) => editor.value.slice(editor.selectionStart, editor.selectionEnd)),
  ).toContain('throw new Error');
  await page.locator('#editor').fill('function tick() { cls(5) }');
  await page.locator('#run').click();
  await expect(page.locator('#error-notice')).toBeHidden();
  await expect.poll(picture).toEqual([100, 185, 100, 255]);
});

test('syntax and malformed URL errors have no invented source line', async ({ page }) => {
  await page.goto('/playload/app/');
  await page.locator('#editor').fill('function tick( {');
  await page.locator('#run').click();
  await expect(page.locator('#error')).toBeVisible();
  await expect(page.locator('#error-line')).toBeHidden();
  await page.goto('about:blank');
  await page.goto('/playload/app/#invalid-payload');
  await expect(page.getByRole('alert')).toContainText('Invalid game URL');
  await expect(page.locator('#error-line')).toBeHidden();
});
