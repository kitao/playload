import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, palette } from '../src/engine.js';
import { glyphs } from '../src/glyphs.js';

test('opaque two-color glyphs use free coordinates, clip, and reset x at a newline', () => {
  const { api, pixels } = createEngine();
  api.pcg.X.pat = '8000000000000001';
  api.col(6, 1); api.cls(4); api.put('X\nX', -1, 2);
  assert.equal(pixels[2 * 160], 1);
  assert.equal(pixels[9 * 160 + 6], 6);
  assert.equal(pixels[17 * 160 + 6], 6);
  assert.equal(pixels[1 * 160], 4);
  assert.equal(pixels[2 * 160 + 7], 4);
  assert.equal(pixels.length, 160 * 144);
  assert.equal(palette.length, 8);
});

test('patterns are mutable bytes; glyph colors inherit independently, including black', () => {
  const { api, pixels } = createEngine();
  api.pcg['漢'].pat = [255, 0, 0, 0, 0, 0, 0, 0];
  api.pcg['漢'].pat[1] = 128;
  api.pcg['漢'].col = [0, null];
  api.col(7, 5); api.put('漢', 0, 0);
  assert.equal(pixels[0], 0);
  assert.equal(pixels[160], 0);
  assert.equal(pixels[161], 5);
  api.pcg['漢'].col[0] = null; api.put('漢', 8, 0);
  assert.equal(pixels[8], 7);
  assert.throws(() => { api.pcg.X.pat = 'ff'; }, /16 hex/);
  assert.throws(() => { api.pcg.X.col = [8, 0]; }, /0–7/);
});

test('emoji selectors and graphemes draw one character; presets do not contain Kanji', () => {
  const { api, pixels } = createEngine(glyphs);
  api.pcg['⛩️'].pat = 'ffffffffffffffff'; api.pcg['⛩'].col = [3, 0];
  api.pcg['👨‍👩‍👧‍👦'].pat = 'ffffffffffffffff'; api.pcg['👨‍👩‍👧‍👦'].col = [4, 0];
  api.put('⛩️👨‍👩‍👧‍👦', 0, 0);
  assert.equal(pixels[0], 3); assert.equal(pixels[8], 4); assert.equal(pixels[16], 0);
  assert(!glyphs.some(g => /\p{Script=Han}/u.test(g.ch)));
});

test('btnp preserves a quick press/release until the next tick and does not repeat', () => {
  const engine = createEngine();
  engine.input(1 << 4); engine.input(0);
  engine.step(() => { assert.equal(engine.api.btn(4), false); assert.equal(engine.api.btnp(4), true); });
  engine.step(() => assert.equal(engine.api.btnp(4), false));
  engine.input(1 << 3);
  engine.step(() => { assert(engine.api.btn(3)); assert(engine.api.btnp(3)); });
  engine.step(() => { assert(engine.api.btn(3)); assert.equal(engine.api.btnp(3), false); });
});

test('play validates and caches scores without sharing cache across games', () => {
  let count = 0; const engine = createEngine([], score => { count++; return { score }; });
  engine.api.play(0, 'c'); engine.api.play(2, 'c'); assert.equal(count, 1);
  const events = engine.sounds(); assert.equal(events.length, 2); assert.equal(events[1].ch, 2);
  assert.equal(engine.sounds().length, 0);
  assert.throws(() => engine.api.play(3, 'c'), /0–2/);
});
