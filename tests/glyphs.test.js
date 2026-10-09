import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { glyphs } from '../src/glyphs.js';
import { createEngine } from '../src/engine.js';
const key = (ch) => ch.normalize('NFC').replace(/[\uFE0E\uFE0F]/g, '');
const bank = new Map(glyphs.map((g) => [key(g.ch), g]));

test('the bank follows the declared source repertoires within its transfer budget', () => {
  const selection = JSON.parse(readFileSync('data/fonts/selection.json', 'utf8'));
  const standard = JSON.parse(readFileSync('data/fonts/wgl4.json', 'utf8'));
  const names = new Map(
    readFileSync('data/fonts/UnicodeData.txt', 'utf8')
      .trim()
      .split('\n')
      .map((line) => {
        const [cp, name, category] = line.split(';');
        return [parseInt(cp, 16), { name, category }];
      }),
  );
  const fontLetters = readFileSync('data/fonts/public-pixel-8.hex', 'utf8')
    .trim()
    .split('\n')
    .filter((line) => line.split(':')[1].length === 16)
    .map((line) => parseInt(line, 16))
    .filter((cp) => {
      return /\p{Letter}/u.test(String.fromCodePoint(cp));
    });
  const fonts = new Set(
    ['unscii-8.hex', 'public-pixel-8.hex'].flatMap((file) =>
      readFileSync('data/fonts/' + file, 'utf8')
        .trim()
        .split('\n')
        .filter((line) => line.split(':')[1].length === 16)
        .map((line) => parseInt(line, 16)),
    ),
  );
  const emojis = readFileSync('data/fonts/emoji-test.txt', 'utf8')
    .split('\n')
    .flatMap((line) => {
      const fields = line.split(';');
      if (!fields[1]?.trim().startsWith('fully-qualified')) return [];
      const points = fields[0]
        .trim()
        .split(/\s+/)
        .map((cp) => parseInt(cp, 16))
        .filter((cp) => cp !== 0xfe0e && cp !== 0xfe0f);
      return points.length === 1 && fonts.has(points[0]) ? [String.fromCodePoint(points[0])] : [];
    });
  const symbols = [...fonts]
    .filter((cp) => ['Sm', 'Sc', 'Sk', 'So'].includes(names.get(cp)?.category))
    .map((cp) => key(String.fromCodePoint(cp)));
  const allowed = new Set([
    ...Array.from({ length: 95 }, (_, i) => String.fromCodePoint(32 + i)),
    ...symbols,
    ...emojis,
    ...standard.codepoints
      .filter((cp) => !/\p{Letter}/u.test(String.fromCodePoint(cp)))
      .map((cp) => key(String.fromCodePoint(cp))),
    ...fontLetters.map((cp) => key(String.fromCodePoint(cp))),
    ...readFileSync('data/fonts/' + selection.kana.font, 'utf8')
      .trim()
      .split('\n')
      .map((line) => String.fromCodePoint(parseInt(line, 16))),
  ]);
  assert.equal(bank.size, glyphs.length);
  assert.equal(bank.size, allowed.size);
  assert(gzipSync(readFileSync('src/glyphs.js')).length <= selection.maximumGzipBytes);
  for (const g of glyphs) {
    assert(allowed.has(key(g.ch)), g.ch);
    assert.equal(g.rows.length, 8, g.ch);
    assert(
      g.rows.every((n) => Number.isInteger(n) && n >= 0 && n <= 255),
      g.ch,
    );
    assert(['unscii', 'public-pixel', 'misaki'].includes(g.source), g.ch);
    assert(g.rows.some(Boolean) || [' ', '\u00A0', '\u2800'].includes(g.ch), g.ch);
    assert(['letters', 'symbols', 'emoji', 'kana'].includes(g.group));
  }
});

test('every source-supported symbol and single emoji has a preset', () => {
  const selection = JSON.parse(readFileSync('data/fonts/selection.json', 'utf8'));
  assert.deepEqual(selection.symbols, { category: 'S' });
  for (let cp = 0x2500; cp <= 0x25ff; cp++)
    assert(
      bank.get(String.fromCodePoint(cp))?.rows.some(Boolean),
      'Structural U+' + cp.toString(16),
    );
  const report = JSON.parse(readFileSync('docs/glyph-coverage.json', 'utf8'));
  assert.equal(report.emojiRepertoire.sourceAvailableSingleCodePoints, 108);
  assert.equal(glyphs.filter((g) => g.group === 'emoji').length, 108);
  assert.equal(report.symbolRepertoire.category, 'S');
  assert.equal(report.symbolRepertoire.sourceAvailableCodePoints, 1237);
  // Blank braille is an authored, intentionally empty symbol, not a missing cell.
  assert.deepEqual(bank.get('\u2800').rows, Array(8).fill(0));
  for (const ch of '⡀⣿⌘★☆☒✓') assert(bank.get(ch)?.rows.some(Boolean), ch);
  for (const ch of '🦆🕴☯☮✴⏏⏫⏬⁉') assert(bank.get(ch)?.rows.some(Boolean), ch);
  for (const ch of '🚀🔥🔑💣') assert(!bank.has(ch), 'Unprovided source artwork: ' + ch);
  // Default colors follow the same preset through the public PCG API.
  const engine = createEngine(glyphs);
  assert.deepEqual(engine.api.pcg['♥'].col, [3, 0]);
  assert.deepEqual(engine.api.pcg['♦'].col, [3, 0]);
});

