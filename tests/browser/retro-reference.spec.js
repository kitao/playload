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

test('CRT glass preserves every edge pixel and its phosphor glow', async ({ page }) => {
  const source = await readFile(new URL('../../src/crt.js', import.meta.url), 'utf8');
  expect(source).toContain('mix(background, srgb + surround, glass)');
  await page.goto('/');
  const result = await page.evaluate(async (source) => {
    const { createCRT } = await import('/src/crt.js'),
      { palette } = await import('/src/engine.js');
    const unmaskedSource = source.replace(
      'mix(background, srgb + surround, glass)',
      'srgb + surround',
    );
    const unmasked = new Function(
      unmaskedSource.replace('export function createCRT', 'function createCRT') +
        '\nreturn createCRT;',
    )();
    const renderers = [createCRT(palette), unmasked(palette)],
      pixels = new Uint8Array(160 * 144),
      rgba = new Uint8Array(640 * 576 * 4);
    const edges = [
      ...Array.from({ length: 160 }, (_, x) => [x, 0]),
      ...Array.from({ length: 160 }, (_, x) => [x, 143]),
      ...Array.from({ length: 142 }, (_, y) => [0, y + 1]),
      ...Array.from({ length: 142 }, (_, y) => [159, y + 1]),
    ];
    let minimumPeak = 1,
      minimumGlow = 1;
    for (const [x, y] of edges) {
      pixels.fill(0);
      pixels[y * 160 + x] = 7;
      const samples = renderers.map((renderer) => {
        renderer.render(pixels);
        const gl = renderer.canvas.getContext('webgl');
        gl.readPixels(0, 0, 640, 576, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
        let peak = 0,
          glow = 0;
        for (let offset = 0; offset < rgba.length; offset += 4) {
          const light = rgba[offset] + rgba[offset + 1] + rgba[offset + 2];
          peak = Math.max(peak, light);
          glow += light;
        }
        return { peak, glow };
      });
      minimumPeak = Math.min(minimumPeak, samples[0].peak / samples[1].peak);
      minimumGlow = Math.min(minimumGlow, samples[0].glow / samples[1].glow);
    }
    return { count: edges.length, minimumPeak, minimumGlow };
  }, source);
  expect(result.count).toBe(604);
  expect(result.minimumPeak).toBe(1);
  expect(result.minimumGlow).toBeGreaterThanOrEqual(0.99);
});
