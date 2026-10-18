// The Latin letter printed on a key, which is how browsers match Ctrl and Cmd shortcuts.
// Keys printed with a letter of another script, such as Cyrillic, use their position;
// punctuation and accented Latin letters are characters of their own, not letters a–z.
export function latinLetter(event) {
  const key = event.key.toLowerCase();
  if (/^[a-z]$/.test(key)) return key;
  if (!/^\p{L}$/u.test(key) || /^\p{Script=Latin}$/u.test(key)) return null;
  return /^Key([A-Z])$/.exec(event.code)?.[1].toLowerCase() ?? null;
}
