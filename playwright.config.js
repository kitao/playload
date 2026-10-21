import { defineConfig } from '@playwright/test';

const port = Number(process.env.PLAYLOAD_BROWSER_PORT ?? 8767);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('PLAYLOAD_BROWSER_PORT must be an integer from 1 to 65535.');
export const baseURL = `http://127.0.0.1:${port}`;
const browserName = process.env.PLAYLOAD_BROWSER || 'chromium';

export default defineConfig({
  testDir: './tests/browser',
  forbidOnly: true,
  workers: 2,
  use: {
    baseURL,
    browserName,
    channel: browserName === 'chromium' ? 'chromium' : undefined,
    // Keep the sound clock running without depending on a host output device.
    launchOptions: { args: browserName === 'chromium' ? ['--disable-audio-output'] : [] },
    viewport: { width: 1400, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `node scripts/wrangler.mjs dev --port ${port}`,
    url: baseURL + '/playload/',
    timeout: 120_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
  },
});
