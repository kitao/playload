import test from 'node:test';
import assert from 'node:assert/strict';
import { createDisplay } from '../src/display.js';
import { palette } from '../src/engine.js';

const rgb = palette.map((hex) =>
  [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)),
);

test('the flat display preserves every palette color and scales each pixel to four by four', () => {
  const display = createDisplay(palette);
  const pixels = Uint8Array.from(
    { length: 160 * 144 },
    (_, i) => ((i % 160) + Math.floor(i / 160)) % 8,
  );
  const before = pixels.slice(),
    data = display.render(pixels);
  assert.equal(data.length, 640 * 576 * 4);
  for (let y = 0; y < 576; y++)
    for (let x = 0; x < 640; x++) {
      const color = pixels[Math.floor(y / 4) * 160 + Math.floor(x / 4)],
        offset = (y * 640 + x) * 4;
      for (let channel = 0; channel < 3; channel++)
        assert.equal(data[offset + channel], rgb[color][channel]);
      assert.equal(data[offset + 3], 255);
    }
  assert.deepEqual(pixels, before);
});

test('CRT curves a horizontal line and retains content near all four source corners', () => {
  const pixels = new Uint8Array(160 * 144),
    display = createDisplay(palette);
  for (let x = 0; x < 160; x++) pixels[4 * 160 + x] = 7;
  for (const [left, top] of [
    [0, 0],
    [152, 0],
    [0, 136],
    [152, 136],
  ]) {
    for (let y = top; y < top + 8; y++) pixels.fill(7, y * 160 + left, y * 160 + left + 8);
  }
  const before = pixels.slice(),
    data = display.render(pixels, true);
  const lit = (x, y) => data[(y * 640 + x) * 4] > 0;
  const firstLit = (x) => {
    for (let y = 0; y < 576; y++) if (lit(x, y)) return y;
    return -1;
  };
  const middle = firstLit(320);
  // The upstream default bends this line by about five output pixels here;
  // reject both flat geometry and the previous, exaggerated curvature.
  for (const x of [100, 539]) assert(firstLit(x) - middle >= 4 && firstLit(x) - middle <= 6);
  for (const [left, top] of [
    [0, 0],
    [540, 0],
    [0, 476],
    [540, 476],
  ]) {
    let visible = false;
    for (let y = top; y < top + 100; y++)
      for (let x = left; x < left + 100; x++) visible ||= lit(x, y);
    assert(visible, 'corner content must remain visible');
  }
  assert.deepEqual(pixels, before);
  const vertical = new Uint8Array(160 * 144);
  for (let y = 0; y < 144; y++) vertical[y * 160 + 4] = 7;
  const verticalData = display.render(vertical, true);
  const firstColumn = (y) => {
    for (let x = 0; x < 640; x++) if (verticalData[(y * 640 + x) * 4] > 0) return x;
    return -1;
  };
  for (const y of [90, 485])
    assert(firstColumn(y) - firstColumn(288) >= 3 && firstColumn(y) - firstColumn(288) <= 5);
});

test('CRT has opaque black borders, scanlines and edge shading, and can return to a flat image', () => {
  const pixels = new Uint8Array(160 * 144).fill(7),
    display = createDisplay(palette);
  const plain = display.render(pixels).slice(),
    curved = display.render(pixels, true);
  for (const offset of [0, 639 * 4, 575 * 640 * 4, (640 * 576 - 1) * 4]) {
    assert.deepEqual([...curved.slice(offset, offset + 4)], [0, 0, 0, 255]);
  }
  for (let i = 3; i < curved.length; i += 4) assert.equal(curved[i], 255);
  const maxAt = (x, y) =>
    Math.max(...Array.from({ length: 8 }, (_, dy) => curved[((y + dy) * 640 + x) * 4]));
  assert(maxAt(320, 280) > maxAt(40, 280));
  const levels = Array.from({ length: 8 }, (_, dy) => curved[((280 + dy) * 640 + 320) * 4]);
  assert(Math.max(...levels) - Math.min(...levels) > 20);
  assert.deepEqual(display.render(pixels, false), plain);
});

test('CRT keeps every edge pixel visible at four-times scale', () => {
  const display = createDisplay(palette),
    pixels = new Uint8Array(160 * 144);
  const edges = [
    ...Array.from({ length: 160 }, (_, x) => [x, 0]),
    ...Array.from({ length: 160 }, (_, x) => [x, 143]),
    ...Array.from({ length: 142 }, (_, y) => [0, y + 1]),
    ...Array.from({ length: 142 }, (_, y) => [159, y + 1]),
  ];
  for (const [x, y] of edges) {
    pixels.fill(0);
    pixels[y * 160 + x] = 7;
    const data = display.render(pixels, true);
    let area = 0;
    for (let offset = 0; offset < data.length; offset += 4) {
      if (data[offset] > 0) area++;
    }
    // At four-times scale, curvature still leaves at least nine samples per pixel.
    assert(area >= 9, `edge pixel (${x}, ${y}) was cut to ${area} samples`);
  }
});

test('CRT surrounds the curved glass with the capture background while retaining game black', () => {
  const display = createDisplay(palette, 640, 576, '#211c29'),
    pixels = new Uint8Array(160 * 144),
    data = display.render(pixels, true);
  for (const [x, y] of [
    [0, 0],
    [639, 0],
    [0, 575],
    [639, 575],
    [320, 0],
    [320, 575],
    [0, 288],
    [639, 288],
  ]) {
    const offset = (y * 640 + x) * 4;
    assert.deepEqual([...data.slice(offset, offset + 4)], [33, 28, 41, 255]);
  }
  const center = (288 * 640 + 320) * 4;
  assert.deepEqual([...data.slice(center, center + 4)], [0, 0, 0, 255]);
  assert.deepEqual([...display.render(pixels, false).slice(0, 4)], [0, 0, 0, 255]);
});
