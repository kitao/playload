# Playload

**A tiny game engine that lets you share games as URLs.**

Write one JavaScript file. Draw with Unicode characters. Share the whole game as a URL.

- 160 × 144 pixels, DB8 palette, free pixel coordinates.
- Every 8 × 8 character has two opaque colors.
- Six buttons: U, D, L, R, A, B.
- Three AY-style sound channels with ZX 128 PLAY notation.
- A game is compressed source code, carried in the URL fragment.

## Try it

Requires Node.js 24+. No dependencies or build step.

```sh
npm run dev
```

Open **http://localhost:8000**. Read **Info**, then use **Develop → Run**, or **Load** your own `.js` file. Try [examples/gems.js](examples/gems.js): move, hold A to go faster, press B to move the gem.

**Develop** and **Info** switch the whole workspace. **Info** opens the Unicode catalog with all character categories and the DB8 palette, including RGB values. Click a glyph or color number to copy it; names appear on hover. **API** opens the cheat sheet. Reading Info temporarily pauses the game and recording, then restores the previous play state.

**Develop** starts with equal editor and game panes. Drag their divider to give the game more room, or toggle **Code** to fold the editor away. Folding preserves the code and game, and **Reload** remains available. Below 600 pixels wide, opening Code stacks the editor above the game. Edit and press **Ctrl+Enter** (Command on macOS) to run. Click the game screen to play; click the editor to keep writing. **Pause** stops the game explicitly. **Download** downloads the current editor source.

**Reload** reads the latest saved file and runs it. Live file rereading requires a browser with `showOpenFilePicker`, such as Chrome or Edge. In other browsers, Reload asks you to select the saved file again; **Code** also works without file access. **Reset** reruns the current game without rereading the file or applying editor changes.

**Copy URL** shares the running version. Opening that URL starts the player directly. The player has game controls, display settings and capture, while the developer tool also has files, code and reference views. Touch devices get a virtual pad.

## Make a game

```js
let x = 76

function tick() {
  x += btn(3) - btn(2)
  cls(0)
  put('👾', x, 68)
}
```

`tick()` runs at a target of 60 Hz. JavaScript's standard functions, including `Math`, are available. There are no game constants to memorize.

| API | Meaning |
| --- | --- |
| `cls(c = 0)` | Fill the screen with color `c`. |
| `put(text, x, y)` | Draw characters, advancing 8 pixels each. Newlines return to the original x and advance y by 8. Coordinates are truncated toward zero and clipped at the screen. |
| `col(ink = 7, paper = 0)` | Set the default color pair. |
| `btn(b)` | Is button `b` held? |
| `btnp(b)` | Was button `b` pressed since the preceding tick? |
| `play(ch, score)` | Replace channel 0–2 with a score. Playback continues while the game runs. An empty score stops that channel. |
| `pcg[ch].pat` | Read or change 8 row bytes. Assign eight bytes or a 16-digit hex string. Bit 7 is the leftmost pixel. |
| `pcg[ch].col` | Read or change `[ink, paper]`. Each `null` inherits the current default. Color `0` is opaque black. Assigning `null` restores both defaults. |

Buttons are **0 U · 1 D · 2 L · 3 R · 4 A · 5 B**. On a keyboard, use arrows, Z and X.

```js
pcg['①'].pat = '183c7e1818181800'
pcg['①'].pat[0] = 255
pcg['①'].col = [6, null]
put('①①\n①', 20, 20)
```

Preset patterns live in the engine, so their data costs no payload bytes. **Unicode** shows the actual available presets and copies their Unicode keys. Unknown keys start as blank characters and can be defined through `pcg`. Emoji variation selectors are ignored in lookup; a grapheme, including a ZWJ sequence, takes one character slot.

The initial bank contains basic Latin, hiragana, katakana, symbols and 107 emoji. The final artwork and coverage are still being selected; Kanji are available as custom keys, without built-in patterns.

## Sound

```js
play(0, 'T150O4N3cegb))') // repeating melody
play(1, 'O6N1GC')        // short effect on a separate channel
```

Lowercase `c`–`b` and uppercase `C`–`B` span two octaves; `O5c` is middle C. `#` sharpens, `$` flattens, `&` rests. Length codes 1–9 cover sixteenth notes through whole notes, including dotted notes; 10–12 apply triplets to the next three notes. `N` separates numbers. `_` ties lengths, as in `3_5A`.

`T60`–`T240` sets global tempo on channel 0. `V0`–`V15` sets volume. `U`, `W0`–`W7` and `X0`–`X65535` select the shared hardware envelope; a score containing `V` uses fixed volume. `M1`–`M63` chooses tone bits 1/2/4 and noise bits 8/16/32 for channels 0/1/2. Noise and envelope generators are shared across channels.

Parentheses repeat a phrase twice; unmatched `))` loops from the start. `!comments!` are ignored. `H` stops all channels. Parsed scores are cached. This adapts [ZX 128 PLAY](https://worldofspectrum.org/ZXSpectrum128Manual/sp128p10.html) for nonblocking per-channel playback; MIDI commands are omitted. The digital AY model is an initial implementation, with analog and exact ROM equivalence still unverified.

## Share and capture

Current payload format: UTF-8 → raw DEFLATE → unpadded base64url, prefixed with `#1.`. Source round-trips unchanged. The provisional ceiling is **3,072 compressed bytes** and **4,096 URL characters including the base URL**; base64 expansion and the base URL can lower the usable byte budget. The exact competition rule remains to be finalized.

The source travels in the URL fragment. Games run in a worker, with network requests blocked by the page's content policy. A nonresponsive game is stopped without losing the editor. Expanded source is limited to 1 MiB.

Screenshots include the CRT setting. Video retains up to the most recent **60 seconds**, capped at **64 MiB**, since loading a game or pressing **New clip**. **New clip** starts a new clip without restarting the game. **Save video** exports through the instant it is pressed and recording continues; **Reset** restarts the game within the same clip. Video uses **WebM** and requires a browser with VP8/VP9 and Opus recording support. The engine audio is included even when listening is muted. Audio starts after a user interaction, subject to the browser's autoplay policy.

Shortcuts: **Alt+R** reload, **Alt+P** pause, **Alt+0** reset, **Alt+1** screenshot, **Alt+2** new clip, **Alt+3** save video. Use Option on macOS. In the editor, **Ctrl+Enter** runs; use Command on macOS.

## Inside

```text
index.html          page
src/
  engine.js         pixels, characters, buttons
  sound.js          score parser and AY synthesis
  payload.js        URL encoding and decoding
  runtime.js        game worker and browser audio
  capture.js        image and video export
  video.js          finalized video intervals and timestamps
  glyphs.js         preset data
  app.js            tool and player
  style.css         shared presentation
examples/           single-file games
test/               public-contract tests
dev.js              local static server
```

Run `npm test`. See [THIRD_PARTY.md](THIRD_PARTY.md) for glyph sources and permissions. The server binds to localhost; the page and `src/` can also be served by a static web host.
