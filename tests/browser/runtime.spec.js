import { test, expect } from './fixtures.js';

import { encode } from '../../src/payload.js';

import { WebMBuffer } from '../../src/app/webm.js';

async function openGame(page, url) {
  await page.goto('about:blank');
  await page.goto(url);
}

async function run(page, source, flat = false) {
  await page.goto('/playload/app/');
  await page.getByRole('tab', { name: 'Play' }).click();
  await page.getByRole('textbox', { name: 'JavaScript code' }).fill(source);
  await page.getByRole('button', { name: 'Run', exact: false }).click();
  if (flat) await page.getByRole('button', { name: 'CRT', exact: true }).click();
  await page.locator('#screen').click();
}

async function pixel(page, x = 0, y = 0) {
  return page
    .locator('#display')
    .evaluate(
      (canvas, [x, y]) => [...canvas.getContext('2d').getImageData(x, y, 1, 1).data],
      [x, y],
    );
}

async function touchStartCanceled(page, selector) {
  return page
    .locator(selector)
    .first()
    .evaluate(
      (element) =>
        !element.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true })),
    );
}

async function openFallbackPicker(page, browserName, open) {
  const input = page.locator('#file');
  if (browserName === 'webkit') {
    // Playwright 1.63 intercepts WebKit's input click path but misses showPicker().
    // Observe the native call returning before supplying files or canceling.
    // https://github.com/microsoft/playwright/blob/v1.63.0/browser_patches/webkit/patches/bootstrap.diff#L2427-L2437
    await input.evaluate((input) => {
      const showPicker = input.showPicker;
      input.showPicker = function () {
        showPicker.call(this);
        this.dataset.pickerOpened = 'true';
      };
    });
    await open();
    await expect(input).toHaveAttribute('data-picker-opened', 'true');
  } else {
    const chooser = page.waitForEvent('filechooser');
    await open();
    await chooser;
  }
  return input;
}

async function loadFileHandle(page, source = 'function tick() { cls(4) }') {
  await page.addInitScript((source) => {
    // Filesystems can report the same timestamp for different source contents.
    window.testFileSource = source;
    window.fileReads = 0;
    window.pickerOpens = 0;
    window.testFileHandle = {
      getFile: async () => {
        window.fileReads++;
        return new File([window.testFileSource], 'native-game.js', {
          type: 'text/javascript',
          lastModified: 1,
        });
      },
    };
    window.showOpenFilePicker = async () => {
      window.pickerOpens++;
      return [window.testFileHandle];
    };
  }, source);
  await page.goto('/playload/app/');
  await page.locator('#load').click();
  await expect(page.locator('#pause')).toBeEnabled();
}

async function mockGamepads(page) {
  await page.addInitScript(() => {
    window.testPads = [];
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => window.testPads,
    });
  });
}

async function setGamepad(
  page,
  { buttons = [], axes = [0, 0], mapping = 'standard', connected = true } = {},
) {
  await page.evaluate(
    ({ buttons, axes, mapping, connected }) => {
      window.testPads = [
        null,
        {
          connected,
          mapping,
          axes,
          buttons: Array.from({ length: 16 }, (_, id) => ({ pressed: buttons.includes(id) })),
        },
      ];
    },
    { buttons, axes, mapping, connected },
  );
}

test('the untouched starter keeps a plain URL until one character changes, including after Run', async ({
  page,
}) => {
  await page.goto('/playload/app/');
  const editor = page.getByRole('textbox', { name: 'JavaScript code' });
  const starter = await editor.inputValue();
  await expect(page.locator('#size')).toBeVisible();
  await expect(page).toHaveTitle('Playload');
  expect(new URL(page.url()).hash).toBe('');
  await page.locator('#run').click();
  await expect(page.locator('#pause')).toBeEnabled();
  await page.waitForTimeout(300);
  await expect(page).toHaveTitle('Playload');
  expect(new URL(page.url()).hash).toBe('');
  await editor.focus();
  await editor.evaluate((element) =>
    element.setSelectionRange(element.value.length, element.value.length),
  );
  await page.keyboard.insertText(' ');
  await expect(editor).toHaveValue(starter + ' ');
  await expect(page).toHaveTitle('My Game — Playload');
  await expect
    .poll(() =>
      page.evaluate(async () => {
        if (!location.hash) return null;
        const { decode } = await import('/src/payload.js');
        return decode(location.hash);
      }),
    )
    .toBe(starter + ' ');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(editor).toHaveValue(starter);
  await expect(page).toHaveTitle('My Game — Playload');
  await expect
    .poll(() =>
      page.evaluate(async () => {
        if (!location.hash) return null;
        const { decode } = await import('/src/payload.js');
        return decode(location.hash);
      }),
    )
    .toBe(starter);
  expect(new URL(page.url()).hash).not.toBe('');
});

