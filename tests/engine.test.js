import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, palette } from '../src/engine/engine.js';
import { glyphs } from '../src/engine/glyphs.js';

const pixel = (engine, x, y = 0) => engine.pixels[y * 160 + x];

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
  const engine = createEngine(),
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
    Uint8Array.from({ length: 160 * 144 }, (_, i) => (i % 160 < 128 && i < 160 * 64 ? 6 : 4)),
  );
  engine.step(() => api.spr(128, 0, 'X', 5));
  assert.equal(pixel(engine, 0), 4);
  assert.equal(pixel(engine, 128), 5);
});

test('sprite strings share the frame limit and ignore the remainder of an oversized call', () => {
  const engine = createEngine(),
    { api } = engine;
  api.cls(4);
  api.pcg.X.pat = 'FFFFFFFFFFFFFFFF';
  engine.step(() => {
    api.spr(-2048, 0, 'X'.repeat(126), 6);
    api.spr(0, 0, 'X\r\nXX', 3);
    api.spr(8, 8, 'X', 5);
  });
  assert.equal(pixel(engine, 0, 0), 3);
  assert.equal(pixel(engine, 0, 8), 3);
  assert.equal(pixel(engine, 8, 8), 4);
});

test('the sprite limit counts graphemes, excluding newlines and presentation selectors', () => {
  const engine = createEngine(),
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
    Uint8Array.from({ length: 160 * 144 }, (_, i) => (i % 160 < 128 && i < 160 * 64 ? 6 : 4)),
  );
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
    for (const value of [null, [], [1], [1, 2, 3], new Uint8Array([1, 2])])
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

test('PCG edits count 32 distinct characters, sharing the budget for patterns and colors', () => {
  const engine = createEngine(),
    { api } = engine;
  const chars = Array.from({ length: 33 }, (_, i) => String.fromCharCode(65 + i));
  const saved = chars.map((ch) => api.pcg[ch]);
  api.put(0, 0, chars.slice(0, 20).join(''));
  api.put(0, 1, chars.slice(20).join(''));
  engine.step(() => {
    for (const element of saved) {
      for (let row = 0; row < 8; row++) element.pat[row] = 255;
      element.col = [6, 1];
      element.col[0] = 5;
    }
    assert.deepEqual([...saved[31].pat], Array(8).fill(255));
    assert.deepEqual([...saved[32].pat], Array(8).fill(0));
    assert.deepEqual([...saved[32].col], [7, 0]);
    // The first character can still change after all 32 slots have been used.
    saved[0].pat = '8000000000000000';
    saved[0].col = [3, 2];
  });
  assert.equal(pixel(engine, 0), 3);
  assert.equal(pixel(engine, 1), 2);
  assert.equal(pixel(engine, 88, 8), 5);
  assert.equal(pixel(engine, 96, 8), 0);
  engine.step(() => {
    saved[32].pat.fill(255);
    saved[32].col[0] = 4;
  });
  assert.equal(pixel(engine, 96, 8), 4);
  assert.equal(pixel(engine, 88, 8), 5);
});

test('PCG reads and rejected writes use no slots, and normalized aliases share one slot', () => {
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
    }
    api.pcg['é'].pat[0] = 128;
    api.pcg['e\u0301'].col[0] = 3;
    api.pcg['⛩'].pat = '8000000000000000';
    api.pcg['⛩️'].col = [4, 0];
    api.pcg['👨‍👩‍👧‍👦'].pat.fill(255);
    for (let i = 0; i < 29; i++) api.pcg[String.fromCodePoint(0xe000 + i)].pat[0] = 255;
    api.pcg['\ue01d'].pat[0] = 255;
    assert.equal(api.pcg['\ue01c'].pat[0], 255);
    assert.equal(api.pcg['\ue01d'].pat[0], 0);
  });
});

test('saved PCG byte views and array editing methods obey the same character limit', () => {
  const edits = [
    (pat) => {
      pat[0] = 128;
    },
    (pat) => pat.set([128]),
    (pat) => pat.fill(128),
    (pat) => pat.copyWithin(0, 1, 2),
    (pat) => pat.reverse(),
    (pat) => pat.sort((a, b) => b - a),
    (pat) => {
      pat.subarray(0, 1)[0] = 128;
    },
    (pat) => pat.subarray(0, 1).fill(128),
    (pat) => Object.defineProperty(pat, '0', { value: 128 }),
    (pat) =>
      pat.forEach((value, index, rows) => {
        if (index === 0) rows[0] = 128;
      }),
    (pat) => {
      pat.valueOf()[0] = 128;
    },
  ];
  for (const edit of edits) {
    const engine = createEngine([{ ch: 'X', rows: [0, 128, 0, 0, 0, 0, 0, 128] }]),
      { api } = engine,
      saved = api.pcg.X.pat;
    engine.step(() => {
      for (let i = 0; i < 32; i++) api.pcg[String.fromCodePoint(0xe000 + i)].col = [3, 1];
      edit(saved);
      assert.equal(saved[0], 0);
      assert.deepEqual([...saved], [0, 128, 0, 0, 0, 0, 0, 128]);
    });
    engine.step(() => edit(saved));
    assert.equal(saved[0], 128);
    assert.equal(api.pcg.X.pat, saved);
  }
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
  for (let i = 0; i < 32; i++) first.api.pcg[String.fromCodePoint(0xe000 + i)].pat[0] = 255;
  first.step(() => {
    first.api.pcg.X.pat[0] = 128;
    second.api.pcg.X.pat[0] = 128;
    assert.equal(first.api.pcg.X.pat[0], 0);
    assert.equal(second.api.pcg.X.pat[0], 128);
  });
  assert.throws(
    () =>
      first.step(() => {
        for (let i = 0; i < 32; i++) first.api.pcg[String.fromCodePoint(0xe000 + i)].pat[0] = 64;
        throw new Error('failed tick');
      }),
    /failed tick/,
  );
  first.step(() => {
    first.api.pcg.X.pat[0] = 128;
  });
  assert.equal(first.api.pcg.X.pat[0], 128);
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
