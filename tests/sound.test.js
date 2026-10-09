import test from 'node:test';
import assert from 'node:assert/strict';
import { AY, compileScore } from '../src/sound.js';

test('ZX octaves, upper-case notes, accidentals, lengths, ties and triplets', () => {
  const notes = compileScore('O5N5cC#c$d3_5a11cde5f').code;
  assert(Math.abs(notes[0].frequency - 261.625565) < 0.001);
  assert.equal(notes[1].frequency, notes[0].frequency * 2);
  assert(Math.abs(notes[2].frequency - 277.18263) < 0.001);
  assert.equal(notes[4].beats, 1.5);
  assert.equal(notes[5].beats, 1 / 3);
  assert.equal(notes.at(-1).beats, 1);
});

test('finite repeats finish; unmatched double close loops; empty loops fail', () => {
  const finite = new AY(8000);
  finite.play(0, compileScore('T240N1(c)'));
  finite.render(1200);
  assert.equal(finite.voices[0], null);
  const loop = new AY(8000);
  loop.play(0, compileScore('T240N1c))'));
  loop.render(8000);
  assert(loop.voices[0]);
  assert.throws(() => compileScore('V15))'), /loop needs/);
  assert.throws(() => compileScore('L4c'), /Unknown/);
});

test('three channels, shared noise, hardware envelope and stopping produce finite PCM', () => {
  const ay = new AY(48000);
  for (let ch = 0; ch < 3; ch++) ay.play(ch, compileScore('O5N9c'));
  const tone = ay.render(4800);
  assert(tone.some((value) => Math.abs(value) > 0.1));
  assert(tone.every(Number.isFinite));
  ay.reset();
  ay.play(0, compileScore('M8UX1000W0N9c'));
  const noise = ay.render(9600);
  assert(noise.some((value) => Math.abs(value) > 0.01));
  assert.equal(ay.envelopeLevel, 0);
  ay.play(1, compileScore('H'));
  ay.render(1);
  assert(ay.voices.every((v) => v === null));
  ay.play(2, compileScore('9C'));
  ay.render(10);
  ay.play(2, compileScore(''));
  assert.equal(ay.voices[2], null);
});

test('all note lengths, dotted lengths and triplets have the documented beat values', () => {
  const beats = [0.25, 0.375, 0.5, 0.75, 1, 1.5, 2, 3, 4];
  for (let length = 1; length <= 9; length++) {
    assert.equal(compileScore(`${length}c`).code[0].beats, beats[length - 1]);
  }
  for (const [length, beat] of [
    [10, 1 / 6],
    [11, 1 / 3],
    [12, 2 / 3],
  ]) {
    assert.deepEqual(
      compileScore(`5N${length}cdef`).code.map((note) => note.beats),
      [beat, beat, beat, 1],
    );
  }
  assert.deepEqual(
    compileScore('1_3_5c&').code.map((note) => note.beats),
    [1.75, 1],
  );
});

test('rests, accidentals and comments preserve the next note and reset local modifiers', () => {
  const code = compileScore('O5 !ignored #O8c! #cc$d&c').code;
  const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
  assert.deepEqual(
    code.map((note) => note.frequency),
    [hz(61), hz(60), hz(61), 0, hz(60)],
  );
  assert.deepEqual(compileScore(' \nN').code, []);
  assert.equal(compileScore('UV0c').fixedVolume, true);
  assert.equal(compileScore('Uc').fixedVolume, false);
});

for (const [command, min, max] of [
  ['O', 0, 8],
  ['V', 0, 15],
  ['W', 0, 7],
  ['X', 0, 65535],
  ['T', 60, 240],
  ['M', 1, 63],
]) {
  test(`${command} accepts its limits and rejects missing or out-of-range numbers`, () => {
    for (const value of [min, max]) assert.doesNotThrow(() => compileScore(`${command}${value}c`));
    for (const source of [command, `${command}-1c`, `${command}${max + 1}c`]) {
      assert.throws(() => compileScore(source), SyntaxError);
    }
    if (min > 0) assert.throws(() => compileScore(`${command}${min - 1}c`), SyntaxError);
  });
}

