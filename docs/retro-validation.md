# Retro validation

These checks compare Playload with fixed independent implementations and exercise browser
playback and exports. They establish agreement under the conditions below, not equivalence
with a particular physical computer or CRT. [Output design](retro-output.md) describes the targets.

## Sound comparison

The bundled, unmodified [emu2149 v1.42](https://github.com/digital-sound-antiques/emu2149/tree/441f3dc295a9b82db16921461f0678b483db8304)
is MIT-licensed. The runner verifies source hashes before compiling it.
[Raw results](retro-validation.json) record the validated sound-source hash;
[reference setup](../tests/reference/README.md) explains reset alignment and filtering.

| Comparison             | Conditions                                                                                     | Result                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Tone transitions       | Three channels; eight periods from 1 to 4095; exact clock-grid sampling                        | All transitions agree after reset-polarity alignment.                                     |
| Envelope transitions   | Eight PLAY shapes × seven periods, including 7, 257 and 65535                                  | All 56 cases agree at every sampled chip tick.                                            |
| Noise sequence         | Complete 131071-bit cycle                                                                      | Exact agreement after seed alignment.                                                     |
| Noise timing           | Periods 1, 3, 7 and 31                                                                         | Exact interval agreement after initial prescaler-phase alignment.                         |
| Period writes          | 1,000-tick changing-period register trace                                                      | Exact agreement, including the elapsed half-cycle counter and output polarity.            |
| Volume curve           | All 16 normalized levels                                                                       | Maximum difference from emu2149: 0.01386 of full-scale amplitude.                         |
| Rendered tone spectrum | Five notes from 32.7 Hz to 6.93 kHz at 44.1/48 kHz; fundamental and odd harmonics below 10 kHz | Maximum amplitude difference: 0.205%, with the same output filter and maximum-level gain. |

Playload retains Westcott's measured volume curve rather than fitting it to emu2149.
Envelope period zero is checked separately against MAME's documented half-period behavior.
The comparisons do not cover every rapid register-write sequence or nonlinear analog mixing.

## CRT comparison

The bundled, unmodified public-domain [CRT-Lottes shader](https://github.com/libretro/glsl-shaders/blob/e808ca09c699db7a843154cf7dc4dfd766d18a8a/crt/shaders/crt-lottes.glsl)
is hash-checked before use. Both renderers run in one Chrome/WebGL session with matched parameters
and presentation additions, independently comparing reconstruction, scanlines, masks and bloom.
See [reference setup](../tests/browser/reference/README.md).

| Pattern             | Mean absolute difference, 8-bit RGB | Maximum difference |
| ------------------- | ----------------------------------: | -----------------: |
| White               |                            0.000348 |                  1 |
| Pixel checkerboard  |                            0.001145 |                  1 |
| Eight palette bands |                            0.001148 |                  1 |
| Text and emoji      |                            0.000604 |                  1 |

These recorded results use CRT source SHA-256
`09f2c0e74e5b495335a0907b0bfc4a8cfe417054ed9c757f5f90235b729eb4d1`.
They cover the central **544×480** region of the **640×576** output. Source-edge sampling differs
intentionally, so the table does not claim whole-frame equivalence.

## Runtime checks

Unit tests cover note timing, filter response, bounded output, block continuity, reproducible
reset and paused synthesis with 4 ms transitions. At 44.1/48 kHz, the FIR sweep samples 129
passband and 513 stopband frequencies: worst passband deviation is **0.00843%**, and worst
stopband gain is **−75.54 dB**. A rendered high-note test requires folded fifth-harmonic energy
below **−60 dB** relative to the fundamental.

Browser tests exercise the real AudioWorklet, black and curved borders, phosphor modulation,
point glow, white level, CPU fallback, PNG export and decoded WebM. A recorded chiptune must
contain audible-level music even while speaker monitoring is muted.

## Reproduction

```sh
npm test
npm run test:reference
PLAYLOAD_BROWSER_CHANNEL=chrome npm run test:browser
```

The sound comparison needs a C99 compiler (`cc`, or `CC`); ordinary Node tests do not.
Reference sources are bundled, so reproduction needs no network downloads beyond development
dependencies and browser installation. [Contributing](../CONTRIBUTING.md#browser-and-reference-checks)
explains setup.

Physical-hardware measurements, specialist listening and physical-phone GPU/audio testing
remain unperformed. Simulated phone layouts and touch tests do not measure device performance.
