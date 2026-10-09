# Independent sound reference

`emu2149/` contains the unmodified emu2149 v1.42 C source and MIT license by Mitsutaka Okazaki, pinned to [441f3dc295a9b82db16921461f0678b483db8304](https://github.com/digital-sound-antiques/emu2149/tree/441f3dc295a9b82db16921461f0678b483db8304).

`psg-trace.c` is Playload's test driver. `scripts/check-sound-reference.js` checks the source hashes, compiles it into a temporary directory, compares independently generated chip states and rendered tone spectra, then removes the executable. The reference implementation is never imported by the game runtime.

Run `npm run test:reference` with a C99 compiler (`cc`, or the `CC` environment variable). No network access is needed. State comparisons use a 2.2 MHz clock and a sample rate of clock/8 so every sample is exactly one chip tick. Rendered comparisons use Playload's 1.7734 MHz clock and both 44.1 and 48 kHz output rates.

The AY volume mode is selected explicitly. emu2149's reset tone polarity is inverted relative to Playload; its Galois noise generator is aligned to Playload's Fibonacci generator before comparing the complete 131071-bit cycle. Their noise prescalers begin half a noise period apart. These reset differences are recorded, not treated as waveform errors.

The independent tone output receives the same FIR filter, DC blocker and maximum-level gain as Playload to isolate synthesis differences. The volume tables are compared separately, without fitting away their differences. This does not establish analog-board equivalence, equivalence of every possible register-write sequence, or expert listening approval. Envelope period zero is checked against MAME's documented half-period behavior by the normal unit tests, separately from this reference.