test('incomplete notation, empty loops and excessive programs fail before playback', () => {
  for (const source of ['!unclosed', '#', '$', '_', '0c', '13c', 'V15))', '&_']) {
    assert.throws(() => compileScore(source), SyntaxError);
  }
  assert.throws(() => compileScore('c'.repeat(65537)), /too long/);
  assert.throws(() => compileScore('c'.repeat(16385)), /too many commands/);
  assert.equal(compileScore('c'.repeat(16384)).code.length, 16384);
});

function sampleCount(score, rate = 48000) {
  const ay = new AY(rate);
  ay.play(0, compileScore(score));
  let count = 0;
  while (ay.voices[0] && count <= rate * 5) {
    ay.sample();
    count++;
  }
  assert(count <= rate * 5, 'finite score must finish');
  // The first sample after the final note detects that the program is finished.
  return count - 1;
}

test('note durations, rests, ties and nested repeats match tempo in rendered samples', () => {
  for (const rate of [44100, 48000]) {
    for (const [score, seconds] of [
      ['T120N5c', 0.5],
      ['T240N1c', 0.0625],
      ['T60N3c', 0.5],
      ['T120N1_3_5c', 0.875],
      ['T120N1c&', 0.25],
      ['T120N10cde', 0.25],
      ['T240N1((cd))', 0.5],
      ['T240N1(cd', 0.25],
    ])
      assert(Math.abs(sampleCount(score, rate) - rate * seconds) <= 2, score);
  }
});

test('tempo is global, controlled only by channel zero, and reset restores defaults', () => {
  const ay = new AY();
  ay.play(1, compileScore('T240c'));
  ay.sample();
  assert.equal(ay.tempo, 120);
  ay.play(0, compileScore('T60c'));
  ay.sample();
  assert.equal(ay.tempo, 60);
  ay.play(2, compileScore('T180c'));
  ay.sample();
  assert.equal(ay.tempo, 60);
  ay.reset();
  assert.equal(ay.tempo, 120);
  assert.deepEqual(ay.voices, [null, null, null]);
  assert(ay.render(1024).every((sample) => sample === 0));
});

test('replacing or stopping one channel leaves the other channels playing', () => {
  const ay = new AY();
  for (let ch = 0; ch < 3; ch++) ay.play(ch, compileScore('9c))'));
  ay.render(100);
  const first = ay.voices[0],
    third = ay.voices[2];
  ay.play(1, compileScore('9g'));
  ay.render(1);
  assert.equal(ay.voices[0], first);
  assert.equal(ay.voices[2], third);
  ay.play(1, compileScore(''));
  assert.equal(ay.voices[1], null);
  assert.equal(ay.voices[0], first);
  assert.equal(ay.voices[2], third);
});

test('volume zero and rests are silent, and fixed volume overrides the envelope', () => {
  for (const score of ['V0N9c))', 'V15N9&))']) {
    const ay = new AY();
    ay.play(0, compileScore(score));
    assert(ay.render(2000).every((sample) => sample === 0));
  }
  const rms = (samples) =>
    Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
  const level = (volume) => {
    const ay = new AY();
    ay.play(0, compileScore(`V${volume}N9c))`));
    ay.render(1000);
    return rms(ay.render(4000));
  };
  assert(level(15) > level(10));
  assert(level(10) > level(5));
  const ay = new AY();
  ay.play(0, compileScore('UX1W0V10N9c'));
  ay.render(1000);
  assert.equal(ay.voices[0].envelope, false);
  assert.equal(ay.voices[0].volume, 10);
  assert(rms(ay.render(1000)) > 0.01);
});

// ZX 128 W0–W7 shapes; an AY cycle has 16 steps and lasts 256 * X / clock seconds.
const down = Array.from({ length: 16 }, (_, i) => 15 - i),
  up = [...down].reverse();
