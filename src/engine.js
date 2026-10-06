export const palette = ['#000000', '#55415f', '#646964', '#d77355', '#508cd7', '#64b964', '#e6c86e', '#dcf5ff'];

// This function also runs in the game worker. Keep its dependencies explicit.
export function createEngine(presets = [], compileScore = s => s) {
  const width = 160, height = 144;
  const pixels = new Uint8Array(width * height);
  const characters = Object.create(null), cache = new Map();
  const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
  let ink = 7, paper = 0, held = 0, pressed = 0;
  let sounds = [];
  const key = s => s.normalize('NFC').replace(/[\ufe0e\ufe0f]/g, '');
  const color = c => {
    if (!Number.isInteger(c) || c < 0 || c > 7) throw new RangeError('Color must be 0–7');
    return c;
  };
  const button = b => {
    if (!Number.isInteger(b) || b < 0 || b > 5) throw new RangeError('Button must be 0–5 (UDLRAB)');
    return 1 << b;
  };
  function character() {
    const rows = new Uint8Array(8);
    const colors = new Proxy([null, null], {
      set(target, index, value) {
        if (index !== '0' && index !== '1') throw new RangeError('Glyph colors have two entries');
        target[index] = value == null ? null : color(value);
        return true;
      }
    });
    return Object.defineProperties({}, {
      pat: { enumerable: true, get: () => rows, set(value) {
        if (typeof value === 'string') {
          if (!/^[0-9a-f]{16}$/i.test(value)) throw new TypeError('Pattern needs 16 hex digits');
          value = Array.from({ length: 8 }, (_, i) => parseInt(value.slice(i * 2, i * 2 + 2), 16));
        }
        if (!value || value.length !== 8 || !Array.from(value).every(v => Number.isInteger(v) && v >= 0 && v <= 255)) {
          throw new TypeError('Pattern needs 8 row bytes');
        }
        rows.set(value);
      } },
      col: { enumerable: true, get: () => colors, set(value) {
        if (value == null) value = [null, null];
        if (!Array.isArray(value) || value.length !== 2) throw new TypeError('Colors need [ink, paper]');
        const next = value.map(v => v == null ? null : color(v));
        colors[0] = next[0]; colors[1] = next[1];
      } }
    });
  }
  function lookup(ch) {
    const k = key(ch);
    return characters[k] ??= character();
  }
  for (const preset of presets) {
    const g = lookup(preset.ch);
    g.pat = preset.rows; g.col = [preset.ink ?? null, preset.paper ?? null];
  }
  const pcg = new Proxy(characters, {
    get: (target, ch) => typeof ch === 'string' ? lookup(ch) : Reflect.get(target, ch),
    set() { throw new TypeError('Set pcg[ch].pat or pcg[ch].col'); }
  });
  function cls(c = 0) { pixels.fill(color(c)); }
  function col(foreground = 7, background = 0) { const nextInk = color(foreground), nextPaper = color(background); ink = nextInk; paper = nextPaper; }
  function put(text, x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new TypeError('Coordinates must be finite numbers');
    const origin = Math.trunc(x);
    x = origin; y = Math.trunc(y);
    for (const { segment: ch } of segmenter.segment(String(text).replace(/\r\n/g, '\n'))) {
      if (ch === '\n') { x = origin; y += 8; continue; }
      const g = lookup(ch), foreground = g.col[0] ?? ink, background = g.col[1] ?? paper;
      for (let row = 0; row < 8; row++) {
        const py = y + row;
        if (py < 0 || py >= height) continue;
        for (let bit = 0; bit < 8; bit++) {
          const px = x + bit;
          if (px >= 0 && px < width) pixels[py * width + px] = g.pat[row] & (128 >> bit) ? foreground : background;
        }
      }
      x += 8;
    }
  }
  function play(ch, score) {
    if (!Number.isInteger(ch) || ch < 0 || ch > 2) throw new RangeError('Sound channel must be 0–2');
    if (typeof score !== 'string') throw new TypeError('Score must be a string');
    if (!cache.has(score)) {
      const compiled = compileScore(score);
      if (cache.size >= 256) cache.delete(cache.keys().next().value);
      cache.set(score, compiled);
    }
    sounds.push({ ch, score: cache.get(score) });
  }
  const api = { cls, put, col, btn: b => !!(held & button(b)), btnp: b => !!(pressed & button(b)), play, pcg };
  return {
    api, pixels,
    input(mask) { mask &= 63; pressed |= mask & ~held; held = mask; },
    step(tick) { try { tick(); } finally { pressed = 0; } },
    sounds() { const result = sounds; sounds = []; return result; }
  };
}
