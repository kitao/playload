# Retro output design

Sound models the three-channel AY-3-8910 family at the ZX Spectrum 128's **1.7734 MHz** clock.
Display targets an RGB CRT monitor with readable low-resolution graphics, scanlines, phosphor
structure, glow and curved glass. These are separate references, not one complete computer emulation.

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

[Resource adoption](resource-adoption.md#sound) identifies the specifications and measurements.
This implementation does not copy MAME's synthesis code or model a particular analog board,
amplifier or speaker. Register-level programming and complete ROM behavior are outside the API.

## Display

The WebGL renderer adapts Timothy Lottes' public-domain
[CRT-Lottes shader](https://github.com/libretro/glsl-shaders/blob/e808ca09c699db7a843154cf7dc4dfd766d18a8a/crt/shaders/crt-lottes.glsl),
whose reference is an RGB-input CGA arcade monitor. It retains Gaussian reconstruction,
scanline beam weighting, bloom, an RGB phosphor mask, curvature and sRGB/linear-light conversion.
WebGL and CPU rendering use the upstream curvature coefficients, **warpX = 0.031** and
**warpY = 0.041**. Playload adds an aperture-grille mask, an inset to retain edge content,
rounded glass and edge shading.

Display, PNG export and WebM capture use the same **640×576 canvas**. The area outside the
curved glass takes the play window's background color, so exports retain its contour.
Flat mode preserves palette colors and uses nearest-neighbor screen scaling. CRT mode allows
interpolation of reconstructed phosphors at fractional sizes. If WebGL is unavailable or its
context is lost, the CPU renderer supplies simpler curvature, scanlines and shading.

The [Libretro CRT guide](https://docs.libretro.com/shader/crt/) explains the reconstruction
techniques. At small sizes, masks and scanlines are approximations of physical tube optics.

## Inspection

[Glyph Quest](../examples/glyph-quest.js) provides text, tiles, pictograms and collection sounds.
[Chiptune](../examples/chiptune.js) provides melody, bass and noise drums. Inspect at desktop
and phone sizes, and listen at normal playback levels.

[Retro validation](retro-validation.md) records independent comparisons, automated checks,
measured differences and reproduction commands. It separates renderer/synthesis agreement
from physical-hardware fidelity and listening acceptance.