test('Load and Run shortcuts work; the address follows edits and restores a bookmark', async ({
  page,
  browserName,
}) => {
  await page.goto('/playload/app/');
  await page.evaluate(() => {
    window.showOpenFilePicker = undefined;
  });
  const editor = page.getByRole('textbox', { name: 'JavaScript code' });
  await editor.focus();
  const input = await openFallbackPicker(page, browserName, () => page.keyboard.press('Control+o'));
  await input.setInputFiles({
    name: 'shortcut-game.js',
    mimeType: 'text/javascript',
    buffer: Buffer.from('function tick() { cls(4) }'),
  });
  await expect(page.locator('#pause')).toBeEnabled();
  const historyLength = await page.evaluate(() => history.length);
  const source = 'function tick() { cls(5) }';
  await editor.fill(source);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        if (!location.hash) return null;
        const { decode } = await import('/src/payload.js');
        return decode(location.hash);
      }),
    )
    .toBe(source);
  expect(await page.evaluate(() => history.length)).toBe(historyLength);
  const bookmark = page.url();
  expect(new URL(bookmark).searchParams.has('edit')).toBe(false);
  await expect(page.locator('#share, #save-code, #reset')).toHaveCount(0);
  await page.keyboard.press('Meta+Enter');
  await expect(page.locator('#pause')).toBeEnabled();
  await page.locator('#crt').click();
  await expect.poll(() => pixel(page)).toEqual([100, 185, 100, 255]);
  await openGame(page, bookmark);
  await expect(editor).toHaveValue(source);
  await expect(editor).toBeVisible();
  await page.locator('#start-game').click();
  await expect(page.locator('#pause')).toBeEnabled();
  await page.locator('#crt').click();
  await expect.poll(() => pixel(page)).toEqual([100, 185, 100, 255]);
});

test('title comments update before Run and survive bookmarks, edits and a fresh URL', async ({
  page,
}) => {
  await page.goto('/playload/app/');
  await expect(page).toHaveTitle('Playload');
  const editor = page.getByRole('textbox', { name: 'JavaScript code' });
  const source = '//\n/* A small game. */\n// @title Star Catcher\nfunction tick() { cls(4) }\n';
  await editor.fill(source);
  await expect(page).toHaveTitle('Star Catcher — Playload');
  await expect(page.locator('#pause')).toBeDisabled();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        if (!location.hash) return null;
        const { decode } = await import('/src/payload.js');
        return decode(location.hash);
      }),
    )
    .toBe(source);
  const bookmark = page.url();
  await openGame(page, bookmark);
  await expect(page).toHaveTitle('Star Catcher — Playload');
  await expect(editor).toHaveValue(source);
  await expect(page.locator('#start-game')).toBeVisible();
  await expect(page.locator('#pause')).toBeDisabled();
  await editor.fill(source.replace('Star Catcher', '星の冒険 👾'));
  await expect(page).toHaveTitle('星の冒険 👾 — Playload');
  await editor.fill(source.replace('// @title Star Catcher', '// @title   '));
  await expect(page).toHaveTitle('Playload');
  const fresh = new URL(bookmark);
  fresh.hash = '';
  await page.goto(fresh.href);
  await expect(page).toHaveTitle('Playload');
});

test('standard gamepads map all six buttons and the left stick, ignoring drift and unknown mappings', async ({
  page,
}) => {
  await mockGamepads(page);
  await run(
    page,
    `function tick() {
    cls(0);
    for (let id = 0; id < 6; id++) scr[0][id].col[1] = btn(id) ? 3 : 0;
  }`,
    true,
  );
  await page.locator('#screen').click();
  const held = [215, 115, 85, 255];
  const released = [0, 0, 0, 255];
  for (const [id, button] of [12, 13, 14, 15, 0, 1].entries()) {
    await setGamepad(page, { buttons: [button] });
    await expect.poll(() => pixel(page, id * 32)).toEqual(held);
    await setGamepad(page);
    await expect.poll(() => pixel(page, id * 32)).toEqual(released);
  }
  for (const [id, axes] of [
    [0, [0, -0.8]],
    [1, [0, 0.8]],
    [2, [-0.8, 0]],
    [3, [0.8, 0]],
  ]) {
    await setGamepad(page, { axes });
    await expect.poll(() => pixel(page, id * 32)).toEqual(held);
    await setGamepad(page, { axes: [0.4, -0.4] });
    await expect.poll(() => pixel(page, id * 32)).toEqual(released);
  }
  await setGamepad(page, { buttons: [0], mapping: '' });
  await page.waitForTimeout(100);
  expect(await pixel(page, 128)).toEqual(released);
  await setGamepad(page, { buttons: [0] });
  await expect.poll(() => pixel(page, 128)).toEqual(held);
  await setGamepad(page, { buttons: [0], connected: false });
  await expect.poll(() => pixel(page, 128)).toEqual(released);
  await setGamepad(page, { buttons: [0] });
  await expect.poll(() => pixel(page, 128)).toEqual(held);
  await page.evaluate(() => {
    window.testPads = [];
  });
  await expect.poll(() => pixel(page, 128)).toEqual(released);
});

