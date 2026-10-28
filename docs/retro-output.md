# Retro output design

Sound models the three-channel AY-3-8910 family at the ZX Spectrum 128's **1.7734 MHz** clock.
Display evokes a television-rate 1980s RGB CRT with low-resolution graphics,
scanlines, phosphor structure, glow and curved glass. These are separate references, not one
complete computer or television emulation.

## Sound

- Tone periods are 12-bit integers, preserving pitch quantization. Volume uses 16 levels from
  Matthew Westcott's measured AY curve, normalized after removing its DC baseline.
- Noise uses a shared maximal-period 17-bit shift register; the 16-step envelope is also shared.
  Changing either affects every channel using it. Envelope period zero is half of period one;
  `W0`–`W7` use the ZX Spectrum 128 PLAY shapes.
- Master-clock counters preserve timing and oscillator polarity across period changes.
- Synthesis runs at eight times the output sample rate. PolyBLEP corrects tone edges, then a
  257-tap Blackman-windowed sinc filter processes the complete tone/noise/envelope mix before
  downsampling. At 44.1/48 kHz output, its group delay is below 0.4 ms; a 20 Hz DC blocker
  removes DC while retaining bass.
- The browser fades mute, pause and reset transitions over 4 ms. Speaker mute preserves the
  recording feed; pause freezes synthesis time.

[AY volume source](../data/ay-volume-source.json) records the fixed measurements and normalization.
This implementation does not copy MAME's synthesis code or model a particular analog board,
amplifier or speaker. Register-level programming and complete ROM behavior are outside the API.

## Display

### Overflow feedback

The first 128 sprite characters and 256 PCG bytes written per frame are accepted.
Each excess sprite character adds an 8×8 noise rectangle offset from its intended draw position
by a random integer from −16 to +16 pixels on each axis. Pixels outside the screen are clipped.
Each excess PCG byte adds one full-width, one-pixel-high noise line
at a random row. Pattern bytes and both color bytes share the PCG budget; partial writes
produce feedback only for the rejected bytes. Initialization shares the first frame's budget.

Each rectangle or line chooses one XOR value from **3, 4, 6, 7** and applies it independently
to each pixel with **75% probability**, using the existing eight-color palette. Feedback uses
`Math.random()`, captured before game code runs so replacing it cannot control the noise.
Masks accumulate in a fixed screen-sized buffer and are applied after all screen and sprite
drawing. Overlaps can cancel; there is no cap on the number of shapes and no persistence into
a frame without overflow.
Rendering the same frame again does not change its feedback. Screen and PCG data stay intact.
Each tick waits **one frame (1/60 second) for sprite overflow** and **one frame for PCG overflow**,
regardless of the excess amount. A tick with both waits two frames. This includes initialization and
intermediate ticks in a catch-up batch. The player keeps its usual schedule and catches up
by skipping intermediate drawings; running sound continues during the wait.

### CRT rendering

The WebGL renderer adapts Timothy Lottes' public-domain
[CRT-Lottes shader](https://github.com/libretro/glsl-shaders/blob/e808ca09c699db7a843154cf7dc4dfd766d18a8a/crt/shaders/crt-lottes.glsl),
whose reference is an RGB-input CGA arcade monitor. It retains Gaussian reconstruction,
scanline beam weighting, bloom, an RGB phosphor mask and sRGB/linear-light conversion.

The renderer retains the upstream curvature coefficients, **warpX = 0.031** and
**warpY = 0.041**. They belong to Lottes' deliberately CRT-styled pixel-art display option;
they are not measurements of a particular historical tube. The visible curve is a presentation
choice consistent with that reference.

Period service limits do not calibrate this effect. For example, the
[Atari SC1224 CA-3 service manual, Side PCC adjustment, page 6](https://www.manualslib.com/manual/4175650/Atari-Sc1224.html?page=6)
specifies pincushion or barrel distortion within 1.5% after adjustment. That electrical raster
adjustment limit does not define the optical projection or coefficients of this shader, so it
is not used to claim that a weaker curve is a more faithful CRT reproduction.

Picture size and curvature are controlled separately. For normalized display position
`p`, the source sampling position is
`q = p × (1 + vec2(warpX, warpY) × p_other²)`. There is no overall image inset:
at the horizontal middle, `q.x = p.x`, and at the vertical middle, `q.y = p.y`.
The widest and tallest sections therefore fill the same **640×576** frame as flat mode,
while the corners bend inward. No game-author margins are required in the **160×144** image.
A white-field test measures both center sections at half their peak brightness and requires
exact agreement with flat mode; the faint halo is excluded from this size measurement.

The rounded glass mask uses its own `0.98` framing factor. This affects opacity outside
the curved picture, not its sampling scale. Tests compare corner and edge-center pixels with
an unmasked renderer to retain their peak brightness and at least 99% of their in-frame glow.
Glow beyond the canvas boundary is clipped by that boundary. Glass shading, phosphor structure,
scanlines and bloom remain intact. No measured tube radius, viewing distance, specific
household-TV model, RF/composite decoder or phosphor persistence is claimed by this model.

Display, PNG export and WebM capture use the same **640×576 canvas**. The area outside the
curved glass takes the play window's background color, so exports retain its contour.
Flat mode preserves palette colors and uses nearest-neighbor screen scaling. CRT mode allows
interpolation of reconstructed phosphors at fractional sizes. If WebGL is unavailable or its
context is lost, CRT is disabled and the CPU renderer supplies the flat picture.
The canvas dimensions, player layout and recording path do not change when toggling CRT;
both modes fill the same maximum picture width and height.

The [Libretro CRT guide](https://docs.libretro.com/shader/crt/) explains the reconstruction
techniques. At small sizes, masks and scanlines are approximations of physical tube optics.

## Inspection

[Glyph Quest](../examples/glyph-quest.js) provides text, tiles, pictograms and collection sounds.
[Chiptune](../examples/chiptune.js) provides melody, bass and noise drums. Inspect at desktop
and phone sizes, and listen at normal playback levels.

Run `npm run check` for local verification: formatting, generated assets, Node tests, the
independent sound comparison and browser integration. Node tests cover engine behavior, sample
frames, scheduling and recording data; browser tests cover the built app's controls, file
updates, downloads, font rendering and CRT output. The [sound reference](../tests/reference/README.md)
and [CRT reference](../tests/browser/reference/README.md) describe their comparison conditions.
Ordinary pushes do not run a separate CI suite.

Use `npm run dev` to play the samples and inspect appearance, sound and interaction at desktop,
phone and tablet sizes. Check longer recordings and their playback here rather than waiting
through real-time recording scenarios in every automated run.
`PLAYLOAD_BROWSER=webkit npm run test:browser` selects WebKit after installing it with
`npx playwright install webkit`; Chromium is the default.
Automated comparisons do not establish physical-device behavior or listening acceptance.
