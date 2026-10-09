import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { renderReference } from './reference-renderer.js';

test('CRT reconstruction agrees with the frozen Lottes shader at matched settings', async ({
  page,
}, testInfo) => {
  const source = await readFile(new URL('./reference/crt-lottes.glsl', import.meta.url), 'utf8');
  expect(createHash('sha256').update(source).digest('hex')).toBe(
    '699a947fc2744eb7e2dc4adb2c08a8b74e31685baa77cbc1face9593106b57ef',
  );
  await page.goto('/');
  const result = await page.evaluate(
    async ({ source, reference }) => {
      const { createCRT } = await import('/src/crt.js'),
        { palette, createEngine } = await import('/src/engine.js'),
        { glyphs } = await import('/src/glyphs.js');
      const renderer = createCRT(palette),
        drawReference = new Function('return (' + reference + ')')();
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 576;
      const ctx = canvas.getContext('2d'),
        patterns = [];
      patterns.push(new Uint8Array(160 * 144).fill(7));
      patterns.push(
        Uint8Array.from({ length: 160 * 144 }, (_, i) =>
          ((i % 160) + Math.floor(i / 160)) % 2 ? 7 : 0,
        ),
      );
      patterns.push(Uint8Array.from({ length: 160 * 144 }, (_, i) => Math.floor((i % 160) / 20)));
      const engine = createEngine(glyphs, () => {});
      for (let cy = 0; cy < 18; cy++) engine.api.put(0, cy, 'AY CRT 0123 👾💎');
      patterns.push(engine.pixels);
      const reports = [];
      for (const pixels of patterns) {
        renderer.render(pixels);
        ctx.drawImage(renderer.canvas, 0, 0);
        const actual = ctx.getImageData(0, 0, 640, 576).data;
        ctx.drawImage(drawReference(source, pixels, palette), 0, 0);
        const expected = ctx.getImageData(0, 0, 640, 576).data;
        let total = 0,
          maximum = 0,
          count = 0;
        // Edge handling intentionally differs: Playload returns black for each
        // off-screen source tap; upstream clamps taps to the edge texel.
        for (let y = 48; y < 528; y++)
          for (let x = 48; x < 592; x++)
            for (let c = 0; c < 3; c++) {
              const i = (y * 640 + x) * 4 + c,
                error = Math.abs(actual[i] - expected[i]);
              total += error;
              maximum = Math.max(maximum, error);
              count++;
            }
        reports.push({ mean: total / count, maximum });
      }
      return reports;
    },
    { source, reference: renderReference.toString() },
  );
  console.log('CRT reference differences (8-bit RGB):', JSON.stringify(result));
  await testInfo.attach('crt-reference-metrics', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  });
  for (const report of result) {
    expect(report.mean).toBeLessThan(0.01);
    expect(report.maximum).toBeLessThanOrEqual(1);
  }
});
