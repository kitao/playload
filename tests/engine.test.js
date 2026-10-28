import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, palette } from '../src/engine/engine.js';
import { glyphs } from '../src/engine/glyphs.js';

const pixel = (engine, x, y = 0) => engine.pixels[y * 160 + x];

// Give compared frames the same noise without fixing randomness in the engine.
function feedbackEngine() {
  const original = Math.random;
  let seed = 123456789;
  try {
    Math.random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    return createEngine();
  } finally {
    Math.random = original;
  }
}

// On a black screen the displayed feedback is the XOR mask itself.
function spriteNoise(positions) {
  const engine = feedbackEngine();
  engine.step(() => {
    for (let i = 0; i < 128; i++) engine.api.spr(-8, -8, 'X', 7);
    for (const [x, y] of positions) engine.api.spr(x, y, 'X', 7);
  });
  return engine.pixels;
}

test('the public surface has six functions, two variables, and a fixed 20 by 18 screen', () => {
  const engine = createEngine(),
    { api } = engine;
  assert.deepEqual(Object.keys(api), ['cls', 'put', 'spr', 'btn', 'btnp', 'play', 'scr', 'pcg']);
  assert.equal(Object.values(api).filter((value) => typeof value === 'function').length, 6);
  assert.equal(api.spr.length, 4);
  assert.equal(api.scr.length, 18);
  assert(api.scr.every((row) => row.length === 20 && row.every((cell) => cell.chr === ' ')));
  assert.equal(engine.pixels.length, 160 * 144);
  assert.equal(palette.length, 8);
  assert.throws(() => {
    api.scr[0][0] = {};
  }, TypeError);
  assert.throws(() => {
    api.scr[0].push({});
  }, TypeError);
  assert.throws(() => {
    api.scr[18] = [];
  }, TypeError);
});

test('put writes character cells, resets x at newlines and never wraps at the right edge', () => {
  const engine = createEngine(),
    { api } = engine;
  api.put(18, 2, 'ABC\r\nDE', 6, 1);
  assert.equal(api.scr[2][18].chr, 'A');
  assert.equal(api.scr[2][19].chr, 'B');
  assert.equal(api.scr[3][0].chr, ' ');
  assert.equal(api.scr[3][18].chr, 'D');
  assert.equal(api.scr[3][19].chr, 'E');
  assert.deepEqual([...api.scr[3][19].col], [6, 1]);
  api.put(-1, 0, 'XYZ');
  assert.equal(api.scr[0][0].chr, 'Y');
  assert.equal(api.scr[0][1].chr, 'Z');
  api.put(1, -1, 'A\nB');
  assert.equal(api.scr[0][1].chr, 'B');
  api.put(0, 17, 'A\nB');
  assert.equal(api.scr[17][0].chr, 'A');
});

test('character coordinates truncate toward zero and empty or outside text changes nothing', () => {
  const { api } = createEngine();
  api.put(-0.9, 1.9, 'X');
  assert.equal(api.scr[1][0].chr, 'X');
  const before = api.scr.map((row) => row.map((cell) => cell.chr));
  for (const [cx, cy, str] of [
    [20, 0, 'X'],
    [0, 18, 'X'],
    [-1, 0, 'X'],
    [0, -1, 'X'],
    [0, 0, ''],
  ])
    api.put(cx, cy, str);
  assert.deepEqual(
    api.scr.map((row) => row.map((cell) => cell.chr)),
    before,
  );
});

test('standard PCG colors and patterns update existing cells while per-cell overrides persist', () => {
  const engine = createEngine(),
    { api } = engine;
  api.pcg.X.pat = '8000000000000000';
  api.pcg.X.col = [6, 1];
  api.put(0, 0, 'X');
  api.put(1, 0, 'X', 0);
  api.put(2, 0, 'X', undefined, 0);
  api.put(3, 0, 'X', 3, 4);
  api.pcg.X.col = [5, 2];
  assert.deepEqual(
    [0, 8, 16, 24].map((x) => pixel(engine, x)),
    [5, 0, 5, 3],
  );
  assert.deepEqual(
    [1, 9, 17, 25].map((x) => pixel(engine, x)),
    [2, 2, 0, 4],
  );
  api.pcg.X.pat[0] = 64;
  assert.equal(pixel(engine, 0), 2);
  assert.equal(pixel(engine, 1), 5);
  api.scr[0][1].col[0] = null;
  assert.equal(pixel(engine, 9), 5);
  api.put(3, 0, 'X');
  assert.deepEqual([...api.scr[0][3].col], [null, null]);
  assert.equal(pixel(engine, 25), 5);
});

test('put accepts null independently for both colors and keeps following each character PCG', () => {
  const engine = createEngine(),
    { api } = engine;
  for (const chr of ['X', 'Y']) api.pcg[chr].pat = '8000000000000000';
  api.pcg.X.col = [6, 1];
  api.pcg.Y.col = [5, 2];
  api.put(0, 0, 'XY', null, null);
  api.put(2, 0, 'X', null, 0);
  api.put(3, 0, 'Y', 0, null);
  api.pcg.X.col = [3, 4];
  api.pcg.Y.col = [7, 5];
  assert.deepEqual(
    [0, 8, 16, 24].map((x) => pixel(engine, x)),
    [3, 7, 3, 0],
  );
  assert.deepEqual(
    [1, 9, 17, 25].map((x) => pixel(engine, x)),
    [4, 5, 0, 5],
  );
  assert.deepEqual([...api.scr[0][0].col], [null, null]);
  assert.deepEqual([...api.scr[0][2].col], [null, 0]);
  assert.deepEqual([...api.scr[0][3].col], [0, null]);
});

test('scr can be read for collision and changed directly without reissuing put', () => {
  const engine = createEngine(),
    { api } = engine;
  api.pcg['壁'].pat = 'FFFFFFFFFFFFFFFF';
  api.pcg['壁'].col = [3, 0];
  api.scr[4][3].chr = '壁';
  api.scr[4][3].col = [null, 1];
  assert.equal(api.scr[4][3].chr, '壁');
  assert.equal(pixel(engine, 24, 32), 3);
  const pair = api.scr[4][3].col;
  api.scr[4][3].col = [6, null];
  assert.equal(api.scr[4][3].col, pair);
  assert.equal(pixel(engine, 24, 32), 6);
  api.scr[4][3].chr = ' ';
  api.scr[4][3].col = [null, 2];
  assert.equal(pixel(engine, 24, 32), 2);
});

test('characters and pixel sprites draw all eight pattern rows from left to right', () => {
  const engine = createEngine(),
    { api } = engine;
  api.pcg.X.pat = [128, 64, 32, 16, 8, 4, 2, 1];
  api.put(2, 3, 'X', 6, 1);
  engine.step(() => api.spr(35, 41, 'X', 5));

  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      assert.equal(pixel(engine, 16 + x, 24 + y), x === y ? 6 : 1);
      assert.equal(pixel(engine, 35 + x, 41 + y), x === y ? 5 : 0);
    }
});

