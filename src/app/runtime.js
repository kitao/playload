import { AY } from '../engine/sound.js';
import { GameSandbox } from './game-sandbox.js';
import { MAX_FRAME_STEPS, readGameReply } from './game-messages.js';

export { MAX_FRAME_STEPS } from './game-messages.js';
// Starting a game also starts its worker, parses the engine and presets and runs
// the game's top-level code, so slow or busy devices get longer than for a frame.
export const START_TIMEOUT = 5000;
export const FRAME_TIMEOUT = 1500;

// Games run off the UI thread. A stuck game can be terminated without losing the editor.
export class Runtime {
  constructor(onFrame, onError, createWorker = () => new GameSandbox()) {
    this.createWorker = createWorker;
    this.onFrame = onFrame;
    this.onError = onError;
  }

  load(source) {
    this.stop();
    try {
      this.worker = this.createWorker();
    } catch (error) {
      this.fail({ message: String(error?.message ?? error) });
      return;
    }

    this.pending = true;
    this.starting = true;
    this.worker.onmessage = ({ data }) => {
      try {
        if (!this.pending && data?.type !== 'error') throw new Error('Invalid game frame.');
        data = readGameReply(data, this.starting, this.pendingSteps);
      } catch {
        this.fail({ message: 'Invalid game frame.' });
        return;
      }
      if (data.type === 'error') {
        this.fail({ message: data.message, line: data.line });
        return;
      }

      clearTimeout(this.watchdog);
      this.pending = false;
      this.starting = false;
      this.onFrame(data.pixels, data.sounds, data.type === 'ready');
    };
    this.worker.onerror = (event) => {
      event.preventDefault?.();
      this.fail({ message: event.message });
    };

    this.worker.postMessage({ type: 'load', source });
    this.watch();
  }

  watch() {
    if (this.suspended) return;
    this.watchdog = setTimeout(
      () => this.fail({ message: 'The game stopped responding.' }),
      this.starting ? START_TIMEOUT : FRAME_TIMEOUT,
    );
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

  frame(steps = 1) {
    if (
      !this.worker ||
      this.pending ||
      this.suspended ||
      !Number.isInteger(steps) ||
      steps < 1 ||
      steps > MAX_FRAME_STEPS
    )
      return false;
    this.pending = true;
    this.pendingSteps = steps;
    this.worker.postMessage({ type: 'frame', steps });
    this.watch();
    return true;
  }

  input(mask) {
    this.worker?.postMessage({ type: 'input', mask });
  }

  stop() {
    clearTimeout(this.watchdog);
    this.worker?.terminate();
    this.worker = null;
    this.pending = false;
    this.starting = false;
    this.pendingSteps = 1;
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
      if (globalThis.isSecureContext === false)
        throw new Error('Use HTTPS or localhost to enable sound.');
      this.context = new AudioContext();
      if (!this.context.audioWorklet)
        throw new Error('AudioWorklet is not supported by this browser.');

      // Bind the serialized class explicitly; minification can rename its declaration.
      const source = `const AY = ${AY};\nclass Processor extends AudioWorkletProcessor {
        constructor() {
          super();
          this.ay = new AY(sampleRate);
          this.paused = false;
          this.gain = 1;
          this.lastSample = 0;
          this.previous = 0;
          this.transition = 0;
          this.samples = 0;
          this.commands = [];

          this.port.onmessage = ({ data }) => {
            if (data.type === 'play') {
              // A newer game frame makes any remaining older effects overdue.
              // Apply them in order before the new batch, so a brief stall
              // cannot build an audio backlog or restart an old effect later.
              for (const command of this.commands) this.ay.play(command.ch, command.score);
              this.commands = [];
              for (const command of data.commands)
                this.commands.push({
                  ...command,
                  at: this.samples + Math.round((command.frame ?? 0) * sampleRate / 60)
                });
              this.commands.sort((a, b) => a.at - b.at);
            }
            if (data.type === 'reset') {
              this.previous = this.lastSample;
              this.transition = 1;
              this.ay.reset();
              this.commands = [];
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
                while (this.commands.length && this.commands[0].at <= this.samples) {
                  const command = this.commands.shift();
                  this.ay.play(command.ch, command.score);
                }
                this.transition = Math.max(0, this.transition - step);
                this.lastSample =
                  this.previous * this.transition + this.ay.sample() * (1 - this.transition);
                this.samples++;
              }
              output[i] = this.lastSample * this.gain;
            }
          } catch (error) {
            this.ay.reset();
            this.commands = [];
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
      const context = this.context;
      this.context = this.node = this.monitor = this.destination = undefined;
      await context?.close().catch(() => {});
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
    this.send({ type: 'play', commands });
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
    if (this.context?.state === 'suspended' || this.context?.state === 'interrupted')
      this.context.resume().catch(() => {});
  }

  close() {
    this.context?.close();
  }
}
