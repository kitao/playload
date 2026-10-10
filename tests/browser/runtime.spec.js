import { test as base, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const test = base.extend({
  runtimeErrors: [
    async ({ page }, use) => {
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await use(errors);
      expect(errors).toEqual([]);
    },
    { auto: true },
  ],
});

async function run(page, source, flat = false) {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Play' }).click();
  await page.getByRole('textbox', { name: 'JavaScript code' }).fill(source);
  await page.getByRole('button', { name: 'Run', exact: false }).click();
  if (flat) await page.getByRole('button', { name: 'CRT', exact: true }).click();
}

async function pixel(page, x = 0, y = 0) {
  return page
    .locator('#display')
    .evaluate(
      (canvas, [x, y]) => [...canvas.getContext('2d').getImageData(x, y, 1, 1).data],
      [x, y],
    );
}

test('the untouched starter keeps a plain URL until one character changes, including after Run', async ({
  page,
}) => {
  await page.goto('/');
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

test('workspace tabs do not change the URL or select the opening screen', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Play', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const url = page.url();
  await page.getByRole('tab', { name: 'Info', exact: true }).click();
  await page.getByRole('tab', { name: 'Examples', exact: true }).click();
  expect(page.url()).toBe(url);
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Play', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.goto('/?ref=examples');
  await expect(page.getByRole('tab', { name: 'Play', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.locator('#info')).toBeHidden();
});

test('a shared URL containing the starter remains a playable bookmark', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByRole('textbox', { name: 'JavaScript code' });
  const starter = await editor.inputValue();
  const hash = await page.evaluate(async (code) => {
    const { encode } = await import('/src/payload.js');
    return (await encode(code)).hash;
  }, starter);
  await page.goto('/' + hash);
  await expect(editor).toHaveValue(starter);
  await expect(page).toHaveTitle('My Game — Playload');
  await expect(page.locator('#pause')).toBeEnabled();
  await expect(page.locator('#size')).toBeVisible();
  expect(new URL(page.url()).hash).toBe(hash);
  await page.reload();
  await expect(editor).toHaveValue(starter);
  await expect(page).toHaveTitle('My Game — Playload');
  await expect(page.locator('#pause')).toBeEnabled();
  expect(new URL(page.url()).hash).toBe(hash);
});

test('loading a file starts bookmark URLs even when its code matches the starter', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(() => {
    window.showOpenFilePicker = undefined;
  });
  const starter = await page.locator('#editor').inputValue();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#load').click();
  await (
    await chooser
  ).setFiles({
    name: 'starter.js',
    mimeType: 'text/javascript',
    buffer: Buffer.from(starter),
  });
  await expect(page.locator('#pause')).toBeEnabled();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        if (!location.hash) return null;
        const { decode } = await import('/src/payload.js');
        return decode(location.hash);
      }),
    )
    .toBe(starter);
});

test('Load and Run shortcuts work; the address follows edits and restores a bookmark', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(() => {
    window.showOpenFilePicker = undefined;
  });
  const editor = page.getByRole('textbox', { name: 'JavaScript code' });
  await editor.focus();
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Control+o');
  await (
    await chooser
  ).setFiles({
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
  await page.goto('about:blank');
  await page.goto(bookmark);
  await expect(editor).toHaveValue(source);
  await expect(editor).toBeVisible();
  await expect(page.locator('#pause')).toBeEnabled();
  await page.locator('#crt').click();
  await expect.poll(() => pixel(page)).toEqual([100, 185, 100, 255]);
});

test('title comments update before Run and survive bookmarks, edits and a fresh URL', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Playload');
  const editor = page.getByRole('textbox', { name: 'JavaScript code' });
  const source = '// @title Star Catcher\n// A small game.\nfunction tick() { cls(4) }\n';
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
  await page.goto('about:blank');
  await page.goto(bookmark);
  await expect(page).toHaveTitle('Star Catcher — Playload');
  await expect(editor).toHaveValue(source);
  await expect(page.locator('#pause')).toBeEnabled();
  await editor.fill(source.replace('Star Catcher', '星の冒険 👾'));
  await expect(page).toHaveTitle('星の冒険 👾 — Playload');
  await editor.fill(source.replace('// @title Star Catcher', '// @title   '));
  await expect(page).toHaveTitle('Playload');
  const fresh = new URL(bookmark);
  fresh.hash = '';
  await page.goto(fresh.href);
  await expect(page).toHaveTitle('Playload');
});

test('title metadata reads only the opening comment, keeps literal text and accepts blank lines', async ({
  page,
}) => {
  await page.goto('/');
  const editor = page.getByRole('textbox', { name: 'JavaScript code' });
  for (const [source, title] of [
    [
      'const text = "// @title String";\nconst template = `\n// @title Template\n`;\n/*\n// @title Block\n*/\nfunction tick() { cls(0) }',
      'Playload',
    ],
    ['function tick() { // @title Inside tick\ncls(0) }', 'Playload'],
    ['// A description\n// @title Below the header\nfunction tick() {}', 'Playload'],
    ['// @title First\n// @title Second\nfunction tick() {}', 'First — Playload'],
    ['// @title\n// @title Second\nfunction tick() {}', 'Playload'],
    ['// @titleOther Not a title\nfunction tick() {}', 'Playload'],
    ['// @title <b>Game & Friends</b>\nfunction tick() {}', '<b>Game & Friends</b> — Playload'],
    ['\ufeff\r\n//\t@title\t  Rainy Day  \r\nfunction tick() {}', 'Rainy Day — Playload'],
  ]) {
    await editor.fill(source);
    await expect(page).toHaveTitle(title);
  }
  await expect(page.locator('title b')).toHaveCount(0);
});

test('file Load and Reload restore title metadata rather than the edited title', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(() => {
    window.showOpenFilePicker = undefined;
  });
  const editor = page.getByRole('textbox', { name: 'JavaScript code' });
  const file = (title) => ({
    name: 'game.js',
    mimeType: 'text/javascript',
    buffer: Buffer.from(`// @title ${title}\nfunction tick() { cls(0) }`),
  });
  let chooser = page.waitForEvent('filechooser');
  await page.locator('#load').click();
  await (await chooser).setFiles(file('Loaded Game'));
  await expect(page).toHaveTitle('Loaded Game — Playload');
  await editor.fill('// @title Editor Title\nfunction tick() { cls(3) }');
  await expect(page).toHaveTitle('Editor Title — Playload');
  page.once('dialog', (dialog) => dialog.accept());
  chooser = page.waitForEvent('filechooser');
  await page.locator('#reload').click();
  await (await chooser).setFiles(file('Updated File'));
  await expect(page).toHaveTitle('Updated File — Playload');
  await expect(editor).toHaveValue('// @title Updated File\nfunction tick() { cls(0) }');
});

test('removing the URL hash restores the starter instead of an old browser draft', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem('playload-code-v2', 'function tick() { cls(3) }'),
  );
  await page.goto('/');
  const editor = page.getByRole('textbox', { name: 'JavaScript code' });
  await expect(editor).toHaveValue(/spr\(x, y, ['"]👾['"], 6\)/);
  const starter = await editor.inputValue(),
    source = 'function tick() { cls(5) }';
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
  const bookmark = page.url();
  await page.reload();
  await expect(editor).toHaveValue(source);
  const freshURL = new URL(bookmark);
  freshURL.hash = '';
  await page.goto(freshURL.href);
  await expect(editor).toHaveValue(starter);
  await expect(page.locator('#pause')).toBeDisabled();
  await expect(page.locator('#size')).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
  await page.goto(bookmark);
  await expect(editor).toHaveValue(source);
  await expect(page.locator('#pause')).toBeEnabled();
});

test('a real game worker draws, receives keyboard input and resets the game', async ({ page }) => {
  await run(page, 'function tick() { cls(btn(4) ? 3 : 4) }', true);
  await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
  await expect.poll(() => pixel(page)).toEqual([80, 140, 215, 255]);
  await page.locator('#screen').click();
  await page.keyboard.down('KeyZ');
  await expect.poll(() => pixel(page)).toEqual([215, 115, 85, 255]);
  await page.keyboard.up('KeyZ');
  await expect.poll(() => pixel(page)).toEqual([80, 140, 215, 255]);
  await page.getByRole('button', { name: 'Run', exact: false }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
  await expect.poll(() => pixel(page)).toEqual([80, 140, 215, 255]);
});

async function mockGamepads(page) {
  await page.addInitScript(() => {
    window.testPads = [];
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => window.testPads,
    });
  });
}

test('WASD and J/K work alongside the original keys and leave editor typing alone', async ({
  page,
}) => {
  await run(
    page,
    'function tick() { cls(0); for (let id = 0; id < 6; id++) if (btn(id)) cls(id + 1); }',
    true,
  );
  const colors = await page.evaluate(async () => {
    const { palette } = await import('/src/engine.js');
    return palette.map((color) =>
      [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)).concat(255),
    );
  });
  for (const [id, key] of ['w', 's', 'a', 'd', 'j', 'k'].entries()) {
    await page.keyboard.down(key);
    await expect.poll(() => pixel(page)).toEqual(colors[id + 1]);
    await page.keyboard.up(key);
    await expect.poll(() => pixel(page)).toEqual(colors[0]);
  }

  await page.keyboard.down('z');
  await page.keyboard.down('j');
  await page.keyboard.up('z');
  await expect.poll(() => pixel(page)).toEqual(colors[5]);
  await page.keyboard.up('j');
  await expect.poll(() => pixel(page)).toEqual(colors[0]);

  const editor = page.locator('#editor');
  const source = await editor.inputValue();
  await editor.focus();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('wasdjk');
  await expect(editor).toHaveValue(source + 'wasdjk');
  await expect.poll(() => pixel(page)).toEqual(colors[0]);
});

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

test('gamepads merge with keyboard input, press once, and release when editing, paused or in Info', async ({
  page,
}) => {
  await mockGamepads(page);
  await run(
    page,
    `let count = 0;
    function tick() {
      if (btnp(4)) count++;
      cls(0);
      scr[0][0].col[1] = btn(4) ? 3 : 0;
      scr[0][1].col[1] = count;
    }`,
    true,
  );
  await page.locator('#screen').click();
  const held = [215, 115, 85, 255];
  const released = [0, 0, 0, 255];
  await setGamepad(page, { buttons: [0] });
  await expect.poll(() => pixel(page)).toEqual(held);
  await expect.poll(() => pixel(page, 32)).toEqual([85, 65, 95, 255]);
  await page.keyboard.down('KeyZ');
  await setGamepad(page);
  await page.waitForTimeout(100);
  expect(await pixel(page)).toEqual(held);
  await setGamepad(page, { buttons: [0] });
  await page.keyboard.up('KeyZ');
  await page.waitForTimeout(100);
  expect(await pixel(page)).toEqual(held);
  expect(await pixel(page, 32)).toEqual([85, 65, 95, 255]);
  await page.locator('#editor').focus();
  await expect.poll(() => pixel(page)).toEqual(released);
  await page.locator('#screen').focus();
  await expect.poll(() => pixel(page)).toEqual(held);
  await expect.poll(() => pixel(page, 32)).toEqual([100, 105, 100, 255]);
  await page.keyboard.press('Alt+p');
  await expect(page.locator('#editor')).toBeFocused();
  await setGamepad(page);
  await page.keyboard.press('Alt+p');
  await expect(page.locator('#screen')).toBeFocused();
  await expect.poll(() => pixel(page)).toEqual(released);
  await setGamepad(page, { buttons: [0] });
  await expect.poll(() => pixel(page)).toEqual(held);
  await page.locator('#info-tab').click();
  await setGamepad(page);
  await page.locator('#code-tab').click();
  await page.locator('#screen').focus();
  await expect.poll(() => pixel(page)).toEqual(released);
});

test('unavailable or permission-blocked gamepad access leaves keyboard games working', async ({
  page,
}) => {
  await run(page, 'function tick() { cls(btn(4) ? 3 : 4) }', true);
  await page.locator('#screen').click();
  for (const blocked of [false, true]) {
    await page.evaluate((blocked) => {
      Object.defineProperty(navigator, 'getGamepads', {
        configurable: true,
        value: blocked
          ? () => {
              throw new DOMException('Blocked', 'SecurityError');
            }
          : undefined,
      });
    }, blocked);
    await page.keyboard.down('KeyZ');
    await expect.poll(() => pixel(page)).toEqual([215, 115, 85, 255]);
    await page.keyboard.up('KeyZ');
    await expect.poll(() => pixel(page)).toEqual([80, 140, 215, 255]);
  }
});