test('cls fills spaces, preserves cell references and sprites, and uses the shared space pattern', () => {
  const engine = createEngine(),
    { api } = engine,
    cell = api.scr[0][0];
  api.pcg.X.pat = '8000000000000000';
  engine.step(() => {
    api.spr(8, 0, 'X', 6);
    api.put(0, 0, 'X', 3, 1);
    api.cls(4);
  });
  assert.equal(api.scr[0][0], cell);
  assert.equal(cell.chr, ' ');
  assert.deepEqual([...cell.col], [null, 4]);
  assert.equal(pixel(engine, 0), 4);
  assert.equal(pixel(engine, 8), 6);
  assert.equal(pixel(engine, 9), 4);
  api.pcg[' '].pat[0] = 128;
  api.pcg[' '].col = [5, 1];
  assert.equal(pixel(engine, 0), 5);
  assert.equal(pixel(engine, 1), 4);
  api.pcg[' '].pat.fill(0);
  engine.step(() => api.cls(0));
  assert(engine.pixels.every((value) => value === 0));
});

test('ASCII cells retain normalization and newline rejection, including control characters', () => {
  const { api } = createEngine(),
    cell = api.scr[0][0];
  for (let code = 0; code < 128; code++) {
    const chr = String.fromCharCode(code);
    if (chr === '\r' || chr === '\n') {
      const previous = cell.chr;
      assert.throws(() => {
        cell.chr = chr;
      }, TypeError);
      assert.equal(cell.chr, previous);
      assert.throws(() => api.pcg[chr], TypeError);
    } else {
      cell.chr = chr;
      assert.equal(cell.chr, chr);
      assert.equal(api.pcg[chr], api.pcg[chr + '\ufe0f']);
    }
  }
});

test('emoji selectors and normalized multi-codepoint graphemes occupy one cell', () => {
  const engine = createEngine(glyphs),
    { api } = engine;
  api.pcg['⛩️'].pat = 'FFFFFFFFFFFFFFFF';
  api.pcg['⛩'].col = [3, 0];
  api.pcg['👨‍👩‍👧‍👦'].pat = 'FFFFFFFFFFFFFFFF';
  api.pcg['👨‍👩‍👧‍👦'].col = [4, 0];
  api.put(0, 0, '⛩️👨‍👩‍👧‍👦');
  assert.equal(pixel(engine, 0), 3);
  assert.equal(pixel(engine, 8), 4);
  assert.equal(pixel(engine, 16), 0);
  assert.equal(api.pcg['é'], api.pcg['e\u0301']);
  api.scr[0][2].chr = 'e\u0301';
  assert.equal(api.scr[0][2].chr, 'é');
  assert.equal(api.pcg['⛩'], api.pcg['⛩\ufe0e']);
});

test('sprite strings use 8px spacing, reset at CRLF and truncate only the origin', () => {
  const engine = createEngine(),
    { api } = engine;
  api.cls(4);
  api.pcg.X.pat = '8080808080808080';
  api.pcg.Y.pat = '0101010101010101';
  engine.step(() => api.spr(1.9, 2.9, 'XY\r\nYX', 0));
  const expected = Uint8Array.from({ length: 160 * 144 }, (_, i) => {
    const x = i % 160,
      y = Math.floor(i / 160);
    return (y >= 2 && y < 10 && (x === 1 || x === 16)) ||
      (y >= 10 && y < 18 && (x === 8 || x === 9))
      ? 0
      : 4;
  });
  assert.deepEqual(engine.pixels, expected);
  assert(api.scr.every((row) => row.every((cell) => cell.chr === ' ')));
  engine.step(() => {});
  assert(engine.pixels.every((col) => col === 4));
});

test('sprite strings advance once per normalized grapheme, including selectors and joined emoji', () => {
  const engine = createEngine(),
    { api } = engine;
  api.cls(4);
  api.pcg['é'].pat = '8000000000000000';
  api.pcg['⛩'].pat = '4000000000000000';
  api.pcg['👨‍👩‍👧‍👦'].pat = '2000000000000000';
  engine.step(() => api.spr(3, 2, 'e\u0301⛩️👨‍👩‍👧‍👦', 6));
  const expected = new Uint8Array(160 * 144).fill(4);
  for (const x of [3, 12, 21]) expected[2 * 160 + x] = 6;
  assert.deepEqual(engine.pixels, expected);
});

test('multiline sprite strings clip as a 16 by 16 image without wrapping at screen edges', () => {
  const engine = createEngine(),
    { api } = engine;
  api.cls(4);
  api.pcg.X.pat = 'FFFFFFFFFFFFFFFF';
  for (const [x, y] of [
    [-3, -3],
    [153, 137],
    [-16, 20],
    [160, 20],
    [20, 144],
  ]) {
    engine.step(() => api.spr(x, y, 'XX\nXX', 6));
    const expected = Uint8Array.from({ length: 160 * 144 }, (_, i) => {
      const px = i % 160,
        py = Math.floor(i / 160);
      return px >= x && px < x + 16 && py >= y && py < y + 16 ? 6 : 4;
    });
    assert.deepEqual(engine.pixels, expected);
  }
});

test('empty sprite strings draw nothing and later sprite calls cover the entire string', () => {
  const engine = createEngine(),
    { api } = engine;
  api.cls(4);
  api.pcg.X.pat = 'FFFFFFFFFFFFFFFF';
  engine.step(() => {
    api.spr(0, 0, '', 6);
    api.spr(0, 0, '\n\r\n', 6);
  });
  assert(engine.pixels.every((col) => col === 4));
  engine.step(() => {
    api.spr(1, 2, 'XX\nXX', 6);
    api.spr(9, 10, 'X', 0);
  });
  assert.equal(pixel(engine, 1, 2), 6);
  assert.equal(pixel(engine, 9, 2), 6);
  assert.equal(pixel(engine, 1, 10), 6);
  assert.equal(pixel(engine, 9, 10), 0);
  assert.equal(pixel(engine, 17, 10), 4);
});

test('a frame draws only the first 128 sprite characters and resets the limit next frame', () => {
  const engine = feedbackEngine(),
    { api } = engine;
  api.cls(4);
  for (const ch of ['X', '👾']) api.pcg[ch].pat = 'FFFFFFFFFFFFFFFF';
  engine.step(() => {
    for (let i = 0; i < 128; i++)
      api.spr((i % 16) * 8, Math.floor(i / 16) * 8, i % 2 ? '👾' : 'X', 6);
    api.spr(0, 0, 'X', 3);
    api.spr(128, 0, 'X', 3);
  });
  assert.deepEqual(
    engine.pixels,
    spriteNoise([
      [0, 0],
      [128, 0],
    ]).map((mask, i) => mask ^ (i % 160 < 128 && i < 160 * 64 ? 6 : 4)),
  );
  engine.step(() => api.spr(128, 0, 'X', 5));
  assert.equal(pixel(engine, 0), 4);
  assert.equal(pixel(engine, 128), 5);
});

