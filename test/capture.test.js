import test from 'node:test';
import assert from 'node:assert/strict';
import { Capture } from '../src/capture.js';

test('the 64 MiB buffer counts a finalized interval once and trims the oldest data', () => {
  const capture = Object.create(Capture.prototype), start = performance.now(), mib = 1024 * 1024;
  const previous = { start, bytes: 20 * mib }, stopped = { start, bytes: 40 * mib };
  capture.intervals = [previous, stopped]; capture.current = stopped; capture.recorder = { state: 'inactive' };
  capture.trim(); assert.deepEqual(capture.intervals, [previous, stopped]);
  capture.recorder.state = 'recording'; capture.current = { start, bytes: 8 * mib };
  capture.trim(); assert.deepEqual(capture.intervals, [stopped]);
});


test('reference reading suspends the clip clock and preserves the buffered play', async () => {
  const capture = Object.create(Capture.prototype), now = performance.now();
  const interval = { start: now - 10000, bytes: 128 };
  capture.intervals = [interval]; capture.current = { start: now, bytes: 32 };
  capture.recorder = { state: 'recording', pause() { this.state = 'paused'; }, resume() { this.state = 'recording'; } };
  capture.suspend(true);
  const seconds = capture.seconds;
  // Model a long reference visit without making this test wait a minute.
  capture.suspendedAt -= 70000; capture.heldTime = -70000;
  assert.ok(Math.abs(capture.seconds - seconds) < .01);
  assert.equal(capture.recorder.state, 'paused');
  assert.deepEqual(capture.intervals, [interval]);
  capture.suspend(false);
  assert.equal(capture.recorder.state, 'recording');
  assert.ok(Math.abs(capture.seconds - seconds) < .1);
});
