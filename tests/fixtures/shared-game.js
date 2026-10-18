export function sharedGameSource(length) {
  let seed = 1;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const noise = Array.from({ length }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return alphabet[seed % alphabet.length];
  }).join('');
  return `// @title Share test\n// ${noise}\nfunction tick() { cls(4); }`;
}

// Finds the adjacent fixture games whose compressed sizes fall on either side of limit,
// using the encoder under test, as deflate implementations differ in their exact output.
export async function sharedGamesAround(limit, encode) {
  const bytes = async (length) => (await encode(sharedGameSource(length))).bytes;
  // Random letters compress to about six bits each, so twice the limit always exceeds it.
  let fits = 0,
    exceeds = limit * 2;
  while (exceeds - fits > 1) {
    const middle = Math.floor((fits + exceeds) / 2);
    if ((await bytes(middle)) <= limit) fits = middle;
    else exceeds = middle;
  }
  return [fits, exceeds].map((length) => sharedGameSource(length));
}