test('sprite strings share the frame limit and add noise for each excess character', () => {
  const engine = feedbackEngine(),
    { api } = engine;
  api.cls(4);
  api.pcg.X.pat = 'FFFFFFFFFFFFFFFF';
  engine.step(() => {
    api.spr(-2048, 0, 'X'.repeat(126), 6);
    api.spr(0, 0, 'X\r\nXX', 3);
    api.spr(8, 8, 'X', 5);
  });
  assert.deepEqual(
    engine.pixels,
    spriteNoise([
      [8, 8],
      [8, 8],
    ]).map((mask, i) => mask ^ (i % 160 < 8 && i < 160 * 16 ? 3 : 4)),
  );
});

test('the sprite limit counts graphemes, excluding newlines and presentation selectors', () => {
  const engine = feedbackEngine(),
    { api } = engine;
  api.cls(4);
  for (const ch of ['é', '⛩', '👨‍👩‍👧‍👦', '👾']) api.pcg[ch].pat = 'FFFFFFFFFFFFFFFF';
  const row = 'e\u0301⛩️👨‍👩‍👧‍👦👾'.repeat(4) + '\r\n';
  engine.step(() => {
    api.spr(0, 0, row.repeat(8) + '👾', 6);
    api.spr(0, 64, '👾', 3);
  });
  assert.deepEqual(
    engine.pixels,
    spriteNoise([
      [0, 64],
      [0, 64],
    ]).map((mask, i) => mask ^ (i % 160 < 128 && i < 160 * 64 ? 6 : 4)),
  );
});

test('feedback captures randomness before game code and consumes it only on overflow', (t) => {
  const random = t.mock.method(Math, 'random', () => 0.5);
  const engine = createEngine(),
    { api } = engine;
  Math.random = () => assert.fail('Game replacement must not control feedback');
  engine.step(() => {
    for (let i = 0; i < 128; i++) api.spr(-8, -8, 'X', 7);
    for (let i = 0; i < 256; i++) api.pcg.X.pat[0] = 0;
    assert.equal(random.mock.callCount(), 0);
    api.spr(40, 40, 'X', 7);
    assert(random.mock.callCount() > 0);
    const calls = random.mock.callCount();
    api.pcg.X.pat[0] = 0;
    assert(random.mock.callCount() > calls);
  });
  const calls = random.mock.callCount(),
    pixels = engine.pixels.slice();
  assert(pixels.some((color) => color !== 0));
  assert.deepEqual(engine.pixels, pixels);
  assert.equal(random.mock.callCount(), calls);
});

test('overflow shapes share one XOR value and affect about 75% of dots', () => {
  for (const kind of ['sprite', 'pcg']) {
    const engine = feedbackEngine(),
      { api } = engine;
    let dots = 0;
    for (let frame = 0; frame < 100; frame++) {
      engine.step(() => {
        if (kind === 'sprite') {
          for (let i = 0; i < 128; i++) api.spr(-8, -8, 'X', 7);
          api.spr(76, 68, 'X', 7);
        } else {
          for (let i = 0; i < 257; i++) api.pcg.X.pat[0] = 0;
        }
      });
      const pixels = engine.pixels.slice(),
        changed = Array.from(pixels.keys()).filter((i) => pixels[i] !== 0),
        xs = changed.map((i) => i % 160),
        ys = changed.map((i) => Math.floor(i / 160)),
        masks = [...new Set(changed.map((i) => pixels[i]))];
      assert.equal(masks.length, 1);
      assert([3, 4, 6, 7].includes(masks[0]));
      if (kind === 'sprite') {
        assert(xs.every((x) => x >= 60 && x <= 99));
        assert(ys.every((y) => y >= 52 && y <= 91));
        assert(Math.max(...xs) - Math.min(...xs) <= 7);
        assert(Math.max(...ys) - Math.min(...ys) <= 7);
        assert(changed.length <= 64);
      } else {
        assert.equal(new Set(ys).size, 1);
        assert(Math.max(...xs) - Math.min(...xs) > 140);
      }
      dots += changed.length;
      assert.deepEqual(engine.pixels, pixels, 'Repeated rendering must not change feedback');
      assert.equal(api.pcg.X.pat[0], 0);
      assert(api.scr.every((row) => row.every((cell) => cell.chr === ' ')));
    }
    const density = dots / (100 * (kind === 'sprite' ? 64 : 160));
    assert(density > 0.72 && density < 0.78, `${kind}: ${density}`);
    engine.step(() => {});
    assert(
      engine.pixels.every((col) => col === 0),
      'Feedback ends with its frame',
    );
  }
});

test('sprite feedback follows each grapheme position across lines and fractional origins', () => {
  const engine = feedbackEngine();
  engine.step(() => {
    for (let i = 0; i < 128; i++) engine.api.spr(-8, -8, 'X', 7);
    engine.api.spr(30.9, 50.9, 'e\u0301⛩️\r\n👨‍👩‍👧‍👦👾', 7);
  });
  assert.deepEqual(
    engine.pixels,
    spriteNoise([
      [30, 50],
      [38, 50],
      [30, 58],
      [38, 58],
    ]),
  );
});

test('sprite feedback clips at screen edges without wrapping or relocating offscreen noise', () => {
  const reference = spriteNoise([[64, 64]]);
  for (const [x, y] of [
    [-8, 64],
    [0, 64],
    [152, 64],
    [160, 64],
    [64, -8],
    [64, 0],
    [64, 136],
    [64, 144],
    [0, 0],
    [152, 136],
    [-32, -32],
    [192, 176],
  ]) {
    const expected = new Uint8Array(160 * 144);
    for (let i = 0; i < reference.length; i++) {
      const px = (i % 160) + x - 64,
        py = Math.floor(i / 160) + y - 64;
      if (px >= 0 && px < 160 && py >= 0 && py < 144) expected[py * 160 + px] = reference[i];
    }
    assert.deepEqual(spriteNoise([[x, y]]), expected, `Sprite at ${x}, ${y}`);
  }
});

