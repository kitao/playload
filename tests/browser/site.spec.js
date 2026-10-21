import { baseURL } from '../../playwright.config.js';

import {
  test,
  expect,
  trackDecodes,
  decodesSettled,
  watchPolicyViolations,
  policyViolations,
} from './fixtures.js';

import { encode } from '../../src/payload.js';

const legacy = '#1.09dXcCjJLMlJVfBJTU9MruRKK81LLsnMz1MoyUzO1tBUqFZIzinWMNG0VqgFAA';

const source = '// @title Legacy\nfunction tick() { cls(4); }';

function expectSharedPolicy(header) {
  const policy = Object.fromEntries(
    header.split(';').map((directive) => {
      const [name, ...values] = directive.trim().split(/\s+/);
      return [name, values];
    }),
  );
  expect(policy['default-src']).toEqual(["'none'"]);
  expect(policy['script-src']).toContain('https://static.cloudflareinsights.com');
  expect(policy['connect-src']).toContain('https://cloudflareinsights.com');
  for (const name of ['base-uri', 'form-action', 'frame-ancestors'])
    expect(policy[name], name).toEqual(["'none'"]);
  return policy;
}

test('image previews wait for the new image and remain closed if loading fails', async ({
  page,
}) => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  await trackDecodes(page);
  await page.route('**/info-api@2x.png', async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto('/playload/');
  const links = page.locator('.introduction:visible .screenshots a');
  const preview = page.getByRole('dialog');
  await links.nth(0).click();
  await expect(preview).toBeVisible();
  await preview.locator('img').click();
  await expect(preview).not.toBeVisible();
  const requested = page.waitForRequest('**/info-api@2x.png');
  await links.nth(1).click();
  await requested;
  await expect(preview).not.toBeVisible();
  release();
  await expect(preview).toBeVisible();
  await expect(preview.locator('img')).toHaveJSProperty('complete', true);
  await expect(preview.locator('img')).toHaveAttribute('src', /info-api@2x\.png$/);
  await preview.locator('img').click();
  await page.route('**/info-emoji@2x.png', (route) => route.abort());
  const failed = page.waitForEvent('requestfailed', (request) =>
    request.url().endsWith('/info-emoji@2x.png'),
  );
  await links.nth(2).click();
  await failed;
  await decodesSettled(page);
  await expect(preview).not.toBeVisible();
});

test('late image loads cannot replace a newer choice or reopen after Escape', async ({ page }) => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  await trackDecodes(page);
  await page.route('**/info-api@2x.png', async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto('/playload/');
  const links = page.locator('.introduction:visible .screenshots a');
  const preview = page.getByRole('dialog');
  const requested = page.waitForRequest('**/info-api@2x.png');
  await links.nth(1).click();
  await requested;
  await links.nth(2).click();
  await expect(preview).toBeVisible();
  const finished = page.waitForEvent('requestfinished', (request) =>
    request.url().endsWith('/info-api@2x.png'),
  );
  release();
  await finished;
  await decodesSettled(page);
  await expect(preview.locator('img')).toHaveAttribute('src', /info-emoji@2x\.png$/);
  await preview.locator('img').click();
  let cancelRelease;
  const cancelGate = new Promise((resolve) => (cancelRelease = resolve));
  await page.route('**/info-examples@2x.png', async (route) => {
    await cancelGate;
    await route.continue();
  });
  const cancelRequested = page.waitForRequest('**/info-examples@2x.png');
  await links.nth(3).click();
  await cancelRequested;
  await page.keyboard.press('Escape');
  const cancelFinished = page.waitForEvent('requestfinished', (request) =>
    request.url().endsWith('/info-examples@2x.png'),
  );
  cancelRelease();
  await cancelFinished;
  await decodesSettled(page);
  await expect(preview).not.toBeVisible();
});

