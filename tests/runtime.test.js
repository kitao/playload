import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import {
  Runtime,
  Sound,
  MAX_FRAME_STEPS,
  START_TIMEOUT,
  FRAME_TIMEOUT,
} from '../src/app/runtime.js';
import { compileScore } from '../src/engine/sound.js';
import { latinLetter } from '../src/app/keys.js';
import { EditorHistory } from '../src/app/editor-history.js';

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

test('failed sound setup closes its context and preserves the original error', async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'AudioContext', original);
    else delete globalThis.AudioContext;
  });
  for (const worklet of [false, true]) {
    let closed = 0;
    const failure = new Error('Worklet could not load');

    class Context {
      constructor() {
        if (worklet)
          this.audioWorklet = {
            addModule: async () => {
              throw failure;
            },
          };
      }

      async close() {
        closed++;
        throw new Error('Context already closed');
      }
    }

    Object.defineProperty(globalThis, 'AudioContext', { value: Context, configurable: true });
    const errors = [],
      sound = new Sound((message) => errors.push(message));
    sound.play([{ ch: 0, score: compileScore('c') }]);
    await assert.rejects(sound.init(), worklet ? failure : /AudioWorklet is not supported/);
    assert.equal(closed, 1);
    assert.equal(sound.context, undefined);
    assert.equal(sound.node, undefined);
    assert.doesNotThrow(() => sound.close());
    assert.equal(sound.failed, true);
    assert.deepEqual(sound.queue, []);
    assert.deepEqual(errors, [
      worklet ? failure.message : 'AudioWorklet is not supported by this browser.',
    ]);
  }
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

test('unavailable or denied workers report an error, release their URL, and allow retry', async (t) => {
  mockWorker(t);
  const SupportedWorker = globalThis.Worker,
    createURL = URL.createObjectURL.bind(URL),
    urls = [],
    errors = [],
    frames = t.mock.fn(),
    runtime = new Runtime(frames, (error) => errors.push(error));
  t.after(() => runtime.stop());
  t.mock.method(URL, 'createObjectURL', (blob) => {
    const url = createURL(blob);
    urls.push(url);
    return url;
  });
  for (const Worker of [
    undefined,
    class {
      constructor() {
        throw new DOMException('Game workers are blocked.', 'SecurityError');
      }
    },
  ]) {
    Object.defineProperty(globalThis, 'Worker', { value: Worker, configurable: true });
    assert.doesNotThrow(() => runtime.load('function tick() {}'));
    assert.equal(runtime.worker, null);
    assert.equal(runtime.workerURL, null);
    assert.equal(runtime.pending, false);
  }
  assert.deepEqual(
    errors.map((error) => error.message),
    ['This browser cannot run games.', 'Game workers are blocked.'],
  );
  assert.equal(urls.length, 1);
  await assert.rejects(fetch(urls[0]), TypeError);
  Object.defineProperty(globalThis, 'Worker', { value: SupportedWorker, configurable: true });
  runtime.load('function tick() {}');
  runtime.worker.onmessage({
    data: { type: 'ready', pixels: new Uint8Array(160 * 144), sounds: [] },
  });
  assert.equal(frames.mock.callCount(), 1);
  assert.equal(errors.length, 2);
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
    worker.onmessage({ data: { type: 'ready', pixels, sounds: [command] } });
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
  t.mock.timers.tick(FRAME_TIMEOUT);
  assert.equal(errors.mock.callCount(), malformed.length);
  assert.equal(worker.terminated, undefined);
});

test('the runtime accepts only the reply it is waiting for, as game code can post messages', (t) => {
  mockWorker(t);
  const frames = t.mock.fn();
  const errors = t.mock.fn();
  const runtime = new Runtime(frames, errors);
  t.after(() => runtime.stop());
  const pixels = new Uint8Array(160 * 144);
  const reply = (type) => runtime.worker.onmessage({ data: { type, pixels, sounds: [] } });
  for (const unsolicited of [
    () => reply('frame'),
    () => (reply('ready'), reply('ready')),
    () => (reply('ready'), reply('frame')),
    () => (reply('ready'), runtime.frame(), reply('ready')),
  ]) {
    runtime.load('function tick() {}');
    unsolicited();
    assert.equal(runtime.worker, null);
  }
  assert.equal(errors.mock.callCount(), 4);
  assert(
    errors.mock.calls.every(({ arguments: [error] }) => error.message === 'Invalid game frame.'),
  );
  // Each game's own ready reply still arrived.
  assert.equal(frames.mock.callCount(), 3);
});

