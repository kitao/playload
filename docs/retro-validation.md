# Retro output validation

Initially validated locally on 2026-10-07; sound and CRT reference checks were rerun on 2026-10-09 after repository-wide formatting. These results establish specific agreements with independent software references; they do not certify equivalence to a physical AY board or CRT, or expert listening approval.

## Independent sound reference

The unmodified [emu2149 v1.42 source](https://github.com/digital-sound-antiques/emu2149/tree/441f3dc295a9b82db16921461f0678b483db8304) is included under its MIT license. The runner verifies its SHA-256 hashes before compiling it. [Raw results](retro-validation.json) include the hash of the validated Playload sound source. See [the reference setup](../tests/reference/README.md) for reset alignment and filtering conditions.

| Comparison             | Conditions                                                                                                   | Result                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Tone transitions       | All three channels, eight integer periods from 1 to 4095, exact clock-grid sampling                          | Every compared transition agrees after accounting for reset polarity.                                                           |
| Envelope transitions   | Eight PLAY envelope shapes × seven periods, including 7, 257 and 65535                                       | All 56 cases agree at every sampled chip tick.                                                                                  |
| Noise sequence         | Complete 131071-bit cycle                                                                                    | Exact agreement after seed alignment; the two implementations use different LFSR representations.                               |
| Noise timing           | Periods 1, 3, 7 and 31                                                                                       | Exact interval agreement after accounting for initial prescaler phase.                                                          |
| Volume curve           | All 16 normalized levels                                                                                     | Largest difference from emu2149's empirical curve: 0.01386 of full-scale amplitude. Playload retains Westcott's measured curve. |
| Rendered tone spectrum | Five notes from 32.7 Hz to 6.93 kHz, at 44.1 and 48 kHz; measured fundamental and odd harmonics below 10 kHz | Largest measured amplitude difference: 0.205%. The same output filter and maximum-level gain are applied to both sources.       |

The comparison found delayed transitions at non-power-of-two periods in Playload's fractional phase accumulation. The implementation now counts master clocks, and a normal unit test preserves the period-seven regression case.

Envelope period zero is checked separately against MAME's documented twice-as-fast behavior. An additional 1,000-tick changing-period register trace now agrees exactly with the independent reference. This found and fixed a polarity change during note transitions: the hardware keeps the half-cycle counter and output bit across period writes. The reference comparisons do not cover every possible rapid register-write sequence, nonlinear analog channel mixing or a particular computer's output circuit.

## Independent CRT reference

The unmodified public-domain [CRT-Lottes source](https://github.com/libretro/glsl-shaders/blob/e808ca09c699db7a843154cf7dc4dfd766d18a8a/crt/shaders/crt-lottes.glsl) is included and its SHA-256 is verified before use. Both renderers run in the same Chrome/WebGL session. Parameters and presentation additions are matched; Gaussian reconstruction, scanlines, mask and bloom are computed by the original shader independently. See [the reference setup](../tests/browser/reference/README.md).

Revalidated on 2026-10-09 after adopting the upstream default curvature (`warpX = 0.031`, `warpY = 0.041`) in both WebGL and CPU rendering. Playload's inset, phosphor settings and edge shading remain separate presentation choices.

| Pattern                                       | Mean absolute difference, 8-bit RGB | Maximum difference |
| --------------------------------------------- | ----------------------------------: | -----------------: |
| White                                         |                            0.000348 |                  1 |
| One-source-pixel checkerboard                 |                            0.001145 |                  1 |
| Eight palette bands                           |                            0.001148 |                  1 |
| Text and emoji glyphs (current adopted fonts) |                            0.000580 |                  1 |

These measurements cover the central 544×480 region of the 640×576 output. Source-edge sampling deliberately differs, so this is not a whole-frame equivalence claim. Separate browser checks cover black, curved borders, phosphor modulation, point glow, white level, screenshot output, decoded video and CPU fallback.

The comparison found different horizontal bloom sampling in Playload. The renderer now follows the upstream 3/5-tap scanline reconstruction and 5/7-tap bloom, including the outer bloom rows' narrower horizontal filter.

Validated CRT source SHA-256: `9bff273805ff831aa116ac4ee1a37479b0be1b16f3d5938830505f6d30bf8cb9`.

## Runtime and reproduction

Unit tests check the serialized AudioWorklet for frozen synthesis during pause and 4 ms pause/resume/reset ramps. Browser tests exercise the actual AudioWorklet and decode music from a recorded, muted-monitor chiptune demo. CRT and sound default to on in the developer tool and shared player.

The FIR response is checked at 129 passband and 513 stopband frequencies for each of 44.1 and 48 kHz output. The measured worst passband deviation is 0.00843%; the worst sampled stopband gain is −75.54 dB. A rendered high-note test separately requires folded fifth-harmonic energy below −60 dB relative to the fundamental.

A local desktop timing run measured median/p99 synthesis times of 0.078/0.095 ms per 128-sample block, against a 2.67 ms audio-block budget at 48 kHz. Synchronized WebGL rendering plus canvas copying measured median/p95 times of 4.9/7.1 ms, against a 16.67 ms frame budget. These are observations on this machine, not cross-device guarantees.

An earlier curated-font candidate produced a 13.045-second chiptune export that was independently probed and its audio decoded with FFmpeg: 640×576 VP8 video, Opus at 48 kHz, audio peak −7.7 dBFS and RMS −24.4 dBFS. The file contained audible-level, unclipped audio; this does not evaluate musical taste or perceived hardware fidelity.

```sh
npm test
npm run test:reference
PLAYLOAD_BROWSER_CHANNEL=chrome npm run test:browser
```

The sound reference command needs a C99 compiler (`cc`, or `CC`). The normal Node tests do not need one. All reference source is bundled; reproduction needs no network download beyond the ordinary development dependency/browser setup.

Physical-hardware measurements, independent specialist review, expert listening and physical-phone GPU/audio testing remain unperformed. A simulated phone viewport checks layout and touch handling; it is not a hardware performance measurement.
