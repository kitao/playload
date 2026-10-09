// Versioned, unpadded base64url. Only the compressed UTF-8 source is in the URL.
export async function encode(source) {
  const bytes = new TextEncoder().encode(source);
  if (bytes.length > 1024 * 1024) throw new Error('Expanded source exceeds 1 MB');
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const data = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = '';
  for (const byte of data) binary += String.fromCharCode(byte);
  return {
    hash: '#1.' + btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''),
    bytes: data.length,
  };
}

export async function decode(hash) {
  if (!/^#1\.[A-Za-z0-9_-]+$/.test(hash)) throw new Error('Invalid game URL');
  const body = hash.slice(3);
  if (body.length > 4096 || body.length % 4 === 1) throw new Error('Invalid payload length');
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
      if (length > 1024 * 1024) throw new Error('Expanded source exceeds 1 MB');
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
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export function gameURL(base, hash) {
  const url = new URL(base);
  url.hash = hash;
  return url.href;
}
