import test from 'node:test';
import assert from 'node:assert/strict';
import { Playback } from '../src/app/playback.js';
import { Runtime, Sound } from '../src/app/runtime.js';

test('the scheduler keeps time while busy and bounds recovery after rendering stalls', () => {
  const accepted = [],
    attempted = [];
  let busy = false;
  const playback = new Playback({
    document: { hidden: false },
    runtime: {
      frame(steps) {
        attempted.push(steps);
        if (busy) return false;
        accepted.push(steps);
        return true;
      },
    },
  });
  playback.running = true;
  playback.advance(0);
  busy = true;
  playback.advance(1000 / 60);
  playback.advance(1000 / 30);
  busy = false;
  playback.advance(50);
  assert.deepEqual(accepted, [3]);
  assert.equal(playback.lastFrame, 50);
  playback.advance(250);
  playback.advance(10000);
  assert.deepEqual(accepted, [3, 5, 1]);
  playback.paused = true;
  playback.advance(20000);
  playback.paused = false;
  playback.advance(30000);
  playback.advance(30000 + 1000 / 60);
  assert.deepEqual(accepted, [3, 5, 1, 1]);
  assert(attempted.every((steps) => steps >= 1 && steps <= 5));
});

test('paused video refreshes cached pixels at 30 Hz without advancing the game', () => {
  const copies = [];
  const canvas = { getContext: () => ({ drawImage: (...args) => copies.push(args) }) };
  const playback = new Playback({
    canvas,
    document: { hidden: false },
    runtime: { frame: assert.fail },
  });
  playback.running = true;
  playback.paused = true;
  playback.capture = { stream: {}, suspended: false };
  playback.advance(1000);
  playback.advance(1010);
  assert.deepEqual(copies, [[canvas, 0, 0]]);
  playback.paintedFrame = true;
  playback.advance(1040);
  assert.equal(copies.length, 1);
  playback.advance(1080);
  assert.equal(copies.length, 2);
  playback.capture.suspended = true;
  playback.advance(2000);
  assert.equal(copies.length, 2);
});

test('hidden pages retain sound while game updates and recording stop', () => {
  let paused, suspended;
  const playback = new Playback({
    document: { hidden: true },
    audio: {
      pause: (value) => {
        paused = value;
      },
    },
    runtime: { frame: assert.fail },
  });
  playback.running = true;
  playback.capture = {
    stream: {},
    suspend: (value) => {
      suspended = value;
    },
  };
  playback.sync();
  playback.advance(1000);
  assert.equal(paused, false);
  assert.equal(suspended, true);
  assert.equal(playback.lastFrame, null);
});

test('cached pages restore the watchdog and prior pause state, then close resources on departure', (t) => {
  const timers = new Map();
  let timerId = 0;
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => {
    const id = ++timerId;
    timers.set(id, { callback, delay });
    return id;
  });
  t.mock.method(globalThis, 'clearTimeout', (id) => timers.delete(id));
  const originalWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  Object.defineProperty(globalThis, 'Worker', {
    configurable: true,
    value: class {
      postMessage() {}
      terminate() {
        this.terminated = true;
      }
    },
  });
  t.after(() => {
    if (originalWorker) Object.defineProperty(globalThis, 'Worker', originalWorker);
    else delete globalThis.Worker;
  });
  for (const state of [
    { running: true, paused: false, active: true },
    { running: true, paused: true, active: true },
    { running: false, paused: false, active: true },
    { running: true, paused: false, active: false },
    { running: true, paused: true, active: true, awaitingStart: true },
  ]) {
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
    const playback = Object.assign(
      new Playback({ runtime, audio, document: { hidden: false }, isActive: () => state.active }),
      state,
      { capture },
    );
    playback.pagehide(true);
    assert.equal(runtime.worker, worker);
    assert.equal(runtime.suspended, true);
    assert.equal(audio.paused, true);
    assert.equal(capture.suspended, true);
    assert.equal(capture.leaving, true);
    assert.equal(timers.size, 0);
    playback.pageshow(true);
    assert.equal(runtime.suspended, false);
    assert.equal(capture.leaving, false);
    assert.equal(audio.paused, !state.running || state.paused || !state.active);
    assert.equal(capture.suspended, !state.running || !state.active || !!state.awaitingStart);
    assert.equal(timers.size, 1);
    worker.onmessage({ data: { type: 'ready', pixels: new Uint8Array(160 * 144), sounds: [] } });
    playback.pagehide(true);
    playback.pageshow(true);
    assert.equal(timers.size, 0);
    playback.pagehide(false);
    assert.equal(runtime.worker, null);
    assert.equal(worker.terminated, true);
    assert.equal(audio.context.state, 'closed');
    assert.equal(capture.closed, true);
    assert.equal(playback.revision, 1);
  }
});

test('pending audio initialization cannot start video capture after navigation', async (t) => {
  for (const navigation of ['none', 'hashchange', 'pagehide']) {
    const initializing = Promise.withResolvers(),
      start = t.mock.fn(),
      leave = t.mock.fn(),
      createCapture = t.mock.fn(() => ({ start, leave, suspend() {} }));
    const audio = {
      context: { state: 'running' },
      destination: { stream: {} },
      play() {},
      pause() {},
      close() {},
      init: t.mock.fn(() => initializing.promise),
    };
    const runtime = { stop: t.mock.fn() };
    const playback = new Playback({
      canvas: {},
      audio,
      runtime,
      render() {},
      createCapture,
      document: { hidden: false },
      onVideoError: assert.fail,
    });
    const ready = playback.frame(new Uint8Array(160 * 144), [], true);
    assert.equal(audio.init.mock.callCount(), 1);
    assert.equal(createCapture.mock.callCount(), 0);
    if (navigation === 'hashchange') playback.navigate();
    if (navigation === 'pagehide') playback.pagehide(false);
    initializing.resolve();
    await ready;
    const active = navigation === 'none';
    assert.equal(createCapture.mock.callCount(), active ? 1 : 0, navigation);
    assert.equal(start.mock.callCount(), active ? 1 : 0, navigation);
    assert.equal(typeof audio.context.onstatechange, active ? 'function' : 'undefined');
    assert.equal(runtime.stop.mock.callCount(), navigation === 'pagehide' ? 1 : 0);
    if (active) {
      playback.navigate();
      assert.deepEqual(leave.mock.calls[0].arguments, [true]);
    }
  }
});
