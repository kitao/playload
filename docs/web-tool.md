# Tool guide

Start the local server with `npm run dev`. The page opens in **PLAY**; **INFO** contains the
API cheat sheet, ZX 128 PLAY notation, glyph catalogs and example games. Catalogs scroll
continuously. Click a glyph or palette number to copy it; hover a glyph to see its name.
Reading Info temporarily pauses the game and recording, then restores the previous state.

## Edit and play

**CODE** shows the JavaScript editor. It starts on for desktop screens and off for touch-first devices
and screens narrower than 600 pixels, including shared URLs. Toggle it or drag the divider to
resize the editor and game. Compact portrait layouts stack the editor above the game.
Long lines scroll horizontally. Line numbers are not part of copied code.

**Run** starts or restarts exactly the web editor's code and begins a fresh recording.
It never rereads a local file. **Load** selects a JavaScript file and starts it;
**Reload** rereads that file so you can work in your own code editor. Browsers without
file-handle support ask you to select the file again. Load and Reload confirm before
replacing edited code and never write back to the local file.

Click the game screen to play and the editor to write. Run moves focus to the game.
Pause moves focus to the visible editor; resuming returns it to the game, so you can
switch using the keyboard. Directions use arrows or WASD; A uses Z or J, and B uses X or K.
Touch devices have a pad. Letter controls follow the labels on Latin keyboard layouts;
other scripts use the same key positions.
Standard-mapped gamepads use the D-pad or left stick for directions and the bottom/right
face buttons for A/B. Gamepad input is active while the game screen has focus.

On phones and tablets, the game and touch controls fit the screen in portrait or landscape. Tap **Tap to play**
to start the game and sound; the first touch on a game control also starts it. **⋯** opens the
editing and capture controls, temporarily pausing play until you close them. **Pause** stays
beside the game controls. Screens narrower than 1280 pixels also use **⋯** to keep the toolbar
out of the way. Run reveals the game; Pause brings the open editor into view.

Errors stop the game and retain its last completed picture. A translucent black backing
behind the message overlays the screen’s upper left, inset by 12 pixels. The yellow line
number selects the reported source line; the white message wraps within the screen,
with continuation lines aligned to the message. Long messages scroll inside the overlay.
For miniature screens below 240 pixels wide, the overlay uses the surrounding play window
instead. Neither placement resizes the game picture. Editing disables the old line link
and clears the editor’s error highlight; Run clears the message.

## Save and share

The starter keeps a plain URL and the `Playload` title until you edit or load a file.
After that, edits update the address after a brief typing pause without adding browser-history entries, including
undoing back to the starter. Bookmark the URL to save that version, or share it from the
browser's address bar. Opening a shared game restores its source and focuses
the game unless you select another control during loading. Desktop games start immediately;
touch-first devices show the first frame until you tap to play. Narrow desktop screens with the
editor initially hidden show **Click to play**. Opening a URL without a fragment
starts with starter code.

Start the source with `// @title My Game` to name the page and bookmark `My Game — Playload`.
Leading blank lines are allowed; the tag must be on the first nonblank line. Spaces or tabs
separate `@title` from its value. Leading and trailing title whitespace is trimmed.
The title updates as you edit and is restored from shared URLs; omitted or blank titles use `Playload`.

**Payload** shows the compressed source size and the 3 KB ceiling. The source lives in the
URL, so a published game needs no separate download. The limits are **3,072 compressed bytes**
and **4,096 URL characters including the base URL**; base64 expansion and the base URL can
lower the usable byte budget. A message appears if the code cannot be stored in the URL.
The format is UTF-8 → raw DEFLATE → unpadded base64url, prefixed with `#1.` in the fragment.
Source round-trips unchanged.

Games run in a worker, with network requests blocked by the page's content policy.
A nonresponsive game is stopped without losing the editor. Expanded source is limited to 1 MiB.

## Screenshots and video

**Screenshot** includes the current CRT setting. CRT and sound are on by default, including
shared games; their toggles turn them off. CRT uses an adaptation of Timothy Lottes'
CRT-Lottes renderer, with a simpler CPU effect when WebGL cannot be used. Screenshots and
videos use the same rendered canvas. See [retro output design](retro-output.md) for details.

Video retains up to the most recent **10 seconds**, capped at **64 MiB**, since loading a game
or pressing **New clip**. **New clip** starts a fresh recording without restarting the game.
The saved clip starts on a video keyframe, so its duration may be shorter.
**Save video** exports through the instant it is pressed and recording continues;
**Run** restarts the game and begins a fresh recording. Video uses **WebM** and requires a
browser with VP8/VP9 and Opus recording support. Engine audio is included even when listening
is muted. Audio starts after a user interaction, subject to the browser's autoplay policy.

## Keyboard shortcuts

Use **Command** instead of Ctrl and **Option** instead of Alt on macOS.

| Shortcut   | Action                           |
| ---------- | -------------------------------- |
| Ctrl+O     | Load a JavaScript file           |
| Alt+R      | Reload the selected local file   |
| Ctrl+Enter | Run or restart the editor's code |
| Alt+P      | Pause or resume                  |
| Alt+1      | Take a screenshot                |
| Alt+2      | Start a new video clip           |
| Alt+3      | Save the current video           |
| Alt+E      | Select the reported error line   |

Load, Reload, Run and Pause work throughout Play, including in the editor. Other Alt
shortcuts work outside text fields; hidden or disabled actions are not invoked.
