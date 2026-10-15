// Offline, deterministic curation from frozen author files. Never runs in a game.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { glyphFallback } from './glyph-fallback.js';
import { colorPolicy, emojiColor } from './emoji-colors.js';
import { palette } from '../src/engine/engine.js';
const root = fileURLToPath(new URL('..', import.meta.url));
const read = (name) => readFileSync(root + '/data/fonts/' + name, 'utf8');
const selection = JSON.parse(read('selection.json'));
const key = (ch) => ch.normalize('NFC').replace(/[\uFE0E\uFE0F]/g, '');
const hex = (text) =>
  new Map(
    text
      .trim()
      .split('\n')
      .map((line) => {
        const [cp, bits] = line.split(':');
        return [
          Number.parseInt(cp, 16),
          bits.length === 16 ? bits.match(/../g).map((byte) => Number.parseInt(byte, 16)) : null,
        ];
      }),
  );
const unscii = hex(read('unscii-8.hex')),
  publicPixel = hex(read('public-pixel-8.hex'));
const misaki = hex(read(selection.kana.font));
const unicode = new Map(
  read('UnicodeData.txt')
    .trim()
    .split('\n')
    .map((line) => {
      const [cp, name, category] = line.split(';');
      return [Number.parseInt(cp, 16), { name: name.toLowerCase(), category }];
    }),
);
// UnicodeData represents ideographs as range endpoints rather than per-letter
// records. Resolve the source font's encoded cells inside those ranges too.
let rangeStart;
for (const [cp, info] of unicode) {
  if (info.name.endsWith(', first>')) rangeStart = cp;
  if (info.name.endsWith(', last>') && rangeStart !== undefined) {
    for (const encoded of new Set([...publicPixel.keys(), ...unscii.keys()])) {
      if (encoded >= rangeStart && encoded <= cp)
        unicode.set(encoded, {
          name: 'cjk unified ideograph-' + encoded.toString(16),
          category: info.category,
        });
    }
    rangeStart = undefined;
  }
}
const emojiNames = new Map();
for (const line of read(selection.emoji.reference).split('\n')) {
  const match = line.match(/^([0-9A-F ]+)\s*; fully-qualified\s*#\s*(\S+)\s+E[\d.]+\s+(.+)$/);
  if (match && [...key(match[2])].length === 1)
    emojiNames.set(key(match[2]).codePointAt(0), { ch: match[2], name: match[3] });
}
const artwork = (cp) => unscii.get(cp) ?? publicPixel.get(cp);
const symbols = [...new Set([...unscii.keys(), ...publicPixel.keys()])].filter(
  (cp) => artwork(cp) && unicode.get(cp)?.category.startsWith(selection.symbols.category),
);
const emoji = [...emojiNames.keys()].filter((cp) => artwork(cp));
const bank = new Map();
const colorSource = JSON.parse(read(selection.emoji.colors));
assert.equal(
  colorSource.extractorSHA256,
  createHash('sha256')
    .update(readFileSync(root + '/scripts/import-emoji-colors.py'))
    .digest('hex'),
  'Emoji color extraction changed; rerun scripts/import-emoji-colors.py',
);
assert.equal(Object.keys(colorSource.glyphs).length, emoji.length);
const colorSelections = emoji.map((cp) => {
  const data = colorSource.glyphs[cp.toString(16).toUpperCase().padStart(4, '0')];
  assert(data?.samples.length, 'Missing emoji color input: U+' + cp.toString(16));
  return { ch: String.fromCodePoint(cp), ...emojiColor(data.samples, palette) };
});
const colors = new Map(colorSelections.map((c) => [c.ch, c.ink]));
function add(cp, group) {
  const category = unicode.get(cp)?.category;
  const text =
    group !== 'emoji' &&
    (group === 'letters' ||
      (cp >= 32 && cp <= 126) ||
      (publicPixel.has(cp) && /^[PNZ]/.test(category)));
  const candidates =
    group === 'kana'
      ? [['misaki', misaki]]
      : text
        ? [['public-pixel', publicPixel]]
        : [
            ['unscii', unscii],
            ['public-pixel', publicPixel],
          ];
  const [source, font] = candidates.find(([, font]) => font.get(cp)) ?? [];
  const rows = font?.get(cp);
  assert(rows && rows.length === 8, 'Selected cell needs native artwork: U+' + cp.toString(16));
  assert(rows.some(Boolean) || cp === 32 || cp === 160 || cp === 0x2800);
  const info = emojiNames.get(cp);
  const ch = group === 'emoji' ? (info?.ch ?? String.fromCodePoint(cp)) : String.fromCodePoint(cp);
  assert(!bank.has(key(ch)), 'Duplicate selection: ' + ch);
  const name = group === 'emoji' ? info?.name : unicode.get(cp)?.name;
  assert(name, 'Selected cell needs a name: ' + ch);
  bank.set(key(ch), {
    ch,
    name,
    rows,
    ink: group === 'emoji' ? (colors.get(key(ch)) ?? 7) : null,
    paper: group === 'emoji' ? 0 : null,
    group,
    source,
  });
}
for (let cp = selection.ascii.from; cp <= selection.ascii.to; cp++)
  add(cp, /[A-Za-z0-9]/.test(String.fromCodePoint(cp)) ? 'letters' : 'symbols');
// Emoji takes precedence for catalog classification and default color.
for (const cp of emoji) if (!bank.has(key(String.fromCodePoint(cp)))) add(cp, 'emoji');
for (const cp of symbols) {
  if (!bank.has(key(String.fromCodePoint(cp)))) add(cp, 'symbols');
}
// One authored alphabet, with no per-letter fallback to another typeface.
// Keep the existing baseline's non-letter punctuation and symbols.
const baseline = JSON.parse(read(selection.text.punctuationBaseline));
const punctuation = baseline.codepoints.filter((cp) => !unicode.get(cp)?.category.startsWith('L'));
const alphabet = [...publicPixel.keys()].filter((cp) => {
  const info = unicode.get(cp);
  return info?.category.startsWith(selection.text.alphabetCategory);
});
for (const cp of new Set([...punctuation, ...alphabet])) {
  const ch = String.fromCodePoint(cp),
    canonical = key(ch);
  if (bank.has(canonical)) continue;
  // Some authored Hebrew letters normalize to a base plus combining marks.
  // They remain one grapheme/cell and keep the source's complete bitmap.
  assert.equal(
    [...new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(canonical)].length,
    1,
    'A preset must occupy one grapheme cell',
  );
  const artworkCP = [...canonical].length === 1 ? canonical.codePointAt(0) : cp;
  add(
    artworkCP,
    unicode.get(artworkCP)?.category.startsWith('L') || /[0-9]/.test(canonical)
      ? 'letters'
      : 'symbols',
  );
}
for (const cp of misaki.keys()) add(cp, 'kana');
const order = ['emoji', 'symbols', 'letters', 'kana'];
const glyphs = [...bank.values()].sort(
  (a, b) =>
    order.indexOf(a.group) - order.indexOf(b.group) || a.ch.codePointAt(0) - b.ch.codePointAt(0),
);
const output =
  '// Generated by scripts/generate-glyphs.js. Edit selection.json, not this file.\n// Author sources and permissions: ../site/index.md#license; curation: ../../docs/glyphs.md\nexport const glyphs = [\n' +
  glyphs.map((g) => '  ' + JSON.stringify(g) + ',').join('\n') +
  '\n];\n';
const fallback = glyphFallback(glyphs);
const sizes = {
  moduleBytes: Buffer.byteLength(output),
  gzipBytes: gzipSync(output).length,
  bitmapBytes: glyphs.length * 8,
  catalogFontBytes: fallback.bytes.length,
};
assert(
  sizes.gzipBytes <= selection.maximumGzipBytes,
  'Preset module exceeds its transfer budget; review the source/font scope',
);
const inputs = [
  'selection.json',
  'wgl4.json',
  'unicode-source.json',
  'unicode-LICENSE.txt',
  'unscii-8.hex',
  'unscii-REVISION',
  'unscii-README.md',
  'unscii-sources.txt',
  'PublicPixel.ttf',
  'public-pixel-LICENSE.txt',
  'public-pixel-8.hex',
  'public-pixel-conversion.json',
  'UnicodeData.txt',
  'emoji-test.txt',
  selection.emoji.colors,
  'twemoji-color-LICENSE.txt',
  'misaki-kana.hex',
  'misaki-kana.bdf',
  'misaki-conversion.json',
  'misaki.txt',
  'misaki-bdf-readme.txt',
];
const hashes = Object.fromEntries(
  inputs.map((name) => [
    name,
    createHash('sha256')
      .update(readFileSync(root + '/data/fonts/' + name))
      .digest('hex'),
  ]),
);
const report = {
  total: glyphs.length,
  groups: {},
  sources: {},
  sizes,
  catalogFont: {
    glyphCount: fallback.glyphCount,
    SHA256: createHash('sha256').update(fallback.bytes).digest('hex'),
  },
  symbolRepertoire: {
    unicodeVersion: '17.0',
    category: selection.symbols.category,
    sourceAvailableCodePoints: symbols.length,
  },
  emojiRepertoire: { unicodeVersion: '17.0', sourceAvailableSingleCodePoints: emoji.length },
  emojiColors: {
    reference: colorSource.source,
    revision: colorSource.revision,
    algorithmSHA256: createHash('sha256')
      .update(readFileSync(root + '/scripts/emoji-colors.js'))
      .digest('hex'),
    policy: colorPolicy,
    selections: colorSelections,
  },
  inputSHA256: hashes,
  textRepertoire: {
    punctuationBaseline: baseline.name,
    punctuationCodePoints: punctuation.length,
    alphabetFont: 'Public Pixel 1.24',
    alphabetCodePoints: alphabet.length,
  },
  outputSHA256: createHash('sha256').update(output).digest('hex'),
};
for (const g of glyphs) {
  report.groups[g.group] = (report.groups[g.group] ?? 0) + 1;
  report.sources[g.source] = (report.sources[g.source] ?? 0) + 1;
}
for (const [name, content] of [
  ['src/engine/glyphs.js', output],
  ['docs/glyph-coverage.json', JSON.stringify(report, null, 2) + '\n'],
  ['src/app/glyph-fallback.woff', fallback.bytes],
]) {
  if (process.argv.includes('--check'))
    assert.deepEqual(
      readFileSync(root + '/' + name),
      Buffer.from(content),
      name + ' is stale; run npm run fonts',
    );
  else writeFileSync(root + '/' + name, content);
}
console.log(
  JSON.stringify({ total: report.total, groups: report.groups, sources: report.sources }),
);
