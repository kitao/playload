import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { Runtime, Sound } from '../src/runtime.js';
import { compileScore } from '../src/sound.js';

test('worker source remains readable until the worker is replaced or stopped', async (t) => {
  const originalWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  class Worker {
    constructor(url) {
      this.url = url;
    }
    postMessage() {}
    terminate() {
      this.terminated = true;
    }
  }
  Object.defineProperty(globalThis, 'Worker', { value: Worker, configurable: true });
  t.after(() => {
    if (originalWorker) Object.defineProperty(globalThis, 'Worker', originalWorker);
    else delete globalThis.Worker;
  });
  const runtime = new Runtime(() => {}, assert.fail);
  t.after(() => runtime.stop());

  runtime.load('function tick() {}');
  const first = runtime.worker;
  assert.match(await (await fetch(first.url)).text(), /gameWorker/);

  runtime.load('function tick() { cls(1); }');
  const second = runtime.worker;
  assert.equal(first.terminated, true);
  await assert.rejects(fetch(first.url), TypeError);
  assert.match(await (await fetch(second.url)).text(), /gameWorker/);

  runtime.stop();
  assert.equal(second.terminated, true);
  await assert.rejects(fetch(second.url), TypeError);
});

test('the serialized worklet freezes synthesis during pause and fades pause, resume and reset', async () => {
  let Processor;
  class WorkletProcessor {
    constructor() {
      this.port = { postMessage() {} };
    }
  }
  class Context {
    constructor() {
      this.destination = {};
      this.audioWorklet = {
        addModule: async (url) => {
          const source = await (await fetch(url)).text();
          runInNewContext(source, {
            sampleRate: 48000,
            AudioWorkletProcessor: WorkletProcessor,
            registerProcessor: (name, implementation) => {
              assert.equal(name, 'playload-ay');
              Processor = implementation;
            },
          });
        },
      };
    }
    createGain() {
      return {
        gain: { value: 1 },
        connect() {
          return this;
        },
      };
    }
    createMediaStreamDestination() {
      return {};
    }
  }
  class Node {
    constructor() {
      this.processor = new Processor();
      this.port = { postMessage: (data) => this.processor.port.onmessage({ data }) };
    }
    connect(target) {
      return target;
    }
  }
  const originalContext = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  const originalNode = Object.getOwnPropertyDescriptor(globalThis, 'AudioWorkletNode');
  Object.defineProperty(globalThis, 'AudioContext', { value: Context, configurable: true });
  Object.defineProperty(globalThis, 'AudioWorkletNode', { value: Node, configurable: true });
  try {
    const sound = new Sound((error) => assert.fail(error));
    await sound.init();
    sound.play([{ ch: 0, score: compileScore('V15O5N9a))') }]);
    const processor = sound.node.processor;
    const render = (length) => {
      const output = new Float32Array(length);
      assert.equal(processor.process([], [[output]]), true);
      return output;
    };
    render(1024);
    const held = processor.lastSample;
    assert(Math.abs(held) > 0.001);
    const before = JSON.stringify({
      voices: processor.ay.voices,
      phase: processor.ay.phase,
      noise: processor.ay.noise,
      position: processor.ay.position,
    });
    sound.pause(true);
    const paused = render(1024);
    assert.equal(
      JSON.stringify({
        voices: processor.ay.voices,
        phase: processor.ay.phase,
        noise: processor.ay.noise,
        position: processor.ay.position,
      }),
      before,
    );
    const ramp = 48000 * 0.004;
    for (let i = 0; i < ramp; i++)
      assert(Math.abs(paused[i] - held * Math.max(0, 1 - (i + 1) / ramp)) < 1e-6);
    assert(paused.subarray(ramp).every((x) => Math.abs(x) < 1e-6));
    sound.pause(false);
    const resumed = render(128);
    assert(resumed.some((x) => Math.abs(x) > 0.01));
    assert(Math.abs(resumed[0]) < 0.002);
    render(512);
    const previous = processor.lastSample;
    sound.reset();
    const reset = render(1024);
    assert(Math.abs(reset[0] - previous) < Math.abs(previous) / ramp + 1e-6);
    assert(reset.subarray(ramp).every((x) => Math.abs(x) < 1e-6));
    assert.equal(processor.ay.voices.filter(Boolean).length, 0);
  } finally {
    if (originalContext) Object.defineProperty(globalThis, 'AudioContext', originalContext);
    else delete globalThis.AudioContext;
    if (originalNode) Object.defineProperty(globalThis, 'AudioWorkletNode', originalNode);
    else delete globalThis.AudioWorkletNode;
  }
});

