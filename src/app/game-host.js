/* global GAME_WORKER_SOURCE: readonly */
import { MAX_FRAME_STEPS, MAX_ERROR_LENGTH, readGameReply } from './game-messages.js';

// The build embeds a bundled worker and hashes this complete host script into
// its CSP. No network script source is allowed inside this document or worker.
let port, worker, gamePort;
let pending = false,
  starting = true,
  pendingSteps = 1,
  stopped = false;

function fail(message) {
  if (stopped) return;
  stopped = true;
  worker?.terminate();
  gamePort?.close();
  port.postMessage({ type: 'error', message: message.slice(0, MAX_ERROR_LENGTH) });
}

function connect(event) {
  if (
    event.source !== parent ||
    event.data !== 'playload-sandbox-connect' ||
    event.ports.length !== 1 ||
    port
  )
    return;
  window.removeEventListener('message', connect);
  port = event.ports[0];
  try {
    worker = new Worker(
      'data:text/javascript;charset=utf-8,' + encodeURIComponent(GAME_WORKER_SOURCE),
    );
    const channel = new MessageChannel();
    gamePort = channel.port1;
    gamePort.onmessage = ({ data }) => {
      if (stopped) return;
      try {
        if (!pending && data?.type !== 'error') throw new Error('Invalid game frame.');
        const reply = readGameReply(data, starting, pendingSteps);
        pending = false;
        starting = false;
        port.postMessage(reply, reply.pixels ? [reply.pixels.buffer] : []);
        if (reply.type === 'error') {
          stopped = true;
          worker.terminate();
          gamePort.close();
        }
      } catch {
        fail('Invalid game frame.');
      }
    };
    gamePort.onmessageerror = () => fail('Invalid game frame.');
    worker.onerror = (event) => {
      event.preventDefault();
      fail(event.message || 'Game error');
    };
    worker.postMessage(null, [channel.port2]);
    port.onmessage = ({ data }) => {
      if (stopped) return;
      if (
        data?.type === 'input' &&
        Number.isInteger(data.mask) &&
        data.mask >= 0 &&
        data.mask <= 63
      ) {
        gamePort.postMessage(data);
        return;
      }
      if (pending) return fail('Invalid game request.');
      const load = starting && data?.type === 'load' && typeof data.source === 'string';
      if (
        !load &&
        (starting ||
          data?.type !== 'frame' ||
          !Number.isInteger(data.steps) ||
          data.steps < 1 ||
          data.steps > MAX_FRAME_STEPS)
      )
        return fail('Invalid game request.');
      pending = true;
      pendingSteps = starting ? 1 : data.steps;
      gamePort.postMessage(data);
    };
    port.onmessageerror = () => fail('Invalid game request.');
  } catch {
    fail('This browser cannot run games.');
  }
}

window.addEventListener('message', connect);
parent.postMessage('playload-sandbox-ready', '*');