test('a starting game gets the longer start budget, then each frame the short one', (t) => {
  mockWorker(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const errors = t.mock.fn();
  const runtime = new Runtime(() => {}, errors);
  t.after(() => runtime.stop());
  const pixels = new Uint8Array(160 * 144);
  assert(START_TIMEOUT > FRAME_TIMEOUT);
  runtime.load('function tick() {}');
  t.mock.timers.tick(START_TIMEOUT - 1);
  assert.equal(errors.mock.callCount(), 0);
  runtime.worker.onmessage({ data: { type: 'ready', pixels, sounds: [] } });
  runtime.frame();
  t.mock.timers.tick(FRAME_TIMEOUT - 1);
  assert.equal(errors.mock.callCount(), 0);
  t.mock.timers.tick(1);
  assert.deepEqual(errors.mock.calls[0].arguments, [{ message: 'The game stopped responding.' }]);
  runtime.load('while (true) {}');
  t.mock.timers.tick(START_TIMEOUT);
  assert.equal(errors.mock.callCount(), 2);
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
    const played = [];
    const play = processor.ay.play.bind(processor.ay);
    processor.ay.play = (ch, score) => {
      played.push({ at: processor.samples, ch, score });
      play(ch, score);
    };

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

    // Catch-up sounds retain their 1/60-second spacing across render blocks.
    const scores = ['c', 'd', 'e'].map((note) => compileScore('V15' + note));
    played.length = 0;
    const start = processor.samples;
    sound.play(scores.map((score, frame) => ({ ch: 0, score, frame })));
    render(1601);
    assert.deepEqual(
      played.map(({ at }) => at - start),
      [0, 800, 1600],
    );
    assert.deepEqual(
      played.map(({ score }) => score),
      scores,
    );

    // A later update flushes overdue effects before its current effect,
    // rather than letting a stale sound replace the new one in the future.
    played.length = 0;
    sound.play([{ ch: 0, score: scores[0], frame: 4 }]);
    sound.play([{ ch: 0, score: scores[1], frame: 0 }]);
    render(4000);
    assert.deepEqual(
      played.map(({ score }) => score),
      [scores[0], scores[1]],
    );

    played.length = 0;
    sound.play([{ ch: 0, score: scores[2], frame: 4 }]);
    sound.reset();
    render(4000);
    assert.deepEqual(played, []);
  } finally {
    if (originalContext) Object.defineProperty(globalThis, 'AudioContext', originalContext);
    else delete globalThis.AudioContext;
    if (originalNode) Object.defineProperty(globalThis, 'AudioWorkletNode', originalNode);
    else delete globalThis.AudioWorkletNode;
  }
});

test('batched worker ticks match individual ticks, rasterize once, and consume a press only once', async (t) => {
  mockWorker(t);
  const runtime = new Runtime(() => {}, assert.fail);
  t.after(() => runtime.stop());
  runtime.load('function tick() {}');
  const source = await (await fetch(runtime.worker.url)).text();

  const create = async () => {
    const messages = [];
    const context = { self: {}, postMessage: (message) => messages.push(structuredClone(message)) };
    runInNewContext(source, context);
    const send = (data) => context.self.onmessage({ data });
    await send({
      type: 'load',
      source: `
      let ticks = 0, presses = 0;
      function tick() {
        ticks++;
        if (btnp(4)) presses++;
        cls(ticks % 8);
        put(0, 0, String(presses));
        spr(ticks, 32, 'A', 7);
        play(0, ['c', 'd', 'e', 'f', 'g'][ticks % 5]);
      }
    `,
    });
    return { send, messages };
  };

  const individual = await create(),
    batch = await create();
  await individual.send({ type: 'input', mask: 16 });
  await batch.send({ type: 'input', mask: 16 });
  for (let i = 0; i < MAX_FRAME_STEPS; i++) await individual.send({ type: 'frame', steps: 1 });
  await batch.send({ type: 'frame', steps: MAX_FRAME_STEPS });
  const combined = batch.messages.at(-1);
  assert.equal(combined.type, 'frame');
  assert.equal(combined.steps, 5);
  assert.equal(batch.messages.length, 2);
  assert.deepEqual(combined.pixels, individual.messages.at(-1).pixels);
  assert.deepEqual(
    combined.sounds,
    individual.messages
      .slice(1)
      .flatMap((message, frame) => message.sounds.map((command) => ({ ...command, frame }))),
  );
});