for (const hz of [60, 90, 120, 144, 165]) {
  test(`${hz} Hz displays keep 60 game updates per second without catching up after a long pause`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (callback) => {
        if (callback.name === 'animate') {
          window.nextAnimate = callback;
          return 1;
        }
        return raf(callback);
      };
      const NativeWorker = window.Worker;
      window.completedFrames = 0;
      window.Worker = class extends NativeWorker {
        constructor(...args) {
          super(...args);
          this.addEventListener('message', ({ data }) => {
            if (data.type === 'frame') {
              window.completedFrames++;
            }
          });
        }
        postMessage(data, ...args) {
          if (data.type === 'frame')
            window.frameFinished = new Promise((resolve) => {
              this.addEventListener('message', resolve, { once: true });
            });
          super.postMessage(data, ...args);
        }
      };
    });
    await run(page, 'function tick() { cls(4); }');
    await expect(page.locator('#pause')).toBeEnabled();
    const frames = await page.evaluate(async (hz) => {
      for (let i = 1; i <= hz; i++) {
        window.nextAnimate((i * 1000) / hz);
        await window.frameFinished;
      }
      return window.completedFrames;
    }, hz);
    expect(frames).toBe(60);
    const afterPause = await page.evaluate(async () => {
      for (const time of [10000, 10000 + 1000 / 60]) {
        window.nextAnimate(time);
        await window.frameFinished;
      }
      return window.completedFrames;
    });
    expect(afterPause).toBe(62);
  });
}

test('btnp is consumed once, pause freezes a frame, and reset restores initial state', async ({
  page,
}) => {
  await run(page, 'let color = 1; function tick() { if(btnp(4)) color++; cls(color) }', true);
  await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
  await page.locator('#screen').click();
  await page.keyboard.down('KeyZ');
  await expect.poll(() => pixel(page)).toEqual([100, 105, 100, 255]);
  await page.getByRole('button', { name: 'Pause', exact: false }).click();
  await page.keyboard.up('KeyZ');
  await expect(page.getByRole('button', { name: 'Screenshot', exact: false })).toBeEnabled();
  expect(await pixel(page)).toEqual([100, 105, 100, 255]);
  await page.getByRole('button', { name: 'Run', exact: false }).click();
  await expect.poll(() => pixel(page)).toEqual([85, 65, 95, 255]);
});

test('paused keyboard and touch presses do not become game actions on resume', async ({
  page,
  browser,
}) => {
  const source = 'let presses = 0; function tick() { if (btnp(4)) presses++; cls(presses); }';
  await run(page, source, true);
  await page.locator('#code-toggle').click();
  await page.locator('#pause').click();
  await expect(page.locator('#screen')).toBeFocused();
  await page.keyboard.press('z');
  await page.locator('#pause').click();
  await page.waitForTimeout(100);
  expect(await pixel(page)).toEqual([0, 0, 0, 255]);
  await page.keyboard.press('z');
  await expect.poll(() => pixel(page)).toEqual([85, 65, 95, 255]);

  const phone = await browser.newPage({
    viewport: { width: 375, height: 812 },
    hasTouch: true,
    isMobile: true,
  });
  await phone.goto('http://127.0.0.1:8765/');
  const hash = await phone.evaluate(async (source) => {
    const { encode } = await import('/src/payload.js');
    return (await encode(source)).hash;
  }, source);
  await phone.goto('http://127.0.0.1:8765/' + hash);
  await phone.locator('#start-game').tap();
  await expect(phone.locator('#pause')).toBeEnabled();
  await phone.locator('#tools-toggle').tap();
  await phone.locator('#crt').click();
  await phone.locator('#tools-toggle').tap();
  await phone.locator('#pause').click();
  await phone.locator('[data-input="4"]').tap();
  await phone.locator('#pause').click();
  await phone.waitForTimeout(100);
  expect(await pixel(phone)).toEqual([0, 0, 0, 255]);
  await phone.locator('[data-input="4"]').tap();
  await expect.poll(() => pixel(phone)).toEqual([85, 65, 95, 255]);
  await phone.close();
});

for (const [name, source, message] of [
  ['missing tick', 'cls(4)', 'Define function tick()'],
  ['tick exception', 'function tick() { throw new Error("test game error") }', 'test game error'],
  ['string exception', 'function tick() { throw "Game over" }', 'Game over'],
  ['number exception', 'function tick() { throw 42 }', '42'],
  ['null exception', 'function tick() { throw null }', 'null'],
  ['syntax error', 'function tick( {', 'SyntaxError'],
  ['nonresponsive game', 'function tick() { while(true) {} }', 'The game stopped responding.'],
]) {
  test(`${name} is reported and the editor can run a replacement game`, async ({ page }) => {
    await run(page, source, true);
    if (name === 'syntax error') await expect(page.getByRole('alert')).toBeVisible();
    else await expect(page.getByRole('alert')).toContainText(message);
    await expect(page.getByRole('textbox', { name: 'JavaScript code' })).toHaveValue(source);
    await page.getByRole('textbox', { name: 'JavaScript code' }).fill('function tick() { cls(5) }');
    await page.getByRole('button', { name: 'Run', exact: false }).click();
    await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
    await expect.poll(() => pixel(page)).toEqual([100, 185, 100, 255]);
    await expect(page.getByRole('alert')).toBeHidden();
  });
}

test('engine validation errors retain the frame without inventing a source line', async ({
  page,
}) => {
  await run(
    page,
    `let frames = 0;
function tick() {
  cls(4);
  if (++frames === 2) {
    cls(9);
  }
}`,
    true,
  );
  await expect(page.locator('#error')).toHaveText('Color must be 0–7');
  await expect(page.locator('#screen')).toBeVisible();
  expect(await pixel(page)).toEqual([80, 140, 215, 255]);
  const line = page.locator('#error-line');
  if (await line.isVisible()) await expect(line).toHaveText('Line 5');
});

test('a shared URL starts the player with the same game', async ({ page }) => {
  await page.goto('/');
  const hash = await page.evaluate(async () => {
    const { encode } = await import('/src/payload.js');
    return (await encode('let color = 6; function tick() { if (btnp(4)) color = 5; cls(color) }'))
      .hash;
  });
  await page.goto('/' + hash);
  await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
  await expect(page.getByRole('tab', { name: 'Play' })).toBeVisible();
  await expect(page.locator('#editor')).toBeVisible();
  await expect(page.locator('#screen')).toBeFocused();
  await expect(page.getByRole('button', { name: 'CRT', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Sound', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(await pixel(page)).toEqual([0, 0, 0, 255]);
  await page.keyboard.press('z');
  await page.getByRole('button', { name: 'CRT', exact: true }).click();
  await expect.poll(() => pixel(page)).toEqual([100, 185, 100, 255]);
  await page.keyboard.press('Control+Enter');
  await expect.poll(() => pixel(page)).toEqual([230, 200, 110, 255]);
});

test('malformed worker frames are rejected before display or playback', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { Runtime } = await import('/src/runtime.js');
    return await new Promise((resolve) => {
      let frames = 0;
      const runtime = new Runtime(
        () => frames++,
        (error) => resolve({ message: error.message, frames, stopped: runtime.worker === null }),
      );
      runtime.load(
        'postMessage({type:"frame",pixels:new Uint8Array(160*144).fill(8),sounds:[]}); function tick() {}',
      );
    });
  });
  expect(result).toEqual({ message: 'Invalid game frame.', frames: 0, stopped: true });
});

test('CRT and sound default to on, the screenshot is curved, and CRT toggles back exactly', async ({
  page,
}) => {
  await run(page, 'function tick() { cls(7) }');
  await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'CRT', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Sound', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(await pixel(page)).toEqual([0, 0, 0, 255]);
  expect((await pixel(page, 320, 288))[0]).toBeGreaterThan(100);
  const curved = await page.locator('#display').evaluate((canvas) => canvas.toDataURL());
  await page.getByRole('button', { name: 'CRT', exact: true }).click();
  const before = await page.locator('#display').evaluate((canvas) => canvas.toDataURL());
  expect(await pixel(page)).toEqual([220, 245, 255, 255]);
  expect(curved).not.toBe(before);
  await page.getByRole('button', { name: 'CRT', exact: true }).click();
  expect(await page.locator('#display').evaluate((canvas) => canvas.toDataURL())).toBe(curved);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Screenshot', exact: false }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('playload.png');
  const stream = await download.createReadStream(),
    chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  expect(Buffer.concat(chunks).toString('base64')).toBe(curved.split(',')[1]);
  await page.getByRole('button', { name: 'CRT', exact: true }).click();
  expect(await page.locator('#display').evaluate((canvas) => canvas.toDataURL())).toBe(before);
});

test('the first Run unlocks audio for both a click and the keyboard shortcut', async ({ page }) => {
  await page.addInitScript(() => {
    const Context = window.AudioContext;
    window.gameAudioContexts = [];
    window.AudioContext = class extends Context {
      constructor(...args) {
        super(...args);
        window.gameAudioContexts.push(this);
      }
    };
  });
  for (const method of ['click', 'shortcut']) {
    await page.goto('/');
    await page.locator('#editor').fill('play(0, "V15O5N9a))");\nfunction tick() { cls(0); }');
    if (method === 'click') await page.locator('#run').click();
    else await page.keyboard.press('ControlOrMeta+Enter');
    await expect(page.locator('#pause')).toBeEnabled();
    await expect
      .poll(() => page.evaluate(() => window.gameAudioContexts.map((context) => context.state)))
      .toEqual(['running']);
    await expect
      .poll(() => page.evaluate(() => window.gameAudioContexts[0].currentTime))
      .toBeGreaterThan(0);
  }
});

test('the serialized synthesizer runs in a real AudioWorklet and mute leaves capture audio connected', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { Sound } = await import('/src/runtime.js');
    const { compileScore } = await import('/src/sound.js');
    const errors = [],
      sound = new Sound((error) => errors.push(error));
    sound.play([{ ch: 0, score: compileScore('O5V15N9a))') }]);
    await sound.init();
    await sound.context.resume();
    const analyser = sound.context.createAnalyser();
    analyser.fftSize = 2048;
    sound.node.connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    const active = await new Promise((resolve) => {
      let tries = 0;
      const poll = () => {
        analyser.getFloatTimeDomainData(data);
        if (data.some((value) => Math.abs(value) > 0.01)) resolve(true);
        else if (++tries === 100) resolve(false);
        else setTimeout(poll, 10);
      };
      poll();
    });
    sound.mute(true);
    const muted = await new Promise((resolve) => {
      const deadline = performance.now() + 1000;
      const poll = () => {
        if (sound.monitor.gain.value < 0.001) resolve(true);
        else if (performance.now() > deadline) resolve(false);
        else setTimeout(poll, 5);
      };
      poll();
    });
    const result = {
      active,
      muted,
      tracks: sound.destination.stream.getAudioTracks().length,
      queued: sound.queue.length,
      errors,
    };
    await sound.context.close();
    return result;
  });
  expect(result).toEqual({ active: true, muted: true, tracks: 1, queued: 0, errors: [] });
});

test('an error during sound initialization cannot start a recording after the game stops', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Context = window.AudioContext;
    window.AudioContext = class extends Context {
      constructor(...args) {
        super(...args);
        const addModule = this.audioWorklet.addModule.bind(this.audioWorklet);
        this.audioWorklet.addModule = async (...args) => {
          await new Promise((resolve) => {
            window.finishSoundInit = resolve;
          });
          return addModule(...args);
        };
      }
    };
    const Node = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends Node {
      constructor(...args) {
        super(...args);
        window.soundReady = true;
      }
    };
    window.recordingStarts = 0;
    const start = MediaRecorder.prototype.start;
    MediaRecorder.prototype.start = function (...args) {
      window.recordingStarts++;
      return start.apply(this, args);
    };
  });
  await run(
    page,
    'let frame = 0; function tick() { if (frame++ === 1) throw new Error("Early error"); cls(4) }',
  );
  await expect(page.locator('#error')).toContainText('Early error');
  await page.evaluate(() => window.finishSoundInit());
  await expect.poll(() => page.evaluate(() => !!window.soundReady)).toBe(true);
  expect(await page.evaluate(() => window.recordingStarts)).toBe(0);
  await expect(page.locator('#record')).toBeDisabled();
  await page.locator('#editor').fill('function tick() { cls(4) }');
  await page.locator('#run').click();
  await expect.poll(() => page.evaluate(() => window.recordingStarts)).toBe(1);
  await expect(page.locator('#error-notice')).toBeHidden();
});