test('cached pages retain execution and media, then restore the watchdog and prior pause state', async (t) => {
  const source = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const lifecycle = source.slice(
    source.indexOf("window.addEventListener('beforeunload'"),
    source.indexOf("window.addEventListener('hashchange'"),
  );
  const playback = source.slice(
    source.indexOf('function syncPlayback()'),
    source.indexOf('function setView('),
  );
  const timers = new Map();
  let timerId = 0;
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => {
    const id = ++timerId;
    timers.set(id, { callback, delay });
    return id;
  });
  t.mock.method(globalThis, 'clearTimeout', (id) => timers.delete(id));

  const originalWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  class Worker {
    constructor() {
      this.messages = [];
    }
    postMessage(message) {
      this.messages.push(message);
    }
    terminate() {
      this.terminated = true;
    }
  }
  Object.defineProperty(globalThis, 'Worker', { value: Worker, configurable: true });
  t.after(() => {
    if (originalWorker) Object.defineProperty(globalThis, 'Worker', originalWorker);
    else delete globalThis.Worker;
  });

  for (const state of [
    { running: true, paused: false, view: 'code' },
    { running: true, paused: true, view: 'code' },
    { running: false, paused: false, view: 'code' },
    { running: true, paused: false, view: 'info' },
    { running: true, paused: true, view: 'code', awaitingStart: true, compact: true },
    { running: true, paused: false, view: 'code', compact: true, toolsOpen: true },
  ]) {
    const handlers = new Map();
    const runtime = new Runtime(() => {}, assert.fail);
    runtime.load('function tick() {}');
    const worker = runtime.worker;
    const audio = new Sound(assert.fail);
    audio.context = {
      state: 'running',
      close() {
        this.state = 'closed';
      },
    };
    audio.node = { port: { postMessage() {} } };
    const capture = {
      leave(value) {
        this.leaving = value;
      },
      suspend(value) {
        this.suspended = value;
      },
      close() {
        this.closed = true;
      },
    };
    const release = t.mock.fn(() => runtime.input(0));
    const clock = new Function(
      'window',
      'document',
      'runtime',
      'audio',
      'capture',
      'release',
      'running',
      'paused',
      'view',
      'compact',
      'toolsOpen',
      'awaitingStart',
      'let lastFrame = 123;\n' + playback + lifecycle + '\nreturn () => lastFrame;',
    )(
      { addEventListener: (type, handler) => handlers.set(type, handler) },
      { hidden: false },
      runtime,
      audio,
      capture,
      release,
      state.running,
      state.paused,
      state.view,
      !!state.compact,
      !!state.toolsOpen,
      !!state.awaitingStart,
    );

    assert.equal(timers.size, 1);
    handlers.get('beforeunload')();
    assert.equal(capture.leaving, true);
    handlers.get('pagehide')({ persisted: true });
    assert.equal(runtime.worker, worker);
    assert.equal(worker.terminated, undefined);
    assert.equal(audio.context.state, 'running');
    assert.equal(audio.paused, true);
    assert.equal(capture.suspended, true);
    assert.equal(release.mock.callCount(), 1);
    assert.equal(timers.size, 0);
    const messages = worker.messages.length;
    runtime.frame();
    assert.equal(worker.messages.length, messages);

    handlers.get('pageshow')({ persisted: true });
    assert.equal(clock(), 0);
    assert.equal(runtime.suspended, false);
    assert.equal(timers.size, 1);
    assert.equal([...timers.values()][0].delay, 1500);
    assert.equal(
      audio.paused,
      !state.running || state.paused || state.view === 'info' || !!state.toolsOpen,
    );
    assert.equal(capture.leaving, false);
    assert.equal(
      capture.suspended,
      !state.running || state.view === 'info' || !!state.awaitingStart || !!state.toolsOpen,
    );
    worker.onmessage({ data: { type: 'ready', pixels: new Uint8Array(160 * 144), sounds: [] } });
    assert.equal(timers.size, 0);

    // An idle worker needs no watchdog after restoration.
    handlers.get('pagehide')({ persisted: true });
    handlers.get('pageshow')({ persisted: true });
    assert.equal(timers.size, 0);
    handlers.get('pagehide')({ persisted: false });
    assert.equal(runtime.worker, null);
    assert.equal(worker.terminated, true);
    assert.equal(audio.context.state, 'closed');
    assert.equal(capture.closed, true);
  }
});

