import { createEngine } from '../engine/engine.js';
import { compileScore } from '../engine/sound.js';
import { MAX_FRAME_STEPS, MAX_ERROR_LENGTH } from './game-messages.js';

export function startGameWorker(presets, scope = globalThis) {
  // Capture the private port operations before game code can replace built-ins.
  const readData = Function.prototype.call.bind(
      Object.getOwnPropertyDescriptor(MessageEvent.prototype, 'data').get,
    ),
    send = Function.prototype.call.bind(MessagePort.prototype.postMessage),
    delay = setTimeout,
    evaluate = Function;
  let engine, tick, port;

  // A game cannot send arbitrary structured-clone payloads to its host. The
  // engine's channel stays in this closure, including against prototype edits.
  for (let object = scope; object; object = Object.getPrototypeOf(object))
    for (const name of ['postMessage', 'Worker', 'SharedWorker'])
      if (Object.hasOwn(object, name)) delete object[name];

  async function step() {
    const delayFrames = engine.step(tick);
    if (delayFrames) await new Promise((resolve) => delay(resolve, (delayFrames * 1000) / 60));
  }

  async function receive(event) {
    const data = readData(event);
    try {
      switch (data.type) {
        case 'load': {
          engine = createEngine(presets, compileScore);
          const api = engine.api;
          tick = new evaluate(
            ...Object.keys(api),
            data.source +
              '\n;return typeof tick === "function" ? tick : null;\n//# sourceURL=playload-game.js',
          )(...Object.values(api));
          if (!tick) throw new Error('Define function tick()');
          await step();
          send(port, { type: 'ready', pixels: engine.pixels, sounds: engine.sounds() });
          break;
        }
        case 'input':
          engine?.input(data.mask);
          break;
        case 'frame': {
          const steps = data.steps;
          if (!Number.isInteger(steps) || steps < 1 || steps > MAX_FRAME_STEPS)
            throw new Error('Invalid game step count.');
          const sounds = [];
          for (let frame = 0; frame < steps; frame++) {
            await step();
            for (const command of engine.sounds()) sounds.push({ ...command, frame });
          }
          send(port, { type: 'frame', pixels: engine.pixels, sounds, steps });
          break;
        }
      }
    } catch (error) {
      let message = 'Game error',
        gameLine = null;
      // Thrown values and their accessors are game code too. A failed error
      // conversion must not break the channel that reports the failure.
      try {
        message = String(error?.message ?? error).slice(0, MAX_ERROR_LENGTH);
        const line = /playload-game\.js:(\d+):/.exec(error?.stack ?? '');
        // WebKit gives anonymous Function bodies a line but no source URL.
        gameLine = line
          ? Number(line[1])
          : !error?.sourceURL && Number.isInteger(error?.line)
            ? error.line
            : null;
      } catch {
        // Keep the plain fallback for malformed thrown values.
      }
      send(port, {
        type: 'error',
        message,
        line: gameLine === null ? null : Math.max(1, gameLine - 2),
      });
    }
  }

  function connect(event) {
    if (port || event.ports.length !== 1) return;
    scope.removeEventListener('message', connect);
    port = event.ports[0];
    port.onmessage = receive;
  }
  scope.addEventListener('message', connect);
}