test('PCG feedback counts rejected bytes, including partial patterns and color pairs', () => {
  for (const [used, write, excess] of [
    [256, (pcg) => (pcg.X.pat = 'ffffffffffffffff'), 8],
    [253, (pcg) => pcg.X.pat.fill(255), 5],
    [256, (pcg) => (pcg.X.col = [3, 4]), 2],
    [255, (pcg) => (pcg.X.col = [3, 4]), 1],
    [256, (pcg) => (pcg.X.col[0] = 3), 1],
    [255, (pcg) => pcg.X.pat.subarray(2, 6).set([1, 2, 3, 4]), 3],
  ]) {
    const actual = feedbackEngine(),
      expected = feedbackEngine();
    actual.step(() => {
      for (let i = 0; i < used; i++) actual.api.pcg.X.pat[0] = 0;
      write(actual.api.pcg);
    });
    expected.step(() => {
      for (let i = 0; i < 256 + excess; i++) expected.api.pcg.X.pat[0] = 0;
    });
    assert.deepEqual(actual.pixels, expected.pixels);
  }
});

test('initialization feedback survives the first tick and does not alter screen or sprite data', () => {
  const engine = feedbackEngine(),
    reference = feedbackEngine(),
    { api } = engine;
  for (let i = 0; i < 257; i++) api.pcg.X.pat[0] = 255;
  for (let i = 0; i < 257; i++) reference.api.pcg.X.pat[0] = 255;
  const mask = reference.pixels.slice();
  engine.step(() => {
    api.cls(4);
    api.spr(0, 0, 'X', 6);
  });
  assert.deepEqual(
    engine.pixels,
    mask.map((value, i) => value ^ (i < 8 ? 6 : 4)),
  );
  engine.step(() => {});
  assert(engine.pixels.every((col) => col === 4));
  assert.equal(api.pcg.X.pat[0], 255);
});

test('invalid and empty writes do not produce overflow feedback', () => {
  const engine = createEngine(),
    { api } = engine;
  engine.step(() => {
    for (let i = 0; i < 256; i++) api.pcg.X.pat[0] = 0;
    api.pcg.X.pat.set([]);
    api.pcg.X.pat.fill(255, 6, 2);
    api.pcg.X.pat.subarray(0, 0).reverse();
    assert.throws(() => api.pcg.X.pat.set([1, 2], 7), RangeError);
    assert.throws(() => (api.pcg.X.col = [2, 8]), RangeError);
    for (let i = 0; i < 128; i++) api.spr(-8, -8, 'X', 7);
    api.spr(0, 0, '', 7);
    api.spr(0, 0, '\n\r\n', 7);
    assert.throws(() => api.spr(0, 0, 'X', 8), RangeError);
  });
  assert(engine.pixels.every((col) => col === 0));
});

test('sprite zero bits are transparent and color zero is opaque black', () => {
  const engine = createEngine(),
    { api } = engine;
  api.cls(4);
  api.pcg.X.pat = '8000000000000001';
  api.pcg.X.col = [5, 2];
  engine.step(() => api.spr(3, 2, 'X', 0));
  assert.equal(pixel(engine, 3, 2), 0);
  assert.equal(pixel(engine, 4, 2), 4);
  assert.equal(pixel(engine, 10, 9), 0);
  assert.equal(api.scr[0][0].chr, ' ');
  api.pcg.X.col = [6, 1];
  assert.equal(pixel(engine, 3, 2), 0);
  api.pcg.X.pat[0] = 64;
  assert.equal(pixel(engine, 3, 2), 4);
  assert.equal(pixel(engine, 4, 2), 0);
});

test('sprites last one tick and reveal retained characters when moved or omitted', () => {
  const engine = createEngine(),
    { api } = engine;
  api.cls(1);
  api.pcg.X.pat = 'FFFFFFFFFFFFFFFF';
  api.pcg.Y.pat = '8000000000000000';
  api.put(0, 0, 'Y', 5, 1);
  api.scr[0][1].chr = 'Y';
  api.scr[0][1].col = [4, 1];
  engine.step(() => api.spr(0, 0, 'X', 6));
  const drawn = engine.pixels.slice();
  assert.deepEqual(engine.pixels, drawn);
  assert.deepEqual(engine.pixels, drawn);
  assert.equal(pixel(engine, 0), 6);
  engine.step(() => api.spr(1.9, 2.9, 'X', 3));
  assert.equal(pixel(engine, 0), 5);
  assert.equal(pixel(engine, 1, 2), 3);
  engine.step(() => {});
  const background = Uint8Array.from({ length: 160 * 144 }, (_, i) =>
    i === 0 ? 5 : i === 8 ? 4 : 1,
  );
  assert.deepEqual(engine.pixels, background);
  assert.equal(api.scr[0][0].chr, 'Y');
  assert.equal(api.scr[0][1].chr, 'Y');
});

test('later sprite calls are in front and characters stay behind every sprite', () => {
  const engine = createEngine(),
    { api } = engine;
  api.pcg.X.pat = 'FFFFFFFFFFFFFFFF';
  api.pcg.Y.pat = '8000000000000000';
  api.cls(4);
  engine.step(() => {
    api.spr(0, 0, 'X', 6);
    api.spr(0, 0, 'Y', 0);
    api.put(0, 0, 'X', 3, 4);
  });
  assert.equal(pixel(engine, 0), 0);
  assert.equal(pixel(engine, 1), 6);
  assert.equal(pixel(engine, 8), 4);
  engine.step(() => {
    api.spr(0, 0, 'Y', 0);
    api.spr(0, 0, 'X', 6);
  });
  assert.equal(pixel(engine, 0), 6);
  assert.equal(pixel(engine, 1), 6);
});

for (const [x, y] of [
  [-3, 20],
  [157, 20],
  [20, -3],
  [20, 141],
  [-3, -3],
  [157, 141],
  [-8, 20],
  [160, 20],
  [20, -8],
  [20, 144],
  [-0.9, -0.9],
]) {
  test(`sprites clip at pixel coordinate (${x}, ${y})`, () => {
    const engine = createEngine(),
      { api } = engine;
    api.cls(4);
    api.pcg.X.pat = 'FFFFFFFFFFFFFFFF';
    engine.step(() => api.spr(x, y, 'X', 6));
    const left = Math.trunc(x),
      top = Math.trunc(y);
    const expected = Uint8Array.from({ length: 160 * 144 }, (_, i) => {
      const px = i % 160,
        py = Math.floor(i / 160);
      return px >= left && px < left + 8 && py >= top && py < top + 8 ? 6 : 4;
    });
    assert.deepEqual(engine.pixels, expected);
  });
}

