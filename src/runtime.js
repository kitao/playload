import { createEngine } from './engine.js?v=15';
import { compileScore, AY } from './sound.js?v=13';
import { glyphs } from './glyphs.js?v=18';

function gameWorker(presets, engineFactory, compiler) {
  let engine, tick;
  self.onmessage = ({ data }) => {
    try {
      switch (data.type) {
        case 'load': {
          engine = engineFactory(presets, compiler);
          const api = engine.api;
          tick = new Function(
            ...Object.keys(api),
            data.source +
              '\n;return typeof tick === "function" ? tick : null;\n//# sourceURL=playload-game.js',
          )(...Object.values(api));
          if (!tick) throw new Error('Define function tick()');
          engine.step(tick);
          postMessage({ type: 'ready', pixels: engine.pixels, sounds: engine.sounds() });
          break;
        }
        case 'input':
          engine?.input(data.mask);
          break;
        case 'frame':
          engine.step(tick);
          postMessage({ type: 'frame', pixels: engine.pixels, sounds: engine.sounds() });
          break;
      }
    } catch (error) {
      const line = /playload-game\.js:(\d+):/.exec(error?.stack ?? '');
      // WebKit gives anonymous Function bodies a line but no source URL in their stack.
      const gameLine = line
        ? Number(line[1])
        : !error?.sourceURL && Number.isInteger(error?.line)
          ? error.line
          : null;
      postMessage({
        type: 'error',
        message: String(error?.message ?? error),
        line: gameLine === null ? null : Math.max(1, gameLine - 2),
      });
    }
  };
}

// Catalog names and author metadata stay in the UI; workers only need artwork.
const workerPresets = JSON.stringify(
  glyphs.map(({ ch, rows, ink, paper }) => ({ ch, rows, ink, paper })),
);

// Games run off the UI thread. A stuck game can be terminated without losing the editor.
export class Runtime {
  constructor(onFrame, onError) {
    this.onFrame = onFrame;
    this.onError = onError;
  }
  load(source) {
    this.stop();
    const code = `(${gameWorker})(${workerPresets},${createEngine},${compileScore});`;
    this.workerURL = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    this.worker = new Worker(this.workerURL);
    this.pending = true;
    this.worker.onmessage = ({ data }) => {
      if (data?.type === 'error') {
        this.fail({
          message: String(data.message),
          line: Number.isInteger(data.line) ? data.line : null,
        });
        return;
      }
      if (
        !['ready', 'frame'].includes(data?.type) ||
        !(data.pixels instanceof Uint8Array) ||
        data.pixels.length !== 160 * 144 ||
        data.pixels.some((c) => c > 7) ||
        !Array.isArray(data.sounds) ||
        data.sounds.length > 256 ||
        !data.sounds.every(
          (command) =>
            Number.isInteger(command?.ch) &&
            command.ch >= 0 &&
            command.ch <= 2 &&
            command.score &&
            Array.isArray(command.score.code) &&
            command.score.code.length <= 16384 &&
            command.score.code.every((event) => validEvent(event, command.score.code.length)),
        )
      ) {
        this.fail({ message: 'Invalid game frame.' });
        return;
      }
      clearTimeout(this.watchdog);
      this.pending = false;
      this.onFrame(data.pixels, data.sounds, data.type === 'ready');
    };
    this.worker.onerror = (event) => {
      event.preventDefault();
      this.fail({ message: event.message });
    };
    this.worker.postMessage({ type: 'load', source });
    this.watch();
  }
  watch() {
    if (this.suspended) return;
    this.watchdog = setTimeout(() => this.fail({ message: 'The game stopped responding.' }), 1500);
  }
  suspend(value) {
    this.suspended = value;
    clearTimeout(this.watchdog);
    if (!value && this.worker && this.pending) this.watch();
  }
  fail(error) {
    this.stop();
    this.onError(error);
  }
  frame() {
    if (!this.worker || this.pending || this.suspended) return;
    this.pending = true;
    this.worker.postMessage({ type: 'frame' });
    this.watch();
  }
  input(mask) {
    this.worker?.postMessage({ type: 'input', mask });
  }
  stop() {
    clearTimeout(this.watchdog);
    this.worker?.terminate();
    this.worker = null;
    if (this.workerURL) URL.revokeObjectURL(this.workerURL);
    this.workerURL = null;
    this.pending = false;
    this.suspended = false;
  }
}

