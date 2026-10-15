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
  await page.goto('/playload/app/');
  const result = await page.evaluate(
    async ({ source, reference }) => {
      const { createCRT } = await import('/src/app/crt.js'),
        { palette, createEngine } = await import('/src/engine/engine.js'),
        { glyphs } = await import('/src/engine/glyphs.js');
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

test('CRT and flat mode have the same maximum picture width and height', async ({
  page,
}, testInfo) => {
  await page.goto('/playload/app/');
  const result = await page.evaluate(async () => {
    const { createCRT } = await import('/src/app/crt.js'),
      { createDisplay } = await import('/src/app/display.js'),
      { palette } = await import('/src/engine/engine.js');
    const pixels = new Uint8Array(160 * 144).fill(7),
      renderer = createCRT(palette),
      gl = renderer.canvas.getContext('webgl'),
      crt = new Uint8Array(640 * 576 * 4);
    renderer.render(pixels);
    gl.readPixels(0, 0, 640, 576, gl.RGBA, gl.UNSIGNED_BYTE, crt);
    const flat = createDisplay(palette).render(pixels);
    // A filled picture measures the actual extent. An isolated edge dot's
    // brightness centroid shifts inward when its halo meets the canvas edge.
    const measure = (rgba) => {
      const light = (x, y) => {
        const i = (y * 640 + x) * 4;
        return rgba[i] + rgba[i + 1] + rgba[i + 2];
      };
      const horizontal = Array.from({ length: 640 }, (_, x) =>
        Math.max(...[286, 287, 288, 289].map((y) => light(x, y))),
      );
      const vertical = Array.from({ length: 576 }, (_, y) =>
        Math.max(...[318, 319, 320, 321].map((x) => light(x, y))),
      );
      const span = (line) => {
        // Half peak excludes the faint glow; the narrow center band avoids
        // measuring a phosphor stripe or scanline trough as the picture edge.
        const threshold = Math.max(...line) / 2;
        return (
          line.findLastIndex((value) => value >= threshold) -
          line.findIndex((value) => value >= threshold) +
          1
        );
      };
      return { width: span(horizontal), height: span(vertical) };
    };
    return { crt: measure(crt), flat: measure(flat) };
  });
  await testInfo.attach('crt-picture-size', {
    body: JSON.stringify(result),
    contentType: 'application/json',
  });
  expect(result.flat).toEqual({ width: 640, height: 576 });
  expect(result.crt).toEqual(result.flat);
});

test('CRT glass preserves every edge pixel and its phosphor glow', async ({ page }) => {
  const source = await readFile(new URL('../../src/app/crt.js', import.meta.url), 'utf8');
  expect(source).toContain('mix(background, srgb + surround, glass)');
  await page.goto('/playload/app/');
  const result = await page.evaluate(async (source) => {
    const { createCRT } = await import('/src/app/crt.js'),
      { palette } = await import('/src/engine/engine.js');
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