test('invalid commands leave existing screen and sprite state intact', () => {
  const engine = createEngine(),
    { api } = engine;
  api.cls(4);
  api.pcg.X.pat = 'FFFFFFFFFFFFFFFF';
  engine.step(() => {
    api.spr(0, 0, 'X', 6);
    const before = engine.pixels.slice();
    assert.throws(() => api.cls(), RangeError);
    assert.throws(() => api.cls(undefined), RangeError);
    for (const value of [NaN, Infinity, -Infinity, '1', null, undefined]) {
      assert.throws(() => api.put(value, 0, 'X'), TypeError);
      assert.throws(() => api.put(0, value, 'X'), TypeError);
      assert.throws(() => api.spr(value, 0, 'X', 6), TypeError);
      assert.throws(() => api.spr(0, value, 'X', 6), TypeError);
    }
    for (const value of [-1, 8, 1.5, NaN, Infinity, '1', null]) {
      assert.throws(() => api.cls(value), RangeError);
      if (value !== null) {
        assert.throws(() => api.put(0, 0, 'X', value, 6), RangeError);
        assert.throws(() => api.put(0, 0, 'X', 6, value), RangeError);
      }
      assert.throws(() => api.spr(0, 0, 'X', value), RangeError);
    }
    for (const chr of ['', 'AB', '\n', null, 1]) {
      assert.throws(() => {
        api.scr[0][0].chr = chr;
      }, TypeError);
      if (typeof chr !== 'string') assert.throws(() => api.spr(0, 0, chr, 6), TypeError);
      if (typeof chr === 'string') assert.throws(() => api.pcg[chr], TypeError);
    }
    for (const str of ['\r', 'X\r', 'X\n\ufe0f']) {
      assert.throws(() => api.spr(0, 0, str, 6), TypeError);
      assert.throws(() => api.put(2, 2, str, 6, 1), TypeError);
    }
    assert.throws(() => api.spr(0, 1), TypeError);
    assert.throws(() => api.spr(0), TypeError);
    assert.throws(() => api.spr(0, 0, 'X'), RangeError);
    assert.throws(() => api.spr(0, 0, 0, 'X', 6), TypeError);
    assert.throws(() => api.put(0, 0, 123), TypeError);
    assert.deepEqual(engine.pixels, before);
  });
});

test('pattern assignment copies bytes and rejects invalid data atomically', () => {
  const { api } = createEngine(),
    pattern = api.pcg.X,
    rows = pattern.pat;
  const input = new Uint8Array([128, 64, 32, 16, 8, 4, 2, 1]);
  pattern.pat = input;
  input[0] = 0;
  assert.equal(rows[0], 128);
  for (const value of [
    null,
    [],
    Array(7).fill(0),
    Array(9).fill(0),
    [-1, 0, 0, 0, 0, 0, 0, 0],
    [256, 0, 0, 0, 0, 0, 0, 0],
    [1.5, 0, 0, 0, 0, 0, 0, 0],
    [NaN, 0, 0, 0, 0, 0, 0, 0],
    ['1', 0, 0, 0, 0, 0, 0, 0],
    'zz00000000000000',
    'ff',
  ]) {
    assert.throws(() => {
      pattern.pat = value;
    }, TypeError);
    assert.deepEqual([...rows], [128, 64, 32, 16, 8, 4, 2, 1]);
  }
  pattern.pat = 'FF000000000000AA';
  assert.equal(pattern.pat, rows);
  assert.throws(() => {
    api.pcg.X = {};
  }, TypeError);
  assert.throws(() => {
    delete api.pcg.X;
  }, TypeError);
});

test('color pairs retain references and reject malformed assignments without partial writes', () => {
  const { api } = createEngine();
  for (const element of [api.pcg.X, api.scr[0][0]]) {
    const pair = element.col;
    element.col = [2, 3];
    assert.equal(element.col, pair);
    const extraColors = [1, 2];
    extraColors[Symbol.iterator] = function* () {
      yield 1;
      yield 2;
      yield 3;
    };
    for (const value of [null, [], [1], [1, 2, 3], new Uint8Array([1, 2]), extraColors])
      assert.throws(() => {
        element.col = value;
      }, TypeError);
    assert.throws(() => {
      element.col = [4, 8];
    }, RangeError);
    assert.throws(() => {
      element.col[0] = -1;
    }, RangeError);
    assert.throws(() => {
      element.col[2] = 4;
    }, RangeError);
    assert.deepEqual([...pair], [2, 3]);
  }
  assert.throws(() => {
    api.pcg.X.col = [null, 1];
  }, RangeError);
  api.scr[0][0].col = [null, null];
  assert.deepEqual([...api.scr[0][0].col], [null, null]);
});

test('PCG patterns and colors share 256 bytes per frame', () => {
  const engine = createEngine(),
    { api } = engine;
  const chars = Array.from({ length: 27 }, (_, i) => String.fromCharCode(65 + i));
  const saved = chars.map((ch) => api.pcg[ch]);
  api.put(0, 0, chars.slice(0, 20).join(''));
  api.put(0, 1, chars.slice(20).join(''));
  engine.step(() => {
    for (const element of saved) {
      element.pat = 'ffffffffffffffff';
      element.col = [5, 1];
    }
    // 25 complete definitions use 250 bytes. The next pattern gets six bytes.
    assert.deepEqual([...saved[24].pat], Array(8).fill(255));
    assert.deepEqual([...saved[24].col], [5, 1]);
    assert.deepEqual([...saved[25].pat], [255, 255, 255, 255, 255, 255, 0, 0]);
    assert.deepEqual([...saved[25].col], [7, 0]);
    assert.deepEqual([...saved[26].pat], Array(8).fill(0));
    saved[0].pat[0] = 128;
    saved[0].col[0] = 3;
    assert.equal(saved[0].pat[0], 255);
    assert.deepEqual([...saved[0].col], [5, 1]);
  });
  engine.step(() => {});
  assert.equal(pixel(engine, 0), 5);
  assert.equal(pixel(engine, 40, 8), 7);
  assert.equal(pixel(engine, 40, 14), 0);
  engine.step(() => {
    saved[25].pat.fill(255);
    saved[25].col[0] = 4;
  });
  assert.equal(pixel(engine, 40, 14), 4);
});

test('PCG color elements, pairs and saved arrays count writes, with partial pairs at the limit', () => {
  const engine = createEngine(),
    { api } = engine,
    colors = api.pcg.X.col;
  engine.step(() => {
    for (let i = 0; i < 253; i++) api.pcg.Z.pat[0] = 0;
    colors[0] = 3;
    api.pcg.X.col = [4, 5];
    colors[1] = 6;
    assert.deepEqual([...colors], [4, 5]);
    assert.equal(api.pcg.X.col, colors);
  });
  engine.step(() => {
    for (let i = 0; i < 255; i++) colors[0] = 4;
    assert.throws(() => {
      api.pcg.X.col = [6, 8];
    }, RangeError);
    api.pcg.X.col = [6, 2];
    assert.deepEqual([...colors], [6, 5]);
    api.pcg.Y.pat[0] = 255;
    assert.equal(api.pcg.Y.pat[0], 0);
    // Screen colors use their own attributes and have no PCG write cost.
    for (const row of api.scr) for (const cell of row) cell.col = [3, 2];
    assert.deepEqual([...api.scr[17][19].col], [3, 2]);
  });
  engine.step(() => {
    for (let i = 0; i < 254; i++) api.pcg.Z.pat[0] = 0;
    colors.fill(3);
    api.pcg.X.col = [4, 5];
    assert.deepEqual([...colors], [3, 3]);
  });
});

