import { readFile } from 'node:fs/promises';

export function escapeHTML(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export async function renderReference() {
  const reference = JSON.parse(
    await readFile(new URL('../data/reference.json', import.meta.url), 'utf8'),
  );

  const spans = (entries) =>
    entries
      .map(
        ([name, meaning]) => `<span><code>${escapeHTML(name)}</code> ${escapeHTML(meaning)}</span>`,
      )
      .join('');

  const code = (value) =>
    escapeHTML(value).replace(/(\/\/[^\n]*)/g, '<span class="code-comment">$1</span>');

  const groups = (entries, api) =>
    entries
      .map((group) => {
        const details = group.entries
          .map((entry) => {
            const buttons = entry.buttons
              ? `<p class="button-map">${entry.buttons.map((label) => `<span>${escapeHTML(label)}</span>`).join('')}</p>`
              : '';
            const example = entry.envelopes
              ? `<div class="envelope-shapes">${spans(reference.envelopes)}</div>`
              : api
                ? `<pre class="api-example"><code>${code(entry.example)}</code></pre>`
                : `<code>${escapeHTML(entry.example)}</code>`;
            return `<div><dt>${escapeHTML(entry.name)}</dt><dd><p class="reference-description">${escapeHTML(entry.description)}</p>${buttons}${example}</dd></div>`;
          })
          .join('\n');
        const description = group.description
          ? `<p class="length-note">${escapeHTML(group.description)}</p>`
          : '';
        const lengths = group.lengths
          ? `<div class="note-lengths" aria-label="Note length codes">${spans(reference.lengths)}</div>`
          : '';
        return `<h3>${escapeHTML(group.title)}</h3>${description}${lengths}<dl class="${api ? 'api-group' : 'mml-group'}">${details}</dl>`;
      })
      .join('\n');

  return `<div class="api-columns">
<section class="api-guide" aria-labelledby="api-heading"><h2 id="api-heading">API</h2>${groups(reference.api, true)}</section>
<section class="score-guide" aria-labelledby="score-heading"><h2 id="score-heading">ZX 128 PLAY</h2>${groups(reference.sound, false)}</section>
</div>`;
}
