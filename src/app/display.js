import { rgb } from '../engine/engine.js';

export function createFrameRenderer(paint) {
  let previous = new Uint8Array(160 * 144);
  return {
    get pixels() {
      return previous;
    },
    render(pixels, force = false) {
      let changed = force;
      for (let i = 0; !changed && i < pixels.length; i++) changed = pixels[i] !== previous[i];
      previous = pixels;
      if (changed) paint();
    },
  };
}

// Nearest-neighbor output for flat mode. CRT uses the WebGL renderer.
export function createDisplay(palette, width = 640, height = 576) {
  const data = new Uint8ClampedArray(width * height * 4),
    output = new Uint32Array(data.buffer),
    columns = new Uint8Array(width),
    colors = new Uint8ClampedArray(8 * 4),
    packed = new Uint32Array(colors.buffer);
  for (let c = 0; c < 8; c++) colors.set([...rgb(palette[c]), 255], c * 4);
  for (let x = 0; x < width; x++) columns[x] = Math.floor((x * 160) / width);

  return {
    render(pixels) {
      let previousRow = -1;
      for (let y = 0; y < height; y++) {
        const row = Math.floor((y * 144) / height) * 160;
        const offset = y * width;
        if (row === previousRow) output.copyWithin(offset, offset - width, offset);
        else {
          for (let x = 0; x < width; x++) output[offset + x] = packed[pixels[row + columns[x]]];
          previousRow = row;
        }
      }
      return data;
    },
  };
}