test('PCG allows 256 one-byte character updates and counts repeated unchanged writes', () => {
  const engine = createEngine(),
    { api } = engine;
  engine.step(() => {
    for (let i = 0; i < 257; i++) api.pcg[String.fromCodePoint(0xe000 + i)].pat[0] = 255;
    assert.equal(api.pcg['\ue0ff'].pat[0], 255);
    assert.equal(api.pcg['\ue100'].pat[0], 0);
  });
  engine.step(() => {
    const pat = api.pcg['\ue000'].pat;
    for (let i = 0; i < 255; i++) pat[0] = 0;
    pat[0] |= 128;
    pat[1] = 64;
    assert.deepEqual([...pat], [128, 0, 0, 0, 0, 0, 0, 0]);
  });
});

test('PCG reads, screen edits, empty ranges and invalid writes consume no bytes', () => {
  const engine = createEngine(glyphs),
    { api } = engine;
  engine.step(() => {
    for (const glyph of glyphs) {
      assert.equal(api.pcg[glyph.ch].pat.length, 8);
      assert.equal(api.pcg[glyph.ch].col.length, 2);
    }
    for (let i = 0; i < 40; i++) {
      const element = api.pcg[String.fromCodePoint(0xe000 + i)];
      assert.throws(() => {
        element.pat = 'bad';
      }, TypeError);
      assert.throws(() => {
        element.col = [3, 8];
      }, RangeError);
      assert.throws(() => {
        element.col[0] = 8;
      }, RangeError);
      assert.throws(() => element.pat.set(Array(9).fill(0)), RangeError);
      assert.throws(() => element.pat.set([1], -1), RangeError);
      assert.throws(() => element.pat.fill(1n), TypeError);
      element.pat[8] = 255;
      element.pat[-1] = 255;
      element.pat.set([], 8);
      element.pat.fill(255, 5, 2);
      element.pat.copyWithin(0, 5, 2);
      Object.defineProperty(element.pat, '0', { enumerable: true });
    }
    api.cls(2);
    api.put(0, 0, 'screen edits');
    api.scr[0][0].col = [3, 1];
    // Normalized aliases share data, but both writes consume a byte.
    api.pcg['é'].pat[0] = 128;
    api.pcg['e\u0301'].pat[1] = 64;
    assert.deepEqual([...api.pcg['é'].pat].slice(0, 2), [128, 64]);
    for (let i = 0; i < 254; i++) api.pcg.X.pat[0] = 128;
    api.pcg.X.pat[0] = 64;
    assert.equal(api.pcg.X.pat[0], 128);
  });
});

test('PCG array methods and saved views charge exactly their written bytes', () => {
  const edits = [
    [
      1,
      (pat) => {
        pat[0] = 128;
      },
    ],
    [1, (pat) => pat.set([128])],
    [3, (pat) => pat.set([128, 64, 32], 2)],
    [3, (pat) => pat.set(Object.freeze({ length: 3.9, 0: 128, 1: 64, 2: 32 }))],
    [8, (pat) => pat.fill(128)],
    [2, (pat) => pat.fill(128, 1, 3)],
    [2, (pat) => pat.fill(128, -3, -1)],
    [1, (pat) => pat.copyWithin(0, 1, 2)],
    [2, (pat) => pat.copyWithin(6, 0)],
    [4, (pat) => pat.copyWithin(1, 0, 4)],
    [8, (pat) => pat.reverse()],
    [2, (pat) => pat.subarray(0, 3).reverse()],
    [8, (pat) => pat.sort((a, b) => b - a)],
    [3, (pat) => pat.subarray(0, 3).sort()],
    [
      1,
      (pat) => {
        pat.subarray(0, 1)[0] = 128;
      },
    ],
    [2, (pat) => pat.subarray(1, 3).fill(128)],
    [1, (pat) => Object.defineProperty(pat, '0', { value: 128 })],
    [
      1,
      (pat) =>
        pat.forEach((value, index, rows) => {
          if (index === 0) rows[0] = 128;
        }),
    ],
    [
      1,
      (pat) => {
        pat.valueOf()[0] = 128;
      },
    ],
  ];
  const initial = [0, 128, 64, 32, 16, 8, 4, 2];
  for (const [cost, edit] of edits) {
    const engine = createEngine([{ ch: 'X', rows: initial }]),
      { api } = engine,
      saved = api.pcg.X.pat;
    const expected = Uint8Array.from(initial);
    edit(expected);
    engine.step(() => {
      for (let i = 0; i < 256; i++) api.pcg.Z.pat[0] = 0;
      edit(saved);
      assert.deepEqual([...saved], initial);
    });
    engine.step(() => {
      for (let i = 0; i < 256 - cost; i++) api.pcg.Z.pat[0] = 0;
      edit(saved);
      assert.deepEqual([...saved], [...expected]);
      api.pcg.Y.pat[0] = 255;
      assert.equal(api.pcg.Y.pat[0], 0, 'The edit must consume exactly its byte count.');
    });
    assert.equal(api.pcg.X.pat, saved);
  }
});

test('PCG bulk writes apply remaining bytes and leave the rest unchanged', () => {
  const cases = [
    [
      (element) => {
        element.pat = 'ffffffffffffffff';
      },
      [255, 255, 255, 4, 5, 6, 7, 8],
    ],
    [(element) => element.pat.set([255, 255, 255, 255], 2), [1, 2, 255, 255, 255, 6, 7, 8]],
    [(element) => element.pat.fill(255, 1, 7), [1, 255, 255, 255, 5, 6, 7, 8]],
    [(element) => element.pat.copyWithin(2, 0, 4), [1, 2, 1, 2, 3, 6, 7, 8]],
    [(element) => element.pat.reverse(), [8, 7, 3, 4, 5, 6, 7, 1]],
    [(element) => element.pat.sort((a, b) => b - a), [8, 7, 6, 4, 5, 6, 7, 8]],
    [(element) => element.pat.subarray(2, 6).fill(255), [1, 2, 255, 255, 255, 6, 7, 8]],
  ];
  for (const [edit, expected] of cases) {
    const engine = createEngine([{ ch: 'X', rows: [1, 2, 3, 4, 5, 6, 7, 8] }]),
      { api } = engine;
    engine.step(() => {
      for (let i = 0; i < 253; i++) api.pcg.Z.pat[0] = 0;
      edit(api.pcg.X);
      assert.deepEqual([...api.pcg.X.pat], expected);
      api.pcg.Y.pat[0] = 255;
      assert.equal(api.pcg.Y.pat[0], 0);
    });
  }
});

