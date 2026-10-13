import { baseURL } from '../../playwright.config.js';
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { marked } from 'marked';

const legacy = '#1.09dXcCjJLMlJVfBJTU9MruRKK81LLsnMz1MoyUzO1tBUqFZIzinWMNG0VqgFAA';
const source = '// @title Legacy\nfunction tick() { cls(4); }';

test('the project license declares UTF-8 and renders its original text', async ({
  page,
  request,
}) => {
  const original = await readFile(new URL('../../LICENSE', import.meta.url), 'utf8');
  const response = await request.get('/playload/LICENSE');
  expect(response.ok()).toBe(true);
  expect(response.headers()['content-type']).toBe('text/plain; charset=utf-8');
  expect(await response.text()).toBe(original);
  await page.goto('/playload/LICENSE');
  expect(await page.evaluate(() => document.characterSet)).toBe('UTF-8');
  expect(await page.locator('body').textContent()).toBe(original);
});

test('README and About use the same introduction, section order, specifications, instructions, support and license wording', async ({
  page,
}) => {
  const readme = await readFile(new URL('../../README.md', import.meta.url), 'utf8');
  await page.goto('/playload/');
  const content = await page.evaluate((html) => {
    const document = new DOMParser().parseFromString(html, 'text/html');
    const normalize = (text) => text.replace(/\s*↗/g, '').replace(/\s+/g, ' ').trim();
    const paragraphs = Array.from(document.querySelectorAll('body > p'));
    const lists = Array.from(document.querySelectorAll('body > ul'));
    const about = window.document.querySelector('#about');
    const support = [];
    const heading = Array.from(document.querySelectorAll('h2')).find(
      (node) => node.textContent === 'Support Playload',
    );
    for (
      let node = heading.nextElementSibling;
      node?.tagName === 'P';
      node = node.nextElementSibling
    )
      support.push(node.textContent);
    const aboutSupport = [];
    const aboutHeading = Array.from(about.querySelectorAll('h3')).find(
      (node) => node.textContent === 'Support Playload',
    );
    for (
      let node = aboutHeading.nextElementSibling;
      node?.tagName === 'P' && !node.className;
      node = node.nextElementSibling
    )
      aboutSupport.push(node.textContent);
    return {
      readme: {
        tagline: normalize(paragraphs.find((node) => !node.querySelector('img')).textContent),
        features: Array.from(document.querySelector('ul').children, (node) =>
          normalize(node.textContent),
        ),
        instructions: paragraphs
          .filter((node) => node.textContent.startsWith('Edit your game'))
          .map((node) => normalize(node.textContent)),
        support: support.map(normalize),
        headings: Array.from(document.querySelectorAll('h2'))
          .map((node) => node.textContent)
          .filter((text) =>
            ['Specifications', 'Create and share', 'Support Playload', 'License'].includes(text),
          ),
        materials: Array.from(lists.at(-1).children, (node) => normalize(node.textContent)),
        license: paragraphs
          .filter(
            (node) =>
              node.textContent.startsWith("Playload's code") ||
              node.textContent.startsWith('Bundled third-party'),
          )
          .map((node) => normalize(node.textContent)),
      },
      about: {
        tagline: normalize(about.querySelector('.about-tagline').textContent),
        features: Array.from(about.querySelector('.about-features').children, (node) =>
          normalize(node.textContent),
        ),
        instructions: Array.from(about.querySelectorAll('.about-instructions p'), (node) =>
          normalize(node.textContent),
        ),
        support: aboutSupport.map(normalize),
        headings: Array.from(about.querySelectorAll('h3')).map((node) => node.textContent),
        license: Array.from(about.querySelectorAll('.about-license p'), (node) =>
          normalize(node.textContent),
        ),
        materials: Array.from(about.querySelectorAll('.about-license li'), (node) =>
          normalize(node.textContent),
        ),
      },
    };
  }, marked.parse(readme));
  expect(content.about).toEqual(content.readme);
});

