import { defineConfig, devices } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port = Number(process.env.PLAYLOAD_BROWSER_PORT ?? 8767);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('PLAYLOAD_BROWSER_PORT must be an integer from 1 to 65535.');
export const baseURL = `http://127.0.0.1:${port}`;
const browserName = process.env.PLAYLOAD_BROWSER || 'chromium';
// Full Chromium, as CI installs it, rather than the separate headless shell.
const channel = 'chromium';
// Host audio devices can stall or fail, and CI runners have none. Chromium's fake
// output keeps the AudioContext clock running, so audio checks test Playload only.
// WebKit has no such option; its iPhone project checks no audio output.
const chromiumArgs = ['--disable-audio-output'];
let env;
if (browserName === 'firefox' && process.platform === 'darwin') {
  // Firefox resolves app data separately from its temporary browser profile.
  const root = mkdtempSync(join(tmpdir(), 'playload-firefox-'));
  mkdirSync(join(root, 'app'));
  mkdirSync(join(root, 'local'));
  env = {
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    TMPDIR: tmpdir(),
    MOZ_APP_DATA: join(root, 'app'),
    MOZ_LOCAL_APP_DATA: join(root, 'local'),
    MOZ_CRASHREPORTER_DISABLE: '1',
  };
  process.once('exit', () => rmSync(root, { recursive: true, force: true }));
}

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  // The local pre-deployment run must also refuse a stray test.only.
  forbidOnly: true,
  // Concurrent software rendering can starve input, capture and audio clocks.
  workers: 1,
  use: { baseURL, trace: 'retain-on-failure' },
  // wrangler dev builds dist/ and serves it as Cloudflare would, with _headers.
  webServer: {
    command: `node scripts/wrangler.mjs dev --port ${port}`,
    url: baseURL + '/playload/',
    timeout: 120_000,
    // SIGTERM lets Wrangler stop workerd and remove its temporary files.
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
  },
  projects: [
    {
      name: 'desktop',
      testIgnore: 'devices.spec.js',
      use: {
        browserName,
        channel: browserName === 'chromium' ? channel : undefined,
        launchOptions: {
          ignoreDefaultArgs: ['--hide-scrollbars'],
          args: browserName === 'chromium' ? chromiumArgs : [],
          env,
        },
        viewport: { width: 1400, height: 1000 },
      },
    },
    // Phone emulation for devices.spec.js; docs/retro-output.md describes it.
    { name: 'iphone', testMatch: 'devices.spec.js', use: devices['iPhone 17'] },
    {
      name: 'android',
      testMatch: 'devices.spec.js',
      use: { ...devices['Pixel 9'], channel, launchOptions: { args: chromiumArgs } },
    },
  ],
});