test('keyboard labels and physical key releases work through the built app', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept());
  await page.addInitScript(() => {
    window.inputMask = 0;
    window.pickerOpens = 0;
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, ...args) {
      if (message.type === 'input') window.inputMask = message.mask;
      return post.call(this, message, ...args);
    };
    window.showOpenFilePicker = async () => {
      window.pickerOpens++;
      throw new DOMException('Canceled', 'AbortError');
    };
  });
  await run(page, 'function tick() { cls(0); }');
  await expect(page.locator('#pause')).toBeEnabled();
  const input = async (type, code, key, expected, extras = {}, target = '#screen') => {
    await page.locator(target).dispatchEvent(type, { code, key, ...extras });
    expect(await page.evaluate(() => window.inputMask), `${type} ${code} ${key}`).toBe(expected);
  };
  for (const [code, key, id] of [
    ['KeyZ', 'z', 4],
    ['KeyW', 'z', 4],
    ['KeyY', 'Z', 4],
    ['KeyZ', 'я', 4],
    ['KeyW', 'w', 0],
    ['KeyS', 's', 1],
    ['KeyA', 'a', 2],
    ['KeyD', 'D', 3],
    ['KeyJ', 'j', 4],
    ['KeyK', 'k', 5],
    ['KeyQ', 'a', 2],
    ['KeyJ', 'о', 4],
    ['KeyK', 'л', 5],
  ]) {
    await input('keydown', code, key, 1 << id);
    await input('keyup', code, 'Process', 0);
  }
  for (const key of ['q', 'y']) await input('keydown', 'KeyZ', key, 0);
  await input('keydown', 'KeyY', 'z', 16);
  await input('keydown', 'KeyZ', 'я', 16);
  await input('keydown', 'KeyX', 'x', 48);
  await input('keyup', 'KeyY', 'y', 48);
  await input('keyup', 'KeyZ', 'Z', 32, { shiftKey: true });
  await input('keyup', 'KeyX', 'ч', 0);
  await input('keydown', 'KeyZ', 'z', 16);
  await input('keydown', 'KeyJ', 'j', 16);
  await input('keyup', 'KeyZ', 'z', 16);
  await input('keyup', 'KeyJ', 'j', 0);
  for (const [id, key] of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].entries())
    await input('keydown', key, key, (1 << (id + 1)) - 1);
  await page.locator('#editor').focus();
  expect(await page.evaluate(() => window.inputMask)).toBe(0);
  await page.locator('#screen').focus();
  for (const extras of [
    { isComposing: true },
    { ctrlKey: true },
    { altKey: true },
    { metaKey: true },
  ])
    for (const key of ['z', 'w', 's', 'a', 'd', 'j', 'k'])
      await input('keydown', 'Key' + key.toUpperCase(), key, 0, extras);
  await input('keydown', 'KeyZ', 'z', 0, {}, '#editor');
  for (const [code, key, opens] of [
    ['KeyS', 'o', 1],
    ['KeyO', 'r', 0],
    ['KeyO', 'щ', 1],
  ]) {
    const before = await page.evaluate(() => window.pickerOpens);
    await input('keydown', code, key, 0, { ctrlKey: true });
    expect(await page.evaluate(() => window.pickerOpens)).toBe(before + opens);
    await expect(page.locator('#load')).toBeEnabled();
  }
});

test('the activation key is consumed until released, including repeats', async ({ page }) => {
  const source = `let color = 6;
function tick() {
  if (btn(3)) color = 4;
  if (btnp(4)) color = 5;
  cls(color);
}`;
  const { hash } = await encode(source);
  for (const [key, color] of [
    ['ArrowRight', [80, 140, 215, 255]],
    ['z', [100, 185, 100, 255]],
  ]) {
    await openGame(page, '/playload/app/' + hash);
    await expect(page.locator('#start-game')).toBeVisible();
    await page.locator('#crt').evaluate((button) => button.click());
    await page.keyboard.down(key);
    await expect(page.locator('#start-game')).toBeHidden();
    await expect.poll(() => pixel(page)).toEqual([230, 200, 110, 255]);
    await page.keyboard.down(key);
    await page.waitForTimeout(100);
    expect(await pixel(page)).toEqual([230, 200, 110, 255]);
    await page.keyboard.press('Escape');
    await expect(page.locator('#editor')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#screen')).toBeFocused();
    await page.keyboard.down(key);
    await page.waitForTimeout(100);
    expect(await pixel(page)).toEqual([230, 200, 110, 255]);
    await page.keyboard.up(key);
    await page.keyboard.down(key);
    await expect.poll(() => pixel(page)).toEqual(color);
    await page.keyboard.up(key);
  }

  await openGame(page, '/playload/app/' + hash);
  await expect(page.locator('#start-game')).toBeVisible();
  await page.locator('#crt').evaluate((button) => button.click());
  await page.mouse.click(2, 2);
  await expect(page.locator('#screen')).toBeFocused();
  await expect(page.locator('#start-game')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#start-game')).toBeHidden();
  await expect.poll(() => pixel(page)).toEqual([230, 200, 110, 255]);
  await page.keyboard.down('ArrowRight');
  await expect.poll(() => pixel(page)).toEqual([80, 140, 215, 255]);
  await page.keyboard.up('ArrowRight');

  for (const key of ['Space', 'Enter']) {
    await openGame(page, '/playload/app/' + hash);
    await expect(page.locator('#start-game')).toBeVisible();
    await page.locator('#crt').evaluate((button) => button.click());
    await page.locator('#start-game').focus();
    await page.keyboard.press(key);
    await expect(page.locator('#screen')).toBeFocused();
    await expect.poll(() => pixel(page)).toEqual([230, 200, 110, 255]);
    await page.keyboard.down('ArrowRight');
    await expect.poll(() => pixel(page)).toEqual([80, 140, 215, 255]);
    await page.keyboard.up('ArrowRight');
  }
});

test('losing the WebGL context disables CRT and keeps the game drawing flat frames', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      const context = getContext.call(this, type, ...args);
      if (type === 'webgl') window.gameGL = context;
      return context;
    };
  });
  await run(page, 'function tick() { cls(7); }');
  await expect(page.locator('#pause')).toBeEnabled();
  await page.evaluate(async () => {
    const { createDisplay } = await import('/src/app/display.js'),
      { palette } = await import('/src/engine/engine.js'),
      canvas = document.querySelector('#display'),
      display = createDisplay(palette, canvas.width, canvas.height);
    window.flatFrame = display.render(new Uint8Array(160 * 144).fill(7)).slice();
    if (!window.gameGL) throw new Error('Expected an active WebGL context');
    const loss = window.gameGL.getExtension('WEBGL_lose_context');
    if (!loss) throw new Error('Expected WEBGL_lose_context');
    loss.loseContext();
  });
  await expect.poll(() => page.evaluate(() => window.gameGL.isContextLost())).toBe(true);
  await expect
    .poll(() =>
      page.locator('#display').evaluate((canvas) => {
        const actual = canvas.getContext('2d').getImageData(0, 0, 640, 576).data;
        return actual.every((value, index) => value === window.flatFrame[index]);
      }),
    )
    .toBe(true);
  await expect(page.locator('#error')).toBeHidden();
  await expect(page.locator('#crt')).toBeDisabled();
  await expect(page.locator('#crt')).toHaveAttribute('aria-pressed', 'false');
  expect(await pixel(page)).toEqual([220, 245, 255, 255]);
});