test('compact desktop controls remain reachable through editing, play and breakpoint changes', async ({
  page,
}) => {
  for (const [width, height] of [
    [800, 600],
    [375, 350],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await expect(page.locator('#tools-toggle')).toBeVisible();
    await expect(page.locator('.touch')).toBeHidden();
    if (width < 600) {
      await expect(page.locator('#start-game')).toHaveText('Click to play');
      await page.locator('#start-game').click();
      await page.locator('#tools-toggle').click();
      await page.locator('#code-toggle').click();
    }
    await page.locator('#editor').fill('function tick() { cls(btn(4) ? 3 : 4) }');
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(page.locator('#screen')).toBeFocused();
    await page.locator('#tools-toggle').click();
    await page.locator('#crt').click();
    const menu = await page.locator('#workspace-toolbar').boundingBox();
    expect(menu.y).toBeGreaterThanOrEqual(0);
    expect(menu.y + menu.height).toBeLessThanOrEqual(height);
    await expect(page.locator('#tools-toggle')).toHaveAttribute('aria-expanded', 'true');
    await page.locator('#tools-toggle').click();
    await page.locator('#screen').click();
    await page.keyboard.down('z');
    await expect.poll(() => pixel(page)).toEqual([215, 115, 85, 255]);
    await page.keyboard.up('z');
    await page.keyboard.press('Alt+KeyP');
    await expect(page.locator('#editor')).toBeFocused();
    await page.keyboard.press('Alt+KeyP');
    await expect(page.locator('#screen')).toBeFocused();
  }
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.locator('#tools-toggle').click();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator('#tools-toggle')).toBeHidden();
  await expect(page.locator('#workspace-toolbar')).toBeVisible();
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.locator('#tools-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#workspace-toolbar')).toBeHidden();
});

test('a failed New clip reports the video error without stopping the game and Run can retry', async ({
  page,
}) => {
  await run(page, 'function tick() { cls(btn(5) ? 5 : 4) }', true);
  await expect(page.locator('#record')).toBeEnabled();
  await expect.poll(() => pixel(page)).toEqual([80, 140, 215, 255]);
  await page.evaluate(() => {
    const start = MediaRecorder.prototype.start;
    MediaRecorder.prototype.start = function () {
      MediaRecorder.prototype.start = start;
      throw new DOMException('Encoder unavailable', 'NotSupportedError');
    };
  });

  await page.locator('#record').click();
  await expect(page.locator('#status')).toHaveText('Video: Encoder unavailable');
  await expect(page.locator('#record')).toBeDisabled();
  await expect(page.locator('#video')).toBeDisabled();
  await expect(page.locator('#pause')).toBeEnabled();
  await expect(page.locator('#error')).toBeHidden();
  await page.locator('#screen').focus();
  await page.keyboard.down('x');
  await expect.poll(() => pixel(page)).toEqual([100, 185, 100, 255]);
  await page.keyboard.up('x');
  await expect.poll(() => pixel(page)).toEqual([80, 140, 215, 255]);

  await page.locator('#run').click();
  await expect(page.locator('#record')).toBeEnabled();
  await expect(page.locator('#video')).toBeEnabled();
  await expect(page.locator('#status')).toBeEmpty();
});

test('CRT video exports a playable curved frame', async ({ page }) => {
  await run(page, 'function tick() { cls(7) }');
  await expect(page.getByRole('button', { name: 'New clip', exact: false })).toBeEnabled();
  await page.getByRole('button', { name: 'New clip', exact: false }).click();
  // A media export check needs a real interval of recorded frames/audio.
  await page.waitForTimeout(1200);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save video', exact: false }).click();
  const download = await pending,
    chunks = [],
    stream = await download.createReadStream();
  for await (const chunk of stream) chunks.push(chunk);
  expect(download.suggestedFilename()).toBe('playload.webm');
  const bytes = [...Buffer.concat(chunks)];
  const result = await page.evaluate(async (bytes) => {
    const video = document.createElement('video'),
      url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'video/webm' }));
    video.muted = true;
    video.style.cssText = 'position: fixed; right: 0; bottom: 0; width: 160px';
    document.body.append(video);
    try {
      await new Promise((resolve, reject) => {
        video.onloadeddata = resolve;
        video.onerror = () => reject(new Error('Exported video could not be decoded'));
        video.src = url;
        video.load();
      });
      await video.play();
      await new Promise((resolve) => video.requestVideoFrameCallback(resolve));
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0);
      return {
        width: canvas.width,
        height: canvas.height,
        duration: video.duration,
        corner: [...ctx.getImageData(0, 0, 1, 1).data],
        center: [...ctx.getImageData(320, 288, 1, 1).data],
      };
    } finally {
      video.pause();
      video.removeAttribute('src');
      video.load();
      video.remove();
      URL.revokeObjectURL(url);
    }
  }, bytes);
  expect(result.width).toBe(640);
  expect(result.height).toBe(576);
  expect(result.duration).toBeGreaterThan(0.5);
  expect(result.corner.slice(0, 3).every((value) => value < 10)).toBe(true);
  expect(result.center[0]).toBeGreaterThan(100);
});

test('the shared chiptune demo exports audible music while speaker monitoring is muted', async ({
  page,
}) => {
  const source = await readFile(new URL('../../examples/chiptune.js', import.meta.url), 'utf8');
  await page.goto('/');
  const hash = await page.evaluate(
    async (source) => (await (await import('/src/payload.js')).encode(source)).hash,
    source,
  );
  await page.goto('/' + hash);
  await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
  await page.locator('#screen').click();
  await page.getByRole('button', { name: 'Sound', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sound', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.getByRole('button', { name: 'New clip', exact: false }).click();
  // A media export check needs a real interval of recorded frames/audio.
  await page.waitForTimeout(1200);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save video', exact: false }).click();
  const download = await pending,
    chunks = [],
    stream = await download.createReadStream();
  for await (const chunk of stream) chunks.push(chunk);
  const result = await page.evaluate(
    async (bytes) => {
      const context = new AudioContext();
      try {
        const audio = await context.decodeAudioData(new Uint8Array(bytes).buffer);
        const samples = audio.getChannelData(0);
        let energy = 0;
        for (const value of samples) energy += value * value;
        return { duration: audio.duration, rms: Math.sqrt(energy / samples.length) };
      } finally {
        await context.close();
      }
    },
    [...Buffer.concat(chunks)],
  );
  expect(result.duration).toBeGreaterThan(0.5);
  expect(result.rms).toBeGreaterThan(0.005);
});

test('video keeps the latest ten seconds with continuous sound and advances after saving', async ({
  page,
}, testInfo) => {
  await run(
    page,
    'let frame = 0; play(0, "V15O5N9a))"); function tick() { cls(Math.floor(frame++ / 60) % 8); }',
    true,
  );
  await expect(page.locator('#pause')).toBeEnabled();
  await page.getByRole('button', { name: 'New clip', exact: false }).click();
  // Cross the rolling limit and several recorder flushes.
  await page.waitForTimeout(13350);
  const recordings = [];
  for (const name of ['rolling.webm', 'rolling-continued.webm']) {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save video', exact: false }).click();
    const download = await pending;
    await download.saveAs(testInfo.outputPath(name));
    const chunks = [];
    for await (const chunk of await download.createReadStream()) chunks.push(chunk);
    const result = await page.evaluate(
      async (bytes) => {
        const context = new AudioContext(),
          video = document.createElement('video'),
          buffer = new Uint8Array(bytes).buffer,
          url = URL.createObjectURL(new Blob([buffer], { type: 'video/webm' }));
        video.muted = true;
        // WebKit can skip presentation callbacks for a detached video.
        video.style.cssText = 'position: fixed; right: 0; bottom: 0; width: 160px';
        document.body.append(video);
        try {
          const audio = await context.decodeAudioData(buffer.slice(0)),
            samples = audio.getChannelData(0),
            window = Math.round(audio.sampleRate * 0.02);
          let minimumRMS = Infinity;
          // Exclude codec start/end padding; a sustained tone must span every join.
          for (let start = window * 5; start + window * 5 < samples.length; start += window) {
            let energy = 0;
            for (let i = start; i < start + window; i++) energy += samples[i] * samples[i];
            minimumRMS = Math.min(minimumRMS, Math.sqrt(energy / window));
          }
          await new Promise((resolve, reject) => {
            video.onloadeddata = resolve;
            video.onerror = () => reject(new Error('Exported video could not be decoded'));
            video.src = url;
            video.load();
          });
          await video.play();
          await new Promise((resolve) => video.requestVideoFrameCallback(resolve));
          video.pause();
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(video, 0, 0);
          return {
            duration: video.duration,
            audioDuration: audio.duration,
            minimumRMS,
            firstColor: [...ctx.getImageData(320, 240, 1, 1).data],
          };
        } finally {
          await context.close();
          video.removeAttribute('src');
          video.load();
          video.remove();
          URL.revokeObjectURL(url);
        }
      },
      [...Buffer.concat(chunks)],
    );
    // WebKit emits keyframes about two seconds apart, despite the one-second hint.
    expect(result.duration).toBeGreaterThan(7.8);
    expect(result.duration).toBeLessThanOrEqual(10.1);
    expect(Math.abs(result.audioDuration - result.duration)).toBeLessThan(0.25);
    expect(result.minimumRMS).toBeGreaterThan(0.001);
    recordings.push(result);
    if (recordings.length === 1) {
      await page.getByRole('tab', { name: 'Info', exact: true }).click();
      await page.waitForTimeout(500);
      await page.getByRole('tab', { name: 'Play', exact: true }).click();
      await page.waitForTimeout(2200);
    }
  }
  expect(recordings[1].firstColor).not.toEqual(recordings[0].firstColor);
});

test('the CRT shader reconstructs glowing phosphors while retaining black and a readable white level', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createCRT } = await import('/src/crt.js'),
      { palette } = await import('/src/engine.js');
    const renderer = createCRT(palette);
    if (!renderer) return { available: false };
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 576;
    const ctx = canvas.getContext('2d'),
      pixels = new Uint8Array(160 * 144);
    const read = () => {
      ctx.drawImage(renderer.canvas, 0, 0);
      return ctx.getImageData(0, 0, 640, 576).data;
    };
    pixels[72 * 160 + 80] = 7;
    renderer.render(pixels);
    const dot = read();
    let glow = 0,
      peak = 0;
    for (let y = 280; y < 301; y++)
      for (let x = 312; x < 333; x++) {
        const value = dot[(y * 640 + x) * 4];
        peak = Math.max(peak, value);
        if (x < 320 || x > 324 || y < 288 || y > 292) glow = Math.max(glow, value);
      }
    pixels.fill(7);
    renderer.render(pixels);
    const white = read();
    let total = 0;
    for (let y = 200; y < 376; y++)
      for (let x = 200; x < 440; x++) total += white[(y * 640 + x) * 4];
    const average = total / (176 * 240);
    const sample = (offset) => [...white.slice(offset, offset + 3)];
    const stripes = [0, 1, 2].map((dx) => sample((288 * 640 + 300 + dx) * 4));
    pixels.fill(0);
    renderer.render(pixels);
    const black = read();
    return {
      available: true,
      peak,
      glow,
      average,
      stripes,
      black: black.every((value, index) => value === (index % 4 === 3 ? 255 : 0)),
    };
  });
  expect(result.available).toBe(true);
  expect(result.peak).toBeGreaterThan(150);
  expect(result.glow).toBeGreaterThan(5);
  expect(result.average).toBeGreaterThan(190);
  expect(result.average).toBeLessThan(250);
  expect(result.stripes.some(([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b) > 5)).toBe(true);
  expect(result.black).toBe(true);
});

test('CRT retains a usable captured picture when WebGL is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return type === 'webgl' ? null : getContext.call(this, type, ...args);
    };
  });
  await run(page, 'function tick() { cls(7) }');
  await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
  expect(await pixel(page)).toEqual([0, 0, 0, 255]);
  expect((await pixel(page, 320, 288))[0]).toBeGreaterThan(100);
  await page.getByRole('button', { name: 'CRT', exact: true }).click();
  expect(await pixel(page)).toEqual([220, 245, 255, 255]);
});