test('complete Unicode reference files retain their official original hashes', () => {
  const sources = JSON.parse(readFileSync('data/fonts/unicode-source.json', 'utf8'));
  for (const file of ['emoji-test.txt'])
    assert.equal(
      createHash('sha256')
        .update(readFileSync('data/fonts/' + file))
        .digest('hex'),
      sources[file].originalSHA256,
      file,
    );
});

test('the frozen author files reproduce the shipped bank and coverage report offline', () => {
  execFileSync(process.execPath, ['scripts/generate-glyphs.js', '--check']);
});

test('borrowed artwork keeps every original pixel from its credited native font', () => {
  for (const [source, file] of [
    ['unscii', 'unscii-8.hex'],
    ['public-pixel', 'public-pixel-8.hex'],
    ['misaki', 'misaki-kana.hex'],
  ]) {
    const originals = new Map(
      readFileSync('data/fonts/' + file, 'utf8')
        .trim()
        .split('\n')
        .map((line) => {
          const [cp, bytes] = line.split(':');
          return [Number.parseInt(cp, 16), bytes];
        }),
    );
    for (const g of glyphs.filter((g) => g.source === source)) {
      assert.equal(
        g.rows
          .map((n) => n.toString(16).padStart(2, '0'))
          .join('')
          .toUpperCase(),
        originals.get(g.ch.codePointAt(0)),
        g.ch,
      );
    }
  }
});

test('all printable ASCII and essential navigation, tile, status and object graphics are available', () => {
  for (let cp = 32; cp <= 126; cp++)
    assert.equal(bank.get(String.fromCodePoint(cp))?.source, 'public-pixel');
  for (const ch of '←↑→↓↖↗↘↙─│┌┐└┘├┤┬┴┼█░▒▓✓☒♥♦♠♣♪∞👾👻💀💎🪙💍🏰🪓🌲💧')
    assert(bank.get(ch)?.rows.some(Boolean), ch);
  assert.deepEqual(bank.get('█').rows, Array(8).fill(255));
  const engine = createEngine(glyphs);
  engine.api.put(0, 0, '████', 6);
  const pixels = engine.pixels;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 32; x++) assert.equal(pixels[y * 160 + x], 6);
});

test('emoji presentation selectors draw the same authored pixels', () => {
  for (const [a, b] of [
    ['☁', '☁️'],
    ['♥', '♥︎'],
    ['👾', '👾️'],
    ['✈', '✈️'],
  ]) {
    const first = createEngine(glyphs),
      second = createEngine(glyphs);
    first.api.put(0, 0, a);
    second.api.put(0, 0, b);
    assert.deepEqual(first.pixels, second.pixels, a + ' ' + b);
    assert(first.pixels.some((n) => n !== 0));
  }
});

test('custom characters support scripts and graphemes outside the built-in repertoire', () => {
  const a = createEngine(glyphs),
    b = createEngine(glyphs);
  for (const ch of ['漢', '한', '汉', 'q\u0307', '👨‍👩‍👧‍👦']) {
    assert(!bank.has(ch));
    a.api.pcg[ch].pat = 'FF818181818181FF';
    a.api.put(0, 0, ch);
    assert(a.pixels.some((n) => n !== 0));
    assert(b.api.pcg[ch].pat.every((n) => n === 0));
  }
  assert.equal(a.api.pcg['e\u0301'], a.api.pcg['é']);
});

test('lazy editable glyphs retain all keys and copy inputs before the first lookup', () => {
  const rows = [128, 0, 0, 0, 0, 0, 0, 0];
  const engine = createEngine([{ ch: 'X', rows, ink: 3, paper: 0 }]);
  rows[0] = 0;
  assert.deepEqual(Object.keys(engine.api.pcg), ['X']);
  assert.equal(engine.api.pcg.X.pat[0], 128);
  engine.api.put(0, 0, 'X');
  assert.equal(engine.pixels[0], 3);
});