test('Tab keeps focus in place throughout the workspace and still indents code', async ({
  page,
}) => {
  await page.goto('/playload/app/');
  const editor = page.locator('#editor'),
    source = await editor.inputValue();
  const staysFocused = async (target) => {
    await target.focus();
    for (const key of ['Tab', 'Shift+Tab']) {
      await page.keyboard.press(key);
      await expect(target).toBeFocused();
    }
  };
  await expect(page.locator('#screen')).toBeFocused();
  await staysFocused(page.locator('#screen'));
  await expect(page.locator('#start-game')).toBeVisible();
  await editor.click();
  await page.keyboard.press('Shift+Tab');
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue(source);
  await editor.evaluate((element) => element.setSelectionRange(0, 0));
  await page.keyboard.press('Tab');
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue('  ' + source);
  await page.locator('#info-tab').click();
  for (const selector of ['#home-link', '#info-tab', '#about-tab', '#about a[href]'])
    await staysFocused(page.locator(selector).first());
  await page.getByRole('tab', { name: 'Emoji', exact: true }).click();
  await staysFocused(page.locator('#catalog'));
  await staysFocused(page.locator('#catalog button').first());
  await page.getByRole('tab', { name: 'Examples', exact: true }).click();
  await staysFocused(page.locator('.example-links a').first());
  await expect(page.locator('#info')).toBeVisible();
  await expect(editor).toHaveValue('  ' + source);
});

test('external file changes restart the game and update code, title and URL without moving focus', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.gameLoads = 0;
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, ...args) {
      if (message.type === 'load') window.gameLoads++;
      return post.call(this, message, ...args);
    };
  });
  await loadFileHandle(page, '// @title Original\nfunction tick() { cls(4) }');
  const initialLoads = await page.evaluate(() => window.gameLoads);
  await page.locator('#crt').click();
  await expect.poll(() => pixel(page)).toEqual([80, 140, 215, 255]);
  await page.locator('#pause').click();
  const editor = page.locator('#editor');
  await editor.click();
  await expect(editor).toBeFocused();
  const source = '// @title Modified\nfunction tick() { cls(5) }';
  await page.evaluate((source) => (window.testFileSource = source), source);
  await expect(editor).toHaveValue(source);
  await expect(page).toHaveTitle('Modified — Playload');
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { decode } = await import('/src/payload.js');
        return decode(location.hash);
      }),
    )
    .toBe(source);
  await expect(editor).toBeFocused();
  await expect(page.locator('#pause')).toHaveText(/^Pause/);
  await expect.poll(() => pixel(page)).toEqual([100, 185, 100, 255]);
  expect(await page.evaluate(() => window.gameLoads)).toBe(initialLoads + 1);
  expect(await page.evaluate(() => window.pickerOpens)).toBe(1);
  await editor.press('Control+Enter');
  await expect.poll(() => pixel(page)).toEqual([100, 185, 100, 255]);
  await expect(page.locator('#screen')).toBeFocused();
  expect(await page.evaluate(() => window.gameLoads)).toBe(initialLoads + 2);
});

test('declining an external update keeps the draft without repeatedly asking to replace it', async ({
  page,
}) => {
  await loadFileHandle(page);
  const editor = page.locator('#editor'),
    original = await editor.inputValue();
  await page.locator('#crt').click();
  let dialogs = 0;
  page.on('dialog', async (dialog) => {
    expect(dialog.type()).toBe('confirm');
    expect(dialog.message()).toBe('The code was edited in the browser. Replace it with a file?');
    dialogs++;
    await dialog.dismiss();
  });
  const draft = '// @title Draft\nfunction tick() { cls(6) }';
  await editor.fill(draft);
  await page.evaluate(() => (window.testFileSource = 'function tick() { cls(3) }'));
  await page.waitForTimeout(1200);
  await expect(editor).toHaveValue(draft);
  await expect(page).toHaveTitle('Draft — Playload');
  await editor.press('Control+Enter');
  await expect.poll(() => pixel(page)).toEqual([230, 200, 110, 255]);
  expect(dialogs).toBe(1);
  await editor.fill(original);
  await expect(editor).toHaveValue('function tick() { cls(3) }');
  await expect.poll(() => pixel(page)).toEqual([215, 115, 85, 255]);
  expect(dialogs).toBe(1);
});