test('PCG method arguments are coerced once and array-like set sources count their actual length', () => {
  const engine = createEngine(),
    { api } = engine;
  let lengths = 0,
    offsets = 0,
    values = 0,
    starts = 0,
    ends = 0;
  engine.step(() => {
    for (let i = 0; i < 251; i++) api.pcg.Z.pat[0] = 0;
    api.pcg.X.pat.set(
      {
        get length() {
          lengths++;
          return 3;
        },
        0: 1,
        1: 2,
        2: 3,
      },
      {
        valueOf() {
          offsets++;
          return 1;
        },
      },
    );
    api.pcg.X.pat.fill(
      {
        valueOf() {
          values++;
          return 255;
        },
      },
      {
        valueOf() {
          starts++;
          return 5;
        },
      },
      {
        valueOf() {
          ends++;
          return 7;
        },
      },
    );
    assert.deepEqual([...api.pcg.X.pat], [0, 1, 2, 3, 0, 255, 255, 0]);
    api.pcg.Y.pat[0] = 255;
    assert.equal(api.pcg.Y.pat[0], 0);
  });
  assert.deepEqual([lengths, offsets, values, starts, ends], [1, 1, 1, 1, 1]);
});

test('PCG copies and buffer snapshots do not expose uncounted mutable pattern data', () => {
  const { api } = createEngine(),
    pat = api.pcg.X.pat;
  pat[0] = 128;
  new Uint8Array(pat.buffer).fill(255);
  pat.slice().fill(255);
  pat.map(() => 255);
  assert.deepEqual([...pat], [128, 0, 0, 0, 0, 0, 0, 0]);
  pat.subarray(1, 3).set([64, 32]);
  assert.deepEqual([...pat], [128, 64, 32, 0, 0, 0, 0, 0]);
});

test('PCG setup shares the first frame budget; failed frames reset it and games are independent', () => {
  const first = createEngine(),
    second = createEngine();
  for (let i = 0; i < 256; i++) first.api.pcg[String.fromCodePoint(0xe000 + i)].pat[0] = 255;
  first.step(() => {
    first.api.pcg.X.pat[0] = 128;
    second.api.pcg.X.pat[0] = 128;
    first.api.pcg.X.col = [3, 2];
    assert.deepEqual([...first.api.pcg.X.col], [7, 0]);
    assert.equal(first.api.pcg.X.pat[0], 0);
    assert.equal(second.api.pcg.X.pat[0], 128);
  });
  assert.throws(
    () =>
      first.step(() => {
        for (let i = 0; i < 256; i++) first.api.pcg[String.fromCodePoint(0xe000 + i)].pat[0] = 64;
        throw new Error('failed tick');
      }),
    /failed tick/,
  );
  first.step(() => {
    first.api.pcg['\ue000'].pat[0] = 128;
    first.api.pcg.X.pat[0] = 128;
  });
  assert.equal(first.api.pcg['\ue000'].pat[0], 128);
  assert.equal(first.api.pcg.X.pat[0], 0, 'A failed tick does not release character slots');
});

test('PCG reserves 256 characters per run across frames, sharing patterns, colors and aliases', () => {
  const engine = feedbackEngine(),
    { api } = engine;
  api.pcg['é'].pat[0] = 128;
  engine.step(() => {
    for (let i = 0; i < 254; i++) api.pcg[String.fromCodePoint(0xe000 + i)].pat[0] = 0;
    api.pcg['e\u0301'].col[0] = 2;
  });
  assert.equal(
    engine.step(() => {
      api.pcg['👾'].col = [4, 1];
    }),
    0,
  );
  assert.equal(
    engine.step(() => {
      api.pcg.X.pat[0] = 255;
    }),
    1,
  );
  assert.equal(api.pcg.X.pat[0], 0);
  assert(engine.pixels.some((col) => col !== 0));
  assert.equal(
    engine.step(() => {
      api.pcg['👾'].pat.fill(255);
      api.pcg['e\u0301'].pat[0] = 64;
    }),
    0,
  );
  assert.equal(api.pcg['é'].pat[0], 64);
  assert.deepEqual([...api.pcg['👾'].pat], Array(8).fill(255));
  assert(engine.pixels.every((col) => col === 0));
  const restarted = createEngine();
  assert.equal(
    restarted.step(() => {
      restarted.api.pcg.X.pat[0] = 255;
    }),
    0,
  );
  assert.equal(restarted.api.pcg.X.pat[0], 255);
});

test('PCG reads, standard rendering and unsuccessful writes do not reserve character slots', () => {
  const engine = createEngine(glyphs),
    { api } = engine;
  engine.step(() => {
    for (const glyph of glyphs) {
      void api.pcg[glyph.ch].pat[0];
      api.put(0, 0, glyph.ch);
    }
    for (let i = 0; i < 300; i++) {
      const pcg = api.pcg[String.fromCodePoint(0xf0000 + i)];
      pcg.pat.set([]);
      pcg.pat.subarray(0, 1).reverse();
      assert.throws(() => {
        pcg.col = [8, 0];
      }, RangeError);
    }
    for (let i = 0; i < 255; i++) api.pcg[String.fromCodePoint(0xe000 + i)].pat[0] = 0;
    api.pcg['\ue000'].pat[0] = 0;
    api.pcg.X.pat[0] = 255;
  });
  assert.equal(
    engine.step(() => {
      api.pcg.Y.pat[0] = 128;
    }),
    0,
  );
  assert.equal(api.pcg.Y.pat[0], 128, 'The rejected X write did not take the last slot');
  const before = [...api.pcg.X.pat];
  assert.equal(
    engine.step(() => {
      api.pcg.X.pat.fill(255);
    }),
    1,
  );
  assert.deepEqual([...api.pcg.X.pat], before);
});

test('saved PCG views and borrowed setters keep the original character owner at capacity', () => {
  const engine = createEngine([{ ch: 'B', rows: [1, 2, 3, 4, 5, 6, 7, 8] }]),
    { api } = engine,
    a = api.pcg.A,
    b = api.pcg.B,
    saved = b.pat.subarray(1, 4),
    colors = b.col,
    before = [...b.pat];
  engine.step(() => {
    a.col[0] = 3;
  });
  engine.step(() => {
    for (let i = 0; i < 255; i++) api.pcg[String.fromCodePoint(0xe000 + i)].pat[0] = 0;
  });
  for (const write of [
    () => {
      saved[0] = 255;
    },
    () => saved.set([255]),
    () => saved.fill(255),
    () => saved.copyWithin(0, 1),
    () => saved.reverse(),
    () => saved.sort((x, y) => y - x),
    () => Object.defineProperty(saved, '0', { value: 255 }),
    () => {
      colors[0] = 6;
    },
    () => Object.getOwnPropertyDescriptor(b, 'pat').set.call(a, Array(8).fill(255)),
    () => Object.getOwnPropertyDescriptor(b, 'col').set.call(a, [6, 5]),
  ]) {
    assert.equal(engine.step(write), 1);
    assert.deepEqual([...b.pat], before);
    assert.deepEqual([...b.col], [7, 0]);
  }
  assert.equal(
    engine.step(() => {
      b.pat[0] = 255;
      for (let i = 0; i < 256; i++) a.pat[0] = i;
    }),
    1,
  );
  assert.equal(a.pat[0], 255, 'Character-limit rejection does not consume the byte budget');
});