test('each overflow kind adds one frame of wait, regardless of count, including setup and catch-up ticks', async (t) => {
  mockWorker(t);
  const runtime = new Runtime(() => {}, assert.fail);
  t.after(() => runtime.stop());
  runtime.load('function tick() {}');
  const source = await (await fetch(runtime.worker.url)).text();
  const messages = [],
    waits = [];
  const context = {
    self: {},
    postMessage: (message) => messages.push(structuredClone(message)),
    setTimeout: (callback, delay) => waits.push({ callback, delay }),
  };
  runInNewContext(source, context);
  const send = (data) => context.self.onmessage({ data });
  const starting = send({
    type: 'load',
    source: `
      for (let i = 0; i < 257; i++) pcg.X.pat[0] = 0;
      let frame = 0;
      function tick() {
        cls(0);
        if (frame === 1 || frame === 3)
          for (let i = 0; i < 258; i++) spr(-8, -8, 'X', 7);
        if (frame === 2 || frame === 3)
          for (let i = 0; i < 258; i++) pcg.X.pat[0] = 0;
        if (frame === 4)
          for (let i = 0; i < 5000; i++) pcg.X.pat[0] = 0;
        if (btnp(4)) put(0, 0, 'X', 7);
        play(0, 'c');
        frame++;
      }
    `,
  });
  assert.equal(messages.length, 0);
  assert.equal(waits.length, 1);
  assert.equal(waits[0].delay, 1000 / 60);
  // Input is still accepted while the worker is waiting.
  await send({ type: 'input', mask: 16 });
  waits.shift().callback();
  await starting;
  assert.equal(messages[0].type, 'ready');

  const pending = send({ type: 'frame', steps: MAX_FRAME_STEPS });
  for (const delayFrames of [1, 1, 2, 1]) {
    assert.equal(messages.length, 1);
    assert.equal(waits.length, 1);
    assert.equal(waits[0].delay, (delayFrames * 1000) / 60);
    waits.shift().callback();
    await new Promise(setImmediate);
  }
  await pending;
  assert.equal(waits.length, 0);
  const frame = messages[1];
  assert.equal(frame.type, 'frame');
  assert.equal(frame.steps, 5);
  assert.deepEqual(
    frame.sounds.map((command) => command.frame),
    [0, 1, 2, 3, 4],
  );
  assert(frame.pixels.every((color) => color === 0));
  await send({ type: 'frame', steps: 1 });
  assert.equal(waits.length, 0);
  assert.equal(messages.length, 3);
});

test('serialized workers reset limits and feedback on every tick, including batched ticks', async (t) => {
  mockWorker(t);
  const runtime = new Runtime(() => {}, assert.fail);
  t.after(() => runtime.stop());
  runtime.load('function tick() {}');
  // Compare batching with identical noise in both worker contexts.
  const source = 'Math.random = () => 0.5;\n' + (await (await fetch(runtime.worker.url)).text());
  const messages = [];
  const context = {
    self: {},
    postMessage: (message) => messages.push(structuredClone(message)),
    setTimeout: (callback) => callback(),
  };
  runInNewContext(source, context);
  const load = {
    data: {
      type: 'load',
      source: `
      Math.random = () => { throw Error('Game replacement used for feedback'); };
      let frame = 0;
      function tick() {
        if (frame === 6) { cls(0); return; }
        const base = 0xe000 + frame++ * 27;
        for (let i = 0; i < 27; i++) {
          const character = pcg[String.fromCodePoint(base + i)];
          character.pat.fill(255);
          character.col = [6, 1];
        }
        const last = pcg[String.fromCodePoint(base + 25)];
        if (last.pat[5] !== 255) throw Error('PCG not reset');
        if (last.pat[6] !== 0 || last.col[0] !== 7) throw Error('PCG overflow');
        cls(0);
        for (let i = 0; i < 257; i++)
          spr(i % 16 * 8, Math.floor(i / 16) * 8, String.fromCodePoint(base), 6);
      }
    `,
    },
  };
  await context.self.onmessage(load);
  await context.self.onmessage({ data: { type: 'frame', steps: MAX_FRAME_STEPS } });
  assert.deepEqual(
    messages.map((message) => message.type),
    ['ready', 'frame'],
  );
  const normal = Uint8Array.from({ length: 160 * 144 }, (_, i) =>
    i % 160 < 128 && i < 160 * 128 ? 6 : 0,
  );
  for (const message of messages) {
    const changed = message.pixels.filter((color, i) => color !== normal[i]).length;
    assert(changed > 0 && changed <= 14 * 160 + 64);
  }
  const individual = [],
    other = {
      self: {},
      postMessage: (message) => individual.push(structuredClone(message)),
      setTimeout: (callback) => callback(),
    };
  runInNewContext(source, other);
  await other.self.onmessage(load);
  for (let i = 0; i < MAX_FRAME_STEPS; i++)
    await other.self.onmessage({ data: { type: 'frame', steps: 1 } });
  assert.deepEqual(messages.at(-1).pixels, individual.at(-1).pixels);
  await context.self.onmessage({ data: { type: 'frame', steps: 1 } });
  assert(messages.at(-1).pixels.every((color) => color === 0));
});

