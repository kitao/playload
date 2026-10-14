import { formatWithCursor } from 'prettier/standalone';
import babel from 'prettier/plugins/babel';
import estree from 'prettier/plugins/estree';

self.onmessage = async ({ data: { source, start, end } }) => {
  try {
    const options = {
      parser: 'babel',
      plugins: [babel, estree],
      singleQuote: true,
      printWidth: 100,
      embeddedLanguageFormatting: 'off',
    };
    const first = await formatWithCursor(source, { ...options, cursorOffset: start });
    const last =
      start === end ? first : await formatWithCursor(source, { ...options, cursorOffset: end });
    self.postMessage({
      source: first.formatted,
      start: first.cursorOffset,
      end: last.cursorOffset,
    });
  } catch (error) {
    self.postMessage({ error: error.message.split('\n')[0] });
  }
};
