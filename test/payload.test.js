import test from 'node:test';
import assert from 'node:assert/strict';
import { encode, decode, gameURL } from '../src/payload.js';

test('UTF-8 source, emoji and newlines round-trip through a URL payload', async () => {
  const source = 'let 漢="👾⛩️"\nfunction tick(){put(漢,3,7)}';
  const payload = await encode(source);
  assert.match(payload.hash, /^#1\.[A-Za-z0-9_-]+$/);
  assert.equal(await decode(payload.hash), source);
  assert.equal(gameURL('https://example.com/playload/#old', payload.hash), 'https://example.com/playload/' + payload.hash);
  assert(payload.bytes > 0);
});

test('malformed and excessive payloads fail without becoming source', async () => {
  for (const hash of ['#2.ab', '#1.a', '#1.**', '#1.' + 'a'.repeat(4097)]) await assert.rejects(decode(hash));
  await assert.rejects(encode(' '.repeat(1024 * 1024 + 1)), /exceeds 1 MB/);
  const stream = new Blob([' '.repeat(1024 * 1024 + 1)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  const hash = '#1.' + Buffer.from(compressed).toString('base64url');
  await assert.rejects(decode(hash), /exceeds 1 MB/);
});