export class Sound {
  constructor(onError) {
    this.onError = onError;
    this.enabled = true;
    this.paused = false;
    this.queue = [];
  }
  async init() {
    if (this.initializing) return this.initializing;
    this.initializing = this.setup();
    return this.initializing;
  }
  async setup() {
    try {
      this.context = new AudioContext();
      const source = `${AY}\nclass Processor extends AudioWorkletProcessor {
        constructor() {
          super();
          this.ay = new AY(sampleRate);
          this.paused = false;
          this.gain = 1;
          this.lastSample = 0;
          this.previous = 0;
          this.transition = 0;

          this.port.onmessage = ({ data }) => {
            if (data.type === 'play') this.ay.play(data.ch, data.score);
            if (data.type === 'reset') {
              this.previous = this.lastSample;
              this.transition = 1;
              this.ay.reset();
            }
            if (data.type === 'pause') this.paused = data.value;
          };
        }

        process(inputs, outputs) {
          try {
            const output = outputs[0][0],
              step = 1 / (sampleRate * 0.004);

            for (let i = 0; i < output.length; i++) {
              this.gain = Math.max(0, Math.min(1, this.gain + (this.paused ? -step : step)));
              if (!this.paused) {
                this.transition = Math.max(0, this.transition - step);
                this.lastSample =
                  this.previous * this.transition + this.ay.sample() * (1 - this.transition);
              }
              output[i] = this.lastSample * this.gain;
            }
          } catch (error) {
            this.ay.reset();
            this.port.postMessage({ error: error.message });
          }
          return true;
        }
      }

      registerProcessor('playload-ay', Processor);`;
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      try {
        await this.context.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      this.node = new AudioWorkletNode(this.context, 'playload-ay', { outputChannelCount: [1] });
      this.monitor = this.context.createGain();
      this.monitor.gain.value = this.enabled ? 1 : 0;
      this.destination = this.context.createMediaStreamDestination();
      this.node.connect(this.monitor).connect(this.context.destination);
      this.node.connect(this.destination);
      this.node.port.onmessage = ({ data }) => this.onError(data.error);
      this.node.port.postMessage({ type: 'pause', value: this.paused });
      for (const command of this.queue) this.node.port.postMessage(command);
      this.queue = [];
    } catch (error) {
      this.failed = true;
      this.queue = [];
      this.onError(error.message);
      throw error;
    }
  }
  send(command) {
    if (this.failed) return;
    if (this.node) this.node.port.postMessage(command);
    else this.queue.push(command);
  }
  play(commands) {
    for (const command of commands) this.send({ type: 'play', ...command });
  }
  reset() {
    this.queue = [];
    this.send({ type: 'reset' });
  }
  pause(value) {
    this.paused = value;
    this.send({ type: 'pause', value });
  }
  mute(value) {
    this.enabled = !value;
    if (this.monitor) {
      const gain = this.monitor.gain,
        now = this.context.currentTime;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(gain.value, now);
      gain.linearRampToValueAtTime(value ? 0 : 1, now + 0.004);
    }
  }
  unlock() {
    if (this.context?.state === 'suspended') this.context.resume().catch(() => {});
  }
  close() {
    this.context?.close();
  }
}

function validEvent(event, length) {
  if (!event || typeof event !== 'object') return false;
  if (event.op === 'note')
    return (
      Number.isFinite(event.frequency) &&
      event.frequency >= 0 &&
      Number.isFinite(event.beats) &&
      event.beats > 0
    );
  if (event.op === 'repeat')
    return (
      Number.isInteger(event.start) &&
      event.start >= 0 &&
      event.start < length &&
      (event.count === 0 || event.count === 2)
    );
  if (event.op === 'U' || event.op === 'H') return true;
  const range = { V: [0, 15], W: [0, 7], X: [0, 65535], T: [60, 240], M: [1, 63] }[event.op];
  return (
    !!range && Number.isInteger(event.value) && event.value >= range[0] && event.value <= range[1]
  );
}
