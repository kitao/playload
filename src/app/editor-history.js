import { latinLetter } from './keys.js';

// Textarea multiline edits can lose their first line on native Redo in Chrome.
// Keep formatting and adjacent typing as complete, bounded undo transactions.
export class EditorHistory {
  constructor(editor) {
    this.editor = editor;
    this.reset();
    editor.addEventListener('beforeinput', (event) => {
      if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
        event.preventDefault();
        this.move(event.inputType === 'historyUndo' ? -1 : 1);
      } else this.before = this.snapshot();
    });
    editor.addEventListener('input', (event) => {
      if (this.applying) return;
      this.record(this.before ?? this.states[this.index], this.snapshot(), event.inputType);
      this.before = null;
    });
    editor.addEventListener('keydown', (event) => {
      if (event.isComposing || event.altKey || (!event.ctrlKey && !event.metaKey)) return;
      const letter = latinLetter(event);
      const step =
        letter === 'z'
          ? event.shiftKey
            ? 1
            : -1
          : letter === 'y' && event.ctrlKey && !event.metaKey && !event.shiftKey
            ? 1
            : 0;
      if (!step) return;
      event.preventDefault();
      event.stopPropagation();
      this.move(step);
    });
  }

  snapshot() {
    const editor = this.editor;
    return {
      source: editor.value,
      start: editor.selectionStart,
      end: editor.selectionEnd,
      direction: editor.selectionDirection,
      top: editor.scrollTop,
      left: editor.scrollLeft,
    };
  }

  reset() {
    this.states = [this.snapshot()];
    this.index = 0;
    this.before = null;
    this.lastType = null;
    this.lastTime = 0;
  }

  record(before, after, type) {
    if (before.source === after.source) return;
    const previous = this.states[this.index];
    const now = performance.now();
    const grouped =
      this.index > 0 &&
      this.index === this.states.length - 1 &&
      /^(insertText|insertCompositionText|deleteContentBackward|deleteContentForward)$/.test(
        type,
      ) &&
      type === this.lastType &&
      now - this.lastTime < 1000 &&
      previous.source === before.source &&
      previous.start === before.start &&
      previous.end === before.end;
    this.states.splice(this.index + 1);
    if (grouped) this.states[this.index] = after;
    else {
      this.states[this.index] = before;
      this.states.push(after);
      this.index++;
    }
    this.lastType = type;
    this.lastTime = now;
    let bytes = this.states.reduce((sum, state) => sum + state.source.length * 2, 0);
    while (this.states.length > 2 && (this.states.length > 100 || bytes > 8 * 1024 * 1024)) {
      bytes -= this.states.shift().source.length * 2;
      this.index--;
    }
  }

  apply(state) {
    this.applying = true;
    try {
      const editor = this.editor;
      editor.value = state.source;
      editor.setSelectionRange(state.start, state.end, state.direction);
      editor.scrollTop = state.top;
      editor.scrollLeft = state.left;
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      editor.dispatchEvent(new Event('scroll'));
    } finally {
      this.applying = false;
    }
  }

  replace(source, start, end, direction) {
    const before = this.snapshot();
    const after = { ...before, source, start, end, direction };
    this.record(before, after, 'format');
    this.apply(after);
  }

  move(step) {
    const index = this.index + step;
    if (index < 0 || index >= this.states.length) return;
    this.index = index;
    this.lastType = null;
    this.before = null;
    this.apply(this.states[index]);
  }
}
