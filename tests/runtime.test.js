import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { Runtime, Sound } from '../src/app/runtime.js';
import { compileScore } from '../src/engine/sound.js';

function mockWorker(t) {
  const originalWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  class Worker {
    constructor(url) {
      this.url = url;
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
}

test('insecure pages report the HTTPS requirement before creating sound resources', async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'isSecureContext');
  Object.defineProperty(globalThis, 'isSecureContext', { value: false, configurable: true });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'isSecureContext', original);
    else delete globalThis.isSecureContext;
  });
  const errors = [],
    sound = new Sound((message) => errors.push(message));
  sound.play([{ ch: 0, score: compileScore('c') }]);

  await assert.rejects(sound.init(), /Use HTTPS or localhost to enable sound\./);

  assert.deepEqual(errors, ['Use HTTPS or localhost to enable sound.']);
  assert.equal(sound.context, undefined);
  assert.equal(sound.failed, true);
  assert.deepEqual(sound.queue, []);
});

test('sound can retry a blocked unlock and recover after a device interruption', async () => {
  const sound = new Sound(assert.fail);
  let attempts = 0;
  sound.context = {
    state: 'suspended',
    async resume() {
      attempts++;
      if (attempts === 1) throw new Error('A completed tap is required');
      this.state = 'running';
    },
  };

  sound.unlock();
  await Promise.resolve();
  assert.equal(sound.context.state, 'suspended');
  sound.unlock();
  assert.equal(sound.context.state, 'running');

  sound.context.state = 'interrupted';
  sound.unlock();
  assert.equal(sound.context.state, 'running');
  sound.unlock();
  sound.context.state = 'closed';
  sound.unlock();
  assert.equal(attempts, 3);
});