for (const [shape, expected] of [
  [0, [...down, ...Array(17).fill(0)]],
  [1, [...up, ...Array(17).fill(0)]],
  [2, [...down, ...Array(17).fill(0)]],
  [3, [...up, ...Array(17).fill(15)]],
  [4, [...down, ...down, 15]],
  [5, [...up, ...up, 0]],
  [6, [...up, ...down, 0]],
  [7, [...down, ...up, 15]],
]) {
  test(`envelope W${shape} has the documented attack, decay, hold and repetition`, () => {
    // Choose an exact one-sample step so the expected shape is independent of rounding.
    const ay = new AY(1773400 / 16);
    ay.play(0, compileScore(`UX1W${shape}N9c`));
    const levels = [shape === 1 || shape === 3 || shape === 5 || shape === 6 ? 0 : 15];
    for (let i = 0; i < 32; i++) {
      ay.sample();
      levels.push(ay.envelopeLevel);
    }
    assert.deepEqual(levels, expected);
  });
}

test('noise and envelope settings are shared, and a note retriggers an enabled envelope', () => {
  const ay = new AY(48000);
  ay.play(0, compileScore('M63UX1000W6N9c'));
  ay.sample();
  assert.equal(ay.mixer, 63);
  assert.equal(ay.envelopePeriod, 1000);
  assert.equal(ay.shape, 14);
  ay.render(1000);
  assert(ay.envelopeStep > 0);
  ay.play(2, compileScore('UN9g'));
  ay.sample();
  assert.equal(ay.envelopeStep, 0);
  ay.play(1, compileScore('M8X2000W7N9c'));
  ay.sample();
  assert.equal(ay.mixer, 8);
  assert.equal(ay.envelopePeriod, 2000);
  assert.equal(ay.shape, 10);
});

function amplitude(samples, frequency, rate) {
  let real = 0,
    imaginary = 0;
  for (let i = 0; i < samples.length; i++) {
    const phase = (2 * Math.PI * frequency * i) / rate;
    real += samples[i] * Math.cos(phase);
    imaginary += samples[i] * Math.sin(phase);
  }
  return (2 * Math.hypot(real, imaginary)) / samples.length;
}

test('rendered A4 has its expected pitch and little DC at common audio sample rates', () => {
  for (const rate of [44100, 48000]) {
    const ay = new AY(rate);
    ay.play(0, compileScore('O5V15N9a))'));
    ay.render(rate / 10);
    const samples = ay.render(rate / 2),
      frequency = ay.clock / (16 * ay.period[0]);
    assert(Math.abs(frequency - 440) < 1);
    assert(amplitude(samples, frequency, rate) > 0.12);
    const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
    assert(Math.abs(mean) < 0.001);
  }
});

test('high square-wave notes suppress the folded fifth harmonic below minus 60 dB', () => {
  for (const rate of [44100, 48000]) {
    const ay = new AY(rate);
    ay.play(0, compileScore('O8V15N9A))'));
    ay.render(Math.floor(rate / 10));
    const samples = ay.render(rate),
      frequency = ay.clock / (16 * ay.period[0]);
    const alias = Math.abs(rate - 5 * frequency);
    const ratio = amplitude(samples, alias, rate) / amplitude(samples, frequency, rate);
    assert(
      20 * Math.log10(ratio) < -60,
      `folded harmonic at ${rate} Hz: ${20 * Math.log10(ratio)} dB`,
    );
  }
});

test('tones above Nyquist do not become an audible folded tone at low sample rates', () => {
  const ay = new AY(8000);
  ay.play(0, compileScore('O8V15N9A))'));
  ay.render(4000);
  assert(ay.render(4000).every((value) => Number.isFinite(value) && Math.abs(value) < 1e-6));
});

test('three loud channels remain finite and within the audio output range', () => {
  for (const rate of [44100, 48000]) {
    const ay = new AY(rate);
    for (let ch = 0; ch < 3; ch++) ay.play(ch, compileScore('V15O8N1abcdefgC))'));
    const samples = ay.render(rate);
    assert(samples.every((value) => Number.isFinite(value) && Math.abs(value) <= 1));
  }
});