test('runtime refuses extra outstanding batches and rejects invalid catch-up sound positions', (t) => {
  mockWorker(t);
  const errors = t.mock.fn();
  const runtime = new Runtime(() => {}, errors);
  t.after(() => runtime.stop());
  const pixels = new Uint8Array(160 * 144);
  for (const frame of [-1, 2, 0.5]) {
    runtime.load('function tick() {}');
    const worker = runtime.worker;
    worker.onmessage({ data: { type: 'ready', pixels, sounds: [] } });
    for (const steps of [0, 6, 1.5, NaN]) assert.equal(runtime.frame(steps), false);
    assert.equal(runtime.frame(2), true);
    assert.equal(runtime.frame(2), false);
    assert.equal(worker.messages.filter((message) => message.type === 'frame').length, 1);
    worker.onmessage({
      data: {
        type: 'frame',
        pixels,
        steps: 2,
        sounds: [{ ch: 0, score: compileScore('c'), frame }],
      },
    });
    assert.equal(worker.terminated, true);
  }
  assert.equal(errors.mock.callCount(), 3);
});

test('shortcut letters follow the printed Latin letter and use the position only for other scripts', () => {
  const letter = (code, key) => latinLetter({ code, key });
  // QWERTZ prints Z on the KeyY position; Shift only changes the case.
  assert.equal(letter('KeyY', 'z'), 'z');
  assert.equal(letter('KeyZ', 'Y'), 'y');
  // Cyrillic and Greek labels fall back to the key's position.
  assert.equal(letter('KeyZ', 'я'), 'z');
  assert.equal(letter('KeyZ', 'Ζ'), 'z');
  // Dvorak punctuation, accented Latin letters, digits and named keys are not letters a–z.
  for (const [code, key] of [
    ['KeyZ', ';'],
    ['KeyW', ','],
    ['KeyZ', 'à'],
    ['KeyE', 'é'],
    ['Digit1', '1'],
    ['KeyA', 'Dead'],
    ['KeyA', 'Unidentified'],
  ])
    assert.equal(letter(code, key), null, `${code} ${key}`);
});

// Just enough of a textarea for the history to observe edits and shortcuts.
class Editor {
  value = '';
  selectionStart = 0;
  selectionEnd = 0;
  selectionDirection = 'none';
  scrollTop = 0;
  scrollLeft = 0;
  listeners = new Map();
  addEventListener(type, listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  dispatchEvent(event) {
    for (const listener of this.listeners.get(event.type) ?? []) listener(event);
  }

  setSelectionRange(start, end, direction = 'none') {
    Object.assign(this, {
      selectionStart: start,
      selectionEnd: end,
      selectionDirection: direction,
    });
  }

  type(text) {
    this.dispatchEvent({ type: 'beforeinput', inputType: 'insertText' });
    this.value += text;
    this.setSelectionRange(this.value.length, this.value.length);
    this.dispatchEvent({ type: 'input', inputType: 'insertText' });
  }

  press(code, key, modifiers = { ctrlKey: true }) {
    const event = { type: 'keydown', code, key, ...modifiers, prevented: false };
    event.preventDefault = () => (event.prevented = true);
    event.stopPropagation = () => {};
    this.dispatchEvent(event);
    return event.prevented;
  }
}

test('undo and redo follow the printed letters on QWERTZ, Dvorak and Cyrillic layouts', () => {
  const editor = new Editor();
  new EditorHistory(editor);
  editor.type('abc');
  // QWERTZ prints Z on the KeyY position and Y on KeyZ.
  assert.equal(editor.press('KeyY', 'z'), true);
  assert.equal(editor.value, '');
  assert.equal(editor.press('KeyZ', 'y'), true);
  assert.equal(editor.value, 'abc');
  // Dvorak prints F on KeyY: the browser's find shortcut must stay untouched.
  assert.equal(editor.press('KeyY', 'f'), false);
  assert.equal(editor.value, 'abc');
  // Without a Latin label, the key's position decides.
  assert.equal(editor.press('KeyZ', 'я'), true);
  assert.equal(editor.value, '');
  assert.equal(editor.press('KeyZ', 'Я', { metaKey: true, shiftKey: true }), true);
  assert.equal(editor.value, 'abc');
});
