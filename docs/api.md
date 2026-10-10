# Game API and sound reference

## Make a game

```js
let x = 76;

function tick() {
  if (btn(2)) {
    x -= 1;
  }
  if (btn(3)) {
    x += 1;
  }

  x = Math.max(0, Math.min(152, x));

  cls(0);
  spr(x, 68, '👾', 6);
}
```

`tick()` runs at a target of 60 Hz. JavaScript's standard functions, including `Math`, are available. There are no game constants to memorize.

Six functions:

| API                              | Meaning                                                                                                                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cls(col = 0)`                   | Fill the screen cells with spaces and a background override of `col`. Affects only the character screen.                                                                             |
| `put(cx, cy, str, col1?, col2?)` | Place text at character coordinates. Newlines return to the original column and advance one row. Omitted or `undefined` colors follow PCG; specified colors override each component. |
| `spr(x, y, chr, col)`            | Draw an 8 × 8 sprite at pixel coordinates for the current tick. All four arguments are required. Zero pattern bits are transparent; color 0 paints black.                            |
| `btn(id)`                        | Is button `id` held?                                                                                                                                                                 |
| `btnp(id)`                       | Was button `id` pressed since the preceding tick?                                                                                                                                    |
| `play(ch, str)`                  | Replace sound channel 0–2 with a ZX 128 PLAY string. Playback continues while the game runs. An empty string stops that channel.                                                     |

Two system variables:

| Data              | Meaning                                                                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pcg[chr].pat`    | Read or change 8 row bytes. Assign eight bytes or a 16-digit hex string. Bit 7 is the leftmost pixel.                                                    |
| `pcg[chr].col`    | Read or change the standard `[col1, col2]` colors, initially `[7, 0]` unless the preset defines different colors. Each component is a color number, 0–7. |
| `scr[cy][cx].chr` | Read or change a screen cell's character. The fixed screen has 18 rows of 20 cells, initially spaces.                                                    |
| `scr[cy][cx].col` | Read or change `[col1, col2]` overrides. Each `null` follows the corresponding standard PCG color.                                                       |

`cx`/`cy` use 8-pixel character units; `x`/`y` use pixels. Coordinates are truncated toward zero. Text and sprites clip at the screen edges without wrapping. Color pairs always use **foreground, background** order. Screen cells retain their character and overrides between ticks. Changing a shared PCG pattern updates every cell and sprite using it; changing its standard colors updates cells that follow those components. Sprite color belongs to the sprite and is independent of PCG colors.

The sprite layer is cleared at the start of each tick. Call `spr` every tick while a sprite should remain visible; omit the call to hide it. Sprites always draw in front of the character screen, and later `spr` calls draw in front of earlier ones.

Buttons are **0 U · 1 D · 2 L · 3 R · 4 A · 5 B**. On a keyboard, use arrows or WASD,
Z or J for A, and X or K for B.

```js
pcg['①'].pat = [0x18, 0x3c, 0x7e, 0x18, 0x18, 0x18, 0x18, 0x00];
pcg['①'].pat = '183c7e1818181800'; // shorthand for the same eight bytes
pcg['①'].col = [6, 0];
put(2, 2, '①①\n①');
scr[2][2].col = [null, 1];
put(4, 2, '①', undefined, 3); // override only the background
```

The fixed screen arrays retain their shape; edit `.chr` and `.col` instead of replacing cells. PCG entries are created lazily; edit `.pat` and `.col` instead of replacing entries. Unknown characters have a blank pattern and `[7, 0]` colors. A character identifier is one Unicode grapheme. Writing a space erases a cell according to that space's pattern and colors; `cls` uses the same shared space pattern.

One callback, `function tick()`, updates the game at a target of 60 Hz. There are no public constructors or extra drawing-state commands.

Preset patterns live in the engine, so their data costs no payload bytes. **Info** shows the actual available presets and copies their Unicode keys. Unknown keys can be defined through `pcg`. Emoji variation selectors are ignored in lookup; a grapheme, including a ZWJ sequence, takes one character slot.

**Public Pixel** is the sole text typeface: its complete letter repertoire is included, and printable ASCII, numbers and text punctuation use its authored pixels. **Unscii-8** supplies classic-computer symbols and pictograms; **Misaki Gothic** supplies kana. Symbols and single-code-point emoji cover the artwork available in the fixed source fonts. See [font coverage](glyphs.md) for the exact repertoire, selection rules and reproduction, and [resource adoption](resource-adoption.md) for sources and reasons.

Try [examples/glyph-quest.js](../examples/glyph-quest.js): collect six gems and a ring, then reach the castle. Walls, hero, items and scenery use the small built-in bank; collection and victory sounds use the same public API. [examples/shooter.js](../examples/shooter.js) demonstrates smooth sprite movement, shooting, hits and reset over a retained character background.

[examples/lights-out.js](../examples/lights-out.js) defines two PCG patterns and uses the persistent screen cells as its puzzle board: reading and writing `scr` changes both the game state and the picture.

## Sound

```js
play(0, 'T150O4N3cegb))'); // repeating melody
play(1, 'O6N1GC'); // short effect on a separate channel
```

Lowercase `cdefgab` and uppercase `CDEFGAB` span two octaves; `O5c` is middle C. `#` sharpens, `$` flattens, `&` rests. Length codes 1–9 cover sixteenth notes through whole notes, including dotted notes; 10–12 apply triplets to the next three notes. `N` separates numbers. `_` ties lengths, as in `3_5A`.

`T60`–`T240` sets global tempo on channel 0. `V0`–`V15` sets volume. `U`, `W0`–`W7` and `X0`–`X65535` select the shared hardware envelope; a score containing `V` uses fixed volume. `M1`–`M63` chooses tone bits 1/2/4 and noise bits 8/16/32 for channels 0/1/2. Noise and envelope generators are shared across channels.

Parentheses repeat a phrase twice; unmatched `))` loops from the start. `!comments!` are ignored. `H` stops all channels. Parsed scores are cached. This adapts [ZX 128 PLAY](https://worldofspectrum.org/ZXSpectrum128Manual/sp128p10.html) for nonblocking per-channel playback; MIDI commands are omitted. The AY-style output uses measured volume levels and filters the complete tone/noise/envelope mix before playback. Exact analog-board and ROM equivalence remain unverified. See [the retro output design](retro-output.md) for the reference targets.

Try [examples/chiptune.js](../examples/chiptune.js) for a three-voice melody, bass and noise-drum demo. Press Z to stop/play and X to restart.

[examples/sound-fx.js](../examples/sound-fx.js) provides short, editable effects using notes, noise and the shared envelope. Select with up/down, play with Z, and stop with X.

For editing, title comments, shared URLs, payload limits, shortcuts and recording, see the [tool guide](web-tool.md).
