import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { palette } from '../src/engine/engine.js';
import { glyphs } from '../src/engine/glyphs.js';
import {
  colorPolicy,
  contrast,
  deltaE,
  dominantColor,
  emojiColor,
  lab,
  paletteInk,
} from '../scripts/emoji-colors.js';

test('CIEDE2000 matches all 34 published Sharma/Wu/Dalal test pairs', () => {
  const lines = readFileSync(
    new URL('../tests/reference/color/ciede2000.tsv', import.meta.url),
    'utf8',
  )
    .trim()
    .split('\n');
  assert.equal(lines.length, 34);
  for (const line of lines) {
    const values = line.trim().split(/\s+/).map(Number);
    assert(Math.abs(deltaE(values.slice(0, 3), values.slice(3, 6)) - values[6]) < 0.00005, line);
  }
});

test('sRGB conversion and contrast have known endpoints and symmetry', () => {
  assert.deepEqual(lab('#000000'), [0, 0, 0]);
  assert(Math.abs(lab('#ffffff')[0] - 100) < 0.00001);
  assert.equal(contrast('#000000', '#ffffff'), 21);
  assert.equal(contrast('#ffffff', '#000000'), 21);
  for (const color of palette) assert.equal(deltaE(lab(color), lab(color)), 0);
});

test('the dominant color joins nearby shades without averaging unrelated hues', () => {
  const samples = [
    ['#2da33a', 40],
    ['#33aa44', 40],
    ['#ff1111', 60],
  ];
  const selected = dominantColor(samples);
  assert(['#2da33a', '#33aa44'].includes(selected));
  assert.equal(dominantColor([...samples].reverse()), selected);
  assert.equal(paletteInk(selected, palette), 5);
});

test('neutral surfaces and small colored accents do not acquire a dominant hue', () => {
  assert.equal(dominantColor([]), null);
  assert.equal(paletteInk(null, palette), 7);
  assert.equal(
    dominantColor([
      ['#eeeeee', 90],
      ['#ff0000', 10],
    ]),
    '#eeeeee',
  );
  assert.equal(paletteInk(dominantColor([['#888888', 100]]), palette), 2);
});

test('a large neutral body outweighs several unrelated colored details', () => {
  const samples = [
    ['#e1e8ed', 74],
    ['#f4900c', 13],
    ['#5dadec', 13],
  ];
  assert.equal(dominantColor(samples), '#e1e8ed');
  assert.equal(emojiColor(samples, palette).ink, 7);
});

test('unrelated neutral parts do not outvote one coherent colored body', () => {
  assert.equal(
    dominantColor([
      ['#ffffff', 20],
      ['#000000', 20],
      ['#888888', 20],
      ['#ffac33', 40],
    ]),
    '#ffac33',
  );
});

test('chromatic ink follows tint rather than source shadow brightness', () => {
  for (const brown of ['#662113', '#bf6952', '#d99e82'])
    assert.equal(paletteInk(brown, palette), 3, brown);
  assert.equal(paletteInk('#553986', palette), 4);
  assert.equal(paletteInk('#a868b7', palette), 4);
});

test('default ink retains every readable palette color and substitutes dark purple', () => {
  for (let ink = 2; ink < palette.length; ink++)
    assert.equal(paletteInk(palette[ink], palette), ink, palette[ink]);
  assert.equal(paletteInk(palette[1], palette), 4);
  assert(contrast(palette[1]) < colorPolicy.contrastTarget);
  assert(contrast(palette[4]) > colorPolicy.contrastTarget);
  // A pale chromatic source stays colored rather than losing its hue to white.
  assert.equal(paletteInk('#75c8f7', palette), 4);
});

test('dark flat neutral artwork becomes white, while shaded or colored objects retain ink', () => {
  assert.equal(emojiColor([['#31373d', 100]], palette).ink, 7);
  assert.equal(emojiColor([['#000000', 100]], palette).ink, 7);
  assert.equal(emojiColor([['#888888', 100]], palette).ink, 2);
  assert.equal(emojiColor([[palette[1], 100]], palette).ink, 4);
  assert.equal(
    emojiColor(
      [
        ['#31373d', 100],
        ['#404040', 100],
      ],
      palette,
    ).ink,
    2,
  );
  assert.deepEqual(emojiColor([], palette), { reference: null, ink: 7 });
});

test('every generated default emoji meets the black-paper contrast floor', () => {
  for (const glyph of glyphs.filter((g) => g.group === 'emoji'))
    assert(contrast(palette[glyph.ink]) >= colorPolicy.contrastTarget, glyph.ch);
});

test('every emoji uses the common frozen input and algorithm with no overrides', () => {
  const source = JSON.parse(
    readFileSync(new URL('../data/fonts/twemoji-colors.json', import.meta.url), 'utf8'),
  );
  assert.equal(source.source, 'Twemoji, PNG at 72px');
  const entries = glyphs.filter((g) => g.group === 'emoji');
  assert.equal(Object.keys(source.glyphs).length, entries.length);
  for (const glyph of entries) {
    const cp = glyph.ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
    const data = source.glyphs[cp];
    assert.match(data.sha256, /^[0-9a-f]{64}$/);
    for (const [color, weight] of data.samples) {
      assert.match(color, /^#[0-9a-f]{6}$/);
      assert(Number.isInteger(weight) && weight > 0);
    }
    assert.equal(glyph.ink, emojiColor(data.samples, palette).ink, glyph.ch);
    assert.equal(glyph.paper, 0, glyph.ch);
  }
});

test('colored button backplates leave their foreground symbols neutral', () => {
  const source = JSON.parse(
    readFileSync(new URL('../data/fonts/twemoji-colors.json', import.meta.url), 'utf8'),
  );
  for (const cp of ['2194', '23E9', '262E', '262F', '2640', '2642']) {
    assert(source.glyphs[cp].plateRemoved, cp);
    const color = dominantColor(source.glyphs[cp].samples);
    assert(Math.hypot(lab(color)[1], lab(color)[2]) < colorPolicy.minimumChroma, cp);
  }
});