test('game input follows keyboard labels and releases the original physical keys', async () => {
  const source = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const handlersSource = source.slice(
    source.indexOf('const keyCodes ='),
    source.indexOf("for (const button of document.querySelectorAll('[data-input]')) {"),
  );
  const syncSource = source.slice(
    source.indexOf('function syncInput('),
    source.indexOf('function readGamepads('),
  );
  const releaseSource = source.slice(
    source.indexOf('function release()'),
    source.indexOf('function focusGame('),
  );
  const handlers = new Map();
  const screen = {};
  const runtime = {
    input(mask) {
      this.mask = mask;
    },
  };
  const keys = new Map();
  const release = new Function(
    'document',
    '$',
    'runtime',
    'audio',
    'keys',
    'let view = "code", running = true, paused = false, gamepadMask = 0; ' +
      'let compact = false, toolsOpen = false, awaitingStart = false; ' +
      'const pointers = new Map(), directions = new Set(); const readGamepads = () => 0;\n' +
      releaseSource +
      syncSource +
      handlersSource +
      '\nreturn release;',
  )(
    {
      activeElement: screen,
      addEventListener: (type, handler) => handlers.set(type, handler),
      querySelectorAll: () => [],
    },
    (id) => (id === 'screen' ? screen : { disabled: true }),
    runtime,
    { unlock() {} },
    keys,
  );
  function input(type, code, key, extras = {}) {
    handlers.get(type)({
      code,
      key,
      target: { closest: () => null },
      preventDefault() {},
      ...extras,
    });
  }

  for (const [code, key] of [
    ['KeyZ', 'z'],
    ['KeyW', 'z'],
    ['KeyY', 'Z'],
    ['KeyZ', 'я'],
  ]) {
    input('keydown', code, key);
    assert.equal(runtime.mask, 16);
    input('keyup', code, 'Process');
    assert.equal(runtime.mask, 0);
  }
  for (const key of ['q', 'y']) {
    input('keydown', 'KeyZ', key);
    assert.equal(runtime.mask, 0);
  }
  input('keydown', 'KeyY', 'z');
  input('keydown', 'KeyZ', 'я');
  input('keydown', 'KeyX', 'x');
  assert.equal(runtime.mask, 48);
  input('keyup', 'KeyY', 'y');
  assert.equal(runtime.mask, 48);
  input('keyup', 'KeyZ', 'Z', { shiftKey: true });
  assert.equal(runtime.mask, 32);
  input('keyup', 'KeyX', 'ч');
  assert.equal(runtime.mask, 0);

  for (const [code, key, id] of [
    ['KeyW', 'w', 0],
    ['KeyS', 's', 1],
    ['KeyA', 'a', 2],
    ['KeyD', 'D', 3],
    ['KeyJ', 'j', 4],
    ['KeyK', 'k', 5],
    ['KeyQ', 'a', 2],
    ['KeyJ', 'о', 4],
    ['KeyK', 'л', 5],
  ]) {
    input('keydown', code, key);
    assert.equal(runtime.mask, 1 << id);
    input('keyup', code, 'Process');
    assert.equal(runtime.mask, 0);
  }
  input('keydown', 'KeyZ', 'z');
  input('keydown', 'KeyJ', 'j');
  assert.equal(runtime.mask, 16);
  input('keyup', 'KeyZ', 'z');
  assert.equal(runtime.mask, 16);
  input('keyup', 'KeyJ', 'j');
  assert.equal(runtime.mask, 0);

  for (const [id, code] of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].entries()) {
    input('keydown', code, code);
    assert.equal(runtime.mask, (1 << (id + 1)) - 1);
  }
  release();
  assert.equal(runtime.mask, 0);
  assert.equal(keys.size, 0);
  for (const extras of [
    { isComposing: true },
    { ctrlKey: true },
    { altKey: true },
    { metaKey: true },
    { target: { closest: () => ({}) } },
  ]) {
    for (const key of ['z', 'w', 's', 'a', 'd', 'j', 'k']) {
      input('keydown', 'Key' + key.toUpperCase(), key, extras);
      assert.equal(runtime.mask, 0);
    }
  }
});
