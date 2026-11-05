import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorHighlighter } from '../src/app/editor-highlighter.js';

test('highlighting cancels slow and outdated work, keeps plain text, and recovers on editing', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const descriptors = Object.fromEntries(
    ['Worker', 'location'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  const workers = [];
  class Worker {
    constructor() {
      workers.push(this);
    }
    postMessage(source) {
      this.source = source;
    }
    terminate() {
      this.terminated = true;
    }
  }
  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: Worker });
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { href: 'https://example.test/playload/app/' },
  });
  t.after(() => {
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const preview = { dataset: { highlighter: '/highlighter.js' } };
  const highlighter = new EditorHighlighter(preview, { classList: { toggle() {} } });
  t.after(() => highlighter.stop());
  highlighter.update('slow source');
  assert.equal(preview.textContent, 'slow source\n');
  t.mock.timers.tick(50);
  const stale = workers[0].onmessage;
  highlighter.update('latest source');
  assert.equal(workers[0].terminated, true);
  stale({ data: 'stale HTML' });
  assert.equal(preview.innerHTML, undefined);
  t.mock.timers.tick(50);
  workers[1].onmessage({ data: '<span>latest source</span>' });
  assert.equal(preview.innerHTML, '<span>latest source</span>\n');
  highlighter.update('another slow source');
  t.mock.timers.tick(50);
  t.mock.timers.tick(500);
  assert.equal(workers[1].terminated, true);
  assert.equal(preview.textContent, 'another slow source\n');
  highlighter.update('recovery');
  t.mock.timers.tick(50);
  workers[2].onmessage({ data: '<span>recovery</span>' });
  assert.equal(preview.innerHTML, '<span>recovery</span>\n');
});