test('worker source remains readable until the worker is replaced or stopped', async (t) => {
  mockWorker(t);
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

test('invalid sound frames stop the worker and valid playback recovers after loading again', (t) => {
  mockWorker(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const frames = t.mock.fn();
  const errors = t.mock.fn();
  const runtime = new Runtime(frames, errors);
  t.after(() => runtime.stop());
  const pixels = new Uint8Array(160 * 144);
  const sound = (event) => ({ ch: 0, score: { code: [event] } });
  const malformed = [
    ['negative channel', { ch: -1, score: compileScore('c') }],
    ['high channel', { ch: 3, score: compileScore('c') }],
    ['fractional channel', { ch: 0.5, score: compileScore('c') }],
    ['missing score', { ch: 0 }],
    ['non-array score', { ch: 0, score: { code: {} } }],
    ['negative frequency', sound({ op: 'note', frequency: -1, beats: 1 })],
    ['non-finite frequency', sound({ op: 'note', frequency: NaN, beats: 1 })],
    ['zero duration', sound({ op: 'note', frequency: 440, beats: 0 })],
    ['non-finite duration', sound({ op: 'note', frequency: 440, beats: Infinity })],
    ['repeat target', sound({ op: 'repeat', start: 1, count: 2 })],
    ['repeat count', sound({ op: 'repeat', start: 0, count: 1 })],
    ['unknown command', sound({ op: 'unknown' })],
    ['high volume', sound({ op: 'V', value: 16 })],
    ['fractional volume', sound({ op: 'V', value: 0.5 })],
    ['low mixer', sound({ op: 'M', value: 0 })],
  ];
  for (const [name, command] of malformed) {
    runtime.load('function tick() {}');
    const worker = runtime.worker;
    worker.onmessage({ data: { type: 'frame', pixels, sounds: [command] } });
    assert.equal(frames.mock.callCount(), 0, name);
    assert.equal(worker.terminated, true, name);
    assert.equal(runtime.worker, null, name);
    assert.equal(runtime.workerURL, null, name);
    assert.equal(runtime.pending, false, name);
    assert.deepEqual(errors.mock.calls.at(-1).arguments, [{ message: 'Invalid game frame.' }]);
  }
  assert.equal(errors.mock.callCount(), malformed.length);

  runtime.load('function tick() {}');
  const worker = runtime.worker;
  const sounds = [
    { ch: 0, score: compileScore('T60V0UX0W0M1O0N1c&H') },
    { ch: 2, score: compileScore('T240V15UX65535W7M63O8N12C))') },
  ];
  worker.onmessage({ data: { type: 'ready', pixels, sounds } });
  assert.deepEqual(frames.mock.calls[0].arguments, [pixels, sounds, true]);
  runtime.frame();
  runtime.frame();
  assert.deepEqual(
    worker.messages.map((message) => message.type),
    ['load', 'frame'],
  );
  worker.onmessage({ data: { type: 'frame', pixels, sounds } });
  assert.deepEqual(frames.mock.calls[1].arguments, [pixels, sounds, false]);
  assert.equal(runtime.pending, false);
  t.mock.timers.tick(1500);
  assert.equal(errors.mock.callCount(), malformed.length);
  assert.equal(worker.terminated, undefined);
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
  const source = await readFile(new URL('../src/app/main.js', import.meta.url), 'utf8');
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

  mockWorker(t);

  for (const state of [
    { running: true, paused: false, view: 'play' },
    { running: true, paused: true, view: 'play' },
    { running: false, paused: false, view: 'play' },
    { running: true, paused: false, view: 'info' },
    { running: true, paused: true, view: 'play', awaitingStart: true, compact: true },
    { running: true, paused: false, view: 'play', compact: true, toolsOpen: true },
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
    const startKeys = new Set(['KeyZ']);
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
      'startKeys',
      'let lastFrame = 123, revision = 0;\n' +
        playback +
        lifecycle +
        '\nreturn () => ({lastFrame, revision});',
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
      startKeys,
    );

    assert.equal(timers.size, 1);
    handlers.get('beforeunload')();
    assert.equal(capture.leaving, true);
    handlers.get('pagehide')({ persisted: true });
    assert.equal(startKeys.size, 0);
    assert.equal(runtime.worker, worker);
    assert.equal(worker.terminated, undefined);
    assert.equal(audio.context.state, 'running');
    assert.equal(audio.paused, true);
    assert.equal(capture.suspended, true);
    assert.equal(release.mock.callCount(), 1);
    assert.equal(timers.size, 0);
    assert.equal(clock().revision, 0);
    const messages = worker.messages.length;
    runtime.frame();
    assert.equal(worker.messages.length, messages);

    handlers.get('pageshow')({ persisted: true });
    assert.deepEqual(clock(), { lastFrame: 0, revision: 0 });
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
    assert.equal(clock().revision, 1);
  }
});

test('pending audio initialization cannot start video capture after navigation', async (t) => {
  const source = await readFile(new URL('../src/app/main.js', import.meta.url), 'utf8');
  const frame = source.slice(
    source.indexOf('async function frame('),
    source.indexOf('function run('),
  );
  const lifecycle = source.slice(
    source.indexOf("window.addEventListener('beforeunload'"),
    source.indexOf('function animate('),
  );

  for (const navigation of ['none', 'hashchange', 'pagehide']) {
    const handlers = new Map();
    const initializing = Promise.withResolvers();
    const start = t.mock.fn();
    const Capture = t.mock.fn(function () {
      this.start = start;
      this.leave = t.mock.fn();
    });
    const context = {
      window: { addEventListener: (type, handler) => handlers.set(type, handler) },
      document: { hidden: false },
      location: { reload: t.mock.fn() },
      runtime: { stop: t.mock.fn() },
      audio: {
        context: { state: 'running' },
        destination: { stream: {} },
        play() {},
        init: t.mock.fn(() => initializing.promise),
        close() {},
      },
      Capture,
      capture: undefined,
      canvas: {},
      revision: 0,
      running: false,
      paused: false,
      awaitingStart: false,
      startKeys: new Set(),
      gameError: '',
      $: () => ({ hidden: false }),
      render() {},
      syncPlayback() {},
      updateError() {},
      controls() {},
      focusAfterRun() {},
      release() {},
      status: assert.fail,
    };
    runInNewContext(frame + lifecycle, context);
    const ready = context.frame(new Uint8Array(160 * 144), [], true);
    assert.equal(context.audio.init.mock.callCount(), 1);
    assert.equal(Capture.mock.callCount(), 0);
    if (navigation === 'hashchange') handlers.get('hashchange')();
    if (navigation === 'pagehide') handlers.get('pagehide')({ persisted: false });
    initializing.resolve();
    await ready;

    const active = navigation === 'none';
    assert.equal(Capture.mock.callCount(), active ? 1 : 0, navigation);
    assert.equal(start.mock.callCount(), active ? 1 : 0, navigation);
    assert.equal(typeof context.audio.context.onstatechange, active ? 'function' : 'undefined');
    assert.equal(context.location.reload.mock.callCount(), navigation === 'hashchange' ? 1 : 0);
    assert.equal(context.runtime.stop.mock.callCount(), navigation === 'pagehide' ? 1 : 0);
    if (active) {
      handlers.get('hashchange')();
      assert.equal(context.capture.leave.mock.callCount(), 1);
      assert.equal(context.capture.leave.mock.calls[0].arguments[0], true);
    }
  }
});

test('game input follows keyboard labels and releases the original physical keys', async () => {
  const source = await readFile(new URL('../src/app/main.js', import.meta.url), 'utf8');
  const handlersSource = source.slice(
    source.indexOf('const keyCodes ='),
    source.indexOf("const dpad = document.querySelector('.dpad');"),
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
    'let view = "play", running = true, paused = false, gamepadMask = 0; ' +
      'let compact = false, toolsOpen = false, awaitingStart = false; ' +
      'const pointers = new Map(), directions = new Set(), startKeys = new Set(); ' +
      'const readGamepads = () => 0;\n' +
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
