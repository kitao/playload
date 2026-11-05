import test from 'node:test';
import assert from 'node:assert/strict';
import { readGameReply } from '../src/app/game-messages.js';
import { compileScore } from '../src/engine/sound.js';

test('game replies reject hidden buffers, extra fields, sparse arrays and malformed errors', () => {
  const ready = () => ({ type: 'ready', pixels: new Uint8Array(160 * 144), sounds: [] });
  const large = new Uint8Array(4 * 1024 * 1024);
  const invalid = [
    { ...ready(), pixels: large.subarray(0, 160 * 144) },
    { ...ready(), extra: large },
    { ...ready(), sounds: Object.assign([], { extra: large }) },
    { ...ready(), sounds: Array(1) },
    { type: 'error', message: { toString: null, valueOf: null } },
    { type: 'error', message: 'x'.repeat(4097) },
    { type: 'error', message: 'Failed', line: -1 },
    { type: 'error', message: 'Failed', extra: large },
  ];
  for (const decorate of [
    (score) => ({ ...score, extra: large }),
    (score) => ({ ...score, fixedVolume: large }),
    (score) => ({ ...score, code: Object.assign(score.code, { extra: large }) }),
    (score) => ({ ...score, code: [{ ...score.code[0], extra: large }] }),
    (score) => ({ ...score, code: Array(1) }),
  ])
    invalid.push({ ...ready(), sounds: [{ ch: 0, score: decorate(compileScore('c')) }] });
  for (const message of invalid)
    assert.throws(() => readGameReply(message, true, 1), /Invalid game frame/);
  assert.deepEqual(readGameReply({ type: 'error', message: 'Failed' }, true, 1), {
    type: 'error',
    message: 'Failed',
    line: null,
  });
});