test.describe('touch player', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 375, height: 812 } });
  test('editing, running and returning to play retain the source and visible controls', async ({
    page,
  }) => {
    const source = `// @title Tap test
let color = 4;

function tick() {
  if (btnp(4)) color = 6;
  cls(color);
}
`;
    for (const [width, height] of [
      [375, 568],
      [568, 320],
      [844, 390],
      [768, 1024],
      [1024, 768],
    ]) {
      await page.setViewportSize({ width, height });
      await page.goto('/');
      await page.locator('#tools-toggle').tap();
      await page.locator('#code-toggle').tap();
      const editor = page.locator('#editor');
      await expect(editor).toBeFocused();
      await editor.fill(source);
      await expect(page).toHaveTitle('Tap test — Playload');
      await expect
        .poll(() =>
          page.evaluate(async () => {
            if (!location.hash) return null;
            return (await import('/src/payload.js')).decode(location.hash);
          }),
        )
        .toBe(source);

      await page.locator('#tools-toggle').tap();
      await page.locator('#crt').tap();
      const menu = await page.locator('#workspace-toolbar').boundingBox();
      expect(menu.y).toBeGreaterThanOrEqual(0);
      expect(menu.y + menu.height).toBeLessThanOrEqual(height);
      await expect(page.locator('#tools-toggle')).toHaveAttribute('aria-expanded', 'true');
      await page.locator('#run').tap();
      await expect(page.locator('#screen')).toBeFocused();
      await expect(page.locator('#start-game')).toBeHidden();
      await expect.poll(() => pixel(page)).toEqual([80, 140, 215, 255]);
      for (const control of await page.locator('[data-input], #pause').all()) {
        const bounds = await control.boundingBox();
        expect(bounds.y).toBeGreaterThanOrEqual(0);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(height);
      }
      await page.locator('[data-input="4"]').tap();
      await expect.poll(() => pixel(page)).toEqual([230, 200, 110, 255]);

      await page.locator('#pause').tap();
      await expect(editor).toBeFocused();
      await expect(page.locator('#pause')).toContainText('Resume');
      expect((await editor.boundingBox()).y).toBeGreaterThanOrEqual(0);
      const pausedImage = await page.locator('#display').evaluate((canvas) => canvas.toDataURL());
      await page.locator('#tools-toggle').tap();
      await page.locator('#tools-toggle').tap();
      await expect(page.locator('#pause')).toContainText('Resume');
      expect(await page.locator('#display').evaluate((canvas) => canvas.toDataURL())).toBe(
        pausedImage,
      );
      await page.locator('#pause').tap();
      await expect(page.locator('#screen')).toBeFocused();
      await expect.poll(() => pixel(page)).toEqual([230, 200, 110, 255]);

      await page.locator('#tools-toggle').tap();
      await page.locator('#code-toggle').tap();
      await expect(editor).toBeHidden();
      await expect(page.locator('#screen')).toBeFocused();
      await page.locator('#info-tab').tap();
      await page.locator('#code-tab').tap();
      await expect(editor).toHaveValue(source);
      await expect(editor).toBeHidden();
      await expect(page.locator('#screen')).toBeFocused();
      await expect.poll(() => pixel(page)).toEqual([230, 200, 110, 255]);
    }
  });
  test('an error on the first tick is revealed and its line returns to visible editing', async ({
    page,
  }) => {
    for (const [width, height] of [
      [375, 568],
      [375, 350],
      [568, 320],
      [768, 1024],
    ]) {
      await page.setViewportSize({ width, height });
      await page.goto('/');
      await page.locator('#tools-toggle').tap();
      await page.locator('#code-toggle').tap();
      await page
        .locator('#editor')
        .fill('// Context\n'.repeat(60) + 'function tick() {\n  throw new Error("First tick");\n}');
      await page.locator('#tools-toggle').tap();
      await page.locator('#run').tap();
      await expect(page.locator('#error')).toContainText('First tick');
      await expect(page.locator('#screen')).toBeFocused();
      const notice = await page.locator('#error-notice').boundingBox();
      expect(notice.y).toBeGreaterThanOrEqual(0);
      expect(notice.y + notice.height).toBeLessThanOrEqual(height);
      await page.locator('#error-line').tap();
      await expect(page.locator('#editor')).toBeFocused();
      expect((await page.locator('#editor').boundingBox()).y).toBeGreaterThanOrEqual(0);
      const line = await page.locator('#editor').evaluate((editor) => {
        const style = getComputedStyle(editor),
          height = parseFloat(style.lineHeight),
          index = editor.value.slice(0, editor.selectionStart).split('\n').length - 1,
          top =
            editor.getBoundingClientRect().top +
            parseFloat(style.paddingTop) +
            index * height -
            editor.scrollTop;
        return { top, bottom: top + height };
      });
      expect(line.top).toBeGreaterThanOrEqual(0);
      expect(line.bottom).toBeLessThanOrEqual(height);
      await page.locator('#editor').fill('function tick() { cls(7) }');
      await page.locator('#tools-toggle').tap();
      await page.locator('#run').tap();
      await expect(page.locator('#error-notice')).toBeHidden();
      await expect(page.locator('#pause')).toBeEnabled();
      await expect(page.locator('#screen')).toBeFocused();
    }
  });
  test('shared games wait on the first frame, then the first tap starts sound and play', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const Node = window.AudioWorkletNode;
      window.AudioWorkletNode = class extends Node {
        constructor(context, ...args) {
          super(context, ...args);
          window.gameAnalyser = context.createAnalyser();
          this.connect(window.gameAnalyser);
        }
      };
    });
    await page.goto('/');
    const hash = await page.evaluate(async () => {
      const { encode } = await import('/src/payload.js');
      return (
        await encode(
          'let frames = 0; play(0, "T240O5N3c))"); function tick() { cls(0); put(1, 1, String(frames++)); }',
        )
      ).hash;
    });
    const sound = () =>
      page.evaluate(() => {
        if (!window.gameAnalyser) return -1;
        const samples = new Float32Array(window.gameAnalyser.fftSize);
        window.gameAnalyser.getFloatTimeDomainData(samples);
        return Math.max(...samples.map(Math.abs));
      });
    for (const [width, height, selector] of [
      [375, 812, '#start-game'],
      [375, 812, '[data-input="4"]'],
      [768, 1024, '#start-game'],
      [1024, 768, '[data-input="4"]'],
    ]) {
      await page.setViewportSize({ width, height });
      await page.goto('/');
      await page.goto('/' + hash);
      await expect(page.locator('#start-game')).toBeVisible();
      await expect.poll(sound).toBe(0);
      const preview = await page.locator('#display').evaluate((canvas) => canvas.toDataURL());
      await page.waitForTimeout(200);
      expect(await page.locator('#display').evaluate((canvas) => canvas.toDataURL())).toBe(preview);
      await expect(page.locator('#workspace-toolbar')).toBeHidden();
      await expect(page.locator('#pause')).toBeDisabled();
      await page.locator(selector).tap();
      await expect(page.locator('#start-game')).toBeHidden();
      await expect(page.locator('#pause')).toBeEnabled();
      await expect.poll(sound).toBeGreaterThan(0.001);
      await expect
        .poll(() => page.locator('#display').evaluate((canvas) => canvas.toDataURL()))
        .not.toBe(preview);
    }
  });
  test('portrait and landscape players fit all controls without page scrolling', async ({
    page,
  }) => {
    for (const [width, height] of [
      [320, 568],
      [375, 560],
      [375, 350],
      [375, 667],
      [390, 844],
      [844, 390],
      [667, 375],
      [568, 320],
      [768, 1024],
      [820, 1180],
      [1024, 768],
      [1180, 820],
      [1024, 1366],
      [1366, 1024],
    ]) {
      await page.setViewportSize({ width, height });
      await page.goto('/');
      await expect(page.locator('#start-game')).toBeVisible();
      await expect(page.locator('#editor')).toBeHidden();
      await expect(page.locator('#pause kbd')).toBeHidden();
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(
        height,
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      for (const selector of ['#screen', '#pause', '[data-input]']) {
        const bounds = await page.locator(selector).evaluateAll((elements) =>
          elements.map((element) => {
            const r = element.getBoundingClientRect();
            return {
              left: r.left,
              top: r.top,
              right: r.right,
              bottom: r.bottom,
              width: r.width,
              height: r.height,
            };
          }),
        );
        for (const r of bounds) {
          expect(r.left).toBeGreaterThanOrEqual(0);
          expect(r.top).toBeGreaterThanOrEqual(0);
          expect(r.right).toBeLessThanOrEqual(width);
          expect(r.bottom).toBeLessThanOrEqual(height);
          expect(Math.min(r.width, r.height)).toBeGreaterThanOrEqual(48);
        }
      }
      const up = await page.locator('[data-input="0"]').boundingBox();
      const down = await page.locator('[data-input="1"]').boundingBox();
      const left = await page.locator('[data-input="2"]').boundingBox();
      const right = await page.locator('[data-input="3"]').boundingBox();
      expect(up.x).toBe(down.x);
      expect(left.y).toBe(right.y);
      expect(up.y + up.height).toBe(left.y);
      expect(left.y + left.height).toBe(down.y);
      await page.locator('#tools-toggle').tap();
      await expect(page.locator('#workspace-toolbar')).toBeVisible();
      const menu = await page.locator('#workspace-toolbar').boundingBox();
      expect(menu.x + menu.width).toBeLessThanOrEqual(width);
      expect(menu.y + menu.height).toBeLessThanOrEqual(height);
    }
  });
  test('tools, Info, pause and rotation retain the game and its prior pause state', async ({
    page,
  }) => {
    await page.goto('/');
    const hash = await page.evaluate(async () => {
      const { encode } = await import('/src/payload.js');
      return (
        await encode('let frames = 0; function tick() { cls(0); put(1, 1, String(frames++)); }')
      ).hash;
    });
    await page.goto('/' + hash);
    await page.locator('#start-game').tap();
    await page.locator('#pause').tap();
    // Let the worker's already requested frame finish before comparing frozen pictures.
    await page.waitForTimeout(100);
    const frozen = await page.locator('#display').evaluate((canvas) => canvas.toDataURL());
    await page.locator('#tools-toggle').tap();
    await page.locator('#tools-toggle').tap();
    await page.getByRole('tab', { name: 'Info', exact: true }).tap();
    await page.getByRole('tab', { name: 'Play', exact: true }).tap();
    await page.setViewportSize({ width: 812, height: 375 });
    await page.waitForTimeout(200);
    expect(await page.locator('#display').evaluate((canvas) => canvas.toDataURL())).toBe(frozen);
    await expect(page.locator('#pause')).toContainText('Resume');
    await page.locator('#pause').tap();
    await expect
      .poll(() => page.locator('#display').evaluate((canvas) => canvas.toDataURL()))
      .not.toBe(frozen);
    await page.locator('#tools-toggle').tap();
    await page.waitForTimeout(100);
    const inTools = await page.locator('#display').evaluate((canvas) => canvas.toDataURL());
    await page.waitForTimeout(200);
    expect(await page.locator('#display').evaluate((canvas) => canvas.toDataURL())).toBe(inTools);
    await page.locator('#tools-toggle').tap();
    await expect
      .poll(() => page.locator('#display').evaluate((canvas) => canvas.toDataURL()))
      .not.toBe(inTools);
    expect(new URL(page.url()).hash).toBe(hash);
  });
  test('video can be saved from the phone tools while recording is temporarily paused', async ({
    page,
  }) => {
    await page.goto('/');
    const supported = await page.evaluate(
      () =>
        typeof MediaRecorder !== 'undefined' &&
        ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus'].some((type) =>
          MediaRecorder.isTypeSupported(type),
        ),
    );
    test.skip(!supported, 'This browser does not support the WebM recording format.');
    await page.locator('#start-game').tap();
    await page.waitForTimeout(1200);
    await page.locator('#tools-toggle').tap();
    await expect(page.locator('#video')).toBeEnabled();
    const pending = page.waitForEvent('download');
    await page.locator('#video').tap();
    const download = await pending;
    expect(download.suggestedFilename()).toBe('playload.webm');
    const chunks = [];
    for await (const chunk of await download.createReadStream()) chunks.push(chunk);
    expect(Buffer.concat(chunks).byteLength).toBeGreaterThan(1000);
    await expect(page.locator('#workspace-toolbar')).toBeVisible();
    await page.locator('#tools-toggle').tap();
    await expect(page.locator('#pause')).toContainText('Pause');
  });
  test('a loaded phone game closes tools and receives game focus', async ({ page }) => {
    await page.addInitScript(() => {
      delete window.showOpenFilePicker;
    });
    await page.goto('/');
    await page.locator('#tools-toggle').tap();
    const pending = page.waitForEvent('filechooser');
    await page.locator('#load').tap();
    await (
      await pending
    ).setFiles({
      name: 'game.js',
      mimeType: 'text/javascript',
      buffer: Buffer.from('function tick() { cls(btn(4) ? 5 : 0); }'),
    });
    await expect(page.locator('#workspace-toolbar')).toBeHidden();
    await expect(page.locator('#screen')).toBeFocused();
    await expect(page.locator('#pause')).toBeEnabled();
    await page.locator('[data-input="4"]').tap();
    await expect(page.locator('#error')).toBeHidden();
  });
  test('direction and action touches work together and rotation releases a held direction', async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName !== 'chromium',
      'Multiple held touch contacts require the Chromium input protocol.',
    );
    await page.goto('/');
    const hash = await page.evaluate(async () => {
      const { encode } = await import('/src/payload.js');
      return (await encode('function tick() { cls(Number(btn(3)) + 2 * Number(btn(4))); }')).hash;
    });
    await page.goto('/' + hash);
    await page.locator('#start-game').tap();
    await page.locator('#tools-toggle').tap();
    await page.locator('#crt').tap();
    await page.locator('#tools-toggle').tap();
    const session = await page.context().newCDPSession(page);
    const contact = async (selector, id) => {
      const bounds = await page.locator(selector).boundingBox();
      return { id, x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    };
    const right = await contact('[data-input="3"]', 0);
    const action = await contact('[data-input="4"]', 1);
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [right, action],
    });
    await expect.poll(() => pixel(page)).toEqual([215, 115, 85, 255]);
    for (const selector of ['[data-input="3"]', '[data-input="4"]']) {
      await expect(page.locator(selector)).toHaveCSS('background-color', 'rgb(230, 200, 110)');
      await expect(page.locator(selector)).toHaveCSS('color', 'rgb(33, 28, 41)');
    }
    const left = await contact('[data-input="2"]', 0);
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [left, action],
    });
    await expect.poll(() => pixel(page)).toEqual([100, 105, 100, 255]);
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => pixel(page)).toEqual([0, 0, 0, 255]);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [right] });
    await expect.poll(() => pixel(page)).toEqual([85, 65, 95, 255]);
    const pause = await contact('#pause', 1);
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [right, pause],
    });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [pause] });
    await expect(page.locator('#pause')).toContainText('Resume');
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [right, pause],
    });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [pause] });
    await expect(page.locator('#pause')).toContainText('Pause');
    await expect.poll(() => pixel(page)).toEqual([0, 0, 0, 255]);
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [right] });
    const info = await contact('#info-tab', 1);
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [right, info],
    });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [info] });
    await expect(page.locator('body')).toHaveAttribute('data-view', 'info');
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.locator('#code-tab').tap();
    await expect.poll(() => pixel(page)).toEqual([0, 0, 0, 255]);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [right] });
    await expect.poll(() => pixel(page)).toEqual([85, 65, 95, 255]);
    await page.setViewportSize({ width: 812, height: 375 });
    await expect.poll(() => pixel(page)).toEqual([0, 0, 0, 255]);
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await session.detach();
    expect(await page.evaluate(() => scrollY)).toBe(0);
  });
  test('game controls and screen clicks preserve page position when the screen is partly outside it', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 350 });
    await page.goto('/');
    await page.locator('#tools-toggle').tap();
    await page.locator('#code-toggle').click();
    await page
      .locator('#editor')
      .fill('let presses = 0; function tick() { if (btnp(0)) presses++; cls(presses ? 3 : 4) }');
    await page.locator('#tools-toggle').tap();
    await page.locator('#run').click();
    await expect(page.locator('#screen')).toBeFocused();
    await page.locator('#tools-toggle').tap();
    await page.locator('#crt').click();
    await page.locator('#tools-toggle').tap();
    const up = page.locator('[data-input="0"]');
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await up.scrollIntoViewIfNeeded();
    const position = await page.evaluate(() => scrollY);
    expect((await page.locator('#screen').boundingBox()).y).toBeLessThan(0);

    await up.tap();
    await expect.poll(() => pixel(page)).toEqual([215, 115, 85, 255]);
    expect(await page.evaluate(() => scrollY)).toBe(position);
    await expect(page.locator('#screen')).toBeFocused();
    for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
      await page.keyboard.press(key);
      await page.keyboard.press(key);
    }
    expect(await page.evaluate(() => scrollY)).toBe(position);

    await page.locator('#editor').evaluate((editor) => editor.focus({ preventScroll: true }));
    const screen = await page.locator('#screen').boundingBox();
    await page.mouse.click(screen.x + 50, 50);
    await expect(page.locator('#screen')).toBeFocused();
    expect(await page.evaluate(() => scrollY)).toBe(position);
  });
  test('CRT and touch input work in the phone player layout', async ({ page }) => {
    await page.goto('/');
    const hash = await page.evaluate(async () => {
      const { encode } = await import('/src/payload.js');
      return (await encode('let color = 7; function tick() { if(btnp(4)) color = 6; cls(color) }'))
        .hash;
    });
    await page.goto('/' + hash);
    await expect(page.locator('#editor')).toBeHidden();
    await expect(page.locator('#code-toggle')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#start-game')).toBeVisible();
    await expect(page.locator('#pause')).toBeDisabled();
    expect(await pixel(page)).toEqual([0, 0, 0, 255]);
    const display = await page.locator('#display').boundingBox();
    expect(display.width).toBeLessThanOrEqual(375);
    await page.locator('[data-input="4"]').tap();
    await expect(page.locator('#start-game')).toBeHidden();
    await expect(page.locator('#pause')).toBeEnabled();
    await expect.poll(async () => (await pixel(page, 320, 288))[2]).toBeLessThan(130);
  });
  test('touch action rows stay aligned and error text and its edit button fit', async ({
    page,
  }) => {
    for (const [width, height] of [
      [375, 812],
      [320, 568],
      [844, 390],
      [812, 375],
    ]) {
      await page.setViewportSize({ width, height });
      await page.goto('/');
      await page.locator('#tools-toggle').tap();
      await expect(page.locator('#screenshot')).toHaveAccessibleName('Screenshot');
      if ((await page.locator('#code-toggle').getAttribute('aria-pressed')) === 'false')
        await page.locator('#code-toggle').click();
      await page
        .locator('#editor')
        .fill('function tick() {\n throw new Error("Test error: readable without clipping")\n}');
      await page.locator('#tools-toggle').tap();
      await page.locator('#run').click();
      await expect(page.locator('#error')).toContainText('Test error');
      await page.locator('#tools-toggle').tap();
      await page.locator('#code-toggle').click();
      const viewport = await page.locator('#viewport').boundingBox();
      const notice = await page.locator('#error-notice').boundingBox();
      expect(notice.x).toBeGreaterThanOrEqual(viewport.x);
      expect(notice.x + notice.width).toBeLessThanOrEqual(viewport.x + viewport.width);
      await expect(page.locator('#screen')).toBeVisible();
      const button = await page.locator('#error-line').boundingBox();
      expect(button.x).toBeGreaterThanOrEqual(viewport.x);
      expect(button.x + button.width).toBeLessThanOrEqual(viewport.x + viewport.width);
      const visible = notice;
      expect(button.y).toBeGreaterThanOrEqual(visible.y);
      expect(button.y + button.height).toBeLessThanOrEqual(visible.y + visible.height);
      expect(button.y + button.height).toBeLessThanOrEqual(viewport.y + viewport.height);
      await page.locator('#error-line').click();
      await expect(page.locator('#editor')).toBeFocused();
    }
  });
});

