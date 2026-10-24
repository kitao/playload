// Offline color selection; never loaded by the game or the web tool.
export const colorPolicy = Object.freeze({
  minimumChroma: 20,
  clusterWidth: 8,
  contrastTarget: 3,
});

// sRGB -> CIELAB, with its D65 reference white.
export function lab(hex) {
  const [r, g, b] = rgb(hex);
  const f = (v) => (v > (6 / 29) ** 3 ? Math.cbrt(v) : v / (3 * (6 / 29) ** 2) + 4 / 29);
  const x = f((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047);
  const y = f(0.2126729 * r + 0.7151522 * g + 0.072175 * b);
  const z = f((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

// CIEDE2000 with unit parametric factors. Verified against Sharma/Wu/Dalal's
// published test pairs, including the hue-wrap discontinuities.
export function deltaE([l1, a1, b1], [l2, a2, b2]) {
  const c = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const g = (1 - Math.sqrt(c ** 7 / (c ** 7 + 25 ** 7))) / 2;
  const ap1 = (1 + g) * a1,
    ap2 = (1 + g) * a2;
  const cp1 = Math.hypot(ap1, b1),
    cp2 = Math.hypot(ap2, b2);

  const hue = (a, b) => ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  const h1 = cp1 === 0 ? 0 : hue(ap1, b1),
    h2 = cp2 === 0 ? 0 : hue(ap2, b2);
  let dh = h2 - h1;
  if (cp1 * cp2 === 0) dh = 0;
  else if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;

  let h = h1 + h2;
  if (cp1 * cp2 !== 0) {
    if (Math.abs(h1 - h2) > 180) h += h < 360 ? 360 : -360;
    h /= 2;
  }

  const lp = (l1 + l2) / 2,
    cp = (cp1 + cp2) / 2;
  const t =
    1 - 0.17 * cos(h - 30) + 0.24 * cos(2 * h) + 0.32 * cos(3 * h + 6) - 0.2 * cos(4 * h - 63);
  const sl = 1 + (0.015 * (lp - 50) ** 2) / Math.sqrt(20 + (lp - 50) ** 2);
  const sc = 1 + 0.045 * cp,
    sh = 1 + 0.015 * cp * t;
  const rt =
    -2 * Math.sqrt(cp ** 7 / (cp ** 7 + 25 ** 7)) * sin(60 * Math.exp(-(((h - 275) / 25) ** 2)));

  const dl = (l2 - l1) / sl,
    dc = (cp2 - cp1) / sc;
  const dH = (2 * Math.sqrt(cp1 * cp2) * sin(dh / 2)) / sh;
  return Math.sqrt(dl * dl + dc * dc + dH * dH + rt * dc * dH);
}

export function contrast(first, second = '#000000') {
  const luminance = (hex) => {
    const [r, g, b] = rgb(hex);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const a = luminance(first),
    b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// Area-weighted density in perceptual color space. A representative is an
// observed color, not an RGB average of unrelated hues. Each nearby shade
// reinforces the same cluster; unrelated gray parts do not form one majority.
export function dominantColor(samples) {
  const colors = samples
    .map(([hex, weight]) => ({ hex, weight, lab: lab(hex) }))
    .sort((a, b) => a.hex.localeCompare(b.hex));
  const total = colors.reduce((sum, c) => sum + c.weight, 0);
  if (!total) return null;

  let best,
    support = -1;
  for (const candidate of colors) {
    const density = colors.reduce(
      (sum, c) =>
        sum +
        c.weight * Math.exp(-0.5 * (deltaE(candidate.lab, c.lab) / colorPolicy.clusterWidth) ** 2),
      0,
    );
    if (density > support || (density === support && candidate.hex < best.hex)) {
      best = candidate;
      support = density;
    }
  }

  return best.hex;
}

export function paletteInk(reference, palette) {
  if (reference === null) return 7;
  const target = lab(reference);
  // A single ink reproduces the source's tint, not its shaded lighting. Compare
  // chromatic colors at equal lightness; neutral colors retain their lightness.
  // Black is paper, so neutral artwork uses gray or white rather than vanishing.
  const chromatic = Math.hypot(target[1], target[2]) >= colorPolicy.minimumChroma;
  const tint = (value) => (chromatic ? [50, value[1], value[2]] : value);
  const ranked = palette
    .slice(1)
    .map((hex, i) => {
      const value = lab(hex);
      return {
        ink: i + 1,
        chromatic: Math.hypot(value[1], value[2]) >= colorPolicy.minimumChroma,
        distance: deltaE(tint(target), tint(value)),
        contrast: contrast(hex),
      };
    })
    .filter((c) => c.chromatic === chromatic && c.contrast >= colorPolicy.contrastTarget);
  ranked.sort((a, b) => a.distance - b.distance || a.ink - b.ink);

  // This limits default emoji ink, not the engine palette or game overrides.
  return ranked[0].ink;
}

export function emojiColor(samples, palette) {
  const reference = dominantColor(samples);
  // Flat, dark neutral artwork is foreground ink intended for a light surface.
  // Render it in white on our black paper; shaded objects retain their colors.
  const flatNeutral =
    samples.length === 1 &&
    Math.hypot(...lab(reference).slice(1)) < colorPolicy.minimumChroma &&
    contrast(reference) < colorPolicy.contrastTarget;
  return { reference, ink: flatNeutral ? 7 : paletteInk(reference, palette) };
}

const linear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

const rgb = (hex) => [1, 3, 5].map((i) => linear(parseInt(hex.slice(i, i + 2), 16) / 255));

const radians = (degrees) => (degrees * Math.PI) / 180;

const sin = (degrees) => Math.sin(radians(degrees));

const cos = (degrees) => Math.cos(radians(degrees));
