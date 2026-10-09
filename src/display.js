// Render into the capture canvas so screenshots and video include the CRT effect.
export function createDisplay(palette, width = 640, height = 576) {
  const data = new Uint8ClampedArray(width * height * 4);
  const output = new Uint32Array(data.buffer);
  const plain = new Int32Array(width * height),
    curved = new Int32Array(width * height);
  const brightness = new Uint8Array(width * height);
  const colors = new Uint8ClampedArray(256 * 8 * 4);
  const packed = new Uint32Array(colors.buffer);
  for (let level = 0; level < 256; level++) {
    for (let c = 0; c < 8; c++) {
      const offset = (level * 8 + c) * 4;
      for (let channel = 0; channel < 3; channel++) {
        colors[offset + channel] =
          (parseInt(palette[c].slice(1 + channel * 2, 3 + channel * 2), 16) * level) / 255;
      }
      colors[offset + 3] = 255;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x,
        u = (2 * (x + 0.5)) / width - 1,
        v = (2 * (y + 0.5)) / height - 1;
      plain[i] = Math.floor((y * 144) / height) * 160 + Math.floor((x * 160) / width);
      // Inverse barrel mapping: straight game rows curve toward the glass edges.
      // A small inset keeps the complete source image inside the curved screen.
      // Match CRT-Lottes' default horizontal and vertical curvature.
      const sx = (u * (1 + 0.031 * v * v)) / 0.98,
        sy = (v * (1 + 0.041 * u * u)) / 0.98;
      if (Math.abs(sx) >= 1 || Math.abs(sy) >= 1) {
        curved[i] = -1;
        continue;
      }
      const sourceY = (sy + 1) * 72;
      curved[i] = Math.floor(sourceY) * 160 + Math.floor((sx + 1) * 80);
      const scanline = 1 - 0.22 * Math.sin(Math.PI * sourceY) ** 8;
      const vignette = 1 - (0.18 * (u * u + v * v)) / 2;
      brightness[i] = Math.round(255 * scanline * vignette);
    }
  }
  return {
    width,
    height,
    render(pixels, crt = false) {
      const map = crt ? curved : plain;
      for (let i = 0; i < output.length; i++) {
        output[i] = packed[map[i] < 0 ? 0 : (crt ? brightness[i] : 255) * 8 + pixels[map[i]]];
      }
      return data;
    },
  };
}
