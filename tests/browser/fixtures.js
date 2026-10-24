import { test as base, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { baseURL } from '../../playwright.config.js';

const root = new URL('../../', import.meta.url);

// Badges and fonts load from Shields.io, Ko-fi and Google Fonts; stand-ins keep the checks
// independent of the network. The stylesheet points at fonts.gstatic.com like the real one, so
// the content policy's font-src is exercised too.
const badgeStandIn =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="20"><rect width="100" height="20"/></svg>';
const fontStandIn =
  "@font-face { font-family: 'Noto Sans JP'; src: url(https://fonts.gstatic.com/s/stand-in.woff2) format('woff2'); }";

async function prepare(context) {
  await context.route(/^https:\/\/(img\.shields\.io|ko-fi\.com\/img)\//, (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: badgeStandIn }),
  );
  await context.route(/^https:\/\/fonts\.googleapis\.com\//, (route) =>
    route.fulfill({ contentType: 'text/css', body: fontStandIn }),
  );
  await context.route(/^https:\/\/fonts\.gstatic\.com\//, (route) =>
    route.fulfill({ contentType: 'font/woff2', body: '' }),
  );
  // Checks import Playload's source modules into its pages; the build does not publish them.
  await context.route(`${baseURL}/src/**`, async (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: await readFile(new URL('.' + new URL(route.request().url()).pathname, root)),
    }),
  );
}

// Every check runs with these stand-ins and fails on an uncaught page error, including in the
// contexts and pages it creates itself. A check that expects an error uses @playwright/test's
// test directly.
export const test = base.extend({
  context: async ({ context }, use) => {
    await prepare(context);
    await use(context);
  },
  pageErrors: [
    async ({ browser, context }, use) => {
      const errors = [],
        contexts = new Set(),
        report = (error) => errors.push(error.error().message),
        watch = (created) => {
          contexts.add(created);
          created.on('weberror', report);
        },
        create = (created) => {
          watch(created);
          return prepare(created);
        };
      watch(context);
      browser.on('context', create);
      try {
        await use(errors);
        expect(errors).toEqual([]);
      } finally {
        browser.off('context', create);
        for (const created of contexts) created.off('weberror', report);
      }
    },
    { auto: true },
  ],
});

// The preview checks its selection only after the image decodes, so a late image's chance
// to replace or reopen the preview has passed once every decode has settled.
export async function trackDecodes(page) {
  await page.addInitScript(() => {
    window.imageDecodes = [];
    const decode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = function () {
      const decoded = decode.call(this);
      window.imageDecodes.push(decoded.catch(() => {}));
      return decoded;
    };
  });
}

export const decodesSettled = (page) =>
  page.evaluate(async () => {
    await Promise.all(window.imageDecodes);
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });

// Records content-policy violations in every document the page loads.
export async function watchPolicyViolations(page) {
  await page.addInitScript(() => {
    window.policyViolations = [];
    document.addEventListener('securitypolicyviolation', (event) =>
      window.policyViolations.push(`${event.violatedDirective} ${event.blockedURI}`),
    );
  });
}

export const policyViolations = (page) => page.evaluate(() => window.policyViolations);

export { expect };
