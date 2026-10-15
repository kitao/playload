export function sharedGameSource(length) {
  let seed = 1;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const noise = Array.from({ length }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return alphabet[seed % alphabet.length];
  }).join('');
  return `// @title Share test\n// ${noise}\nfunction tick() { cls(4); }`;
}