test('automatic file reads preserve edits made while the read is pending', async ({ page }) => {
  await loadFileHandle(page);
  await page.evaluate(() => {
    const original = window.testFileHandle.getFile;
    window.testFileHandle.getFile = async () => {
      const file = await original();
      await new Promise((resolve) => (window.finishFileRead = resolve));
      return file;
    };
    window.dispatchEvent(new Event('focus'));
  });
  await expect.poll(() => page.evaluate(() => typeof window.finishFileRead)).toBe('function');
  await expect(page.locator('#run')).toBeEnabled();
  await expect(page.locator('#load')).toBeEnabled();
  const editor = page.locator('#editor');
  await editor.fill('function tick() { cls(6) }');
  await page.evaluate(() => window.finishFileRead());
  await page.waitForTimeout(100);
  await expect(editor).toHaveValue('function tick() { cls(6) }');
});

test('a new Load supersedes a pending automatic read of the old file', async ({ page }) => {
  await loadFileHandle(page);
  await page.evaluate(() => {
    const original = window.testFileHandle.getFile;
    window.testFileHandle.getFile = async () => {
      const file = await original();
      await new Promise((resolve) => (window.finishFileRead = resolve));
      return file;
    };
    window.dispatchEvent(new Event('focus'));
  });
  await expect.poll(() => page.evaluate(() => typeof window.finishFileRead)).toBe('function');
  await page.evaluate(
    () =>
      (window.testFileHandle = {
        getFile: async () =>
          new File(['// @title New File\nfunction tick() { cls(5) }'], 'new-game.js'),
      }),
  );
  await page.locator('#load').click();
  await expect(page).toHaveTitle('New File — Playload');
  await page.evaluate(() => window.finishFileRead());
  await page.waitForTimeout(100);
  await expect(page.locator('#filename')).toHaveText('new-game.js');
  await expect(page.locator('#editor')).toHaveValue(
    '// @title New File\nfunction tick() { cls(5) }',
  );
});

test('Load preserves edits made during a pending file read', async ({ page }) => {
  await page.addInitScript(
    () =>
      (window.showOpenFilePicker = async () => [
        {
          getFile: async () => {
            await new Promise((resolve) => (window.finishFileRead = resolve));
            return new File(['function tick() { cls(4) }'], 'native-game.js');
          },
        },
      ]),
  );
  await page.goto('/playload/app/');
  await page.locator('#load').click();
  await expect(page.locator('#run')).toBeDisabled();
  await expect(page.locator('#load')).toBeDisabled();
  const editor = page.locator('#editor');
  await editor.fill('function tick() { cls(6) }');
  await page.evaluate(() => window.finishFileRead());
  await expect(page.locator('#run')).toBeEnabled();
  await expect(editor).toHaveValue('function tick() { cls(6) }');
  await expect(page.locator('#status')).toHaveText(
    'Code changed while loading. Your edits were kept.',
  );
});

test('a temporary file read failure preserves the game and automatic checks recover', async ({
  page,
}) => {
  await loadFileHandle(page);
  await page.locator('#crt').click();
  await page.evaluate(() => {
    const original = window.testFileHandle.getFile;
    window.testFileHandle.getFile = () => {
      if (window.fileMissing) throw new DOMException('File no longer exists.', 'NotFoundError');
      return original();
    };
    window.fileMissing = true;
    window.dispatchEvent(new Event('focus'));
  });
  await expect(page.locator('#status')).toHaveText('File no longer exists.');
  await expect(page.locator('#editor')).toHaveValue('function tick() { cls(4) }');
  expect(await pixel(page)).toEqual([80, 140, 215, 255]);
  await page.evaluate(() => {
    window.fileMissing = false;
    window.testFileSource = 'function tick() { cls(5) }';
  });
  await expect(page.locator('#editor')).toHaveValue('function tick() { cls(5) }');
  await expect(page.locator('#status')).toHaveText('');
  await expect.poll(() => pixel(page)).toEqual([100, 185, 100, 255]);
});

test('canceling a fallback Load restores controls and preserves the source and URL', async ({
  page,
  browserName,
}) => {
  await page.addInitScript(() => (window.showOpenFilePicker = undefined));
  await page.goto('/playload/app/');
  const source = await page.locator('#editor').inputValue(),
    url = page.url();
  const input = await openFallbackPicker(page, browserName, () => page.locator('#load').click());
  await expect(page.locator('#run')).toBeDisabled();
  await expect(page.locator('#load')).toBeDisabled();
  await input.dispatchEvent('cancel');
  await expect(page.locator('#run')).toBeEnabled();
  await expect(page.locator('#load')).toBeEnabled();
  await expect(page.locator('#editor')).toHaveValue(source);
  expect(page.url()).toBe(url);
});

