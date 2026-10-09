// Independent chip-state comparisons; never shipped in the game runtime.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AY, compileScore } from '../src/sound.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), 'playload-psg-'));
const executable = join(temporary, 'trace');
const revision = readFileSync(join(root, 'tests/reference/emu2149/REVISION'), 'utf8').trim();
assert.equal(revision, '441f3dc295a9b82db16921461f0678b483db8304');
for (const [name, expected] of Object.entries({
  'emu2149.c': '07fc71c1c43d37f36bc24e0ecddd3db3e2d25c89b8383360fcffaa12b4e82a79',
  'emu2149.h': '58acf90feeb2ee07cb85af2b2df9e034cb45a385fffcd826410dd06577127044',
  LICENSE: 'e0db14654c1f977ec384c3fad3baf6e1f4d21c8369946823bbb6d4e06ebc372b',
})) {
  assert.equal(
    createHash('sha256')
      .update(readFileSync(join(root, 'tests/reference/emu2149', name)))
      .digest('hex'),
    expected,
    name,
  );
}
const clock = 2200000;
const create = () => {
  const ay = new AY(clock / 64);
  ay.clock = clock;
  return ay;
};
const report = {
  reference: 'emu2149',
  revision,
  soundSourceSHA256: createHash('sha256')
    .update(readFileSync(join(root, 'src/sound.js')))
    .digest('hex'),
  clock,
  toneCases: 0,
  envelopeCases: 0,
  noisePeriodCases: 0,
};
try {
  execFileSync(
    process.env.CC || 'cc',
    [
      '-std=c99',
      '-O2',
      'tests/reference/psg-trace.c',
      'tests/reference/emu2149/emu2149.c',
      '-o',
      executable,
    ],
    { cwd: root },
  );
  const trace = (count, tone, noise, envelope, shape) => {
    const bytes = execFileSync(executable, [count, tone, noise, envelope, shape].map(String), {
      maxBuffer: count * 9 + 1024,
    });
    assert.equal(bytes.length, count * 9);
    return bytes;
  };
  // Exercise period writes during both output polarities, rather than only
  // static oscillators. Independent register counters preserve their bit.
  {
    const count = 1000;
    const reference = execFileSync(
      executable,
      [count, 7, 1, 1, 8, 275000, clock, 'writes'].map(String),
    );
    const ay = create();
    ay.period.fill(7);
    for (let i = 0; i < count; i++) {
      if (i > 0 && i % 31 === 0)
        for (let ch = 0; ch < 3; ch++) ay.setPeriod(ch, Math.floor(i / 31) % 2 ? 31 : 7);
      ay.synth();
      for (let ch = 0; ch < 3; ch++)
        assert.equal(
          Number(ay.phase[ch] < 8 * ay.period[ch]),
          reference[i * 9 + ch] ^ 1,
          `period write tick ${i}`,
        );
    }
    report.periodWriteTicks = count;
  }
  for (const period of [1, 2, 7, 31, 101, 251, 1000, 4095]) {
    const count = period * 8,
      reference = trace(count, period, 1, 1, 8),
      ay = create();
    ay.period.fill(period);
    for (let i = 0; i < count; i++) {
      ay.synth();
      for (let ch = 0; ch < 3; ch++) {
        // Reset polarity is arbitrary. Compare after that one polarity inversion.
        assert.equal(
          Number(ay.phase[ch] < period * 8),
          reference[i * 9 + ch] ^ 1,
          `tone ${period}, tick ${i}, channel ${ch}`,
        );
      }
    }
    report.toneCases++;
  }
  for (const shape of [0, 4, 9, 13, 8, 12, 14, 10]) {
    for (const period of [1, 2, 7, 31, 257, 1000, 65535]) {
      const count = Math.min(1000000, period * 128),
        reference = trace(count, 101, 3, period, shape),
        ay = create();
      ay.shape = shape;
      ay.envelopePeriod = period;
      ay.trigger();
      for (let i = 0; i < count; i++) {
        ay.synth();
        assert.equal(
          ay.envelopeLevel,
          reference[i * 9 + 4],
          `envelope ${shape}, period ${period}, tick ${i}`,
        );
      }
      report.envelopeCases++;
    }
  }
  // emu2149 uses a Galois LFSR and Playload a Fibonacci LFSR. Their reset
  // states differ. Compare the complete cyclic output after aligning its seed.
  const cycle = 131071,
    reference = trace(cycle * 2, 1, 1, 1, 8),
    ay = create();
  let theirs = '',
    ours = '';
  for (let i = 0; i < cycle * 2; i++) {
    ay.synth();
    if (i % 2 === 0) theirs += reference[i * 9 + 3];
    else ours += ay.noise & 1;
  }
  const aligned = (theirs + theirs).indexOf(ours.slice(0, 64));
  assert(aligned >= 0);
  assert.equal((theirs + theirs).slice(aligned, aligned + cycle), ours);
  report.noiseCycleBits = cycle;
  report.noiseSeedOffset = aligned;
  for (const period of [1, 3, 7, 31]) {
    const count = period * 100,
      reference = trace(count, 1, period, 1, 8),
      ay = create();
    ay.noisePeriod = period;
    const theirChanges = [],
      ourChanges = [];
    let oldTheirs = 0xffff,
      oldOurs = ay.noise;
    for (let i = 0; i < count; i++) {
      ay.synth();
      const seed = reference.readUInt32LE(i * 9 + 5);
      if (seed !== oldTheirs) theirChanges.push(i);
      if (ay.noise !== oldOurs) ourChanges.push(i);
      oldTheirs = seed;
      oldOurs = ay.noise;
    }
    assert.deepEqual(
      ourChanges,
      theirChanges.slice(0, ourChanges.length).map((i) => i + period),
    );
    assert(ourChanges.length >= 49);
    report.noisePeriodCases++;
  }
  // emu2149 uses its own empirical AY table. Differences from Westcott's
  // measurements are expected and are reported, rather than hidden by gain fitting.
  const referenceVolumes = [0, 3, 4, 6, 9, 13, 18, 29, 34, 55, 77, 98, 130, 166, 208, 255].map(
    (x) => x / 255,
  );
  report.maximumVolumeDifference = Math.max(
    ...ay.levels.map((x, i) => Math.abs(x - referenceVolumes[i])),
  );
  assert(report.maximumVolumeDifference < 0.02);
  const amplitude = (samples, frequency, rate) => {
    let real = 0,
      imaginary = 0;
    for (let i = 0; i < samples.length; i++) {
      const angle = (2 * Math.PI * frequency * i) / rate;
      real += samples[i] * Math.cos(angle);
      imaginary += samples[i] * Math.sin(angle);
    }
    return (2 * Math.hypot(real, imaginary)) / samples.length;
  };
  report.renderedTones = [];
  for (const rate of [44100, 48000])
    for (const note of ['O2c', 'O5c', 'O5a', 'O7a', 'O8A']) {
      const ay = new AY(rate);
      ay.play(0, compileScore('V15N9' + note + '))'));
      ay.sample();
      const period = ay.period[0];
      ay.reset();
      ay.play(0, compileScore('V15N9' + note + '))'));
      const count = Math.round(rate * 0.6),
        actual = ay.render(count),
        ratio = ay.oversample;
      const raw = execFileSync(
        executable,
        [count * ratio, period, 1, 1, 8, rate * ratio, ay.clock].map(String),
        { maxBuffer: count * ratio * 9 + 1024 },
      );
      // Same DAC gain, FIR and DC blocker, applied to emu2149's independent
      // chip output. This isolates synthesis from the two output-filter designs.
      const expected = new Float32Array(count),
        history = new Float64Array(ay.kernel.length * 2);
      let position = 0,
        lastInput = 0,
        lastOutput = 0;
      for (let i = 0; i < count; i++) {
        for (let sub = 0; sub < ratio; sub++) {
          history[position] = history[position + ay.kernel.length] =
            raw[(i * ratio + sub) * 9] * 0.2;
          position = (position + 1) % ay.kernel.length;
        }
        let input = 0;
        for (let tap = 0; tap < ay.kernel.length; tap++)
          input += ay.kernel[tap] * history[position + tap];
        const output = input - lastInput + ay.dcDecay * lastOutput;
        expected[i] = output;
        lastInput = input;
        lastOutput = output;
      }
      const frequency = ay.clock / (16 * period),
        start = Math.round(rate * 0.1),
        measurements = [];
      for (const harmonic of [1, 3, 5]) {
        if (frequency * harmonic > Math.min(10000, rate * 0.35)) continue;
        const ours = amplitude(actual.subarray(start), frequency * harmonic, rate);
        const theirs = amplitude(expected.subarray(start), frequency * harmonic, rate);
        const relativeError = Math.abs(ours / theirs - 1);
        assert(relativeError < 0.005, `${note} at ${rate}, harmonic ${harmonic}: ${relativeError}`);
        measurements.push({ harmonic, relativeError });
      }
      report.renderedTones.push({ rate, note, period, frequency, measurements });
    }
  console.log(JSON.stringify(report, null, 2));
  if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + '\n');
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
