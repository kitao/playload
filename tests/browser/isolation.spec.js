import { test, expect } from './fixtures.js';
import { encode } from '../../src/payload.js';

test('stopping an unresponsive game releases its worker and leaves the editor usable', async ({
  page,
}) => {
  const workers = new Set();
  page.on('worker', (worker) => {
    if (!worker.url().startsWith('data:')) return;
    workers.add(worker);
    worker.on('close', () => workers.delete(worker));
  });
  await page.goto('/playload/app/');
  await page.locator('#editor').fill('while (true) {}');
  await page.locator('#run').click();
  await page.locator('#info-tab').click();
  await expect(page.locator('#info')).toBeVisible();
  await expect(page.locator('#error')).toHaveText('The game stopped responding.', {
    timeout: 7000,
  });
  await expect.poll(() => workers.size).toBe(0);
  await page.locator('#play-tab').click();
  await page.locator('#editor').fill('function tick() { cls(4); }');
  await page.locator('#run').click();
  await expect(page.locator('#pause')).toBeEnabled();
  await expect(page.locator('iframe')).toHaveCount(1);
});

async function report(page, source) {
  await page.locator('#editor').fill(source);
  await page.locator('#run').click();
  await expect(page.locator('#error')).toHaveText(/^probe /);
  return JSON.parse((await page.locator('#error').textContent()).slice(6));
}

test('malformed thrown values stop the game without breaking the error display', async ({
  page,
}) => {
  await page.goto('/playload/app/');
  for (const value of [
    '{ toString: null, valueOf: null }',
    'Object.create(null)',
    '{ get message() { throw Error("nested"); } }',
  ]) {
    await page.locator('#editor').fill(`function tick() { throw ${value}; }`);
    await page.locator('#run').click();
    await expect(page.locator('#error')).toHaveText('Game error');
    await expect(page.locator('iframe')).toHaveCount(0);
  }
});

test('games cannot communicate over the network or read the app storage', async ({
  page,
  context,
}) => {
  const requests = [];
  await context.route('**/*security-probe*', (route) => {
    requests.push(route.request().url());
    return route.abort();
  });
  await context.routeWebSocket('**/*security-probe*', (socket) => {
    requests.push(socket.url());
    socket.close();
  });
  await page.goto('/playload/app/');
  await page.evaluate(async () => {
    await (
      await caches.open('security-probe')
    ).put('/security-probe-parent', new Response('parent'));
  });
  const origin = new URL(page.url()).origin;
  const result = await report(
    page,
    `
    const result = {};
    let done = false;
    async function check(name, action) {
      try { result[name] = await action(); } catch { result[name] = 'blocked'; }
    }
    Promise.all([
      check('fetchSameOrigin', () => fetch('${origin}/security-probe-fetch').then(() => 'allowed')),
      check('fetchAnalytics', () => fetch('https://cloudflareinsights.com/security-probe-fetch').then(() => 'allowed')),
      check('importScripts', () => { importScripts('${origin}/security-probe.js'); return 'allowed'; }),
      check('importAnalytics', () => { importScripts('https://static.cloudflareinsights.com/security-probe.js'); return 'allowed'; }),
      check('importData', () => { importScripts('data:text/javascript,void 0'); return 'allowed'; }),
      check('dynamicImport', () => import('${origin}/security-probe-module.js').then(() => 'allowed')),
      check('xhr', () => new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', '${origin}/security-probe-xhr');
        xhr.onload = () => resolve('allowed'); xhr.onerror = reject; xhr.send();
      })),
      check('websocket', () => new Promise((resolve, reject) => {
        const ws = new WebSocket('${origin.replace('http:', 'ws:')}/security-probe-ws');
        ws.onopen = () => { ws.close(); resolve('allowed'); }; ws.onerror = reject;
      })),
      check('events', () => new Promise((resolve, reject) => {
        const stream = new EventSource('${origin}/security-probe-events');
        stream.onopen = () => { stream.close(); resolve('allowed'); };
        stream.onerror = () => { stream.close(); reject(); };
      })),
      check('indexedDB', () => new Promise((resolve, reject) => {
        const request = indexedDB.open('security-probe');
        request.onsuccess = () => { request.result.close(); resolve('allowed'); }; request.onerror = reject;
      })),
      check('opfs', () => navigator.storage.getDirectory().then(() => 'allowed')),
      check('parentCache', async () => {
        const cache = await caches.open('security-probe');
        const parent = await cache.match('${origin}/security-probe-parent');
        await cache.put('${origin}/security-probe-child', new Response('child'));
        return parent ? 'allowed' : 'blocked';
      }),
    ]).then(() => { done = true; });
    function tick() { cls(0); if (done) throw Error('probe ' + JSON.stringify(result)); }
  `,
  );
  expect(Object.keys(result)).toHaveLength(12);
  expect(
    Object.values(result).every((value) => value === 'blocked'),
    JSON.stringify(result),
  ).toBe(true);
  expect(requests).toEqual([]);
  expect(
    await page.evaluate(
      async () => !!(await (await caches.open('security-probe')).match('/security-probe-child')),
    ),
  ).toBe(false);
});

test('game code cannot acquire the engine channel through globals or prototype edits', async ({
  page,
}) => {
  await page.goto('/playload/app/');
  const result = await report(
    page,
    `
    let captured = false, frames = 0;
    MessagePort.prototype.postMessage = function () { captured = true; };
    Object.defineProperty(MessageEvent.prototype, 'data', { get() { captured = true; } });
    const scope = Function('return globalThis')();
    let exposed = false;
    for (let object = scope; object; object = Object.getPrototypeOf(object))
      for (const name of ['postMessage', 'Worker', 'SharedWorker'])
        if (Object.hasOwn(object, name)) exposed = true;
    let caller = null;
    try { caller = cls.caller; } catch {}
    function tick() {
      cls(4);
      if (++frames === 3)
        throw Error('probe ' + JSON.stringify({ captured, exposed, caller: !!caller, tickCaller: !!tick.caller }));
    }
  `,
  );
  expect(result).toEqual({ captured: false, exposed: false, caller: false, tickCaller: false });
});

test('the embedded policy still blocks game requests when hosting omits CSP headers', async ({
  page,
  context,
}) => {
  await context.route('**/playload/app/sandbox/', async (route) => {
    const response = await route.fetch();
    const headers = { ...response.headers() };
    delete headers['content-security-policy'];
    await route.fulfill({ response, headers });
  });
  const requests = [];
  await context.route('**/*security-probe*', (route) => {
    requests.push(route.request().url());
    return route.abort();
  });
  const { hash } = await encode(`
    let result;
    fetch('https://cloudflareinsights.com/security-probe').then(() => result = 'allowed', () => result = 'blocked');
    function tick() { cls(4); if (result) throw Error(result); }
  `);
  await page.goto('/playload/app/' + hash);
  await expect(page.locator('#start-game')).toBeVisible();
  expect(page.frames()).toHaveLength(1);
  await page.locator('#start-game').click();
  await expect(page.locator('#error')).toHaveText('blocked');
  expect(requests).toEqual([]);
});