test('a shared game does not steal editor focus chosen while its worker is starting', async ({
  page,
}) => {
  await page.goto('/playload/app/');
  const hash = await page.evaluate(
    async () => (await (await import('/src/payload.js')).encode('function tick() { cls(4) }')).hash,
  );
  await page.goto('about:blank');
  await page.addInitScript(() => {
    const GameWorker = window.Worker;
    window.Worker = class extends GameWorker {
      postMessage(message, ...args) {
        if (message.type === 'load')
          window.finishInitialLoad = () => super.postMessage(message, ...args);
        else super.postMessage(message, ...args);
      }
    };
  });
  await page.goto('/playload/app/' + hash);
  await page.locator('#start-game').click();
  await expect.poll(() => page.evaluate(() => typeof window.finishInitialLoad)).toBe('function');
  await page.locator('#editor').focus();
  await page.evaluate(() => window.finishInitialLoad());
  await expect(page.locator('#pause')).toBeEnabled();
  await expect(page.locator('#editor')).toBeFocused();
});

test('Info interactions stay in Info when a shared URL finishes decoding', async ({ browser }) => {
  const { hash } = await encode('function tick() { cls(6) }');
  for (const touch of [false, true]) {
    const page = await browser.newPage({
      viewport: touch ? { width: 390, height: 844 } : { width: 1280, height: 800 },
      hasTouch: touch,
      isMobile: touch,
    });
    await page.addInitScript(() => {
      const Stream = DecompressionStream;
      window.DecompressionStream = class {
        constructor(...args) {
          const stream = new Stream(...args);
          this.writable = stream.writable;
          this.readable = stream.readable.pipeThrough(
            new TransformStream({
              async transform(chunk, controller) {
                await new Promise((resolve) => (window.releaseDecode = resolve));
                controller.enqueue(chunk);
              },
            }),
          );
        }
      };
    });
    try {
      for (const action of ['pointer', 'key']) {
        await openGame(page, '/playload/app/' + hash);
        await page.waitForFunction(() => typeof window.releaseDecode === 'function');
        await page.locator('#info-tab').click();
        await page.getByRole('tab', { name: 'API', exact: true }).click();
        await page.evaluate(() => window.releaseDecode());
        await page.waitForFunction(() => !document.querySelector('#start-game').hidden);
        if (action === 'pointer') {
          const description = page.locator('#api .reference-description').first();
          if (touch) await description.tap();
          else await description.click();
        } else {
          await page.keyboard.press('ArrowDown');
        }
        await expect(page.locator('#start-game')).toBeHidden();
        await expect(page.locator('#pause')).toBeDisabled();
        await expect(page.locator('#info')).toBeVisible();
        await expect(page.locator('#screen')).not.toBeFocused();
        await expect(page.locator('#error')).toBeHidden();
      }
    } finally {
      await page.close();
    }
  }
});