test('audio block boundaries do not change tone, noise, envelope or score timing', () => {
  const whole = new AY(),
    blocks = new AY();
  for (const ay of [whole, blocks]) {
    ay.play(0, compileScore('T150M63UX1000W6N1cdef))'));
    ay.play(1, compileScore('O4V12N3gb))'));
  }
  const expected = whole.render(8192),
    actual = new Float32Array(8192);
  for (let offset = 0; offset < actual.length; offset += 128)
    actual.set(blocks.render(128), offset);
  assert.deepEqual(actual, expected);
});

test('the complete-mix output filter preserves audible mids and rejects frequencies above Nyquist', () => {
  for (const rate of [44100, 48000]) {
    const ay = new AY(rate);
    const response = (frequency) =>
      (amplitude(ay.kernel, frequency, ay.sampleRate * ay.oversample) * ay.kernel.length) / 2;
    for (let i = 0; i <= 128; i++) {
      const frequency = (10000 * i) / 128;
      assert(
        Math.abs(response(frequency) - 1) < 0.001,
        `passband gain at ${frequency} Hz, ${rate} Hz output`,
      );
    }
    for (let i = 0; i <= 512; i++) {
      const multiple = 0.5 + (3.5 * i) / 512;
      assert(response(rate * multiple) < 0.001, `stopband at ${multiple} times ${rate} Hz output`);
    }
  }
});

test('zero envelope period runs twice as fast as period one', () => {
  for (const [period, expected] of [
    [0, 2],
    [1, 1],
  ]) {
    const ay = new AY(1773400 / 16);
    ay.play(0, compileScore(`UX${period}W4N9c`));
    ay.sample();
    assert.equal(ay.envelopeStep, expected);
  }
});

test('clock-grid envelope and tone transitions do not slip at period seven', () => {
  const ay = new AY(2200000 / 64);
  ay.clock = 2200000;
  ay.period.fill(7);
  ay.envelopePeriod = 7;
  ay.shape = 12;
  ay.trigger();
  for (let tick = 1; tick <= 14 * 64; tick++) {
    ay.synth();
    assert.equal(ay.envelopeLevel, Math.floor(tick / 14) % 16);
    assert.equal(Number(ay.phase[0] < 56), 1 - (Math.floor(tick / 7) % 2));
  }
});

test('the noise generator has a maximal 17-bit period and remains balanced', () => {
  const ay = new AY(1773400 / (16 * 8)),
    initial = ay.noise;
  let ones = 0;
  for (let i = 0; i < 131071; i++) {
    ay.synth();
    ones += ay.noise & 1;
    assert.notEqual(ay.noise, 0);
    if (i < 131070) assert.notEqual(ay.noise, initial);
  }
  assert.equal(ay.noise, initial);
  assert.equal(ones, 65536);
});

test('reset clears output filter history and reproduces the same noise and envelope audio', () => {
  const ay = new AY(),
    score = compileScore('M8UX1000W7N9c))');
  ay.play(0, score);
  const expected = ay.render(4096);
  ay.reset();
  assert(ay.render(1024).every((sample) => sample === 0));
  ay.reset();
  ay.play(0, score);
  assert.deepEqual(ay.render(4096), expected);
});

test('pitch changes preserve elapsed half-cycle clocks and output polarity', () => {
  const ay = new AY(2200000 / 64);
  ay.clock = 2200000;
  ay.period[0] = 7;
  // Advance into the low half-cycle, then write a longer period. The old full
  // cycle modulo incorrectly flips the bit high immediately at this point.
  for (let i = 0; i < 9; i++) ay.synth();
  assert.equal(ay.phase[0], 72);
  ay.setPeriod(0, 31);
  assert.equal(ay.phase[0], 264);
  for (let i = 0; i < 28; i++) {
    ay.synth();
    assert(ay.phase[0] >= 248);
  }
  ay.synth();
  assert.equal(ay.phase[0], 0);
});
