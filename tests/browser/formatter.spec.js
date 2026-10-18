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

test('typing after Format is grouped separately and both edits survive Undo and Redo', async ({
  page,
}) => {
  const editor = page.locator('#editor');
  await editor.fill(source);
  await page.locator('#format').click();
  await expect(editor).toHaveValue(formatted);
  await editor.evaluate((element) =>
    element.setSelectionRange(element.value.length, element.value.length),
  );
  await editor.pressSequentially('// typed');
  const typed = formatted + '// typed';
  await expect(editor).toHaveValue(typed);
  await editor.press('ControlOrMeta+z');
  await expect(editor).toHaveValue(formatted);
  await editor.press('ControlOrMeta+z');
  await expect(editor).toHaveValue(source);
  await editor.press('ControlOrMeta+Shift+z');
  await expect(editor).toHaveValue(formatted);
  await editor.press('ControlOrMeta+Shift+z');
  await expect(editor).toHaveValue(typed);
});

test('loading a file starts a fresh history without discarding its formatting undo', async ({
  page,
}) => {
  const editor = page.locator('#editor');
  await editor.fill(source);
  const loaded = 'function tick(){cls(2)}';
  await page.locator('#file').setInputFiles({
    name: 'loaded.js',
    mimeType: 'text/javascript',
    buffer: Buffer.from(loaded),
  });
  await expect(editor).toHaveValue(loaded);
  await editor.press('ControlOrMeta+z');
  await expect(editor).toHaveValue(loaded);
  await page.locator('#format').click();
  await expect(editor).toHaveValue('function tick() {\n  cls(2);\n}\n');
  await editor.press('ControlOrMeta+z');
  await expect(editor).toHaveValue(loaded);
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

test('Shift+Alt+F formats only inside the editor and leaves find, repeats and IME composition alone', async ({
  page,
}) => {
  const editor = page.locator('#editor');
  await editor.fill(source);
  // A format starts its module worker synchronously, so this count shows whether a key started one.
  await page.evaluate(() => {
    window.formatterStarts = 0;
    const Native = Worker;
    window.Worker = class extends Native {
      constructor(url, options) {
        super(url, options);
        if (options?.type === 'module') window.formatterStarts++;
      }
    };
  });
  const starts = () => page.evaluate(() => window.formatterStarts);
  await page.locator('#screen').focus();
  await page.keyboard.press('Alt+Shift+f');
  expect(await starts()).toBe(0);
  await editor.focus();
  for (const modifiers of [{ metaKey: true }, { ctrlKey: true }, { isComposing: true }]) {
    expect(
      await editor.evaluate((element, modifiers) => {
        const event = new KeyboardEvent('keydown', {
          key: 'f',
          code: 'KeyF',
          altKey: !!modifiers.isComposing,
          shiftKey: !!modifiers.isComposing,
          ...modifiers,
          bubbles: true,
          cancelable: true,
        });
        return element.dispatchEvent(event);
      }, modifiers),
    ).toBe(true);
  }
  await editor.dispatchEvent('keydown', {
    key: 'F',
    code: 'KeyF',
    altKey: true,
    shiftKey: true,
    repeat: true,
  });
  expect(await starts()).toBe(0);
  await expect(editor).toHaveValue(source);
  await editor.press('Alt+Shift+f');
  await expect(editor).toHaveValue(formatted);
  expect(await starts()).toBe(1);
  await expect(page.locator('#format')).toHaveAttribute('aria-keyshortcuts', 'Alt+Shift+F');
  await expect(page.locator('#format')).toHaveText('Format');
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

test('a formatter load failure keeps the source and enables retry', async ({ page }) => {
  await page.route('**/formatter.js', (route) => route.abort());
  await page.locator('#editor').fill(source);
  await page.locator('#format').click();
  await expect(page.locator('#status')).toHaveText('Format: The formatter could not load.');
  await expect(page.locator('#editor')).toHaveValue(source);
  await expect(page.locator('#format')).toBeEnabled();
  await page.unroute('**/formatter.js');
  await page.locator('#format').click();
  await expect(page.locator('#editor')).toHaveValue(formatted);
});

test('formatting an already formatted source does not add an undo step or disturb the caret', async ({
  page,
}) => {
  const editor = page.locator('#editor');
  await editor.fill(source);
  await page.locator('#format').click();
  await expect(editor).toHaveValue(formatted);
  const caret = await editor.evaluate((element) => element.selectionStart);
  await page.locator('#format').click();
  await expect(page.locator('#format')).toBeEnabled();
  await expect(editor).toHaveValue(formatted);
  expect(await editor.evaluate((element) => element.selectionStart)).toBe(caret);
  await editor.focus();
  await editor.press('ControlOrMeta+z');
  await expect(editor).toHaveValue(source);
});

test('the floating button does not resize the workspace and hides with CODE', async ({ page }) => {
  const selectors = ['#workbench', '#editor', '#game', '#viewport', '#workspace-toolbar'];
  const measure = () =>
    page.evaluate(
      (selectors) =>
        selectors.map((selector) => {
          const { x, y, width, height } = document.querySelector(selector).getBoundingClientRect();
          return { x, y, width, height };
        }),
      selectors,
    );
  const initial = await measure();
  const button = await page.locator('#format').boundingBox();
  const editor = await page.locator('#editor').boundingBox();
  expect(button.width).toBeLessThan(54);
  expect(button.height).toBe(18);
  expect(button.x - editor.x).toBe(4);
  expect(editor.y + editor.height - button.y - button.height).toBe(4);
  await page.locator('#format').evaluate((element) => (element.style.display = 'none'));
  expect(await measure()).toEqual(initial);
  await page.locator('#format').evaluate((element) => element.style.removeProperty('display'));
  await page.locator('#code-toggle').click();
  await expect(page.locator('#format')).toBeHidden();
  await page.locator('#code-toggle').click();
  await expect(page.locator('#format')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#format')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('Format clears the horizontal scrollbar only while it occupies space, including after resize and undo', async ({
  page,
}) => {
  const editor = page.locator('#editor');
  const measure = () =>
    page.evaluate(() => {
      const editor = document.querySelector('#editor'),
        style = getComputedStyle(editor),
        bounds = editor.getBoundingClientRect(),
        button = document.querySelector('#format').getBoundingClientRect(),
        height =
          editor.offsetHeight -
          editor.clientHeight -
          parseFloat(style.borderTopWidth) -
          parseFloat(style.borderBottomWidth),
        thumbInset =
          height > 0 && CSS.supports('selector(::-webkit-scrollbar-thumb)')
            ? parseFloat(getComputedStyle(editor, '::-webkit-scrollbar-thumb').borderTopWidth) || 0
            : 0;
      return {
        scrollbar: height,
        bottom: bounds.bottom - button.bottom,
        left: button.left - bounds.left,
        visibleBottomGap:
          bounds.bottom - parseFloat(style.borderBottomWidth) - height + thumbInset - button.bottom,
        visibleLeftGap: button.left - bounds.left - parseFloat(style.borderLeftWidth),
        width: button.width,
        height: button.height,
      };
    });
  const original = await measure();
  expect(original.scrollbar).toBe(0);
  expect(original.bottom).toBe(4);
  await editor.fill('// ' + 'wide '.repeat(200) + '\nfunction tick() {}');
  await expect.poll(async () => (await measure()).scrollbar).toBeGreaterThan(0);
  await expect
    .poll(async () => {
      const measured = await measure();
      return measured.visibleBottomGap - measured.visibleLeftGap;
    })
    .toBe(1);
  const wide = await measure();
  expect(wide.left).toBe(original.left);
  expect(wide.width).toBe(original.width);
  expect(wide.height).toBe(original.height);
  const gutter = await page.locator('#editor-lines').boundingBox();
  const editorBounds = await editor.boundingBox();
  const border = await editor.evaluate((element) =>
    parseFloat(getComputedStyle(element).borderBottomWidth),
  );
  expect(gutter.y + gutter.height).toBeCloseTo(
    editorBounds.y + editorBounds.height - border - wide.scrollbar,
    3,
  );
  await editor.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
    element.dispatchEvent(new Event('scroll'));
  });
  expect(await measure()).toEqual(wide);
  await page.locator('#code-toggle').click();
  await page.locator('#code-toggle').click();
  await expect.poll(async () => (await measure()).bottom).toBe(wide.bottom);
  await editor.fill('// ' + 'wide '.repeat(20) + '\nfunction tick() {}');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => {
      const measured = await measure();
      return measured.visibleBottomGap - measured.visibleLeftGap;
    })
    .toBe(1);
  await page.setViewportSize({ width: 3000, height: 1000 });
  await expect.poll(async () => (await measure()).scrollbar).toBe(0);
  await expect.poll(async () => (await measure()).bottom).toBe(4);
  await editor.fill(source);
  await page.locator('#format').click();
  await expect(editor).toHaveValue(formatted);
  await editor.press('ControlOrMeta+z');
  await expect(editor).toHaveValue(source);
  await expect.poll(async () => (await measure()).bottom).toBe(4);
});

test('fractional layout scales do not leave scrollbar space after a wide line is removed', async ({
  page,
}) => {
  const editor = page.locator('#editor');
  const bottom = () =>
    page.evaluate(() => {
      const bounds = document.querySelector('#editor').getBoundingClientRect(),
        button = document.querySelector('#format').getBoundingClientRect(),
        zoom = parseFloat(getComputedStyle(document.documentElement).zoom);
      return (bounds.bottom - button.bottom) / zoom;
    });
  for (const zoom of [0.9, 1.1, 1.25, 1.5]) {
    await page.evaluate((zoom) => {
      document.documentElement.style.zoom = zoom;
    }, zoom);
    await editor.fill('// ' + 'wide '.repeat(200) + '\nfunction tick() {}');
    await expect.poll(bottom).toBeGreaterThan(10);
    await editor.fill('function tick() {}');
    await expect.poll(bottom).toBeCloseTo(4, 1);
  }
});
