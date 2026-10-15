import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import twitterText from 'twitter-text';
import {
  encode,
  decode,
  gameURL,
  formatPayloadSize,
  fitsURLLimit,
  MAX_COMPRESSED_BYTES,
} from '../src/payload.js';
import { sharedGameSource } from './fixtures/shared-game.js';

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

test('3 KB means 3,000 bytes and remains one complete URL in X text', async () => {
  assert.equal(MAX_COMPRESSED_BYTES, 3000);
  const source = sharedGameSource(3906),
    payload = await encode(source),
    url = gameURL('https://kitao.dev/playload/app/?ref=tracking', payload.hash);
  assert.equal(payload.bytes, 3000);
  assert.equal(url.length, 4035);
  assert.equal(new URL(url).search, '');
  assert(fitsURLLimit(url));
  assert.equal(await decode(new URL(url).hash), source);
  for (const text of [url, `ゲームを作りました。\n${url}\n#playload`, `「${url}」`]) {
    assert.deepEqual(twitterText.extractUrls(text), [url]);
    assert(twitterText.parseTweet(text).valid);
  }
  assert.equal(twitterText.parseTweet(url).weightedLength, 23);
});

test('the full URL length check agrees with X, including protocol overhead', () => {
  for (const protocol of ['http:', 'https:']) {
    const base = protocol + '//kitao.dev/playload/app/#v1.';
    const boundary = 4096 - protocol.length - 2;
    for (const length of [boundary, boundary + 1]) {
      const url = base + 'A'.repeat(length - base.length);
      const fits = length === boundary;
      assert.equal(fitsURLLimit(url), fits);
      assert.equal(twitterText.extractUrls(url).includes(url), fits);
    }
  }
});

test('an over-limit game never rounds down to 3.00 KB', async () => {
  const payload = await encode(sharedGameSource(3908));
  assert.equal(payload.bytes, 3001);
  assert.equal(formatPayloadSize(3000), '3.00 KB');
  assert.equal(formatPayloadSize(payload.bytes), '3.01 KB');
  for (const bytes of [0, 1, 999, 1000, 2999, 3000, 3001, 3072]) {
    assert(Number.parseFloat(formatPayloadSize(bytes)) * 1000 >= bytes);
  }
});

test('earlier 3 KiB URLs remain decodable but are outside the new share budget', async () => {
  const source = sharedGameSource(4003),
    payload = await encode(source),
    url = gameURL('https://kitao.dev/playload/app/', payload.hash);
  assert.equal(payload.bytes, 3072);
  assert.equal(await decode(payload.hash), source);
  assert.equal(await decode(payload.hash.replace('#v1.', '#1.')), source);
  assert.equal(twitterText.parseTweet(url).valid, false);
  assert.equal(fitsURLLimit(url), false);
});
