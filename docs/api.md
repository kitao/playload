# Game API

Six functions, two system variables and one callback. Standard JavaScript, including `Math`, is available.

The screen is **160 × 144 pixels**, or **20 × 18 character cells**. `cx`/`cy` use 8-pixel cells;
`x`/`y` use pixels. Coordinates are truncated toward zero, and drawing clips at the edges without wrapping.
Colors are palette numbers **0–7**; color pairs use **foreground, background** order.

## Functions

| API                              | Meaning                                                                                                                                         |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `cls(col)`                       | Fill the character screen with spaces and background color `col`. Sprites are unaffected.                                                       |
| `put(cx, cy, str, col1?, col2?)` | Write text with per-cell color overrides. Newlines return to the starting column and advance one row. Omitted or `undefined` colors follow PCG. |
| `spr(x, y, chr, col)`            | Draw an 8 × 8 sprite for this tick. All arguments are required. Zero pattern bits are transparent; color 0 paints black.                        |
| `btn(id)`                        | Return `true` while button `id` is held.                                                                                                        |
| `btnp(id)`                       | Return `true` if button `id` was pressed since the preceding tick.                                                                              |
| `play(ch, str)`                  | Play a ZX 128 PLAY string on channel 0–2, replacing its previous sound. Playback continues between ticks; `''` stops the channel.               |

Button IDs are **0 ↑ · 1 ↓ · 2 ← · 3 → · 4 A · 5 B**. Keyboard, touch and gamepad mappings
are in the [tool guide](web-tool.md#controls).

## Variables

| Variable      | Properties                                                                                                                                                                               |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pcg[chr]`    | `.pat`: eight row bytes, with bit 7 at the left. Assign eight bytes or a 16-digit hex string. `.col`: the character's `[col1, col2]` colors, initially `[7, 0]` unless a preset differs. |
| `scr[cy][cx]` | `.chr`: the cell's character, initially a space. `.col`: `[col1, col2]` overrides, initially `[null, null]`; each `null` follows the corresponding PCG color.                            |

```js
pcg['①'].pat = [0x18, 0x3c, 0x7e, 0x18, 0x18, 0x18, 0x18, 0x00];
pcg['①'].pat = '183c7e1818181800'; // the same eight bytes
pcg['①'].col = [6, 0];

put(2, 2, '①①\n①');
scr[2][2].col = [null, 1];
put(4, 2, '①', undefined, 3); // override only the background
```

Screen cells persist between ticks: update text when it changes, and call `spr` every tick a sprite
should remain visible. Sprites draw above the character screen; later calls draw above earlier ones.
Changing a PCG pattern updates every cell and sprite using it. Changing PCG colors updates cells
that follow them; sprite colors are independent.

Edit properties rather than replacing PCG entries or screen cells. A character key is one Unicode
grapheme, normalized to NFC with emoji variation selectors ignored. Unknown keys start with a blank
pattern and `[7, 0]` colors. Writing a space erases a cell using that space's pattern and colors;
`cls` uses the same space pattern and overrides its background.

Built-in patterns cost no bytes in a game's shared URL. **INFO** shows and copies the available keys;
define other artwork through `pcg`. See [font coverage](glyphs.md) for the repertoire and sources.

## Callback

`tick()` updates the game at a target of **60 Hz**:

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

  spr(x, 68, '👾', 6);
}
```

[Shooter](../examples/shooter.js) combines moving sprites with a retained character background.
[Lights Out](../examples/lights-out.js) uses `pcg` for artwork and `scr` as its puzzle board.

## Sound

```js
play(0, 'T150O4N3cegb))'); // repeating melody
play(1, 'O6N1GC'); // short effect on another channel
```

Lowercase `cdefgab` uses the current octave; uppercase `CDEFGAB` uses the next. `O0`–`O8` sets the
octave (default 5); `O5c` is middle C. `#` sharpens, `$` flattens, and `&` rests.

Write a length before the notes: codes 1–9 cover sixteenth notes through whole notes, including
dotted notes; the default, 5, is a quarter note. Codes 10–12 apply triplets to the next three notes.
`N` separates adjacent numbers, as in `O5N3c`. `_` ties lengths, as in `3_5A`.

`T60`–`T240` sets global tempo on channel 0. `V0`–`V15` sets fixed volume. `U` enables the shared
envelope, `W0`–`W7` selects its shape, and `X0`–`X65535` sets its period; a string containing `V`
uses fixed volume instead. `M1`–`M63` selects tone bits 1/2/4 and noise bits 8/16/32 for channels
0/1/2. Noise and envelope generators are shared across channels.

Parentheses repeat a phrase twice; unmatched `))` loops from the start. `!comments!` are ignored.
`H` stops all channels. This adapts [ZX Spectrum 128 PLAY](https://worldofspectrum.org/ZXSpectrum128Manual/sp128p10.html)
for nonblocking, per-channel playback; MIDI commands are omitted. The tool's **ZX 128 PLAY** sheet
lists each command and length; [retro output design](retro-output.md) explains the synthesis.

[Chiptune](../examples/chiptune.js) demonstrates melody, bass and noise drums.
[Sound FX](../examples/sound-fx.js) provides editable effects using notes, noise and envelopes.
