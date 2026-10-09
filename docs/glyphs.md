# Font sources and coverage

**Text uses Public Pixel alone; classic-computer symbols and pictograms come from Unscii and Public Pixel; kana comes from Misaki Gothic.** Every shipped bitmap comes from these fonts. [Resource adoption](resource-adoption.md) records the fixed sources and adoption reasons; [README](../README.md#license) lists sources and licenses; original notices are retained in `data/fonts/`.

## Established repertoire

**Every authored letter in Public Pixel 1.24 is included, with no letter fallback to another typeface.** Unicode 17.0 General_Category **L** defines its **945 encoded letters**. This includes Latin, Greek, Cyrillic, Hebrew, Coptic and modifier letters, and the source’s two ideographs `元` and `円`. No scripts or individual letters are hand-picked. All printable ASCII, numbers and text punctuation use Public Pixel too. This is glyph coverage; the cell-based `put` API writes graphemes in their supplied order and does not implement bidirectional text layout or language-specific shaping.

Kana consists of every character provided by **Misaki Gothic 2021-05-05** in Unicode blocks **U+3040–U+309F** and **U+30A0–U+30FF**: 87 and 90 cells respectively. Those blocks include spacing voiced marks, iteration marks, the middle dot and prolonged sound mark. The source's missing characters are not fabricated. Halfwidth kana and the full Han bank from Misaki are not included.

## Symbols and emoji

**Symbols adopt every native 8×8 symbol in the fixed Unscii-8 and Public Pixel 1.24 sources.** Unicode 17.0 General_Category **S** defines symbols (Sm: mathematics, Sc: currency, Sk: modifiers, So: other symbols). All **1,237 encoded source symbols** are covered, including arrows, box drawing, blocks, geometric shapes, braille patterns and legacy-computer graphics. The Unicode category supplies the boundary; no individual symbols or blocks are hand-picked. Braille Pattern Blank (U+2800) correctly retains its empty source bitmap.

Emoji adopts every **fully-qualified Unicode 17.0 emoji that reduces to one code point after removing FE0E/FE0F and has native 8×8 artwork in Unscii-8 or Public Pixel 1.24**: **108 characters**, all in the Emoji catalog. This is the complete intersection of the fixed fonts and the defined Unicode forms, not all Unicode emoji. ZWJ sequences, flags, keycaps, skin-tone sequences and unsupported source glyphs are outside this preset scope. The complete official `emoji-test.txt` is frozen so the generator can detect any omitted supported emoji.

ASCII and the retained punctuation baseline also contribute punctuation and other symbols. Emoji takes catalog precedence when scopes overlap: 105 of the 108 emoji also belong to the 1,237 source-symbol set; all emoji appear in Emoji rather than Symbols. The Symbols catalog contains **1,196 cells**, including the additional ASCII and baseline characters. Game pictogram bitmaps are preserved.

## Exact bitmap selection

The generator selects ASCII U+0020–U+007E, the retained punctuation baseline, every letter from Public Pixel, all native source-font symbols and single-code-point emoji, and the Misaki kana subset. Canonical duplicates share one NFC key; FE0E/FE0F emoji presentation selectors do not create separate cells. Encoded code-point counts therefore need not sum to the canonical cell count.

Bitmap priority is deterministic:

1. ASCII, alphabet/number cells and source-supported text punctuation: Public Pixel alone.
2. Other symbols and pictograms: Unscii, then Public Pixel.
3. Kana: Misaki Gothic.

The first available source supplies the complete bitmap. Pixels from different fonts are not mixed inside one character. **All 95 printable ASCII cells use Public Pixel.** Each exported glyph records its actual source. The engine resolves composed/decomposed forms to the same NFC cell; authored letters that canonically decompose into a base and marks still occupy one grapheme cell with their original bitmap. Other graphemes can be defined with `pcg[chr].pat`.

| Source            | Shipped cells | Breakdown                                        |
| ----------------- | ------------: | ------------------------------------------------ |
| Public Pixel 1.24 |         1,126 | 952 alphabet/number cells, 162 symbols, 12 emoji |
| Unscii-8          |         1,130 | 1,034 symbols, 96 emoji                          |
| Misaki Gothic     |           177 | Kana                                             |

The bank has **2,433 canonical cells**: 952 alphabet/number cells, 1,196 symbols, 108 emoji and 177 kana cells. There are **zero project-original preset bitmaps**. Coverage determines the cell count. A separate **48 KiB gzip transfer budget** guards module size; it does not cut a declared repertoire midway to meet a character quota.

## Conversion and cost

Public Pixel is extracted at 8px without antialiasing or scaling. All **1,293 encoded source cells** fit; 15 low-descender cells are translated upward as whole bitmaps, with their code points recorded in `public-pixel-conversion.json`. Misaki's BDF glyph offsets and ascent are restored inside its native 8×8 cell. The kana-only BDF retains the original glyph records; the full Han bank is not bundled. Unscii's row bytes are used directly. These conversions do not scale, blur or crop artwork; conversion records in `data/fonts/*conversion.json` identify the affected cells.

The generated module is **364,150 bytes**, including names and source metadata. Local default gzip produces **35,792 bytes**; transfer compression depends on the host. Bitmap rows occupy **19,464 bytes**. Presets add no bytes to a game's shared source URL.

### Emoji colors

DB8 color numbers 0–7 are `#000000`, `#55415f`, `#646964`, `#d77355`, `#508cd7`, `#64b964`, `#e6c86e` and `#dcf5ff`. Ink and paper are display attributes separate from the source bitmap.

**All 108 default colors are generated from the same fixed [Twemoji reference](https://github.com/jdecked/twemoji/tree/b6b55fef1e8636b540a6d016a4729ca8cdf2e60b/assets/72x72), with no per-character color overrides.** The 72px PNGs provide color statistics only; 8×8 artwork still comes from Unscii/Public Pixel. The 26,853-byte frozen statistics file is a generation input, not a web asset. Original PNG hashes and the extractor hash are retained in `data/fonts/twemoji-colors.json`; the source’s [CC BY 4.0 graphics license](https://github.com/jdecked/twemoji/blob/b6b55fef1e8636b540a6d016a4729ca8cdf2e60b/LICENSE-GRAPHICS) is retained in `data/fonts/twemoji-color-LICENSE.txt`. Color statistics are reduced to one DB8 ink by the following common rules; source graphics and Twemoji code are not bundled.

1. Exclude transparent edge pixels. Detect colored rectangular backplates with a common geometry/color rule, remove their background and connected outer-border remnants, and keep their central symbols. The exact extraction thresholds are in [the importer](../scripts/import-emoji-colors.py). Other objects retain their full color distribution.
2. Collect alpha-weighted RGB statistics in 3-bit buckets. Keep all sampled colors together; separate neutral parts are not pooled into one majority against a coherent colored body.
3. Select the sampled color with the largest area-weighted Gaussian neighborhood in CIEDE2000 space (width 8). Nearby shades reinforce each other; unrelated hues are not averaged together.
4. Match the representative to DB8 with [CIEDE2000](https://hajim.rochester.edu/ece/sites/gsharma/ciede2000/), preserving its chromatic/neutral character. For chromatic colors (CIELAB chroma at least 20), set both CIELAB lightness values to 50 before comparison: a single ink follows hue and chroma rather than source-image shading. Neutral colors retain their original lightness. Choose the closest candidate with at least [3:1 contrast against black](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html). Black and dark purple are therefore excluded from default emoji ink; both remain available in the engine palette and game overrides.
5. For flat neutral artwork (one RGB bucket after extraction) with source contrast below 3:1 against black, use white foreground ink. Colored artwork and shaded neutral objects retain ordinary color matching. This makes dark one-color symbols readable on black without character-specific exceptions.

These fixed extraction/selection parameters are Playload design choices, applied to every emoji. The contrast floor is a readability choice for default black paper, not a claim of WCAG compliance. Generation records each representative and final ink in `docs/glyph-coverage.json`. Games can override colors as usual. The current result is **51 chromatic, 3 gray and 54 white** cells, all on black paper.

| DB8 ink    | Emoji                                                                                                                                                             |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — Purple | —                                                                                                                                                                 |
| 2 — Gray   | 💾 🕴️ 🚍                                                                                                                                                          |
| 3 — Red    | ‼️ ⁉️ ☎️ ♥️ ♦️ ⛔ ❌ ❤️ ⭕ 🍄 🍅 🍎 🐪 🦆 🧲 🪜                                                                                                                   |
| 4 — Blue   | ℹ️ ☂️ ☄️ ⛵ ✈️ 🐙 🐟 👾 💎 💧 📁 🔮 🖨️ 🦋                                                                                                                         |
| 5 — Green  | 🌲 🌳 🍏 🍾 🐍 🔫                                                                                                                                                 |
| 6 — Yellow | ⌛ ☹️ ☺️ ⛽ 🍺 🏎️ 🐈 💰 📜 🔔 🛖 🛸 🪐 🪓 🪙                                                                                                                      |
| 7 — White  | ©️ ®️ ™️ ↔️ ↕️ ↖️ ↗️ ↘️ ↙️ ⌚ ⏏️ ⏩ ⏪ ⏫ ⏬ ⏯️ ⏸️ ⏹️ ⏺️ ▪️ ▫️ ▶️ ◀️ ◻️ ◼️ ◽ ◾ ☁️ ☑️ ☕ ☮️ ☯️ ♀️ ♂️ ♠️ ♣️ ⚪ ⚫ ⛈️ ✴️ 🏐 🏰 🐇 👻 💀 💍 💭 📄 📻 🕷️ 🗑️ 🪦 🪧 🪨 |

The catalog also ships a **6,216-byte WOFF fallback** for 290 supplementary-plane symbols missing from OS fonts. It traces the same CC0 Unscii row bitmaps into rectangles, without changing pixels. It is generated offline with the bank and is used only for catalog labels. Browser tests compare every fallback glyph against its 8×8 source rows.

## Browsing and reproduction

The catalog starts with emoji and offers Emoji, Symbols, Alphabet and Kana categories. It scrolls continuously without search or page controls; keyboard navigation and copied Unicode keys remain available. Worker output and catalog previews use the same bitmaps. Game edits remain isolated.

Tests compare every shipped bitmap with its credited source rows, check every symbol and single-code-point emoji provided by the fixed source fonts, verify the retained punctuation baseline, check the selected repertoire, reconstruct Misaki from original BDF coordinates, and check composed/decomposed output. Browser tests exercise European accents, Hebrew composed/decomposed letters, Coptic, voiced kana, extended symbols and emoji selectors in the real worker. The supplied dungeon is played through collection, victory and reset with the public API.

The generator retains only the **non-letter punctuation and symbol portion** of the earlier [Microsoft WGL4](https://learn.microsoft.com/en-us/typography/develop/wgl4) baseline. The frozen numeric list and source-page hashes are in `data/fonts/wgl4.json`. Alphabet coverage is determined entirely by Public Pixel; the bank does not claim complete coverage of that earlier text baseline and contains no Microsoft font artwork.

```sh
npm run fonts
npm run fonts:check
npm test
PLAYLOAD_BROWSER_CHANNEL=chrome npm run test:browser
```

Ordinary regeneration is offline and uses Node with frozen inputs. To repeat the color import from the pinned official PNGs and regenerate the bank:

```sh
python3 -m venv .venv
. .venv/bin/activate
python3 -m pip install Pillow==12.3.0
npm run fonts:colors
```

The importer caches reference images in the system temporary directory and verifies their hashes against the frozen input. Images are not bundled. Python and Pillow are unnecessary for ordinary regeneration or checks.

`scripts/import-public-pixel.py` also requires Pillow 12.3.0 to repeat the original TTF extraction. `scripts/import-misaki.py` uses Python's standard library with the hash-checked author archive. Unicode character names keep unmodified source lines for all encoded source-font cells and the retained punctuation baseline. The emoji definition retains the complete official file; original hashes and URLs are in `unicode-source.json`. `glyph-coverage.json` records input/output hashes and source/repertoire counts.

The finished `logo.svg` and `favicon.svg` are static brand images, separate from the game bank. Their Press Start 2P source TTF, fixed revision `dbd72d6ef9ebea750d33c02c7189633e972d6a40` and SIL OFL 1.1 notice are retained in `data/fonts/`.

## Requests outside the scope

A missing preset is decided by the declared repertoire and fixed source artwork, not by liking or disliking a character. For example, `🚀`, `🔥`, `🔑` and `💣` have no native glyph in the adopted sources. Game authors can define them through `pcg[chr].pat`. Changes to built-in coverage require an explicit source-version or repertoire change, a documented reason and cost, and the same complete-coverage and artwork tests. Passing these tests establishes coverage of the declared scope; it does not establish that every game genre has all desired artwork.