test('the starter reaches every screen edge and keeps collecting gems with short sounds', async ({
  page,
}) => {
  await page.goto('/');
  const source = await page.locator('#editor').inputValue();
  const result = await page.evaluate(async (source) => {
    const { createEngine } = await import('/src/engine.js');
    const { glyphs } = await import('/src/glyphs.js');
    const { compileScore } = await import('/src/sound.js');
    const overlaps = [];
    for (const [dx, dy] of [
      [7, 0],
      [6, 0],
      [-6, 0],
      [0, 6],
      [0, -6],
      [5, 0],
      [-5, 0],
      [0, 5],
      [0, -5],
      [5, 5],
      [-5, -5],
    ]) {
      const probe = createEngine(glyphs, compileScore);
      const game = new Function(
        ...Object.keys(probe.api),
        'dx',
        'dy',
        source + '\nx = gx * 8 + dx; y = gy * 8 + dy; return {tick,count:()=>gems};',
      )(...Object.values(probe.api), dx, dy);
      probe.step(game.tick);
      overlaps.push(game.count());
    }
    const repeatEngine = createEngine(glyphs, compileScore);
    const repeatMath = Object.create(Math);
    const repeatRandom = [0.7, 0.375, 0, 0];
    let repeatDraws = 0;
    repeatMath.random = () => repeatRandom[repeatDraws++ % repeatRandom.length];
    const repeatGame = new Function(
      ...Object.keys(repeatEngine.api),
      'Math',
      source + '\nx = gx * 8; y = gy * 8; return {tick,state:()=>({gx,gy,gems})};',
    )(...Object.values(repeatEngine.api), repeatMath);
    repeatEngine.step(repeatGame.tick);
    const sameSpot = repeatGame.state();
    const firstDraws = repeatDraws;
    repeatEngine.step(repeatGame.tick);
    const nextSpot = repeatGame.state();
    const engine = createEngine(glyphs, compileScore);
    const math = Object.create(Math);
    const random = [0.25, 0.5, 0.8, 0.75, 0.7, 0.375];
    let next = 0;
    math.random = () => random[next++ % random.length];
    const game = new Function(
      ...Object.keys(engine.api),
      'Math',
      source + '\nreturn {tick,state:()=>({x,y,gx,gy,gems})};',
    )(...Object.values(engine.api), math);
    const step = (mask, frames = 1) => {
      engine.input(mask);
      for (let i = 0; i < frames; i++) engine.step(game.tick);
    };
    step(0);
    const visible = engine.pixels.filter((color) => color === 6).length;
    const initial = game.state();
    const gem = engine.api.scr[8][14].chr;
    step(1 << 0, 200);
    const top = game.state().y;
    step(1 << 3, 200);
    const right = game.state().x;
    step(1 << 1, 200);
    const bottom = game.state().y;
    step(1 << 2, 200);
    const left = game.state().x;
    const before = engine.sounds().length;
    step(1 << 3, 112);
    step(1 << 0, 72);
    const sounds = engine.sounds();
    const message = engine.api.scr[1]
      .map((cell) => cell.chr)
      .join('')
      .trim();
    const collected = game.state();
    const removed = engine.api.scr[8][14].chr;
    step(0, 60);
    const repeats = engine.sounds().length;
    for (let i = 0; i < 9; i++) {
      const target = game.state();
      const dx = target.gx * 8 - target.x;
      step(dx < 0 ? 1 << 2 : 1 << 3, Math.abs(dx));
      const dy = target.gy * 8 - game.state().y;
      step(dy < 0 ? 1 << 0 : 1 << 1, Math.abs(dy));
    }
    const continued = game.state();
    const moreSounds = engine.sounds();
    return {
      overlaps,
      sameSpot,
      firstDraws,
      nextSpot,
      repeatDraws,
      visible,
      initial,
      gem,
      top,
      right,
      bottom,
      left,
      before,
      sounds,
      message,
      collected,
      removed,
      repeats,
      continued,
      moreSounds,
    };
  }, source);
  expect(source.trimEnd().split('\n').length).toBeLessThanOrEqual(40);
  expect(result.overlaps).toEqual([0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1]);
  expect(result.sameSpot).toEqual({ gx: 14, gy: 8, gems: 1 });
  expect(result.firstDraws).toBe(2);
  expect(result.nextSpot).toEqual({ gx: 0, gy: 2, gems: 2 });
  expect(result.repeatDraws).toBe(4);
  expect(result.visible).toBeGreaterThan(0);
  expect(result.initial).toEqual({ x: 76, y: 68, gx: 14, gy: 8, gems: 0 });
  expect(result.gem).toBe('💎');
  expect([result.top, result.right, result.bottom, result.left]).toEqual([0, 152, 136, 0]);
  expect(result.before).toBe(0);
  expect(result.sounds).toHaveLength(1);
  expect(result.sounds[0].ch).toBe(0);
  expect(result.sounds[0].score.code).toContainEqual({ op: 'T', value: 240 });
  const notes = result.sounds[0].score.code.filter((event) => event.op === 'note');
  expect(notes).toHaveLength(2);
  expect(notes.reduce((beats, note) => beats + note.beats, 0) * (60 / 240)).toBe(0.125);
  expect(result.message).toBe('GEMS 1');
  expect(result.collected).toEqual({ x: 112, y: 64, gx: 5, gy: 10, gems: 1 });
  expect(result.removed).toBe(' ');
  expect(result.repeats).toBe(0);
  expect(result.continued.gems).toBe(10);
  expect(result.moreSounds).toHaveLength(9);
});

test('keyboard bindings stay visible in Play without opening code or reference', async ({
  page,
  browser,
}) => {
  await page.goto('/');
  const guide = page.locator('#keyboard-controls');
  await expect(guide).toHaveText('CURSOR: ↑↓←→ / WASDA: Z/J B: X/K');
  await expect(guide).toBeVisible();
  await page.locator('#run').click();
  await expect(page.locator('#pause')).toBeEnabled();
  await page.setViewportSize({ width: 1280, height: 800 });
  const buttons = await page
    .locator('#workspace-toolbar button')
    .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().top));
  expect(Math.max(...buttons) - Math.min(...buttons)).toBeLessThanOrEqual(1);
  await expect(page.locator('#viewport > #keyboard-controls')).toBeVisible();
  await page.locator('#code-toggle').click();
  await expect(page.locator('#editor')).toBeHidden();
  await expect(guide).toBeVisible();
  for (const width of [1400, 1280, 1200, 960, 640]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(guide).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const bounds = await guide.evaluate((element) => {
      const guide = element.getBoundingClientRect(),
        player = element.parentElement.getBoundingClientRect();
      return {
        left: guide.left - player.left,
        right: player.right - guide.right,
        bottom: player.bottom - guide.bottom,
        fits: element.scrollWidth <= element.clientWidth,
      };
    });
    expect(bounds.left).toBeGreaterThanOrEqual(12);
    expect(bounds.right).toBeCloseTo(13, 0);
    expect(bounds.bottom).toBeCloseTo(9, 0);
    expect(bounds.fits).toBe(true);
  }
  await page.locator('#info-tab').click();
  await expect(guide).toBeHidden();
  await page.locator('#code-tab').click();
  await expect(guide).toBeVisible();

  const phone = await browser.newPage({ viewport: { width: 375, height: 800 }, hasTouch: true });
  await phone.goto('http://127.0.0.1:8765/');
  await expect(phone.locator('.touch')).toBeVisible();
  await expect(phone.locator('#keyboard-controls')).toBeHidden();
  await phone.close();
});