test.describe('touch player', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 375, height: 812 } });
  test('direction and action touches work together and rotation releases a held direction', async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName !== 'chromium',
      'Multiple held touch contacts require the Chromium input protocol.',
    );
    const { hash } = await encode(
      'function tick() { for (let id = 0; id < 6; id++) put(id, 0, " ", 0, btn(id) ? 7 : 0); }',
    );
    await page.goto('/playload/app/' + hash);
    await page.locator('#start-game').tap();
    await page.locator('#tools-toggle').tap();
    await page.locator('#crt').tap();
    await page.locator('#tools-toggle').tap();
    const session = await page.context().newCDPSession(page);
    const contact = async (selector, id) => {
      const bounds = await page.locator(selector).boundingBox();
      return { id, x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    };
    const dispatch = (type, ...touchPoints) =>
      session.send('Input.dispatchTouchEvent', { type, touchPoints });
    const inputMask = () =>
      page.locator('#display').evaluate((canvas) => {
        const context = canvas.getContext('2d');
        let mask = 0;
        for (let id = 0; id < 6; id++) {
          if (context.getImageData(id * 32 + 16, 16, 1, 1).data[0] === 220) mask |= 1 << id;
        }
        return mask;
      });
    await page.evaluate(() => {
      window.touchCancellations = 0;
      window.gameFocusTargets = [];
      document.addEventListener('pointercancel', () => window.touchCancellations++);
      document.addEventListener('focusin', (event) => {
        window.gameFocusTargets.push(event.target.id || event.target.tagName);
      });
    });
    const center = await contact('.dpad', 0);
    const right = await contact('[data-input="3"]', 0);
    const left = await contact('[data-input="2"]', 0);
    const a = await contact('[data-input="4"]', 1);
    const b = await contact('[data-input="5"]', 2);
    await dispatch('touchStart', center, a, b);
    await expect.poll(inputMask).toBe(48);
    await dispatch('touchMove', right, a, b);
    await expect.poll(inputMask).toBe(56);
    for (const selector of ['[data-input="3"]', '[data-input="4"]', '[data-input="5"]']) {
      await expect(page.locator(selector)).toHaveCSS('background-color', 'rgb(230, 200, 110)');
      await expect(page.locator(selector)).toHaveCSS('color', 'rgb(33, 28, 41)');
    }
    await dispatch('touchMove', center, a, b);
    await expect(page.locator('[data-input="3"]')).toHaveAttribute('data-held', 'true');
    await expect.poll(inputMask).toBe(56);
    await dispatch('touchMove', left, a, b);
    await expect(page.locator('[data-input="2"]')).toHaveAttribute('data-held', 'true');
    await expect.poll(inputMask).toBe(52);

    const pad = await page.locator('.dpad').boundingBox();
    for (const [x, y, mask] of [
      [pad.x + 2, center.y - 4, 4],
      [pad.x + 2, pad.y + 2, 5],
      [center.x - 4, pad.y + 2, 1],
      [pad.x + pad.width - 2, pad.y + 2, 9],
      [pad.x + pad.width - 2, center.y - 4, 8],
      [pad.x + pad.width - 2, pad.y + pad.height - 2, 10],
      [center.x + 4, pad.y + pad.height - 2, 2],
      [pad.x + 2, pad.y + pad.height - 2, 6],
    ]) {
      await dispatch('touchMove', { id: 0, x, y }, a, b);
      await expect.poll(inputMask).toBe(mask | 48);
      await dispatch('touchMove', center, a, b);
      await expect.poll(inputMask).toBe(mask | 48);
    }
    await dispatch('touchMove', { id: 0, x: pad.x + 2, y: pad.y + 4 }, a, b);
    await expect(page.locator('.dpad [data-held="true"]')).toHaveCount(2);
    await expect.poll(inputMask).toBe(53);
    await dispatch('touchMove', { id: 0, x: pad.x + pad.width + 12, y: center.y }, a, b);
    await expect(page.locator('.dpad [data-held="true"]')).toHaveCount(0);
    await expect.poll(inputMask).toBe(48);
    await dispatch('touchMove', right, a, b);
    await expect.poll(inputMask).toBe(56);
    // A resting finger keeps its direction held.
    await page.waitForTimeout(800);
    expect(await inputMask()).toBe(56);
    expect(await page.evaluate(() => window.getSelection().toString())).toBe('');
    expect(await page.evaluate(() => window.touchCancellations)).toBe(0);
    await dispatch('touchEnd');
    await expect.poll(inputMask).toBe(0);

    await dispatch('touchStart', { id: 0, x: pad.x + 2, y: pad.y + 2 });
    await expect.poll(inputMask).toBe(5);
    await dispatch('touchMove', center);
    await expect.poll(inputMask).toBe(5);
    await dispatch('touchEnd');
    await expect.poll(inputMask).toBe(0);

    await expect(page.locator('#screen')).toBeFocused();
    expect(
      await page.evaluate(() => window.gameFocusTargets.filter((id) => id !== 'screen')),
    ).toEqual([]);

    await page.evaluate(() => {
      window.headerClicks = {};
      document.addEventListener('click', (event) => {
        const id = event.target.closest('header button')?.id;
        if (id) window.headerClicks[id] = (window.headerClicks[id] || 0) + 1;
      });
    });
    const tools = await contact('#tools-toggle', 1);
    await dispatch('touchStart', { ...tools, id: 0 });
    await dispatch('touchMove', { id: 0, x: tools.x, y: tools.y + 70 });
    await dispatch('touchEnd');
    await expect(page.locator('#workspace-toolbar')).toBeHidden();
    expect(await page.evaluate(() => window.headerClicks['tools-toggle'] || 0)).toBe(0);
    await page.locator('#tools-toggle').tap();
    await expect(page.locator('#workspace-toolbar')).toBeVisible();
    expect(await page.evaluate(() => window.headerClicks['tools-toggle'])).toBe(1);
    await page.locator('#tools-toggle').tap();
    await expect(page.locator('#workspace-toolbar')).toBeHidden();
    expect(await page.evaluate(() => window.headerClicks['tools-toggle'])).toBe(2);

    // Secondary touches can open tools without leaving a held direction behind.
    await dispatch('touchStart', right);
    await expect.poll(inputMask).toBe(8);
    await dispatch('touchStart', right, tools);
    await dispatch('touchEnd', tools);
    await expect(page.locator('#workspace-toolbar')).toBeVisible();
    expect(await page.evaluate(() => window.headerClicks['tools-toggle'])).toBe(3);
    await dispatch('touchEnd');
    expect(await page.evaluate(() => window.headerClicks['tools-toggle'])).toBe(3);
    await page.locator('#tools-toggle').tap();
    await expect.poll(inputMask).toBe(0);

    await dispatch('touchStart', right);
    const info = await contact('#info-tab', 1);
    await dispatch('touchStart', right, info);
    await dispatch('touchEnd', info);
    await expect(page.locator('body')).toHaveAttribute('data-view', 'info');
    expect(await page.evaluate(() => window.headerClicks['info-tab'])).toBe(1);
    await dispatch('touchEnd');
    expect(await page.evaluate(() => window.headerClicks['info-tab'])).toBe(1);

    const tabs = page.locator('.reference-scroll');
    const strip = await tabs.boundingBox();
    expect(await tabs.evaluate((element) => element.scrollWidth)).toBeGreaterThan(
      await tabs.evaluate((element) => element.clientWidth),
    );
    expect(await touchStartCanceled(page, '.reference-tabs')).toBe(false);
    const start = { id: 0, x: strip.x + strip.width - 20, y: strip.y + 12 };
    await dispatch('touchStart', start);
    for (let step = 1; step <= 5; step++)
      await dispatch('touchMove', { ...start, x: start.x - step * 30 });
    await dispatch('touchEnd');
    await expect.poll(() => tabs.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    await expect(page.locator('#about-tab')).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('tab', { name: 'API', exact: true }).tap();

    const api = page.locator('#api');
    const content = await api.boundingBox();
    const contentStart = { id: 0, x: content.x + 100, y: content.y + content.height - 40 };
    await dispatch('touchStart', contentStart);
    for (let step = 1; step <= 5; step++)
      await dispatch('touchMove', { ...contentStart, y: contentStart.y - step * 30 });
    await dispatch('touchEnd');
    await expect.poll(() => api.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    expect(await page.evaluate(() => [scrollX, scrollY])).toEqual([0, 0]);
    await page.locator('#play-tab').tap();
    await expect.poll(inputMask).toBe(0);
    await dispatch('touchStart', right);
    await expect.poll(inputMask).toBe(8);
    await page.setViewportSize({ width: 812, height: 375 });
    await expect.poll(inputMask).toBe(0);
    await dispatch('touchEnd');
    await session.detach();
    expect(await page.evaluate(() => scrollY)).toBe(0);
  });
});