test('language selection still works when browser storage is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('Storage unavailable', 'SecurityError');
      },
    });
  });
  await page.goto('/playload/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.getByRole('button', { name: '日本語', exact: true }).click();
  await expect(page.locator('.introduction:visible')).toHaveAttribute('lang', 'ja');
  await expect(page.getByRole('button', { name: '日本語', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('existing shared root URLs restore their code and drop tracking parameters', async ({
  page,
}) => {
  for (const hash of [legacy, (await encode(source)).hash]) {
    await page.goto('/playload/?ref=shared' + hash);
    await expect(page.locator('#editor')).toHaveValue(source);
    await expect(page).toHaveURL(baseURL + '/playload/app/' + hash);
  }
  await page.goto('/playload/#specifications');
  await expect(page.locator('.introduction:visible')).toBeVisible();
  await expect(page).toHaveURL(baseURL + '/playload/#specifications');
  await page.evaluate((hash) => (location.hash = hash), legacy);
  await expect(page).toHaveURL(baseURL + '/playload/app/' + legacy);
  await expect(page.locator('#editor')).toHaveValue(source);
});

test('the language choice uses the shared kitao.dev key and reads the earlier one without it', async ({
  page,
}) => {
  await page.goto('/playload/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('playload-language', 'ja');
  });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  await page.locator('.language-switch button[data-language="en"]').click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  expect(
    await page.evaluate(() => [
      localStorage.getItem('kitao.dev.language'),
      localStorage.getItem('playload-language'),
    ]),
  ).toEqual(['en', 'ja']);
});

test('trailing slashes follow Workers defaults and keep a legacy fragment', async ({ page }) => {
  await page.goto('/playload?ref=legacy' + legacy);
  await expect(page).toHaveURL(baseURL + '/playload/app/' + legacy);
  await expect(page.locator('#editor')).toHaveValue(source);
  await page.goto('/playload/index.html?ref=legacy' + legacy);
  await expect(page).toHaveURL(baseURL + '/playload/app/' + legacy);
  await page.goto('/playload/app?ref=legacy' + legacy);
  await expect(page).toHaveURL(baseURL + '/playload/app/' + legacy);
  // Static assets' default auto-trailing-slash handling, as wrangler dev serves it.
  for (const [path, status, location] of [
    ['/playload?ref=alias', 307, '/playload/?ref=alias'],
    ['/playload.html?ref=alias', 307, '/playload/?ref=alias'],
    ['/playload/app.html', 307, '/playload/app/'],
    ['/playload/app/index', 307, '/playload/app/'],
    ['/playload/LICENSE.txt', 200],
    ['/playload/app/index.html/', 404],
  ]) {
    const response = await page.request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(status);
    expect(response.headers().location, path).toBe(location);
    expect(response.headers()['x-content-type-options'], path).toBe('nosniff');
    expect(response.headers()['referrer-policy'], path).toBe('strict-origin-when-cross-origin');
  }
  // Browsers style an image or text opened on its own inline, so PNGs and text carry no content
  // policy; SVG documents keep it.
  for (const [path, policy] of [
    ['/playload/assets/images/info-api@2x.png', false],
    ['/playload/LICENSE.txt', false],
    ['/playload/assets/logo.svg', true],
  ]) {
    const headers = (await page.request.get(path)).headers();
    expect(headers['x-content-type-options'], path).toBe('nosniff');
    expect('content-security-policy' in headers, path).toBe(policy);
  }
});

test('the introduction and the app run under their own content policies without violations', async ({
  page,
}) => {
  await watchPolicyViolations(page);
  const site = expectSharedPolicy(
    (await page.goto('/playload/')).headers()['content-security-policy'],
  );
  expect(site['style-src']).toContain('https://fonts.googleapis.com');
  expect(site['script-src']).not.toContain("'unsafe-eval'");
  await page.locator('.language-switch button[data-language="ja"]').click();
  await page.locator('.introduction:visible .badges').scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  expect(await policyViolations(page)).toEqual([]);
  // Games run from blob workers with eval, so only the app's own policy admits them.
  const app = expectSharedPolicy(
    (await page.goto('/playload/app/' + legacy)).headers()['content-security-policy'],
  );
  expect(app['script-src']).toEqual(expect.arrayContaining(["'unsafe-eval'", 'blob:']));
  expect(app['worker-src']).toEqual(["'self'", 'blob:']);
  expect(app['style-src']).toEqual(["'self'"]);
  await page.locator('#start-game').click();
  await expect(page.locator('#pause')).toBeEnabled();
  // The formatter worker runs under the policy of its own script response.
  await page.getByRole('button', { name: 'Format', exact: false }).click();
  await expect(page.locator('#format')).toBeEnabled();
  await expect(page.locator('#status')).not.toHaveText(/^Format:/);
  await page.getByRole('tab', { name: 'Info', exact: true }).click();
  await page.evaluate(() => document.fonts.ready);
  expect(await policyViolations(page)).toEqual([]);
});