for (const touch of [false, true]) {
  test(`About gives the shared introduction, source and support on ${touch ? 'phone' : 'desktop'}`, async ({
    browser,
  }, testInfo) => {
    const page = await browser.newPage({
      viewport: touch ? { width: 390, height: 844 } : { width: 1280, height: 800 },
      hasTouch: touch,
      isMobile: touch,
    });
    try {
      await page.goto(baseURL + '/playload/' + legacy);
      await expect(page.locator('#editor')).toHaveValue(source);
      const original = page.url();
      await page.getByRole('tab', { name: 'Info', exact: true }).click();
      await expect(page.getByRole('tab', { name: 'About', exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(
        (await page.locator('.reference-tabs button').allTextContents()).map((text) => text.trim()),
      ).toEqual(['About', 'API', 'Emoji', 'Symbols', 'Alphabet', 'Kana', 'Examples']);
      await expect(page.locator('#about')).toBeVisible();
      await expect(page.locator('#about img')).toHaveCount(0);
      await expect(page.locator('#about .about-features li')).toHaveCount(7);
      await expect(page.getByRole('link', { name: 'buy me a coffee on Ko-fi ↗' })).toHaveAttribute(
        'href',
        'https://ko-fi.com/H2H27VDKD',
      );
      await expect(
        page.locator('#about').getByRole('link', { name: 'Source code ↗' }),
      ).toHaveAttribute('href', 'https://github.com/kitao/playload');
      await expect(page.getByRole('link', { name: 'sponsor me on GitHub ↗' })).toHaveAttribute(
        'href',
        'https://github.com/sponsors/kitao',
      );
      await expect(page.locator('#about')).not.toContainText('Make it. Share it. Play it.');
      await expect(
        page.locator('#about').getByRole('heading', { name: 'Specifications' }),
      ).toBeVisible();
      await expect(page.locator('#about')).not.toContainText('temporarily unavailable');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: testInfo.outputPath(`about-${touch ? 'phone' : 'desktop'}.png`),
      });
      await expect(page.locator('#about')).not.toContainText('User guide');
      await expect(page.locator('.about-license')).not.toContainText('Created by');
      const typography = (element) => {
        const style = getComputedStyle(element);
        return [style.fontFamily, style.fontSize, style.color, style.lineHeight];
      };
      expect(await page.locator('.about-license p').first().evaluate(typography)).toEqual(
        await page.locator('.about-instructions p').first().evaluate(typography),
      );
      await expect(
        page.locator('.about-license').getByRole('link', { name: 'MIT', exact: true }),
      ).toHaveAttribute('href', '/playload/LICENSE');
      await expect(page.locator('#about')).not.toContainText('Resource notices');
      await expect(
        page.getByRole('link', { name: 'starring the project on GitHub ↗' }),
      ).toHaveAttribute('href', 'https://github.com/kitao/playload');
      const licenses = page.locator('.about-license');
      await expect(page.locator('#about details, #about summary')).toHaveCount(0);
      await expect(licenses.locator('li')).toHaveCount(11);
      const listStyle = (element) => {
        const style = getComputedStyle(element);
        return [
          style.fontFamily,
          style.fontSize,
          style.fontWeight,
          style.color,
          style.lineHeight,
          style.marginTop,
          style.marginBottom,
          style.paddingLeft,
        ];
      };
      expect(await page.locator('.about-features').evaluate(listStyle)).toEqual(
        await licenses.locator('ul').evaluate(listStyle),
      );
      expect(await page.locator('.about-features li').first().evaluate(listStyle)).toEqual(
        await licenses.locator('li').first().evaluate(listStyle),
      );
      expect(await page.locator('.about-features li').first().evaluate(typography)).toEqual(
        await page.locator('.about-instructions p').first().evaluate(typography),
      );
      await licenses.locator('li').last().scrollIntoViewIfNeeded();
      await expect(licenses.getByRole('link', { name: 'Misaki Gothic' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: testInfo.outputPath(`licenses-${touch ? 'phone' : 'desktop'}.png`),
      });
      expect(page.url()).toBe(original);
      await expect(page.locator('#editor')).toHaveValue(source);
      await page.getByRole('tab', { name: 'API', exact: true }).click();
      await expect(page.locator('#api')).toBeVisible();
      await page.getByRole('tab', { name: 'Play', exact: true }).click();
      if (await page.locator('#start-game').isVisible()) await page.locator('#start-game').click();
      await expect(page.locator('#pause')).toBeEnabled();
      if (touch) await page.locator('#tools-toggle').click();
      await page.locator('#crt').click();
      expect(
        await page
          .locator('#display')
          .evaluate((canvas) => Array.from(canvas.getContext('2d').getImageData(0, 0, 1, 1).data)),
      ).toEqual([80, 140, 215, 255]);
      expect(new URL(page.url()).hash).toBe(legacy);
      if (touch) await page.locator('#code-toggle').click();
      await page.locator('#editor').fill(source + '\n// edited');
      await expect.poll(() => new URL(page.url()).hash).toMatch(/^#v1\./);
    } finally {
      await page.close();
    }
  });
}

test('slash normalization retains a legacy fragment and unavailable paths return 404', async ({
  page,
}) => {
  await page.goto('/playload?ref=legacy' + legacy);
  await expect(page).toHaveURL(baseURL + '/playload/?ref=legacy' + legacy);
  await expect(page.locator('#editor')).toHaveValue(source);
  await page.goto('/playload/index.html?ref=legacy' + legacy);
  await expect(page).toHaveURL(baseURL + '/playload/?ref=legacy' + legacy);
  for (const path of [
    '/playload/app/',
    '/playload/user-guide/',
    '/playload/missing/',
    '/playload/NOTICE.txt',
    '/playload/notices/misaki.txt',
    '/playload/README.md',
    '/playload/CHANGELOG.md',
    '/playload/docs/',
    '/playload/data/',
    '/playload/examples/starter.js',
    '/playload/assets/images/example-starter.jpg',
    '/another-project/',
  ]) {
    const response = await page.goto(path);
    expect(response.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  }
});

test('palette swatches display their codes without copying or changing the draft', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.paletteCopies = [];
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (text) => window.paletteCopies.push(text) },
    });
  });
  await page.goto('/playload/' + legacy);
  await expect(page.locator('#editor')).toHaveValue(source);
  await page.getByRole('tab', { name: 'Info', exact: true }).click();
  const original = page.url();
  await expect(page.locator('#palette button')).toHaveCount(0);
  await expect(page.locator('#palette .hex')).toHaveCount(8);
  for (const swatch of await page.locator('#palette .color').all()) await swatch.click();
  expect(await page.evaluate(() => window.paletteCopies)).toEqual([]);
  await expect(page.locator('#status')).toBeEmpty();
  expect(page.url()).toBe(original);
  await expect(page.locator('#editor')).toHaveValue(source);
});
