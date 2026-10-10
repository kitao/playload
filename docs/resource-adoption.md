# Resource adoption

The versions and linked commits below identify Playload's fixed sources. Original font data,
conversion records and notices are retained in `data/fonts/`; [README](../README.md#license)
lists licenses.

## Fonts

- **[Public Pixel](https://ggbot.itch.io/public-pixel-font) 1.24 — GGBotNet.**
  A single CC0 typeface for 8×8 multilingual text. Supplies its complete letter repertoire,
  printable ASCII, numbers and text punctuation, plus symbols and emoji where Unscii has no glyph.
  The original TTF and distribution-archive hash are retained.
- **[Unscii-8](https://github.com/viznut/unscii/tree/257b4dfeb50651510fe8b9cf4f151a148a4490e4) — Ville-Matias Heikkilä and contributors.**
  Native 8×8 symbols and pictograms based on classic-computer typefaces. Supplies symbols and
  emoji first, using `unscii-8.hex` at the linked commit.
- **[Misaki Gothic](https://littlelimit.net/misaki.htm) 2021-05-05 BDF — Num Kadoma / 門真なむ.**
  An 8×8 typeface for PC-E500 pocket computers, mostly drawn within 7×7 pixels to leave spacing.
  Supplies hiragana and katakana from `misaki_gothic.bdf`.

Every preset uses a complete source-font bitmap. [Font coverage](glyphs.md) defines the repertoire,
source priority, conversions, colors and regeneration; patterns are not scaled, blurred or cropped.

## Color and display

- **[DB8 v1.0](https://pixeljoint.com/forum/forum_posts.asp?TID=26050) — Richard Fhager / DawnBringer, 2017-11-22.**
  Its eight RGB values are used unchanged: black, white, chromatic colors and gray.
- **[Twemoji](https://github.com/jdecked/twemoji/tree/b6b55fef1e8636b540a6d016a4729ca8cdf2e60b/assets/72x72) — Twitter and contributors, community edition.**
  Pinned 72px PNG color statistics guide recognizable emoji colors through
  [one common rule](glyphs.md#emoji-colors). Graphics and Twemoji code are not bundled;
  the 8×8 bitmaps remain Unscii/Public Pixel artwork. The CC BY 4.0 graphics notice is retained.
- **[CRT-Lottes](https://github.com/libretro/glsl-shaders/blob/e808ca09c699db7a843154cf7dc4dfd766d18a8a/crt/shaders/crt-lottes.glsl) — Timothy Lottes.**
  The public-domain shader is adapted to WebGL for reconstruction, scanlines, bloom, phosphor
  masks, curvature and linear-light processing, based on its RGB-input CGA arcade-monitor target.
  [Output design](retro-output.md) records Playload's adjustments and CPU fallback.

## Sound

- **[AY-3-8910 family documentation](https://map.grauw.nl/resources/sound/generalinstrument_ay-3-8910.pdf) — General Instrument.**
  Specifies three voices, integer pitch periods, shared noise and envelopes. Playload implements
  these properties at the ZX Spectrum 128 clock.
- **[ZX Spectrum 128 PLAY manual](https://worldofspectrum.org/ZXSpectrum128Manual/sp128p10.html).**
  Supplies the era's music-string notation for nonblocking, per-channel playback.
  Adopted commands and differences are in the [sound reference](api.md#sound).
- **[AY volume measurements recorded in MAME](https://github.com/mamedev/mame/blob/dd06c01bbbd7d0c1c8aefa477c095861c7f8bf31/src/devices/sound/ay8910.cpp) — Matthew Westcott, December 2001.**
  Sixteen measured values preserve the chip's uneven volume steps. Subtract 1.147 and divide by
  `2.580 − 1.147` to normalize them to 0–1. Values and the source hash are retained in
  `data/ay-volume-source.json`; MAME's synthesis code is not used.

## Brand

[Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P) supplies the logo's letter shapes.
`logo.svg` and `favicon.svg` are static images, separate from the game bank. The TTF,
[fixed revision](../data/fonts/press-start-2p-REVISION) and SIL OFL 1.1 notice are retained.

## Verification

Unicode supplies keys, names and classifications, not artwork. Generation records input/output
hashes and per-glyph sources, and tests compare shipped pixels with their credited fonts.
[Retro validation](retro-validation.md) records comparisons with frozen emu2149 v1.42 and the
original CRT-Lottes shader. Both reference implementations are used only in tests.