test('the built app connects shared source, game input, sound and downloads', async ({ page }) => {
  await page.addInitScript(() => {
    const Context = window.AudioContext;
    window.AudioContext = class extends Context {
      createMediaStreamDestination() {
        const destination = super.createMediaStreamDestination();
        window.gameAnalyser = this.createAnalyser();
        this.createMediaStreamSource(destination.stream).connect(window.gameAnalyser);
        return destination;
      }
    };
  });
  const source =
    '// @title Integration\nlet pressed = false; play(0,"T120O5N3c))");\n' +
    'function tick() { if(btnp(4)) pressed = !pressed; cls(pressed ? 5 : 1); }';
  const { hash } = await encode(source);
  await page.goto('/playload/app/' + hash);
  await expect(page.locator('#start-game')).toBeVisible();
  await expect(page.locator('#pause')).toBeDisabled();
  await expect(page.locator('#editor')).toHaveValue(source);
  await expect(page).toHaveTitle('Integration — Playload');
  await expect(page.locator('#crt')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#crt').click();
  await page.locator('#start-game').click();
  await expect(page.locator('#pause')).toBeEnabled();
  await expect.poll(() => pixel(page, 320, 288)).toEqual([85, 65, 95, 255]);
  await page.keyboard.press('z');
  await expect.poll(() => pixel(page, 320, 288)).toEqual([100, 185, 100, 255]);
  await expect
    .poll(() =>
      page.evaluate(() => {
        if (!window.gameAnalyser) return 0;
        const samples = new Float32Array(window.gameAnalyser.fftSize);
        window.gameAnalyser.getFloatTimeDomainData(samples);
        return Math.max(...samples.map(Math.abs));
      }),
    )
    .toBeGreaterThan(0.001);
  const pngReady = page.waitForEvent('download');
  await page.locator('#screenshot').click();
  const png = await pngReady,
    pngParts = [];
  for await (const part of await png.createReadStream()) pngParts.push(part);
  const image = Buffer.concat(pngParts);
  expect(png.suggestedFilename()).toBe('playload.png');
  expect([image.readUInt32BE(16), image.readUInt32BE(20)]).toEqual([640, 576]);
  await expect(page.locator('#video')).toBeEnabled();
  const videoReady = page.waitForEvent('download');
  await page.locator('#video').click();
  const video = await videoReady,
    videoParts = [];
  for await (const part of await video.createReadStream()) videoParts.push(part);
  expect(video.suggestedFilename()).toBe('playload.webm');
  const buffer = new WebMBuffer();
  buffer.begin(0);
  buffer.append(Buffer.concat(videoParts));
  expect(buffer.frames.some((frame) => frame.kind === 1)).toBe(true);
  expect(buffer.frames.some((frame) => frame.kind === 2)).toBe(true);
  // Decode the exported file with the browser, independently of Playload's WebM parser.
  // A fresh page keeps this test separate from the app's restrictive media policy.
  const playback = await page.context().newPage();
  try {
    const decoded = await playback.evaluate(
      async (bytes) => {
        const video = document.createElement('video'),
          url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'video/webm' }));
        video.muted = true;
        video.src = url;
        let timer;
        try {
          await new Promise((resolve, reject) => {
            video.onended = resolve;
            video.onerror = () =>
              reject(new Error(video.error?.message || 'Video decoding failed'));
            timer = setTimeout(() => reject(new Error('Video playback did not finish')), 15000);
            video.play().catch(reject);
          });
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const context = canvas.getContext('2d');
          context.drawImage(video, 0, 0);
          return {
            width: video.videoWidth,
            height: video.videoHeight,
            duration: video.duration,
            color: [...context.getImageData(320, 288, 1, 1).data],
          };
        } finally {
          clearTimeout(timer);
          video.pause();
          video.removeAttribute('src');
          video.load();
          URL.revokeObjectURL(url);
        }
      },
      [...Buffer.concat(videoParts)],
    );
    expect([decoded.width, decoded.height]).toEqual([640, 576]);
    expect(decoded.duration).toBeGreaterThan(0);
    expect(decoded.duration).toBeLessThanOrEqual(10);
    // Lossy encoders and YUV conversion vary by browser; the green game picture must survive.
    expect(decoded.color[1]).toBeGreaterThan(decoded.color[0] + 40);
    expect(decoded.color[1]).toBeGreaterThan(decoded.color[2] + 40);
  } finally {
    await playback.close();
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause')).toContainText('Resume');
});
