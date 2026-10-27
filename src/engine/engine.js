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

// The red, green and blue values, 0–255, of a #rrggbb color.
export const rgb = (hex) => [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));

// This factory is also serialized into the game worker. Keep dependencies inside it.
export function createEngine(presets = [], compileScore = (s) => s) {
  const width = 160,
    height = 144,
    columns = 20,
    lines = 18;
  const pixels = new Uint8Array(width * height),
    glitches = new Uint8Array(width * height);
  const characters = Object.create(null),
    sprites = [],
    cache = new Map(),
    patterns = new WeakMap();
  const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
  let held = 0,
    pressed = 0,
    pcgBytes = 0,
    firstFrame = true,
    glitched = false,
    noise = 0x6d2b79f5,
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

  // Keep feedback deterministic and independent of the game's Math.random().
  function randomNoise(range) {
    noise ^= noise << 13;
    noise ^= noise >>> 17;
    noise ^= noise << 5;
    return (noise >>> 0) % range;
  }

  function glitch(x, y, w, h) {
    glitched = true;
    const mask = [3, 4, 6, 7][randomNoise(4)];
    for (let row = 0; row < h; row++) {
      const py = y + row;
      for (let col = 0; col < w; col++) {
        const px = x + col;
        if (randomNoise(4) && px >= 0 && px < width && py >= 0 && py < height)
          glitches[py * width + px] ^= mask;
      }
    }
  }

  function glitchSprite(x, y) {
    glitch(x + randomNoise(17) - 8, y + randomNoise(17) - 8, 8, 8);
  }

  // Character data

  function colorPair(initial, inherit = false, limited = false) {
    const validate = (value) => (inherit && value == null ? null : color(value));
    const values = initial.map(validate);
    const pair = new Proxy(values, {
      set(target, index, value) {
        if (index !== '0' && index !== '1') throw new RangeError('Colors have two entries');
        const next = target.slice();
        next[index] = validate(value);
        if (limited) writePcg(target, next, Number(index), Number(index) + 1);
        else target[index] = next[index];
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
        if (next.length !== 2) throw new TypeError('Colors need [col1, col2]');
        if (limited) writePcg(values, next);
        else {
          values[0] = next[0];
          values[1] = next[1];
        }
      },
    };
  }

  // Count writes, including unchanged bytes. A bulk edit uses the remaining
  // budget before dropping its excess bytes. Patterns and PCG colors share it.
  function writePcg(target, next, start = 0, end = next.length) {
    const length = Math.max(0, end - start),
      count = Math.min(length, 256 - pcgBytes);
    for (let i = start; i < start + count; i++) target[i] = next[i];
    pcgBytes += count;
    for (let i = count; i < length; i++) glitch(0, randomNoise(height), width, 1);
  }

  const integer = (value) => Math.trunc(+value) || 0;

  const arrayIndex = (value, length) => {
    const index = integer(value);
    return index < 0 ? Math.max(length + index, 0) : Math.min(index, length);
  };

  // Saved references and subarrays share the byte budget. Rendering reads the
  // private bytes directly; only the range written by each method is copied back.
  function patternView(pattern) {
    const mutators = ['set', 'fill', 'copyWithin', 'reverse', 'sort'];
    const view = new Proxy(pattern, {
      get(target, key) {
        // Exposing the backing buffer would allow writes outside the budget.
        if (key === 'buffer') return target.buffer.slice(0);
        if (key === 'subarray') return (...args) => patternView(target.subarray(...args));
        const value = Reflect.get(target, key, target);
        if (typeof value !== 'function' || key === 'constructor') return value;
        return (...args) => {
          if (mutators.includes(key)) {
            const next = target.slice();
            let start = 0,
              end = target.length;
            if (key === 'set') {
              start = integer(args[1]);
              args[1] = start;
              // Let the native method validate the source and offset. Capture
              // its length once, including array-like sources with getters.
              if (args[0] != null) {
                const source = Object(args[0]);
                args[0] = new Proxy(
                  {},
                  {
                    get(_, name) {
                      const value = Reflect.get(source, name, source);
                      if (name !== 'length') return value;
                      const length = Math.min(Math.max(integer(value), 0), Number.MAX_SAFE_INTEGER);
                      end = start + length;
                      return length;
                    },
                  },
                );
              }
            } else if (key === 'fill') {
              args[0] = +args[0];
              start = arrayIndex(args[1], target.length);
              end = args[2] === undefined ? target.length : arrayIndex(args[2], target.length);
              args[1] = start;
              args[2] = end;
            } else if (key === 'copyWithin') {
              start = arrayIndex(args[0], target.length);
              const from = arrayIndex(args[1], target.length),
                to = args[2] === undefined ? target.length : arrayIndex(args[2], target.length);
              end = start + Math.max(0, Math.min(to - from, target.length - start));
              args = [start, from, to];
            }
            const result = value.apply(next, args);
            if (key === 'reverse') {
              // Reverse writes both ends of each pair, but not an odd middle byte.
              for (let i = 0; i < Math.floor(target.length / 2); i++) {
                writePcg(target, next, i, i + 1);
                writePcg(target, next, target.length - i - 1, target.length - i);
              }
            } else writePcg(target, next, start, end);
            return result === next ? view : result;
          }
          // Array callbacks must receive the guarded view as their array argument.
          if (typeof args[0] === 'function') {
            const callback = args[0];
            args[0] = function (...values) {
              return callback.apply(
                this,
                values.map((item) => (item === target ? view : item)),
              );
            };
          }
          const result = value.apply(target, args);
          return result === target ? view : result;
        };
      },
      set(target, key, value) {
        const next = target.slice();
        const result = Reflect.set(next, key, value);
        if (result && Object.hasOwn(target, key))
          writePcg(target, next, Number(key), Number(key) + 1);
        return result;
      },
      defineProperty(target, key, descriptor) {
        const next = target.slice();
        const result = Reflect.defineProperty(next, key, descriptor);
        if (result && Object.hasOwn(target, key) && Object.hasOwn(descriptor, 'value'))
          writePcg(target, next, Number(key), Number(key) + 1);
        return result;
      },
    });
    return view;
  }

  class PcgElem {
    constructor(rows = new Uint8Array(8), col = [7, 0]) {
      const pattern = new Uint8Array(rows);
      patterns.set(this, pattern);
      const view = patternView(pattern);
      Object.defineProperties(this, {
        pat: {
          enumerable: true,
          get: () => view,
          set(value) {
            if (typeof value === 'string') {
              if (!/^[0-9a-f]{16}$/i.test(value))
                throw new TypeError('Pattern needs 16 hex digits');
              value = Array.from({ length: 8 }, (_, i) =>
                parseInt(value.slice(i * 2, i * 2 + 2), 16),
              );
            }
            if (!value || value.length !== 8) throw new TypeError('Pattern needs 8 row bytes');
            const next = Array.from(value);
            if (
              next.length !== 8 ||
              !next.every((v) => Number.isInteger(v) && v >= 0 && v <= 255)
            ) {
              throw new TypeError('Pattern needs 8 row bytes');
            }
            writePcg(pattern, next);
          },
        },
        col: colorPair(col, false, true),
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

  // Game API

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
    const pair = [col1 == null ? null : color(col1), col2 == null ? null : color(col2)];

    // Check every character before writing, so an invalid one leaves the screen intact.
    const writes = [];
    for (const { segment } of segmenter.segment(str.replace(/\r\n/g, '\n'))) {
      if (segment === '\n') {
        cx = origin;
        cy++;
        continue;
      }
      const chr = characterKey(segment);
      if (cx >= 0 && cx < columns && cy >= 0 && cy < lines) writes.push(scr[cy][cx], chr);
      cx++;
    }

    for (let i = 0; i < writes.length; i += 2) {
      writes[i].chr = writes[i + 1];
      writes[i].col = pair;
    }
  }

  function spr(x, y, str, col) {
    const origin = coordinate(x);
    x = origin;
    y = coordinate(y);
    if (typeof str !== 'string') throw new TypeError('Text must be a string');
    col = color(col);

    // Keep individual ASCII, kana and emoji sprites on the existing fast path.
    if (
      (str.length === 1 || (str.length === 2 && str.codePointAt(0) > 0xffff)) &&
      str !== '\r' &&
      str !== '\n'
    ) {
      if (sprites.length < 128) sprites.push({ x, y, chr: characterKey(str), col });
      else glitchSprite(x, y);
      return;
    }

    const start = sprites.length;
    try {
      for (const { segment } of segmenter.segment(str.replace(/\r\n/g, '\n'))) {
        if (segment === '\n') {
          x = origin;
          y += 8;
          continue;
        }
        if (sprites.length < 128) sprites.push({ x, y, chr: characterKey(segment), col });
        else glitchSprite(x, y);
        x += 8;
      }
    } catch (error) {
      sprites.length = start;
      throw error;
    }
  }

  function play(ch, str) {
    if (!Number.isInteger(ch) || ch < 0 || ch > 2)
      throw new RangeError('Sound channel must be 0–2');
    if (typeof str !== 'string') throw new TypeError('Sound must be a string');
    // The player accepts 256 sounds per tick; top-level code counts with the first tick.
    if (sounds.length >= 256) throw new RangeError('A tick can play at most 256 sounds');
    if (!cache.has(str)) {
      const compiled = compileScore(str);
      if (cache.size >= 256) cache.delete(cache.keys().next().value);
      cache.set(str, compiled);
    }
    sounds.push({ ch, score: cache.get(str) });
  }

  // Rasterization

  function draw(chr, x, y, col1, col2) {
    const pattern = patterns.get(lookup(chr));
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
    if (glitched) for (let i = 0; i < pixels.length; i++) pixels[i] ^= glitches[i];
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
      // Setup overflow belongs to the first frame, just like its PCG writes.
      if (!firstFrame && glitched) {
        glitches.fill(0);
        glitched = false;
      }
      firstFrame = false;
      sprites.length = 0;
      try {
        tick();
      } finally {
        pressed = 0;
        // Top-level setup shares the first frame's budget, as sound commands do.
        pcgBytes = 0;
      }
    },
    sounds() {
      const result = sounds;
      sounds = [];
      return result;
    },
  };
}