test('Play opens first, the static retro logo loads, and the starter runs', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Play' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#code')).toBeVisible();
  await expect(page.locator('#info')).toBeHidden();
  await expect(page.locator('#logo')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Playload on GitHub' })).toHaveAttribute(
    'href',
    'https://github.com/kitao/playload',
  );
  await expect
    .poll(() =>
      page.locator('#logo').evaluate((image) => image.complete && image.naturalWidth === 64),
    )
    .toBe(true);
  await expect(page.getByRole('textbox', { name: 'JavaScript code' })).toHaveValue(
    /spr\(x, y, ['"]👾['"], 6\)/,
  );
  await expect(page.locator('#workspace-toolbar button[title]')).toHaveCount(0);
  const actions = [
    'load',
    'reload',
    'run',
    'pause',
    'code-toggle',
    'crt',
    'sound',
    'screenshot',
    'record',
    'video',
  ];
  const toolbarBounds = async () =>
    Promise.all(actions.map((id) => page.locator('#' + id).boundingBox()));
  const before = await toolbarBounds();
  expect(before.every(Boolean)).toBe(true);
  for (const id of ['reload', 'pause', 'screenshot', 'record', 'video'])
    await expect(page.locator('#' + id)).toBeDisabled();
  for (const id of ['crt', 'sound']) await expect(page.locator('#' + id)).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('develop-initial.png') });
  await page.getByRole('button', { name: 'Run', exact: false }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
  await expect(page.getByRole('alert')).toBeHidden();
  expect(await toolbarBounds()).toEqual(before);
  await expect(page.locator('.game-status, .key-hint')).toHaveCount(0);
  await expect(page.locator('#workspace-toolbar #size')).toBeVisible();
  expect(
    await page
      .locator('#size')
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
  ).toBeGreaterThanOrEqual(16);
  expect(
    await page.locator('#editor').evaluate((element) => getComputedStyle(element).borderRightWidth),
  ).toBe('1px');
  expect(
    await page
      .locator('#viewport')
      .evaluate((element) => getComputedStyle(element).borderLeftWidth),
  ).toBe('1px');
  const bottoms = await page
    .locator('#editor, #divider, #viewport')
    .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().bottom));
  expect(Math.max(...bottoms) - Math.min(...bottoms)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('develop-running.png') });
  await page.setViewportSize({ width: 375, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('develop-phone.png') });
});

test('the reference documents six functions and two variables; every example runs without copy controls', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1710, height: 895 });
  await page.goto('/');
  await page.getByRole('tab', { name: 'Info', exact: true }).click();
  await expect(page.locator('#info')).toBeVisible();
  await expect(page.locator('.api-guide .api-group').nth(0).locator('.api-example')).toHaveCount(6);
  await expect(page.locator('.api-guide .api-group').nth(1).locator('.api-example')).toHaveCount(2);
  await expect(page.locator('.api-guide .api-group').nth(2).locator('.api-example')).toHaveCount(1);
  await expect(page.locator('.example-label')).toHaveCount(0);
  await expect(page.locator('.api-guide dt')).toHaveText([
    'cls(col = 0)',
    'put(cx, cy, str, col1?, col2?)',
    'spr(x, y, chr, col)',
    'btn(id)',
    'btnp(id)',
    'play(ch, str)',
    'pcg[chr]',
    'scr[cy][cx]',
    'tick()',
  ]);
  await expect(page.locator('.score-guide details, .score-guide summary')).toHaveCount(0);
  await expect(page.locator('.score-guide h3')).toHaveText([
    'Notes',
    'Lengths',
    'Tempo',
    'Volume & Envelope',
    'Mixer',
    'Control',
  ]);
  await expect(page.locator('.score-guide')).toContainText('W7');
  await expect(page.locator('#score-heading')).toHaveText('ZX 128 PLAY');
  await page.evaluate(async () => {
    const { compileScore } = await import('/src/sound.js');
    for (const code of document.querySelectorAll('.mml-group dd > code'))
      for (const line of code.textContent.split('\n'))
        compileScore(new Function('return ' + line)());
  });
  await expect(page.locator('.api-guide h3')).toHaveText(['Functions', 'Variables', 'Callback']);
  await expect(page.locator('#api button')).toHaveCount(0);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await page.screenshot({ path: testInfo.outputPath('cheat-sheet-readme.jpg'), quality: 90 });
  const examples = page.locator('#api .api-example');
  for (let i = 0; i < (await examples.count()); i++) {
    const example = examples.nth(i),
      source = await example.locator('code').textContent();
    await page.evaluate(async (source) => {
      const { createEngine } = await import('/src/engine.js');
      const { glyphs } = await import('/src/glyphs.js');
      const { compileScore } = await import('/src/sound.js');
      const engine = createEngine(glyphs, compileScore);
      const tick = new Function(
        ...Object.keys(engine.api),
        source + '\nreturn typeof tick === "function" ? tick : null;',
      )(...Object.values(engine.api));
      if (tick) engine.step(tick);
      if (engine.pixels.some((col) => col > 7)) throw new Error('Invalid example frame');
    }, source);
  }
  for (const width of [1440, 1100, 600, 375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(
      await page
        .locator('.api-guide code')
        .evaluateAll((elements) =>
          elements.every((element) => getComputedStyle(element).whiteSpace === 'pre'),
        ),
    ).toBe(true);
    expect(
      await page
        .locator('.api-guide .api-example')
        .evaluateAll((elements) =>
          elements.every((element) => element.scrollWidth <= element.clientWidth + 1),
        ),
    ).toBe(true);
    const signatureLines = await page
      .locator('.api-guide dt')
      .evaluateAll((elements) =>
        elements.every((element) => getComputedStyle(element).whiteSpace === 'nowrap'),
      );
    expect(signatureLines).toBe(true);
    const exampleLefts = await page
      .locator('.api-guide dd')
      .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().left));
    expect(Math.max(...exampleLefts) - Math.min(...exampleLefts)).toBeLessThanOrEqual(1);
    if (width >= 1100) {
      expect(
        await page
          .locator('.api-guide, .score-guide')
          .evaluateAll((elements) =>
            elements.every((element) => element.scrollWidth <= element.clientWidth + 1),
          ),
      ).toBe(true);
    }
    const mmlExampleLefts = await page
      .locator('.mml-group dd > code')
      .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().left));
    expect(Math.max(...mmlExampleLefts) - Math.min(...mmlExampleLefts)).toBeLessThanOrEqual(1);
    for (const group of ['#views button', '#workspace-toolbar button', '.reference-tabs button']) {
      const widths = await page
        .locator(group)
        .evaluateAll((elements) =>
          elements.map((element) => parseFloat(getComputedStyle(element).width)),
        );
      expect(new Set(widths).size).toBe(1);
    }
    const headerBottoms = await page.evaluate(() => {
      const range = document.createRange(),
        context = document.createElement('canvas').getContext('2d');
      return [
        document.querySelector('#logo').getBoundingClientRect().bottom,
        ...['#info-tab', '#repository'].map((selector) => {
          const element = document.querySelector(selector);
          range.selectNodeContents(element);
          context.font = getComputedStyle(element).font;
          return (
            range.getBoundingClientRect().bottom -
            context.measureText(element.textContent).fontBoundingBoxDescent
          );
        }),
      ];
    });
    expect(Math.max(...headerBottoms) - Math.min(...headerBottoms)).toBeLessThanOrEqual(2);
    await page.locator('#api').evaluate((panel) => (panel.scrollTop = 0));
    await page.locator('#status').evaluate((status) => (status.textContent = ''));
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await page.screenshot({ path: testInfo.outputPath(`api-${width}.png`) });
  }
});

test('the worker retains cells, applies live PCG changes, and draws sprites only for the current tick', async ({
  page,
}) => {
  await run(
    page,
    `
    cls(4); pcg.X.pat = '8000000000000000'; pcg.X.col = [3,1];
    put(0,0,'X');
    let x = 27;
    let visible = true;
    function tick() {
      if (btnp(4)) {
        pcg.X.col = [5,2]; scr[0][1].chr = 'X'; scr[0][1].col = [null,0];
        x = 19;
      }
      if (btnp(5)) visible = false;
      if (visible) {
        spr(x,0,'X',0);
        spr(40,0,'X',6);
        spr(40,0,'X',3);
        put(5,0,'X',5,2);
      }
    }
  `,
    true,
  );
  await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
  await expect.poll(() => pixel(page, 0, 0)).toEqual([215, 115, 85, 255]);
  await expect.poll(() => pixel(page, 108, 0)).toEqual([0, 0, 0, 255]);
  await expect.poll(() => pixel(page, 160, 0)).toEqual([215, 115, 85, 255]);
  await page.locator('#screen').focus();
  await page.keyboard.press('z');
  await expect.poll(() => pixel(page, 0, 0)).toEqual([100, 185, 100, 255]);
  await expect.poll(() => pixel(page, 4, 0)).toEqual([100, 105, 100, 255]);
  await expect.poll(() => pixel(page, 32, 0)).toEqual([100, 185, 100, 255]);
  await expect.poll(() => pixel(page, 44, 0)).toEqual([0, 0, 0, 255]);
  await expect.poll(() => pixel(page, 108, 0)).toEqual([80, 140, 215, 255]);
  await expect.poll(() => pixel(page, 76, 0)).toEqual([0, 0, 0, 255]);
  await page.keyboard.press('x');
  await expect.poll(() => pixel(page, 76, 0)).toEqual([80, 140, 215, 255]);
  await expect.poll(() => pixel(page, 160, 0)).toEqual([100, 185, 100, 255]);
});

test('the updated page avoids stale unversioned scripts and initializes every toggle', async ({
  page,
}) => {
  // Simulate an old cached module graph. Neither unversioned nor previous-version modules may initialize the page.
  const stale = [];
  await page.route(/\/src\/[^/]+\.js(?:\?v=(?:[1-9]|10|11|12))?$/, (route) => {
    stale.push(route.request().url());
    return route.fulfill({
      contentType: 'text/javascript',
      body: 'throw new Error("Old cached module loaded")',
    });
  });
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Play' })).toHaveAttribute('aria-selected', 'true');
  const code = page.locator('#code-toggle');
  await code.click();
  await expect(page.locator('#workbench')).toBeHidden();
  await code.click();
  await expect(page.locator('#workbench')).toBeVisible();
  await page.getByRole('tab', { name: 'Info', exact: true }).click();
  await expect(page.locator('#info')).toBeVisible();
  await page.getByRole('tab', { name: 'Emoji', exact: true }).click();
  await expect(page.locator('#catalog button').first()).toBeVisible();
  await page.getByRole('tab', { name: 'API', exact: true }).click();
  await expect(page.locator('#api')).toBeVisible();
  await page.getByRole('tab', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Run', exact: false }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
  for (const id of ['crt', 'sound']) {
    const toggle = page.locator('#' + id);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  }
  expect(stale).toEqual([]);
});

test('panel frames stay rectangular after resizing and focus colors cover all four sides', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('playload-split', '.45127597'));
  await page.goto('/');
  const editor = page.locator('#editor'),
    viewport = page.locator('#viewport');
  for (const width of [1401, 999]) {
    await page.setViewportSize({ width, height: 800 });
    await page.locator('#divider').focus();
    await page.keyboard.press('ArrowRight');
    const boxes = await page.locator('#editor,#viewport').evaluateAll((elements) =>
      elements.map((element) => {
        const r = element.getBoundingClientRect();
        return [r.left, r.top, r.right, r.bottom];
      }),
    );
    for (const box of boxes)
      for (const edge of [box[0], box[2]]) expect(edge).toBe(Math.round(edge));
    expect(boxes[0][1]).toBe(boxes[1][1]);
    expect(boxes[0][3]).toBe(boxes[1][3]);
    for (const [key, limit] of [
      ['Home', 'aria-valuemin'],
      ['End', 'aria-valuemax'],
    ]) {
      await page.locator('#divider').focus();
      await page.keyboard.press(key);
      expect(await page.locator('#divider').getAttribute('aria-valuenow')).toBe(
        await page.locator('#divider').getAttribute(limit),
      );
    }
    for (const target of [editor, viewport]) {
      if (target === editor) await editor.focus();
      else {
        await page.keyboard.press('ControlOrMeta+Enter');
        await expect(page.locator('#screen')).toBeFocused();
      }
      const sides = await target.evaluate((element) => {
        const s = getComputedStyle(element);
        return [s.borderTopColor, s.borderRightColor, s.borderBottomColor, s.borderLeftColor];
      });
      expect(new Set(sides).size).toBe(1);
      expect(sides[0]).toBe('rgb(145, 132, 155)');
    }
  }
});

