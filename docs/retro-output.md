# Retro output design

## Reference targets

The sound target is the three-channel AY-3-8910 family at the ZX Spectrum 128's 1.7734 MHz clock. The visual target is a good RGB CRT monitor: readable low-resolution graphics, scanline beams, phosphor structure, glow and curved glass. These are separate references; Playload is not an emulator of one complete historical computer.

## Audio

- The tone periods remain 12-bit integers; volume has 16 measured levels. This preserves the characteristic pitch quantization and uneven amplitude steps.
- The noise source is a shared, maximal-period 17-bit shift register. The 16-step envelope is also shared. Changing either affects every channel that uses it.
- The amplitude curve comes from Matthew Westcott's public-domain AY measurements of December 2001, documented in [MAME's AY source](https://github.com/mamedev/mame/blob/dd06c01bbbd7d0c1c8aefa477c095861c7f8bf31/src/devices/sound/ay8910.cpp). The measured DC baseline is subtracted and the resulting amplitudes are normalized.
- Envelope period zero is half of period one, as documented by the MAME maintainers. `W0`–`W7` follow the [ZX Spectrum 128 PLAY manual](https://worldofspectrum.org/ZXSpectrum128Manual/sp128p13.html).
- Synthesis runs at eight times the output sample rate. A 257-tap Blackman-windowed sinc filter covers the complete mix before downsampling, including noise and envelope changes. PolyBLEP corrects tone edges before that filter.
- Oscillator, noise and envelope time is accumulated in master-clock units. This avoids rounding a fraction of each period and preserves the half-cycle counter and output polarity across note changes.
- The output filter passes 100 Hz–10 kHz within 0.1% of unity and rejects sampled frequencies at or above output Nyquist by at least 60 dB in the tested sweep. Its group delay is below 0.4 ms at 44.1/48 kHz. A 20 Hz DC blocker retains bass while removing DC.
- The browser fades mute, pause and reset transitions over 4 ms. Muting the speakers preserves the recording feed; pausing freezes synthesis time.

This is an original implementation of those documented properties. It does not copy MAME's emulator code or reproduce a particular analog board, amplifier or speaker. ROM parsing details and rapid register-level tricks remain outside the current API.

## Display

The WebGL renderer adapts Timothy Lottes' public-domain [CRT-Lottes shader](https://github.com/libretro/glsl-shaders/blob/e808ca09c699db7a843154cf7dc4dfd766d18a8a/crt/shaders/crt-lottes.glsl), whose stated reference is a good CGA arcade monitor with RGB input. It retains Gaussian reconstruction, scanline beam weighting, bloom, an RGB phosphor mask, curvature and conversion between sRGB and linear light. Both WebGL and CPU rendering use the upstream default curvature coefficients: `warpX = 0.031`, `warpY = 0.041`. Playload uses a gentle aperture grille, a small inset to retain edge content, rounded glass and modest edge shading.

The CRT image is copied into the same 640×576 canvas used for display, PNG export and WebM capture. Flat mode preserves exact palette colors in the captured canvas and uses nearest-neighbor screen scaling. CRT mode lets the browser interpolate reconstructed phosphors at fractional screen sizes. If WebGL is unavailable or its context is lost, the CPU renderer supplies simpler curvature, scanlines and shading.

The [Libretro CRT documentation](https://docs.libretro.com/shader/crt/) provides context for those reconstruction techniques. At small display sizes, phosphor masks and scanlines are necessarily approximations; a modern LCD cannot reproduce the full optics or timing of a physical tube.

## Acceptance

Automated checks cover pitch, note timing, envelope shapes, noise period, filter response, bounded output, block continuity and reset reproducibility. Browser checks cover the actual AudioWorklet, CRT shader compilation, a readable white level, glow around a bright point, phosphor modulation, preserved black, fallback rendering, touch input and decoded PNG/WebM output. The shared chiptune example is also recorded while speaker monitoring is muted; decoding the export must recover audible music.

`examples/glyph-quest.js` exercises the curated pictograms and game tiles in a playable dungeon with collection and victory sounds. `examples/chiptune.js` provides a repeatable melody, bass and noise-drum demonstration using the public API. Listen and inspect at native playback levels and at desktop/phone sizes. Automated success does not certify a listener's nostalgia or exact physical-hardware fidelity; those require human acceptance and reference recordings/screens.

Independent comparisons with frozen emu2149 and CRT-Lottes sources, their measured differences and reproduction commands are recorded in [retro validation](retro-validation.md).
