import test from 'node:test';
import assert from 'node:assert/strict';
import { createDisplay } from '../src/app/display.js';
import { palette } from '../src/engine/engine.js';

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

test('flat scaling handles smaller dimensions and reuses the output buffer', () => {
  const display = createDisplay(palette, 3, 2),
    pixels = new Uint8Array(160 * 144);
  for (const [offset, color] of [
    [0, 1],
    [53, 2],
    [106, 3],
    [72 * 160, 4],
    [72 * 160 + 53, 5],
    [72 * 160 + 106, 6],
  ])
    pixels[offset] = color;
  const output = display.render(pixels);
  assert.deepEqual(
    [...output],
    [1, 2, 3, 4, 5, 6].flatMap((color) => [...rgb[color], 255]),
  );
  pixels.fill(7);
  assert.equal(display.render(pixels), output);
  assert.deepEqual([...output], Array.from({ length: 6 }, () => [...rgb[7], 255]).flat());
});
