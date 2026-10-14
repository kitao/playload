// Nearest-neighbor output for flat mode. CRT uses the WebGL renderer.
export function createDisplay(palette, width = 640, height = 576) {
  const data = new Uint8ClampedArray(width * height * 4),
    output = new Uint32Array(data.buffer),
    map = new Uint16Array(width * height),
    colors = new Uint8ClampedArray(8 * 4),
    packed = new Uint32Array(colors.buffer);
  for (let c = 0; c < 8; c++) {
    for (let channel = 0; channel < 3; channel++)
      colors[c * 4 + channel] = parseInt(palette[c].slice(1 + channel * 2, 3 + channel * 2), 16);
    colors[c * 4 + 3] = 255;
  }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      map[y * width + x] = Math.floor((y * 144) / height) * 160 + Math.floor((x * 160) / width);
  return {
    width,
    height,
    render(pixels) {
      for (let i = 0; i < output.length; i++) output[i] = packed[pixels[map[i]]];
      return data;
    },
  };
}
