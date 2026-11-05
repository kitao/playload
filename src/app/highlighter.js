import './prism-settings.js';
import 'prismjs/components/prism-core.js';
import 'prismjs/components/prism-clike.js';
import 'prismjs/components/prism-javascript.js';

self.onmessage = ({ data: source }) => {
  const { Prism } = globalThis;
  const html = Prism.highlight(source, Prism.languages.javascript, 'javascript');
  // Bound the DOM work too; long sources remain readable as plain text.
  self.postMessage(html.length <= 1024 * 1024 ? html : null);
};
