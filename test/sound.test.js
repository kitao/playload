import test from 'node:test';
import assert from 'node:assert/strict';
import { AY, compileScore } from '../src/sound.js';

test('ZX octaves, upper-case notes, accidentals, lengths, ties and triplets', () => {
  const notes = compileScore('O5N5cC#c$d3_5a11cde5f').code;
  assert(Math.abs(notes[0].frequency - 261.625565) < .001);
  assert.equal(notes[1].frequency, notes[0].frequency * 2);
  assert(Math.abs(notes[2].frequency - 277.18263) < .001);
  assert.equal(notes[4].beats, 1.5);
  assert.equal(notes[5].beats, 1 / 3);
  assert.equal(notes.at(-1).beats, 1);
});

test('finite repeats finish; unmatched double close loops; empty loops fail', () => {
  const finite = new AY(8000); finite.play(0, compileScore('T240N1(c)'));
  finite.render(1200); assert.equal(finite.voices[0], null);
  const loop = new AY(8000); loop.play(0, compileScore('T240N1c))'));
  loop.render(8000); assert(loop.voices[0]);
  assert.throws(() => compileScore('V15))'), /loop needs/);
  assert.throws(() => compileScore('L4c'), /Unknown/);
});

test('three channels, shared noise, hardware envelope and stopping produce finite PCM', () => {
  const ay = new AY(48000);
  for (let ch = 0; ch < 3; ch++) ay.play(ch, compileScore('O5N9c'));
  const tone = ay.render(4800);
  assert(tone.some(value => Math.abs(value) > .1)); assert(tone.every(Number.isFinite));
  ay.reset(); ay.play(0, compileScore('M8UX1000W0N9c'));
  const noise = ay.render(9600);
  assert(noise.some(value => Math.abs(value) > .01));
  assert.equal(ay.envelopeLevel, 0);
  ay.play(1, compileScore('H')); ay.render(1); assert(ay.voices.every(v => v === null));
  ay.play(2, compileScore('9C')); ay.render(10); ay.play(2, compileScore('')); assert.equal(ay.voices[2], null);
});