test('split limits restore after reload and clamp to the resized screen', async ({ page }) => {
  await page.setViewportSize({ width: 1535, height: 1000 });
  await page.goto('/');
  const divider = page.locator('#divider');
  for (const [key, limit] of [
    ['Home', 'aria-valuemin'],
    ['End', 'aria-valuemax'],
  ]) {
    await divider.focus();
    await page.keyboard.press(key);
    const value = await divider.getAttribute('aria-valuenow');
    await page.reload();
    await expect(divider).toHaveAttribute('aria-valuenow', value);
    expect(value).toBe(await divider.getAttribute(limit));
  }
  await divider.focus();
  await page.keyboard.press('Home');
  await page.setViewportSize({ width: 700, height: 1000 });
  await page.reload();
  expect(await divider.getAttribute('aria-valuenow')).toBe(
    await divider.getAttribute('aria-valuemin'),
  );
});

test('Run hands keyboard input to the game from the button and editor shortcuts', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('#crt').click();
  const editor = page.locator('#editor'),
    screen = page.locator('#screen');
  const source = 'function tick() { cls(btn(4) ? 3 : 4) }';
  await editor.fill(source);
  for (const action of ['click', 'Control+Enter', 'Meta+Enter']) {
    await editor.focus();
    const idleBorder = await page
      .locator('#viewport')
      .evaluate((element) => getComputedStyle(element).borderColor);
    if (action === 'click') await page.locator('#run').click();
    else await editor.press(action);
    await expect(screen).toBeFocused();
    expect(
      await page.locator('#viewport').evaluate((element) => getComputedStyle(element).borderColor),
    ).not.toBe(idleBorder);
    await page.keyboard.down('KeyZ');
    await expect.poll(() => pixel(page)).toEqual([215, 115, 85, 255]);
    await page.keyboard.up('KeyZ');
    await expect.poll(() => pixel(page)).toEqual([80, 140, 215, 255]);
    await expect(editor).toHaveValue(source);
  }
  await editor.click();
  await expect(editor).toBeFocused();
  await editor.press('End');
  await editor.press('Space');
  await expect(editor).toHaveValue(source + ' ');
});

test('Pause and Resume move between code and game without a mouse or changing the draft', async ({
  page,
}) => {
  const source = 'function tick() { cls(btn(4) ? 3 : 4) }';
  await run(page, source, true);
  const editor = page.locator('#editor'),
    screen = page.locator('#screen');
  await expect(screen).toBeFocused();
  await page.keyboard.press('Alt+KeyP');
  await expect(editor).toBeFocused();
  await expect(page.locator('#pause')).toHaveText(/^Resume/);
  await editor.press('End');
  await editor.press('Space');
  await editor.press('Alt+KeyP');
  await expect(screen).toBeFocused();
  await expect(page.locator('#pause')).toHaveText(/^Pause/);
  await expect(editor).toHaveValue(source + ' ');
  await page.keyboard.down('KeyZ');
  await expect.poll(() => pixel(page)).toEqual([215, 115, 85, 255]);
  await page.keyboard.press('Alt+KeyP');
  await page.keyboard.up('KeyZ');
  await expect(editor).toBeFocused();
  await editor.press('Alt+KeyP');
  await expect(screen).toBeFocused();
  await expect.poll(() => pixel(page)).toEqual([80, 140, 215, 255]);
  await page.locator('#code-toggle').click();
  await page.keyboard.press('Alt+KeyP');
  await expect(screen).toBeFocused();
  await page.keyboard.press('Alt+KeyP');
  await expect(screen).toBeFocused();
});

test('Shift+Tab exits the editor without inserting whitespace', async ({ page }) => {
  await page.goto('/');
  const editor = page.locator('#editor'),
    source = await editor.inputValue();
  await editor.focus();
  await editor.press('Shift+Tab');
  await expect(editor).not.toBeFocused();
  await expect(editor).toHaveValue(source);
});

test('Run applies editor changes and Control+Enter restarts without rereading a file', async ({
  page,
}) => {
  await run(page, 'function tick() { cls(4) }', true);
  await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
  await expect(page.locator('#reload')).toBeDisabled();
  await expect(page.locator('#run')).toHaveAttribute(
    'aria-keyshortcuts',
    'Control+Enter Meta+Enter',
  );
  await page.getByRole('button', { name: 'Pause', exact: false }).click();
  await page.getByRole('textbox', { name: 'JavaScript code' }).fill('function tick() { cls(5) }');
  await expect(page.locator('#pause')).toBeEnabled();
  await page.locator('#screen').focus();
  await page.keyboard.press('Control+Enter');
  await expect.poll(() => pixel(page)).toEqual([100, 185, 100, 255]);
  await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
  await expect(page.locator('#pause')).toHaveText(/^Pause/);
});

test('disabled Reload and Pause shortcuts never insert characters into the editor', async ({
  page,
}) => {
  await page.goto('/');
  const editor = page.locator('#editor'),
    source = await editor.inputValue();
  await editor.focus();
  for (const key of ['Alt+KeyR', 'Alt+KeyP']) await editor.press(key);
  await expect(editor).toHaveValue(source);
  await expect(editor).toBeFocused();
  expect(
    await editor.evaluate((element) =>
      ['KeyR', 'KeyP'].every((code) => {
        const event = new KeyboardEvent('keydown', {
          code,
          key: code === 'KeyR' ? '®' : 'π',
          altKey: true,
          bubbles: true,
          cancelable: true,
        });
        element.dispatchEvent(event);
        return event.defaultPrevented;
      }),
    ),
  ).toBe(true);
  await expect(editor).toHaveValue(source);
});

test('Run executes only editor code; Reload rereads the selected file without reopening the picker', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.testFileSource = 'function tick() { cls(4) }';
    window.fileReads = 0;
    window.pickerOpens = 0;
    window.showOpenFilePicker = async () => {
      window.pickerOpens++;
      return [
        {
          getFile: async () => {
            window.fileReads++;
            return new File([window.testFileSource], 'native-game.js', { type: 'text/javascript' });
          },
        },
      ];
    };
  });
  await page.goto('/');
  await page.locator('#load').click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
  await page.locator('#crt').click();
  await expect.poll(() => pixel(page)).toEqual([80, 140, 215, 255]);
  await page.evaluate(() => (window.testFileSource = 'function tick() { cls(5) }'));
  await page.locator('#run').click();
  await expect.poll(() => pixel(page)).toEqual([80, 140, 215, 255]);
  expect(await page.evaluate(() => window.fileReads)).toBe(1);
  await page.locator('#editor').focus();
  await page.keyboard.press('Alt+KeyR');
  await expect.poll(() => pixel(page)).toEqual([100, 185, 100, 255]);
  await expect(page.locator('#screen')).toBeFocused();
  expect(await page.evaluate(() => window.pickerOpens)).toBe(1);
  const editor = page.getByRole('textbox', { name: 'JavaScript code' });
  await expect(editor).toHaveValue('function tick() { cls(5) }');
  await editor.fill('function tick() { cls(6) }');
  await page.evaluate(() => (window.testFileSource = 'function tick() { cls(3) }'));
  await page.locator('#run').click();
  await expect.poll(() => pixel(page)).toEqual([230, 200, 110, 255]);
  await expect(editor).toHaveValue('function tick() { cls(6) }');
  expect(await page.evaluate(() => window.fileReads)).toBe(2);
  const cancelled = page.waitForEvent('dialog').then((dialog) => dialog.dismiss());
  await page.locator('#reload').click();
  await cancelled;
  await expect(editor).toHaveValue('function tick() { cls(6) }');
  expect(await page.evaluate(() => window.fileReads)).toBe(2);
  const accepted = page.waitForEvent('dialog').then((dialog) => dialog.accept());
  await page.locator('#reload').click();
  await accepted;
  await expect(editor).toHaveValue('function tick() { cls(3) }');
  await expect.poll(() => pixel(page)).toEqual([215, 115, 85, 255]);
  expect(await page.evaluate(() => window.fileReads)).toBe(3);
});

for (const action of ['load', 'reload'])
  test(`${action} preserves edits made during a pending file read`, async ({ page }) => {
    await page.addInitScript(() => {
      window.fileReads = 0;
      window.showOpenFilePicker = async () => [
        {
          getFile: async () => {
            window.fileReads++;
            if (window.fileReads > 1)
              await new Promise((resolve) => (window.finishFileRead = resolve));
            return new File(['function tick() { cls(4) }'], 'native-game.js', {
              type: 'text/javascript',
            });
          },
        },
      ];
    });
    await page.goto('/');
    await page.locator('#load').click();
    await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
    await page.locator('#' + action).click();
    await expect(page.locator('#run')).toBeDisabled();
    await expect(page.locator('#load')).toBeDisabled();
    await expect(page.locator('#reload')).toBeDisabled();
    const editor = page.getByRole('textbox', { name: 'JavaScript code' });
    await editor.fill('function tick() { cls(6) }');
    await page.evaluate(() => window.finishFileRead());
    await expect(page.locator('#run')).toBeEnabled();
    await expect(editor).toHaveValue('function tick() { cls(6) }');
    await expect(page.locator('#status')).toHaveText(
      'Code changed while loading. Your edits were kept.',
    );
  });

test('a failed Reload preserves the file and editor, and a later retry succeeds', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.fileMissing = false;
    window.showOpenFilePicker = async () => [
      {
        getFile: async () => {
          if (window.fileMissing) throw new DOMException('File no longer exists.', 'NotFoundError');
          return new File(['function tick() { cls(4) }'], 'retry-game.js');
        },
      },
    ];
  });
  await page.goto('/');
  await page.locator('#load').click();
  await expect(page.locator('#pause')).toBeEnabled();
  await page.locator('#crt').click();
  await expect.poll(() => pixel(page)).toEqual([80, 140, 215, 255]);
  await page.evaluate(() => (window.fileMissing = true));
  await page.locator('#reload').click();
  await expect(page.locator('#status')).toHaveText('File no longer exists.');
  await expect(page.locator('#editor')).toHaveValue('function tick() { cls(4) }');
  await expect(page.locator('#filename')).toHaveText('retry-game.js');
  await expect(page.locator('#reload')).toBeEnabled();
  await expect.poll(() => pixel(page)).toEqual([80, 140, 215, 255]);
  await page.evaluate(() => (window.fileMissing = false));
  await page.locator('#reload').click();
  await expect(page.locator('#status')).toHaveText('');
  await expect(page.locator('#screen')).toBeFocused();
});

test('Reload skips replacement confirmation after edits are reverted to the loaded source', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.fileReads = 0;
    window.showOpenFilePicker = async () => [
      {
        getFile: async () => {
          window.fileReads++;
          return new File(['function tick() { cls(4) }'], 'reverted-game.js');
        },
      },
    ];
  });
  await page.goto('/');
  await page.locator('#load').click();
  await expect(page.locator('#reload')).toBeEnabled();
  const editor = page.locator('#editor'),
    source = await editor.inputValue();
  await editor.fill(source + ' ');
  await editor.fill(source);
  let dialogs = 0;
  page.on('dialog', async (dialog) => {
    dialogs++;
    await dialog.dismiss();
  });
  await page.locator('#reload').click();
  await expect.poll(() => page.evaluate(() => window.fileReads)).toBe(2);
  expect(dialogs).toBe(0);
});

test('Reload reselects the file when file handles are unavailable and rejects another filename', async ({
  page,
}) => {
  await page.addInitScript(() => (window.showOpenFilePicker = undefined));
  await page.goto('/');
  const select = async (button, name, source) => {
    const chooser = page.waitForEvent('filechooser');
    await page.locator(button).click();
    await (
      await chooser
    ).setFiles({ name, mimeType: 'text/javascript', buffer: Buffer.from(source) });
  };
  await select('#load', 'fallback-game.js', 'function tick() { cls(4) }');
  await expect(page.locator('#pause')).toBeEnabled();
  await expect(page.locator('#reload')).toBeEnabled();
  await select('#reload', 'other-game.js', 'function tick() { cls(3) }');
  await expect(page.locator('#status')).toHaveText('Select fallback-game.js to reload.');
  await expect(page.locator('#editor')).toHaveValue('function tick() { cls(4) }');
  await select('#reload', 'fallback-game.js', 'function tick() { cls(5) }');
  await expect(page.locator('#editor')).toHaveValue('function tick() { cls(5) }');
  await page.locator('#crt').click();
  await expect.poll(() => pixel(page)).toEqual([100, 185, 100, 255]);
});