test('each game has independent screen, sprites, PCG, input, and sound', () => {
  const presets = [{ ch: 'X', rows: [128, 0, 0, 0, 0, 0, 0, 0] }];
  const first = createEngine(presets),
    second = createEngine(presets);
  first.api.pcg.X.pat[0] = 255;
  first.api.pcg.X.col = [3, 2];
  first.api.cls(6);
  first.step(() => first.api.spr(0, 0, 'X', 4));
  first.input(63);
  first.api.play(0, 'c');
  assert(second.pixels.every((value) => value === 0));
  assert.deepEqual([...second.api.pcg.X.pat], presets[0].rows);
  assert.deepEqual([...second.api.pcg.X.col], [7, 0]);
  second.api.put(0, 0, 'X');
  assert.equal(pixel(second, 0), 7);
  assert.equal(pixel(second, 1), 0);
  assert.equal(second.api.btn(0), false);
  assert.deepEqual(second.sounds(), []);
});

test('btnp preserves a quick press/release until the next tick and does not repeat', () => {
  const engine = createEngine();
  engine.input(1 << 4);
  engine.input(0);
  engine.step(() => {
    assert.equal(engine.api.btn(4), false);
    assert.equal(engine.api.btnp(4), true);
  });
  engine.step(() => assert.equal(engine.api.btnp(4), false));
  engine.input(1 << 3);
  engine.step(() => {
    assert(engine.api.btn(3));
    assert(engine.api.btnp(3));
  });
  engine.step(() => {
    assert(engine.api.btn(3));
    assert.equal(engine.api.btnp(3), false);
  });
});

test('play caches compiled scores independently in each game', () => {
  let count = 0;
  const compiler = (str) => {
    count++;
    return { str };
  };
  const engine = createEngine([], compiler);
  engine.api.play(0, 'c');
  engine.api.play(2, 'c');
  assert.equal(count, 1);
  const events = engine.sounds();
  assert.equal(events.length, 2);
  const other = createEngine([], compiler);
  other.api.play(0, 'c');
  assert.equal(count, 2);
  assert.notEqual(other.sounds()[0].score, events[0].score);
});

test('all six buttons support simultaneous presses, holds, releases and re-presses', () => {
  const engine = createEngine();
  for (let b = 0; b < 6; b++) {
    assert.equal(engine.api.btn(b), false);
    assert.equal(engine.api.btnp(b), false);
  }
  engine.input(63 | 128);
  engine.step(() => {
    for (let b = 0; b < 6; b++) {
      assert(engine.api.btn(b));
      assert(engine.api.btnp(b));
    }
  });
  engine.input(63);
  engine.step(() => {
    for (let b = 0; b < 6; b++) {
      assert(engine.api.btn(b));
      assert.equal(engine.api.btnp(b), false);
    }
  });
  engine.input(0);
  engine.input(63);
  engine.input(0);
  engine.step(() => {
    for (let b = 0; b < 6; b++) {
      assert.equal(engine.api.btn(b), false);
      assert(engine.api.btnp(b));
    }
  });
  engine.step(() => {
    for (let b = 0; b < 6; b++) assert.equal(engine.api.btnp(b), false);
  });
  for (const value of [-1, 6, 0.5, NaN, '0', null, undefined]) {
    assert.throws(() => engine.api.btn(value), RangeError);
    assert.throws(() => engine.api.btnp(value), RangeError);
  }
});

test('a failed tick clears old sprites and presses while preserving held buttons', () => {
  const engine = createEngine(),
    error = new Error('game error');
  engine.api.cls(4);
  engine.api.pcg.X.pat = 'FFFFFFFFFFFFFFFF';
  engine.step(() => engine.api.spr(0, 0, 'X', 6));
  engine.input(1);
  assert.throws(
    () =>
      engine.step(() => {
        assert(engine.api.btnp(0));
        throw error;
      }),
    (e) => e === error,
  );
  assert(engine.pixels.every((value) => value === 4));
  engine.step(() => {
    assert(engine.api.btn(0));
    assert.equal(engine.api.btnp(0), false);
  });
});

test('sound commands preserve channel, compiled score and order, including stop', () => {
  const engine = createEngine([], (score) => ({ source: score }));
  engine.api.play(2, 'c');
  engine.api.play(0, 'd');
  engine.api.play(2, '');
  assert.deepEqual(engine.sounds(), [
    { ch: 2, score: { source: 'c' } },
    { ch: 0, score: { source: 'd' } },
    { ch: 2, score: { source: '' } },
  ]);
  assert.deepEqual(engine.sounds(), []);
  for (const ch of [-1, 3, 0.5, NaN, '0', null])
    assert.throws(() => engine.api.play(ch, 'c'), RangeError);
  for (const score of [null, 1, {}, undefined])
    assert.throws(() => engine.api.play(0, score), TypeError);
  assert.deepEqual(engine.sounds(), []);
});

test('a tick can play 256 sounds, and more fail clearly instead of breaking the frame', () => {
  const engine = createEngine([], (score) => score);
  engine.step(() => {
    for (let i = 0; i < 256; i++) engine.api.play(i % 3, 'c');
  });
  assert.equal(engine.sounds().length, 256);
  assert.throws(
    () =>
      engine.step(() => {
        for (let i = 0; i < 257; i++) engine.api.play(0, 'c');
      }),
    { name: 'RangeError', message: 'A tick can play at most 256 sounds' },
  );
  assert.equal(engine.sounds().length, 256);
});

test('a failed score compile emits nothing and can be retried', () => {
  let calls = 0;
  const engine = createEngine([], (score) => {
    if (++calls === 1) throw new SyntaxError('bad score');
    return score;
  });
  assert.throws(() => engine.api.play(0, 'c'), SyntaxError);
  assert.deepEqual(engine.sounds(), []);
  engine.api.play(0, 'c');
  assert.equal(calls, 2);
  assert.deepEqual(engine.sounds(), [{ ch: 0, score: 'c' }]);
});

test('the score cache remains bounded and re-compiles evicted scores', () => {
  let calls = 0;
  const engine = createEngine([], (score) => {
    calls++;
    return score;
  });
  for (let i = 0; i < 256; i++) engine.api.play(0, String(i));
  engine.sounds();
  engine.api.play(0, '0');
  assert.equal(calls, 256);
  engine.api.play(0, '256');
  assert.equal(calls, 257);
  engine.api.play(0, '0');
  assert.equal(calls, 258);
});
