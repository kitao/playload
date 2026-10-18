# Font coverage

The built-in bank contains **2,460 canonical 8×8 cells**. Public Pixel supplies text;
Unscii and Public Pixel supply symbols and emoji; Misaki Gothic supplies kana.
Original fonts, licenses and conversion records are in `data/fonts/`;
[Playload's website](https://kitao.dev/playload/) lists the source projects and licenses.

## Letters and kana

**Every letter in Public Pixel 1.24 is included**: 946 encoded letters in Unicode 17.0
General_Category L. They cover Latin, Greek, Cyrillic, Hebrew, Coptic and modifier letters,
plus the source's two ideographs `元` and `円`. Printable ASCII, numbers and text punctuation
also use Public Pixel. `put` writes graphemes in the supplied order; it does not provide
bidirectional layout or language-specific shaping.

Kana includes every Misaki Gothic 2021-05-05 glyph in **U+3040–U+309F** (87 cells) and
**U+30A0–U+30FF** (90 cells), including spacing voiced marks, iteration marks, the middle dot
and prolonged sound mark. Halfwidth kana, the full Han bank and glyphs absent from the source
are outside this subset.

## Symbols and emoji

Symbols include every native 8×8 glyph in Unscii-8 and Public Pixel 1.24 whose Unicode 17.0
General_Category is S: mathematics, currency, modifiers or other symbols. The **1,263 encoded
source symbols** include arrows, box drawing, blocks, shapes, braille and legacy-computer
graphics. Braille Pattern Blank (U+2800) retains its empty bitmap.

Emoji includes every fully-qualified Unicode 17.0 emoji that becomes one code point after
removing FE0E/FE0F and has native artwork in those two fonts: **132 characters**.
ZWJ sequences, flags, keycaps, skin-tone sequences and missing source glyphs are outside
this preset scope. The complete official `emoji-test.txt` is frozen for coverage checks.

Printable ASCII and [WGL4](https://learn.microsoft.com/en-us/typography/develop/wgl4)'s
**220 non-letter code points** provide a compatibility baseline of punctuation, numbers,
spaces and symbols. Letters come entirely from Public Pixel, so the bank does not claim
complete WGL4 coverage. The frozen list and source-page hashes are in `data/fonts/wgl4.json`.

Emoji takes catalog precedence: 129 of the 132 emoji also belong to the source-symbol set.
The final catalogs contain **953 alphabet/number cells, 1,198 symbols, 132 emoji and 177 kana**.
Encoded code-point counts differ from cell counts because canonically equivalent forms share
one NFC key, and emoji variation selectors do not add cells.

## Bitmap selection

The first available source supplies the whole bitmap:

1. ASCII, alphabet/number cells and source-supported text punctuation: Public Pixel alone.
2. Emoji, other symbols and pictograms: Unscii, then Public Pixel.
3. Kana: Misaki Gothic.

Pixels from different fonts are not mixed within a character. All 95 printable ASCII cells
use Public Pixel. Each exported glyph records its source. Composed and decomposed forms resolve
to the same NFC key; letters that normalize to a base and marks still occupy one grapheme cell.
Other artwork can be defined through `pcg[chr].pat`.

| Source            | Cells | Breakdown                                        |
| ----------------- | ----: | ------------------------------------------------ |
| Public Pixel 1.24 | 1,153 | 953 alphabet/number cells, 164 symbols, 36 emoji |
| Unscii-8          | 1,130 | 1,034 symbols, 96 emoji                          |
| Misaki Gothic     |   177 | Kana                                             |

## Conversion and size

Public Pixel is extracted at 8px without antialiasing or scaling. All **1,324 encoded source
cells** fit. Misaki's BDF offsets and ascent
are restored within its native 8×8 cell; the kana-only BDF retains the original glyph records.
Unscii's row bytes are used directly. These conversions do not blur, scale or crop artwork;
`data/fonts/misaki-conversion.json` records affected cells and positions.

The module is **367,804 bytes**, including names and source metadata; local default gzip gives
**36,425 bytes**. Bitmap rows occupy **19,680 bytes**. A **48 KiB gzip budget** checks module size
without cutting the declared repertoire to a character quota. Built-in patterns add no bytes
to a game's shared source URL; actual transfer compression depends on the host.

### Emoji colors

All default emoji colors use one rule applied to fixed
[Twemoji 72px PNGs](https://github.com/jdecked/twemoji/tree/b6b55fef1e8636b540a6d016a4729ca8cdf2e60b/assets/72x72).
The PNGs provide color statistics; the 8×8 artwork remains Unscii/Public Pixel. The 33,219-byte
statistics file is a generation input, not a web asset. Original PNG and extractor hashes are
retained in `data/fonts/twemoji-colors.json`.

1. Exclude transparent edge pixels. For colored rectangular backplates, remove the background
   and connected outer-border remnants using the shared geometry/color rules in
   [the importer](../scripts/import-emoji-colors.py). Other objects retain their full distribution.
2. Collect alpha-weighted RGB statistics in 3-bit buckets. Keep sampled colors together rather
   than pooling all neutral parts against a colored body.
3. Choose the sampled color with the largest area-weighted Gaussian neighborhood in
   [CIEDE2000](https://hajim.rochester.edu/ece/sites/gsharma/ciede2000/) space, with width 8.
   Nearby shades reinforce each other; unrelated hues are not averaged.
4. Match it to DB8 inks of the same chromatic or neutral class using CIEDE2000.
   For chromatic colors (CIELAB chroma at least 20), set both
   lightness values to 50 before comparison to preserve hue rather than shading; neutral colors
   retain their lightness. Require at least 3:1 contrast against black, excluding black and dark
   purple from default ink. Both remain available in games.
5. Use white for flat neutral artwork (one RGB bucket) whose source contrast is below 3:1 against black.
   Colored artwork and shaded neutral objects retain ordinary matching.

These are Playload's common color rules, with no per-character overrides. The contrast floor
is a readability choice, not a WCAG compliance claim. The result is **66 chromatic, 4 gray and
62 white** cells on black paper. Games can override colors. [The coverage report](glyph-coverage.json)
records each representative color and final ink; the tool shows the resulting artwork.

The catalog's **6,308-byte WOFF fallback** covers 292 supplementary-plane symbols missing
from OS fonts. It traces the same CC0 Unscii and Public Pixel rows into rectangles and is used
only for catalog labels. Browser tests compare every fallback glyph with its source rows.

## Regeneration

```sh
npm run fonts
npm run fonts:check
npm test
npm run test:browser
```

Ordinary regeneration uses Node and frozen inputs, offline. Tests compare every shipped bitmap
with its source, check repertoire coverage, restore Misaki's BDF coordinates and verify NFC
lookup. Browser tests check catalog previews and real worker output for accents, composed
letters, kana, extended symbols and emoji selectors.

To repeat the color import from the pinned PNGs:

```sh
python3 -m venv .venv
. .venv/bin/activate
python3 -m pip install Pillow==12.3.0
npm run fonts:colors
```

The importer caches images in the system temporary directory and verifies their hashes against
frozen inputs. The images are not bundled. Python and Pillow are unnecessary for ordinary checks.
`scripts/import-public-pixel.js` extracts the TTF with Node;
`scripts/import-misaki.py` uses Python's standard library and the hash-checked author archive.

`data/fonts/unicode-source.json` records original hashes and URLs for Unicode names and emoji
definitions. Original name records are retained for source-font cells and the WGL4 baseline.
[The coverage report](glyph-coverage.json) records input/output hashes, sources and counts.

## Extending coverage

A missing preset is determined by the declared repertoire and source artwork. For example,
`🚀`, `🔥`, `🔑` and `💣` have no native glyph in the adopted fonts; define them with
`pcg[chr].pat`. Built-in coverage changes require an explicit source-version or repertoire
change, its reason and size cost, and the same artwork and coverage checks.