test('JavaScript coloring preserves source, literal markup, typing and scrolling', async ({
  page,
}) => {
  await page.goto('/');
  const editor = page.locator('#editor');
  const source = '// comment\nlet x = 7\nconst label = "<img src=x>"\nfunction tick() { cls(x) }\n';
  await editor.fill(source);
  await expect(page.locator('#editor-highlight .token.keyword').first()).toHaveText('let');
  const commentColor = await page
    .locator('#editor-highlight .token.comment')
    .evaluate((element) => getComputedStyle(element).color);
  expect(commentColor).toBe('rgb(133, 128, 150)');
  expect(commentColor).not.toBe(
    await page
      .locator('#editor-highlight .token.keyword')
      .first()
      .evaluate((element) => getComputedStyle(element).color),
  );
  const box = await editor.boundingBox();
  await page.mouse.move(box.x + 16, box.y + 24);
  await page.mouse.down();
  await page.mouse.move(box.x + 130, box.y + 65, { steps: 10 });
  await page.mouse.up();
  expect(await editor.evaluate((element) => element.selectionEnd > element.selectionStart)).toBe(
    true,
  );
  expect(await editor.evaluate((element) => getComputedStyle(element, '::selection').color)).toBe(
    'rgb(238, 234, 226)',
  );
  expect(await editor.inputValue()).toBe(source);
  await expect(page.locator('#editor-highlight .token.string')).toHaveText('"<img src=x>"');
  await expect(page.locator('#editor-highlight img')).toHaveCount(0);
  await expect(editor).toHaveValue(source);
  await editor.fill(source);
  await editor.press('Tab');
  await expect(editor).toHaveValue(source + '  ');
  const longLine = 'const label = "' + 'wide source '.repeat(30) + '"';
  await editor.fill(longLine);
  await expect(editor).toHaveAttribute('wrap', 'off');
  expect(await editor.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await editor.evaluate((element) => {
    element.scrollLeft = 140;
    element.dispatchEvent(new Event('scroll'));
  });
  expect(await page.locator('#editor-highlight').evaluate((element) => element.scrollLeft)).toBe(
    await editor.evaluate((element) => element.scrollLeft),
  );
  await expect(editor).toHaveValue(longLine);
  await editor.fill('// line\n'.repeat(120) + 'function tick() { cls(7) }');
  await editor.evaluate((element) => {
    element.scrollTop = 800;
    element.dispatchEvent(new Event('scroll'));
  });
  expect(await page.locator('#editor-highlight').evaluate((element) => element.scrollTop)).toBe(
    await editor.evaluate((element) => element.scrollTop),
  );
  await page.locator('#run').click();
  await expect(page.locator('#pause')).toBeEnabled();
});

test('line numbers follow edits and scrolling without becoming part of the source', async ({
  page,
}) => {
  await page.goto('/');
  const editor = page.locator('#editor'),
    numbers = page.locator('#editor-line-numbers');
  await editor.fill('let x = 1\n\n');
  await expect(numbers).toHaveText('1\n2\n3');
  const source = '// row\n'.repeat(100) + 'function tick() { cls(4) }';
  await editor.fill(source);
  expect((await numbers.textContent()).split('\n').at(-1)).toBe('101');
  expect(
    await page
      .locator('#editor,#editor-highlight,#editor-line-numbers')
      .evaluateAll(
        (elements) => new Set(elements.map((element) => getComputedStyle(element).lineHeight)).size,
      ),
  ).toBe(1);
  const gutter = await page.locator('#editor-lines').boundingBox();
  await editor.evaluate((element) => {
    element.scrollTop = 900;
    element.dispatchEvent(new Event('scroll'));
  });
  expect(
    await numbers.evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).m42),
  ).toBe(-(await editor.evaluate((element) => element.scrollTop)));
  await editor.fill('const wide = "' + 'text '.repeat(200) + '"');
  await editor.evaluate((element) => {
    element.scrollLeft = 500;
    element.dispatchEvent(new Event('scroll'));
  });
  expect((await page.locator('#editor-lines').boundingBox()).x).toBe(gutter.x);
  await editor.selectText();
  const copied = await editor.evaluate((element) =>
    element.value.slice(element.selectionStart, element.selectionEnd),
  );
  expect(copied).toBe(await editor.inputValue());
  await editor.fill('function tick() {}');
  await expect(numbers).toHaveText('1');
});

test('an error preserves the last game picture and marks its editable source line', async ({
  page,
}, testInfo) => {
  const source =
    'let frame = 0\nfunction tick() {\n  cls(4)\n  spr(76, 68, "👾", 6)\n  if (++frame === 5) throw new Error("Ship update failed")\n}';
  await run(page, source, true);
  await expect(page.locator('#error')).toHaveText('Ship update failed');
  await expect(page.locator('#error-line')).toHaveText('Line 5');
  await expect(page.locator('#screen')).toBeVisible();
  await expect(page.locator('#pause')).toBeDisabled();
  expect(await pixel(page)).toEqual([80, 140, 215, 255]);
  await expect(page.locator('.editor-line-error')).toHaveText('5');
  const picture = await page.locator('#screen').boundingBox(),
    notice = await page.locator('#error-notice').boundingBox();
  expect(notice.x).toBeGreaterThan(picture.x);
  expect(notice.y).toBeGreaterThan(picture.y);
  expect(notice.x + notice.width).toBeLessThanOrEqual(picture.x + picture.width);
  expect(notice.y + notice.height).toBeLessThanOrEqual(picture.y + picture.height);
  await page.locator('#error-line').click();
  await expect(page.locator('#editor')).toBeFocused();
  expect(
    await page
      .locator('#editor')
      .evaluate((element) => element.value.slice(element.selectionStart, element.selectionEnd)),
  ).toContain('Ship update failed');
  await page.screenshot({ path: testInfo.outputPath('error-with-last-frame.png') });
  const lastFrame = await page.locator('#display').evaluate((canvas) => canvas.toDataURL());
  await page.locator('#editor').fill('function tick( {');
  await expect(page.locator('.editor-line-error')).toHaveCount(0);
  await page.locator('#run').click();
  await expect(page.locator('#error')).toBeVisible();
  expect(await page.locator('#display').evaluate((canvas) => canvas.toDataURL())).toBe(lastFrame);
  await page.locator('#editor').fill('function tick() { cls(5) }');
  await page.locator('#run').click();
  await expect(page.locator('#pause')).toBeEnabled();
  await expect(page.locator('#error-notice')).toBeHidden();
  await expect.poll(() => pixel(page)).toEqual([100, 185, 100, 255]);
});

test('Examples is last and every game link contains its actual source', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1710, height: 895 });
  await page.goto('/');
  await page.getByRole('tab', { name: 'Info', exact: true }).click();
  await page.getByRole('tab', { name: 'Examples', exact: true }).click();
  await expect(page.locator('[data-ref]').last()).toHaveText('Examples');
  const entries = JSON.parse(
    await readFile(new URL('../../data/examples.json', import.meta.url), 'utf8'),
  );
  const rows = page.locator('.example-links li');
  await expect(rows).toHaveCount(entries.length);
  await expect(rows.locator('a')).toHaveText(entries.map((entry) => entry.name));
  await page.screenshot({ path: testInfo.outputPath('examples-desktop.jpg'), quality: 90 });
  for (let index = 0; index < entries.length; index++) {
    const link = rows.nth(index).locator('a').first();
    await expect(rows.nth(index).locator('a')).toHaveCount(1);
    const id = entries[index].id;
    const source = await readFile(new URL('../../examples/' + id + '.js', import.meta.url), 'utf8');
    const url = await link.getAttribute('href');
    expect(
      await page.evaluate(async (url) => {
        const { decode } = await import('/src/payload.js');
        return decode(new URL(url).hash);
      }, url),
    ).toBe(source);
    const opened = page.waitForEvent('popup');
    await link.click();
    const game = await opened;
    await expect(game).toHaveTitle((await link.textContent()) + ' — Playload');
    await expect(game.locator('#pause')).toBeEnabled();
    await expect(game.locator('#screen')).toBeFocused();
    await expect(game.locator('#editor')).toHaveValue(source);
    await expect(game.locator('#crt')).toHaveAttribute('aria-pressed', 'true');
    await expect(game.locator('#error')).toBeHidden();
    if (id === 'gems') {
      const before = await game.locator('#display').evaluate((canvas) => canvas.toDataURL());
      await game.keyboard.down('ArrowRight');
      await expect
        .poll(() => game.locator('#display').evaluate((canvas) => canvas.toDataURL()))
        .not.toBe(before);
      await game.keyboard.up('ArrowRight');
      await expect(game.locator('#editor')).toHaveValue(source);
    }
    if (['snake', 'jump', 'music-box'].includes(id)) {
      const before = await game.locator('#display').evaluate((canvas) => canvas.toDataURL());
      await game.keyboard.press(id === 'music-box' ? 'ArrowUp' : 'z');
      await expect
        .poll(() => game.locator('#display').evaluate((canvas) => canvas.toDataURL()))
        .not.toBe(before);
      await expect(game.locator('#error')).toBeHidden();
      await game.screenshot({ path: testInfo.outputPath(id + '-desktop.png') });
    }
    await game.close();
  }
});

test('new examples respond to touch controls and fit a narrow player', async ({
  browser,
}, testInfo) => {
  const entries = JSON.parse(
    await readFile(new URL('../../data/examples.json', import.meta.url), 'utf8'),
  );
  for (const entry of entries.filter((entry) =>
    ['snake', 'jump', 'music-box'].includes(entry.id),
  )) {
    const phone = await browser.newPage({
      viewport: { width: 375, height: 812 },
      hasTouch: true,
      isMobile: true,
    });
    await phone.goto('http://127.0.0.1:8765/');
    if (entry.id === 'snake') {
      await phone.getByRole('tab', { name: 'Info', exact: true }).click();
      await phone.getByRole('tab', { name: 'Examples', exact: true }).click();
      await expect(phone.locator('header')).toHaveCount(1);
      await expect(phone.locator('.example-links li')).toHaveCount(entries.length);
      await phone.screenshot({ path: testInfo.outputPath('examples-phone.png') });
      const last = phone.locator('.example-links li').last();
      await last.scrollIntoViewIfNeeded();
      await expect(last.locator('a')).toBeVisible();
    }
    const source = await readFile(
      new URL('../../examples/' + entry.id + '.js', import.meta.url),
      'utf8',
    );
    const hash = await phone.evaluate(async (source) => {
      const { encode } = await import('/src/payload.js');
      return (await encode(source)).hash;
    }, source);
    await phone.goto('http://127.0.0.1:8765/' + hash);
    await phone.locator('#start-game').tap();
    await expect(phone.locator('#pause')).toBeEnabled();
    await expect(phone.locator('#editor')).toBeHidden();
    await expect(phone.locator('.touch')).toBeVisible();
    const before = await phone.locator('#display').evaluate((canvas) => canvas.toDataURL());
    await phone.locator('[data-input="' + (entry.id === 'music-box' ? 0 : 4) + '"]').tap();
    await expect
      .poll(() => phone.locator('#display').evaluate((canvas) => canvas.toDataURL()))
      .not.toBe(before);
    await expect(phone.locator('#error')).toBeHidden();
    expect(await phone.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      375,
    );
    const screen = await phone.locator('#screen').boundingBox();
    expect(screen.x).toBeGreaterThanOrEqual(0);
    expect(screen.x + screen.width).toBeLessThanOrEqual(375);
    await phone.screenshot({ path: testInfo.outputPath(entry.id + '-phone.png') });
    await phone.close();
  }
});

test('a shared game does not steal editor focus chosen while its worker is starting', async ({
  page,
}) => {
  await page.goto('/');
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
  await page.goto('/' + hash);
  await expect.poll(() => page.evaluate(() => typeof window.finishInitialLoad)).toBe('function');
  await page.locator('#editor').focus();
  await page.evaluate(() => window.finishInitialLoad());
  await expect(page.locator('#pause')).toBeEnabled();
  await expect(page.locator('#editor')).toBeFocused();
});

test('Workspace and reference tabs share bar spacing; keyboard focus adds no decoration', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Info', exact: true }).click();
  const style = async (selector) =>
    page.locator(selector).evaluate((element) => {
      const s = getComputedStyle(element);
      return [
        s.height,
        s.paddingTop,
        s.paddingBottom,
        s.lineHeight,
        s.fontSize,
        s.borderBottomWidth,
      ];
    });
  expect(await style('#info-tab')).toEqual(await style('#api-tab'));
  await page.locator('#info-tab').focus();
  expect(
    await page.locator('#info-tab').evaluate((element) => getComputedStyle(element).outlineStyle),
  ).toBe('none');
  const logo = await page.locator('#logo').boundingBox(),
    version = await page.locator('#version').boundingBox();
  expect(version.x).toBeGreaterThanOrEqual(logo.x + logo.width);
  const versionInk = await page.locator('#version').evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return range.getBoundingClientRect().bottom;
  });
  expect(Math.abs(logo.y + logo.height - versionInk)).toBeLessThanOrEqual(4);
  const header = await page.locator('header').boundingBox(),
    tabs = await page.locator('#views').boundingBox();
  expect(
    Math.abs(logo.y - header.y - (tabs.y + tabs.height - logo.y - logo.height)),
  ).toBeLessThanOrEqual(2);
});
