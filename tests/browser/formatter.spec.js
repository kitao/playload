import { test, expect } from './fixtures.js';

import { decode, encode } from '../../src/payload.js';

const source = '// @title Format Check\n\n\n\nfunction tick(){cls(0)}\n\n';

const formatted = '// @title Format Check\n\nfunction tick() {\n  cls(0);\n}\n';

test.beforeEach(async ({ page }) => {
  await page.goto('/playload/app/');
  await expect(page.locator('#format')).toBeVisible();
});

test('Format removes excess blank lines, updates the shared source and remains one undo action', async ({
  page,
}) => {
  const requests = [];
  page.on('request', (request) => {
    if (/\/formatter\.js$/.test(new URL(request.url()).pathname)) requests.push(request.url());
  });
  const editor = page.locator('#editor');
  await editor.fill(source);
  await expect.poll(() => page.url().includes('#v1.')).toBe(true);
  expect(requests).toEqual([]);
  await page.locator('#format').click();
  await expect(editor).toHaveValue(formatted);
  await expect(editor).toBeFocused();
  await expect(page.locator('#format')).toBeEnabled();
  expect(requests).toHaveLength(1);
  await expect.poll(async () => decode(new URL(page.url()).hash)).toBe(formatted);
  const encoded = await encode(formatted);
  await expect(page.locator('#size')).toHaveAttribute(
    'title',
    `${encoded.bytes} bytes · ${page.url().length} URL characters`,
  );
  await expect(page.locator('#editor-highlight')).toHaveText(formatted + '\n');
  await expect(page.locator('#editor-line-numbers')).toHaveText('1\n2\n3\n4\n5\n6');
  await editor.press('ControlOrMeta+z');
  await expect(editor).toHaveValue(source);
  await editor.press('ControlOrMeta+Shift+z');
  await expect(editor).toHaveValue(formatted);
});

test('moving focus during formatting keeps the source and the new focus', async ({ page }) => {
  let release;
  const blocked = new Promise((resolve) => (release = resolve));
  let arrived;
  const requested = new Promise((resolve) => (arrived = resolve));
  await page.route('**/formatter.js', async (route) => {
    arrived();
    await blocked;
    await route.continue();
  });
  await page.locator('#editor').fill(source);
  await page.locator('#format').click();
  await requested;
  await page.locator('#screen').focus();
  release();
  await expect(page.locator('#format')).toBeEnabled();
  await expect(page.locator('#editor')).toHaveValue(source);
  await expect(page.locator('#screen')).toBeFocused();
  await expect(page.locator('#status')).toContainText('focus or selection changed');
});

test('Format preserves template string contents, comments and a backward selection', async ({
  page,
}) => {
  const editor = page.locator('#editor');
  const original = '// comment\nconst text=`first\n\n\nlast`;\nfunction tick(){cls(0)}';
  await editor.fill(original);
  await editor.evaluate((element) => {
    const start = element.value.indexOf('cls');
    element.setSelectionRange(start, start + 3, 'backward');
  });
  await page.locator('#format').click();
  await expect(editor).toHaveValue(
    '// comment\nconst text = `first\n\n\nlast`;\nfunction tick() {\n  cls(0);\n}\n',
  );
  expect(
    await editor.evaluate((element) => ({
      selected: element.value.slice(element.selectionStart, element.selectionEnd),
      direction: element.selectionDirection,
    })),
  ).toEqual({ selected: 'cls', direction: 'backward' });
});

test('syntax errors leave the source and selection intact, and the next format still works', async ({
  page,
}) => {
  const editor = page.locator('#editor');
  await editor.fill('function tick(){');
  const selection = await editor.evaluate((element) => [
    element.selectionStart,
    element.selectionEnd,
  ]);
  await page.locator('#format').click();
  await expect(page.locator('#status')).toContainText('Format:');
  await expect(page.locator('#format')).toBeEnabled();
  await expect(editor).toHaveValue('function tick(){');
  expect(
    await editor.evaluate((element) => [element.selectionStart, element.selectionEnd]),
  ).toEqual(selection);
  await editor.fill(source);
  await page.locator('#format').click();
  await expect(editor).toHaveValue(formatted);
  await expect(page.locator('#status')).toBeEmpty();
});

test('edits made while the formatter is loading take precedence over its result', async ({
  page,
}) => {
  let release;
  const blocked = new Promise((resolve) => (release = resolve));
  let arrived;
  const requested = new Promise((resolve) => (arrived = resolve));
  await page.route('**/formatter.js', async (route) => {
    arrived();
    await blocked;
    await route.continue();
  });
  const editor = page.locator('#editor');
  await editor.fill(source);
  await page.locator('#format').click();
  await requested;
  await expect(page.locator('#format')).toBeDisabled();
  const newer = source + '// newer edit';
  await editor.fill(newer);
  release();
  await expect(page.locator('#status')).toHaveText(
    'Code changed while formatting. Your edits were kept.',
  );
  await expect(editor).toHaveValue(newer);
  await expect(page.locator('#format')).toBeEnabled();
});
