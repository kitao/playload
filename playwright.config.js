import { defineConfig } from '@playwright/test';

export const baseURL = 'http://127.0.0.1:8767';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  use: {
    browserName: 'chromium',
    channel: process.env.PLAYLOAD_BROWSER_CHANNEL || undefined,
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
