// Highlighting is optional presentation work. Expensive syntax must never keep
// a shared game URL from opening, or prevent the player from editing its source.
export class EditorHighlighter {
  constructor(preview, editor) {
    this.preview = preview;
    this.editor = editor;
  }

  update(source) {
    clearTimeout(this.scheduled);
    if (this.pending) this.stop();
    // Avoid laying out a second full copy of unusually large source text.
    const plain = source.length > 100000;
    this.editor.classList.toggle('plain', plain);
    this.preview.textContent = plain ? '' : source + '\n';
    if (plain) return;
    this.scheduled = setTimeout(() => this.highlight(source), 50);
  }

  highlight(source) {
    try {
      this.worker ??= new Worker(new URL(this.preview.dataset.highlighter, location.href), {
        type: 'module',
      });
      const worker = this.worker;
      this.pending = true;
      this.worker.onmessage = ({ data }) => {
        if (this.worker !== worker || !this.pending) return;
        clearTimeout(this.watchdog);
        this.pending = false;
        if (typeof data === 'string') this.preview.innerHTML = data + '\n';
      };
      this.worker.onerror = (event) => {
        event.preventDefault();
        this.stop();
      };
      this.worker.postMessage(source);
      this.watchdog = setTimeout(() => this.stop(), 500);
    } catch {
      this.stop();
    }
  }

  stop() {
    clearTimeout(this.scheduled);
    clearTimeout(this.watchdog);
    this.worker?.terminate();
    this.worker = null;
    this.pending = false;
  }
}
