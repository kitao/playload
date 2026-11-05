export const MAX_FRAME_STEPS = 5;
export const MAX_ERROR_LENGTH = 4096;

// Both sides of the isolated host check the protocol. Nothing supplied by a
// game is passed through to the UI or audio worklet as an unchecked extra field.
function fields(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    keys.length <= required.length + optional.length &&
    keys.every((key) => required.includes(key) || optional.includes(key))
  );
}

export function readGameReply(data, starting, pendingSteps) {
  const invalid = () => {
    throw new Error('Invalid game frame.');
  };
  if (data?.type === 'error') {
    if (
      !fields(data, ['type', 'message'], ['line']) ||
      typeof data.message !== 'string' ||
      data.message.length > MAX_ERROR_LENGTH ||
      (data.line != null && (!Number.isSafeInteger(data.line) || data.line < 1))
    )
      invalid();
    return { type: 'error', message: data.message, line: data.line ?? null };
  }

  const steps = starting ? 1 : data?.steps;
  if (
    !fields(data, ['type', 'pixels', 'sounds'], starting ? [] : ['steps']) ||
    data.type !== (starting ? 'ready' : 'frame') ||
    !Number.isInteger(steps) ||
    steps < 1 ||
    steps > MAX_FRAME_STEPS ||
    (!starting && steps !== pendingSteps) ||
    !(data.pixels instanceof Uint8Array) ||
    !(data.pixels.buffer instanceof ArrayBuffer) ||
    data.pixels.byteOffset !== 0 ||
    data.pixels.byteLength !== 160 * 144 ||
    data.pixels.buffer.byteLength !== 160 * 144 ||
    data.pixels.some((color) => color > 7) ||
    !Array.isArray(data.sounds) ||
    data.sounds.length > 256 * steps ||
    Object.keys(data.sounds).length !== data.sounds.length
  )
    invalid();

  // Repeated play() calls share compiled scores. Validate each distinct score
  // once, preserving the engine's existing per-score and per-tick limits.
  const scores = new Set();
  for (const command of data.sounds) {
    if (
      !fields(command, ['ch', 'score'], ['frame']) ||
      !Number.isInteger(command.ch) ||
      command.ch < 0 ||
      command.ch > 2 ||
      (command.frame !== undefined &&
        (!Number.isInteger(command.frame) || command.frame < 0 || command.frame >= steps))
    )
      invalid();
    const score = command.score;
    if (scores.has(score)) continue;
    if (
      !fields(score, ['code', 'fixedVolume']) ||
      typeof score.fixedVolume !== 'boolean' ||
      !Array.isArray(score.code) ||
      score.code.length > 16384 ||
      Object.keys(score.code).length !== score.code.length
    )
      invalid();
    for (const event of score.code) if (!validEvent(event, score.code.length)) invalid();
    scores.add(score);
  }
  return data;
}

function validEvent(event, length) {
  if (event?.op === 'note')
    return (
      fields(event, ['op', 'frequency', 'beats']) &&
      Number.isFinite(event.frequency) &&
      event.frequency >= 0 &&
      Number.isFinite(event.beats) &&
      event.beats > 0
    );
  if (event?.op === 'repeat')
    return (
      fields(event, ['op', 'start', 'count']) &&
      Number.isInteger(event.start) &&
      event.start >= 0 &&
      event.start < length &&
      (event.count === 0 || event.count === 2)
    );
  if (event?.op === 'U' || event?.op === 'H') return fields(event, ['op']);
  const range = { V: [0, 15], W: [0, 7], X: [0, 65535], T: [60, 240], M: [1, 63] }[event?.op];
  return (
    !!range &&
    fields(event, ['op', 'value']) &&
    Number.isInteger(event.value) &&
    event.value >= range[0] &&
    event.value <= range[1]
  );
}
