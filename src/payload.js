export const MAX_SOURCE_BYTES = 1024 * 1024;
export const MAX_COMPRESSED_BYTES = 3072;
export const MAX_URL_LENGTH = 4096;

// Versioned, unpadded base64url. Only the compressed UTF-8 source is in the URL.
export async function encode(source) {
  const bytes = new TextEncoder().encode(source);
  if (bytes.length > MAX_SOURCE_BYTES) throw new Error('Expanded source exceeds 1 MiB');
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const data = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = '';
  for (const byte of data) binary += String.fromCharCode(byte);
  return {
    hash: '#v1.' + btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''),
    bytes: data.length,
  };
}

export async function decode(hash) {
  const match = /^#(?:v1|1)\.([A-Za-z0-9_-]+)$/.exec(hash);
  if (!match) throw new Error('Invalid game URL');
  const body = match[1];
  if (body.length > Math.ceil((MAX_COMPRESSED_BYTES * 4) / 3) || body.length % 4 === 1)
    throw new Error('Invalid payload length');
  const binary = atob(body.replaceAll('-', '+').replaceAll('_', '/'));
  const stream = new Blob([Uint8Array.from(binary, (c) => c.charCodeAt(0))])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader(),
    chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > MAX_SOURCE_BYTES) throw new Error('Expanded source exceeds 1 MiB');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
}

export function gameURL(base, hash) {
  const url = new URL(base);
  url.hash = hash;
  return url.href;
}
