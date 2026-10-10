# Tool guide

[Open Playload](https://kitao.github.io/playload/), or run locally with `npm run dev`.
The page opens in **PLAY**. **INFO** contains the API cheat sheet, ZX 128 PLAY notation,
glyph catalogs and examples. Click a glyph or palette number to copy it; hover a glyph for its name.
Catalogs scroll continuously without search or page controls.

## Edit and play

**CODE** shows the JavaScript editor. It starts on for desktop screens and off for touch-first
devices and screens narrower than 600 pixels, including shared games. Toggle it or drag the
divider to resize the editor and game. The divider starts centered on each page load;
compact portrait layouts stack the editor above the game. Long lines scroll horizontally.
Line numbers are not part of copied code.

**Run** starts or restarts the editor's code, focuses the game and begins a fresh recording.
It never rereads a local file. **Load** selects and starts a JavaScript file, confirming before
replacing edited code. The tool never writes back to the file.

Browsers with `showOpenFilePicker`, such as desktop Chrome and Edge, check the loaded file
every second while the page is visible and when you return. External changes update the editor,
URL and title; Run applies them to the game. Updates wait while the web editor has changes.
Other browsers require selecting the file again with Load.

Errors stop the game and preserve its last completed picture. The message appears at the top left
of the player; select its line number to jump to the source. Long messages scroll inside the overlay.
Editing clears the source highlight and disables the old line link; Run clears the message.

## Controls

New pages focus the visible editor, or the game when CODE is off. Shared games focus the game
unless you select another control during loading. Click anywhere inside the play window to
focus the game, or the editor to write. **Esc** pauses and moves focus to the visible editor;
press it again to resume and return focus to the game. Resume continues the existing game;
use Run to apply code changes.

Directions use **arrows or WASD**; **A** uses **Z or J**, and **B** uses **X or K**.
Letter keys follow Latin keyboard labels; other layouts use the same key positions.
Standard-mapped gamepads use the D-pad or left stick and the bottom/right face buttons for A/B.
Gamepad input is active while the game has focus.

On phones and tablets, tap **Tap to play** or a game control to start the game and sound.
The directional pad and A/B buttons fit portrait and landscape layouts. **⋯** opens editing
and capture controls, temporarily pausing play until you close them. **Pause** stays beside
the game controls. On PCs, the toolbar stays visible and wraps when the window narrows.
Run reveals the game; Pause brings the open editor into view.

Reading INFO or switching browser tabs pauses the game, sound and recording, then restores
the previous state when you return.

## Save and share

The untouched starter keeps a plain URL and the `Playload` title. Editing or loading a file
starts URL updates after a brief typing pause, without adding browser-history entries;
updates continue even if you undo back to the starter. Bookmark the URL to save that version,
or share it from the browser's address bar. Shared URLs restore the source. Desktop games
start immediately; touch-first devices wait for a tap, and narrow desktop screens with CODE
initially off show **Click to play**.

A URL without a fragment opens the starter. **Starter** in Examples opens it in a new tab;
the logo opens the GitHub repository in a new tab. Both preserve your current code.

Name the game with a title tag on its own line in the opening comments:

```js
// @title My Game
```

The bookmark title becomes `My Game — Playload`. Line and block comments are supported;
blank lines and other comments may precede the tag. The first tag is used. Spaces or tabs
separate `@title` from its value; surrounding title whitespace is trimmed. Titles update as
you edit and are restored from shared URLs. Missing or blank titles use `Playload`.

**Payload** shows compressed source size against the **3 KB** ceiling. Shared source is limited
to **1 MiB before compression**, **3,072 compressed bytes** and **4,096 URL characters including
the base URL**. Base64 expansion and the base URL can lower the usable byte budget.
An error appears at the top left of the player if the code cannot fit. The fragment stores
unchanged UTF-8 source as raw DEFLATE and unpadded base64url, prefixed with `#1.`; games need no
separate source download.

Games run in a worker, with network requests blocked by the page's content policy.
A nonresponsive game is stopped without losing the editor.

## Screenshots and video

**Screenshot** saves the current picture. CRT and sound are on by default; screenshots and
videos share the displayed canvas and CRT setting. See [retro output design](retro-output.md).

Video retains the most recent **10 seconds**, capped at **64 MiB**. **New clip** clears the
recording without restarting the game. **Save video** exports through the instant it is pressed,
and recording continues. The clip starts on a keyframe, so it may be shorter than 10 seconds.

Pause records a still picture with silent audio. INFO, open touch tools and hidden browser tabs
suspend recording without clearing its buffer; that time is excluded. Run or loading a game
starts a fresh recording.

Video uses **WebM**, requiring VP8/VP9 and Opus recording support. Engine audio is included
even when speaker listening is muted. Audio needs a user interaction to start, subject to the
browser's autoplay policy.

## Keyboard shortcuts

Use **Command** instead of Ctrl and **Option** instead of Alt on macOS.

| Shortcut   | Action                           |
| ---------- | -------------------------------- |
| Ctrl+O     | Load a JavaScript file           |
| Ctrl+Enter | Run or restart the editor's code |
| Esc        | Pause or resume                  |
| Alt+1      | Take a screenshot                |
| Alt+2      | Start a new video clip           |
| Alt+3      | Save the current video           |
| Alt+E      | Select the reported error line   |

Load, Run and Pause work throughout PLAY, including in the editor. Alt shortcuts work
outside text fields only when their action is visible and enabled.