test('the retained punctuation baseline remains covered without letter fallback', () => {
  const reference = JSON.parse(readFileSync('data/fonts/wgl4.json', 'utf8'));
  assert.equal(reference.sources.length, 4);
  assert.equal(reference.codepoints.length, 653);
  for (const cp of reference.codepoints) {
    const ch = String.fromCodePoint(cp);
    if (!/\p{Letter}/u.test(ch)) assert(bank.has(key(ch)), 'Punctuation U+' + cp.toString(16));
  }
  for (const ch of 'ÆæŒœßẞÐðÞþŁłŊŋĦħİıȘșȚțĄąĘęČčŐőŰűҐґЄєЇїЎўЉљЊњЏџΑΩαωςάέήίόύώΐΰ') {
    assert(bank.get(ch)?.rows.some(Boolean), ch);
  }
  for (const [plain, accent] of [
    ['a', 'ä'],
    ['e', 'é'],
    ['S', 'Ș'],
    ['Г', 'Ґ'],
    ['І', 'Ї'],
  ])
    assert.notDeepEqual(bank.get(plain).rows, bank.get(accent).rows);
});

test('the complete Public Pixel alphabet uses one typeface with no letter fallback', () => {
  const report = JSON.parse(readFileSync('docs/glyph-coverage.json', 'utf8'));
  assert.equal(report.textRepertoire.alphabetFont, 'Public Pixel 1.24');
  assert.equal(report.textRepertoire.alphabetCodePoints, 945);
  for (const file of ['public-pixel-8.hex']) {
    for (const line of readFileSync('data/fonts/' + file, 'utf8')
      .trim()
      .split('\n')) {
      const [cp, bits] = line.split(':');
      const ch = String.fromCodePoint(parseInt(cp, 16));
      if (bits.length === 16 && /\p{Letter}/u.test(ch)) assert(bank.has(key(ch)), file + ' ' + cp);
    }
  }
  for (const g of glyphs.filter((g) => g.group === 'letters')) {
    assert.equal(g.source, 'public-pixel', g.ch);
    const first = createEngine(glyphs),
      second = createEngine(glyphs);
    first.api.put(0, 0, g.ch);
    second.api.put(0, 0, g.ch.normalize('NFD'));
    assert.deepEqual(first.pixels, second.pixels, g.ch);
    assert(
      first.pixels.some((n) => n !== 0),
      g.ch,
    );
  }
});

test('kana matches the author BDF coordinates, including voiced kana and iteration marks', () => {
  const source = readFileSync('data/fonts/misaki-kana.bdf', 'utf8');
  const report = JSON.parse(readFileSync('data/fonts/misaki-conversion.json', 'utf8'));
  assert.equal(createHash('sha256').update(source).digest('hex'), report.subsetBDFSHA256);
  const ascent = Number(source.match(/^FONT_ASCENT (\d+)$/m)[1]);
  const blocks = [...source.matchAll(/STARTCHAR .*?ENDCHAR/gms)];
  assert.equal(blocks.length, 177);
  assert.equal(glyphs.filter((g) => g.source === 'misaki').length, 177);
  for (const [block] of blocks) {
    const cp = Number(block.match(/^ENCODING (\d+)$/m)[1]);
    assert(cp >= 0x3040 && cp <= 0x30ff);
    const [width, height, left, bottom] = block
      .match(/^BBX (.+)$/m)[1]
      .split(' ')
      .map(Number);
    const raw = block
      .split('BITMAP\n')[1]
      .split('ENDCHAR')[0]
      .trim()
      .split('\n')
      .map((byte) => parseInt(byte, 16));
    const rows = Array(8).fill(0);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        if (raw[y] & (128 >> x)) rows[ascent - bottom - height + y] |= 128 >> (left + x);
      }
    const ch = String.fromCodePoint(cp),
      glyph = bank.get(ch);
    assert.equal(glyph.source, 'misaki');
    assert.deepEqual(glyph.rows, rows, ch);
    const a = createEngine(glyphs),
      b = createEngine(glyphs);
    a.api.put(0, 0, ch);
    b.api.put(0, 0, ch.normalize('NFD'));
    assert.deepEqual(a.pixels, b.pixels, ch);
  }
  assert.deepEqual(bank.get('あ').rows, [32, 124, 32, 60, 106, 178, 100, 0]);
  assert.deepEqual(bank.get('ア').rows, [126, 2, 20, 24, 16, 16, 32, 0]);
  for (const ch of 'がぎぐげごぱぴぷぺぽガギグゲゴパピプペポヴゝゞヽヾー・')
    assert(bank.get(ch)?.rows.some(Boolean), ch);
});
