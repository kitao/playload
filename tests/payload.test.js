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
  MAX_SOURCE_BYTES,
  MAX_URL_LENGTH,
} from '../src/payload.js';
import { sharedGamesAround } from './fixtures/shared-game.js';

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
  assert.equal(MAX_SOURCE_BYTES, 1024 * 1024);
  const source = 'é'.repeat(MAX_SOURCE_BYTES / 2);
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

test('source with an unpaired surrogate is refused instead of changing when shared', async () => {
  for (const source of ['"\ud83d"', 'put(0, 0, "\udc7e")', '\ud83d\ud83d\udc7e'])
    await assert.rejects(encode(source), /unpaired surrogate/);
  assert.equal(await decode((await encode('"\ud83d\udc7e"')).hash), '"👾"');
});

test('malformed and excessive payloads fail without becoming source', async () => {
  for (const hash of ['#2.ab', '#1.a', '#1.**']) await assert.rejects(decode(hash));
  // A whole base64 length just over the legacy 3 KiB, which no other check rejects.
  await assert.rejects(decode('#1.' + 'A'.repeat(4100)), /Invalid payload length/);
  await assert.rejects(encode(' '.repeat(MAX_SOURCE_BYTES + 1)), /exceeds 1 MiB/);
  const stream = new Blob([' '.repeat(MAX_SOURCE_BYTES + 1)])
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
  assert.match(current.hash, /^#v1\./);
  assert.equal(await decode(current.hash), source);
  for (const prefix of ['#v0.', '#v2.', '#v01.', '#V1.']) {
    await assert.rejects(decode(prefix + legacy.slice(3)), /Invalid game URL/);
  }
});

test('3 KB means 3,000 bytes and remains one complete URL in X text', async () => {
  assert.equal(MAX_COMPRESSED_BYTES, 3000);
  // The longest possible payload: 3,000 bytes are 4,000 unpadded base64url characters.
  const longest = gameURL(
    'https://kitao.dev/playload/app/?ref=tracking',
    '#v1.' + 'A'.repeat(4000),
  );
  assert.equal(longest.length, 4035);
  assert.equal(new URL(longest).search, '');
  assert(fitsURLLimit(longest));
  for (const text of [longest, `ゲームを作りました。\n${longest}\n#playload`, `「${longest}」`]) {
    assert.deepEqual(twitterText.extractUrls(text), [longest]);
    assert(twitterText.parseTweet(text).valid);
  }
  assert.equal(twitterText.parseTweet(longest).weightedLength, 23);
  // A real game at the limit shares and restores its source.
  const [source] = await sharedGamesAround(MAX_COMPRESSED_BYTES, encode),
    payload = await encode(source),
    url = gameURL('https://kitao.dev/playload/app/', payload.hash);
  assert(payload.bytes <= MAX_COMPRESSED_BYTES && payload.bytes > MAX_COMPRESSED_BYTES - 4);
  assert(fitsURLLimit(url));
  assert.equal(await decode(new URL(url).hash), source);
});

test('the full URL length check agrees with X, including protocol overhead', () => {
  for (const protocol of ['http:', 'https:']) {
    const base = protocol + '//kitao.dev/playload/app/#v1.';
    const boundary = MAX_URL_LENGTH - protocol.length - 2;
    for (const length of [boundary, boundary + 1]) {
      const url = base + 'A'.repeat(length - base.length);
      const fits = length === boundary;
      assert.equal(fitsURLLimit(url), fits);
      assert.equal(twitterText.extractUrls(url).includes(url), fits);
    }
  }
});

test('an over-limit game never rounds down to 3.00 KB', async () => {
  const [, over] = await sharedGamesAround(MAX_COMPRESSED_BYTES, encode);
  const { bytes } = await encode(over);
  assert(bytes > MAX_COMPRESSED_BYTES);
  assert.equal(formatPayloadSize(3000), '3.00 KB');
  assert.equal(formatPayloadSize(3001), '3.01 KB');
  assert(Number.parseFloat(formatPayloadSize(bytes)) > 3);
  for (const size of [0, 1, 999, 1000, 2999, 3000, 3001, 3072]) {
    assert(Number.parseFloat(formatPayloadSize(size)) * 1000 >= size);
  }
});

test('earlier 3 KiB URLs remain decodable but are outside the new share budget', async () => {
  const [source, over] = await sharedGamesAround(3072, encode),
    payload = await encode(source),
    url = gameURL('https://kitao.dev/playload/app/', payload.hash);
  assert(payload.bytes <= 3072 && payload.bytes > 3068);
  assert.equal(await decode(payload.hash), source);
  assert.equal(await decode(payload.hash.replace('#v1.', '#1.')), source);
  assert.equal(twitterText.parseTweet(url).valid, false);
  assert.equal(fitsURLLimit(url), false);
  await assert.rejects(decode((await encode(over)).hash), /Invalid payload length/);
});
