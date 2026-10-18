import './prism-settings.js';
import 'prismjs/components/prism-core.js';
import 'prismjs/components/prism-clike.js';
import 'prismjs/components/prism-javascript.js';

export function highlightJavaScript(source) {
  const { Prism } = globalThis;
  return Prism.highlight(source, Prism.languages.javascript, 'javascript');
}
