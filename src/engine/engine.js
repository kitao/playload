export const palette = [
  '#000000',
  '#55415f',
  '#646964',
  '#d77355',
  '#508cd7',
  '#64b964',
  '#e6c86e',
  '#dcf5ff',
];

// This factory is also serialized into the game worker. Keep dependencies inside it.
export function createEngine(presets = [], compileScore = (s) => s) {
  const width = 160,
    height = 144,
    columns = 20,
    lines = 18;
  const pixels = new Uint8Array(width * height);
  const characters = Object.create(null),
    sprites = [],
    cache = new Map();
  const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
  let held = 0,
    pressed = 0,
    sounds = [];
  const color = (col) => {
    if (!Number.isInteger(col) || col < 0 || col > 7) throw new RangeError('Color must be 0–7');
    return col;
  };
  const coordinate = (value) => {
    if (!Number.isFinite(value)) throw new TypeError('Coordinates must be finite numbers');
    return Math.trunc(value);
  };
  const characterKey = (chr) => {
    if (typeof chr !== 'string') throw new TypeError('Character must be a string');
    // cls() writes 360 spaces per tick. ASCII needs no Unicode normalization
    // or grapheme segmentation; keep the same newline rejection as below.
    if (chr.length === 1 && chr.charCodeAt(0) < 128 && chr !== '\r' && chr !== '\n') return chr;
    const normalized = chr.normalize('NFC').replace(/[\ufe0e\ufe0f]/g, '');
    if (
      !normalized ||
      /[\r\n]/.test(normalized) ||
      [...segmenter.segment(normalized)].length !== 1
    ) {
      throw new TypeError('Character must contain one grapheme');
    }
    return normalized;
  };
  const button = (id) => {
    if (!Number.isInteger(id) || id < 0 || id > 5)
      throw new RangeError('Button must be 0–5 (UDLRAB)');
    return 1 << id;
  };
  function colorPair(initial, inherit = false) {
    const validate = (value) => (inherit && value == null ? null : color(value));
    const values = initial.map(validate);
    const pair = new Proxy(values, {
      set(target, index, value) {
        if (index !== '0' && index !== '1') throw new RangeError('Colors have two entries');
        target[index] = validate(value);
        return true;
      },
      deleteProperty() {
        throw new TypeError('Colors have two entries');
      },
      defineProperty() {
        throw new TypeError('Set col[0] or col[1]');
      },
    });
    return {
      enumerable: true,
      get: () => pair,
      set(value) {
        if (!Array.isArray(value) || value.length !== 2)
          throw new TypeError('Colors need [col1, col2]');
        const next = Array.from(value, validate);
        values[0] = next[0];
        values[1] = next[1];
      },
    };
  }
  class PcgElem {
    constructor(rows = new Uint8Array(8), col = [7, 0]) {
      const pattern = new Uint8Array(rows);
      Object.defineProperties(this, {
        pat: {
          enumerable: true,
          get: () => pattern,
          set(value) {
            if (typeof value === 'string') {
              if (!/^[0-9a-f]{16}$/i.test(value))
                throw new TypeError('Pattern needs 16 hex digits');
              value = Array.from({ length: 8 }, (_, i) =>
                parseInt(value.slice(i * 2, i * 2 + 2), 16),
              );
            }
            if (
              !value ||
              value.length !== 8 ||
              !Array.from(value).every((v) => Number.isInteger(v) && v >= 0 && v <= 255)
            ) {
              throw new TypeError('Pattern needs 8 row bytes');
            }
            pattern.set(value);
          },
        },
        col: colorPair(col),
      });
      Object.preventExtensions(this);
    }
  }
  class ScrElem {
    constructor() {
      let chr = ' ';
      Object.defineProperties(this, {
        chr: {
          enumerable: true,
          get: () => chr,
          set(value) {
            chr = characterKey(value);
          },
        },
        col: colorPair([null, null], true),
      });
      Object.preventExtensions(this);
    }
  }
  function lookup(chr) {
    return (characters[chr] ??= new PcgElem());
  }
  for (const preset of presets) {
    // Copy source data; create editable patterns lazily for each game.
    const rows = Uint8Array.from(preset.rows),
      col = [preset.ink ?? 7, preset.paper ?? 0];
    const chr = characterKey(preset.ch);
    Object.defineProperty(characters, chr, {
      configurable: true,
      enumerable: true,
      get() {
        const element = new PcgElem(rows, col);
        Object.defineProperty(characters, chr, {
          value: element,
          writable: true,
          configurable: true,
          enumerable: true,
        });
        return element;
      },
    });
  }
  const pcg = new Proxy(characters, {
    get: (target, chr) =>
      typeof chr === 'string' ? lookup(characterKey(chr)) : Reflect.get(target, chr),
    set() {
      throw new TypeError('Set pcg[chr].pat or pcg[chr].col');
    },
    deleteProperty() {
      throw new TypeError('PCG elements cannot be deleted');
    },
    defineProperty() {
      throw new TypeError('Set pcg[chr].pat or pcg[chr].col');
    },
  });
  const scr = Object.freeze(
    Array.from({ length: lines }, () =>
      Object.freeze(Array.from({ length: columns }, () => new ScrElem())),
    ),
  );

  function cls(col) {
    col = color(col);
    for (const row of scr)
      for (const element of row) {
        element.chr = ' ';
        element.col = [null, col];
      }
  }
  function put(cx, cy, str, col1, col2) {
    const origin = coordinate(cx);
    cx = origin;
    cy = coordinate(cy);
    if (typeof str !== 'string') throw new TypeError('Text must be a string');
    const pair = [col1 === undefined ? null : color(col1), col2 === undefined ? null : color(col2)];
    for (const { segment } of segmenter.segment(str.replace(/\r\n/g, '\n'))) {
      if (segment === '\n') {
        cx = origin;
        cy++;
        continue;
      }
      const chr = characterKey(segment);
      if (cx >= 0 && cx < columns && cy >= 0 && cy < lines) {
        const element = scr[cy][cx];
        element.chr = chr;
        element.col = pair;
      }
      cx++;
    }
  }
  function spr(x, y, chr, col) {
    sprites.push({ x: coordinate(x), y: coordinate(y), chr: characterKey(chr), col: color(col) });
  }
  function play(ch, str) {
    if (!Number.isInteger(ch) || ch < 0 || ch > 2)
      throw new RangeError('Sound channel must be 0–2');
    if (typeof str !== 'string') throw new TypeError('Sound must be a string');
    if (!cache.has(str)) {
      const compiled = compileScore(str);
      if (cache.size >= 256) cache.delete(cache.keys().next().value);
      cache.set(str, compiled);
    }
    sounds.push({ ch, score: cache.get(str) });
  }
  function draw(chr, x, y, col1, col2) {
    const pattern = lookup(chr).pat;
    for (let row = 0; row < 8; row++) {
      const py = y + row;
      if (py < 0 || py >= height) continue;
      for (let bit = 0; bit < 8; bit++) {
        const px = x + bit;
        if (px < 0 || px >= width) continue;
        if (pattern[row] & (128 >> bit)) pixels[py * width + px] = col1;
        else if (col2 !== null) pixels[py * width + px] = col2;
      }
    }
  }
  function render() {
    for (let cy = 0; cy < lines; cy++)
      for (let cx = 0; cx < columns; cx++) {
        const element = scr[cy][cx],
          standard = lookup(element.chr).col;
        draw(
          element.chr,
          cx * 8,
          cy * 8,
          element.col[0] ?? standard[0],
          element.col[1] ?? standard[1],
        );
      }
    for (const sprite of sprites) {
      draw(sprite.chr, sprite.x, sprite.y, sprite.col, null);
    }
    return pixels;
  }
  const api = {
    cls,
    put,
    spr,
    btn: (id) => !!(held & button(id)),
    btnp: (id) => !!(pressed & button(id)),
    play,
    scr,
    pcg,
  };
  return {
    api,
    get pixels() {
      return render();
    },
    input(mask) {
      mask &= 63;
      pressed |= mask & ~held;
      held = mask;
    },
    step(tick) {
      sprites.length = 0;
      try {
        tick();
      } finally {
        pressed = 0;
      }
    },
    sounds() {
      const result = sounds;
      sounds = [];
      return result;
    },
  };
}
