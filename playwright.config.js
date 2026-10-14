import { defineConfig } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const baseURL = 'http://127.0.0.1:8767';
const browserName = process.env.PLAYLOAD_BROWSER || 'chromium';
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
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  use: {
    browserName,
    channel:
      browserName === 'chromium' ? process.env.PLAYLOAD_BROWSER_CHANNEL || undefined : undefined,
    launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'], env },
    baseURL,
    viewport: { width: 1400, height: 1000 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --no-open --no-watch',
    env: { PORT: new URL(baseURL).port },
    url: baseURL + '/playload/',
    reuseExistingServer: false,
  },
});
