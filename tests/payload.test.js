import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { encode, decode, gameURL } from '../src/payload.js';

test('UTF-8 source, emoji and newlines round-trip through a URL payload', async () => {
  const source = 'let 漢="👾⛩️"\nfunction tick(){put(3,7,漢)}';
  const payload = await encode(source);
  assert.match(payload.hash, /^#v1\.[A-Za-z0-9_-]+$/);
  assert.equal(await decode(payload.hash), source);
  assert.equal(
    gameURL('https://example.com/playload/#old', payload.hash),
    'https://example.com/playload/' + payload.hash,
  );
  assert.equal(payload.bytes, Buffer.from(payload.hash.slice(4), 'base64url').length);
});

test('a source byte-order mark is preserved when restoring a shared game', async () => {
  const source = '\ufeff// @title Demo\nfunction tick() {}';
  assert.equal(await decode((await encode(source)).hash), source);
});

test('the source limit counts UTF-8 bytes and permits exactly one MiB', async () => {
  const source = 'é'.repeat((1024 * 1024) / 2);
  assert.equal(await decode((await encode(source)).hash), source);
  await assert.rejects(encode(source + 'x'), /exceeds 1 MiB/);
});

test('corrupt compression and invalid UTF-8 fail without affecting a later valid decode', async () => {
  const invalidUTF8 = deflateRawSync(Buffer.from([0xc3, 0x28]));
  for (const bytes of [Buffer.from([0x07]), invalidUTF8]) {
    await assert.rejects(decode('#1.' + bytes.toString('base64url')));
  }

  const source = 'function tick() { put(0, 0, "é👾"); }';
  const fixture = deflateRawSync(Buffer.from(source));
  assert.equal(await decode('#1.' + fixture.toString('base64url')), source);
});

test('malformed and excessive payloads fail without becoming source', async () => {
  for (const hash of ['#2.ab', '#1.a', '#1.**', '#1.' + 'a'.repeat(4097)])
    await assert.rejects(decode(hash));
  await assert.rejects(encode(' '.repeat(1024 * 1024 + 1)), /exceeds 1 MiB/);
  const stream = new Blob([' '.repeat(1024 * 1024 + 1)])
    .stream()
    .pipeThrough(new CompressionStream('deflate-raw'));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  const hash = '#1.' + Buffer.from(compressed).toString('base64url');
  await assert.rejects(decode(hash), /exceeds 1 MiB/);
});

test('the fixed legacy v1 payload remains readable and new URLs use the explicit version', async () => {
  const source = '// @title Legacy\nfunction tick() { cls(4); }';
  const legacy = '#1.09dXcCjJLMlJVfBJTU9MruRKK81LLsnMz1MoyUzO1tBUqFZIzinWMNG0VqgFAA';
  assert.equal(await decode(legacy), source);
  assert.equal(await decode(legacy.replace('#1.', '#v1.')), source);
  const current = await encode(source);
  assert.equal(current.hash, legacy.replace('#1.', '#v1.'));
  for (const prefix of ['#v0.', '#v2.', '#v01.', '#V1.']) {
    await assert.rejects(decode(prefix + legacy.slice(3)), /Invalid game URL/);
  }
});
