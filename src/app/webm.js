// Keep encoded WebM blocks; exporting changes only timing fields and track IDs.
// A clip is the latest ten seconds from a keyframe, within one memory limit.
const CLIP_MILLISECONDS = 10000;
export const MAX_RECORDING_BYTES = 64 * 1024 * 1024;
export const recordingTooLarge = () => new Error('Video recording exceeded 64 MiB');

export class WebMBuffer {
  constructor() {
    this.frames = [];
    this.pending = new Uint8Array();
  }
  get bytes() {
    return (
      this.frames.reduce((sum, frame) => sum + frame.data.length, 0) +
      this.pending.length +
      (this.header?.length ?? 0) +
      (this.tracks?.length ?? 0) +
      (this.info?.reduce((sum, field) => sum + field.length, 0) ?? 0)
    );
  }
  begin(start) {
    this.offset = start;
    this.scale = 1000000;
    this.clusterTime = 0;
    this.trackTypes = new Map();
    this.pending = new Uint8Array();
  }
  append(bytes) {
    const data = join([this.pending, bytes]);
    let position = 0;
    while (position < data.length) {
      const id = vint(data, position, true);
      if (!id) break;
      const size = vint(data, position + id.width);
      if (!size) break;
      const body = position + id.width + size.width;
      if (id.value === 0x18538067 || id.value === 0x1f43b675) {
        if (id.value === 0x1f43b675) this.clusterTime = 0;
        position = body;
        continue;
      }
      if (size.unknown) throw new Error('Unsupported WebM element');
      const end = body + size.value;
      if (end > data.length) break;
      if (id.value === 0x1a45dfa3) this.header ??= data.slice(position, end);
      if (id.value === 0x1549a966) {
        const fields = elements(data, body, end),
          time = fields.find((field) => field.id === 0x2ad7b1);
        if (time) this.scale = uint(data.subarray(time.body, time.end));
        if (!Number.isSafeInteger(this.scale) || this.scale <= 0)
          throw new Error('Invalid WebM time scale');
        this.timeScale ??= this.scale;
        this.info ??= fields
          .filter((field) => ![0x4489, 0x2ad7b1, 0xbf].includes(field.id))
          .map((field) => data.slice(field.start, field.end));
      }
      if (id.value === 0x1654ae6b) {
        this.tracks = data.slice(position, end);
        for (const { number, type } of trackEntries(data, body, end)) {
          if (number === undefined || type === undefined) throw new Error('Missing WebM track');
          this.trackTypes.set(number, type);
        }
      }
      if (id.value === 0xe7) this.clusterTime = uint(data.subarray(body, end));
      if (id.value === 0xa3 || id.value === 0xa0) {
        const fields = id.value === 0xa0 ? elements(data, body, end) : [],
          block = id.value === 0xa3 ? { body, end } : fields.find((field) => field.id === 0xa1);
        if (!block) throw new Error('Missing WebM block');
        const content = data.subarray(block.body, block.end),
          track = vint(content, 0),
          kind = track && this.trackTypes.get(track.value);
        if (!kind || content.length < track.width + 3) throw new Error('Invalid WebM block');
        let relative = (content[track.width] << 8) | content[track.width + 1];
        if (relative & 0x8000) relative -= 65536;
        const flags = content[track.width + 2],
          frame = {
            time: this.offset + ((this.clusterTime + relative) * this.scale) / 1000000,
            sourceScale: this.scale,
            kind,
            keyframe:
              kind === 1 &&
              (id.value === 0xa3 ? !!(flags & 128) : !fields.some((field) => field.id === 0xfb)),
            duration:
              kind === 2 && !(flags & 6) ? opusDuration(content.subarray(track.width + 3)) : 0,
            data: data.slice(position, end),
          };
        this.frames.push(frame);
      }
      position = end;
    }
    this.pending = data.slice(position);
    if (this.pending.length > MAX_RECORDING_BYTES) throw recordingTooLarge();
  }
  merge(parser) {
    this.header ??= parser.header;
    this.info ??= parser.info;
    this.timeScale ??= parser.timeScale;
    if (parser.tracks) {
      // One rebuilt TrackEntry per track type, numbered by type, from every merged parser.
      this.mergedTracks ??= new Map();
      const header = elements(parser.tracks)[0];
      for (const { fields, type: kind } of trackEntries(parser.tracks, header.body, header.end)) {
        if (kind !== 1 && kind !== 2) throw new Error('Unsupported WebM track');
        this.mergedTracks.set(
          kind,
          element(
            0xae,
            join([
              element(0xd7, unsigned(kind)),
              element(0x73c5, unsigned(kind)),
              ...fields
                .filter((field) => ![0xd7, 0x73c5, 0xbf].includes(field.id))
                .map((field) => parser.tracks.subarray(field.start, field.end)),
            ]),
          ),
        );
      }
      this.tracks = element(
        0x1654ae6b,
        join([...this.mergedTracks].sort(([a], [b]) => a - b).map(([, entry]) => entry)),
      );
    }
    this.frames.push(...parser.frames);
    parser.frames = [];
  }
  trim(end) {
    const start = clipStart(this.frames, end)?.time ?? end - CLIP_MILLISECONDS;
    this.frames = this.frames.filter((frame) => frame.time >= start);
    while (this.bytes > MAX_RECORDING_BYTES && this.frames.length) {
      const next = this.frames.find((frame) => frame.keyframe && frame.time > this.frames[0].time);
      this.frames = next ? this.frames.filter((frame) => frame.time >= next.time) : [];
    }
    if (this.bytes > MAX_RECORDING_BYTES) throw recordingTooLarge();
  }
  seconds(end) {
    const first = clipStart(this.frames, end);
    return first ? Math.max(0, (end - first.time) / 1000) : 0;
  }
}

// The first keyframe from which a clip ending at `end` can start.
function clipStart(frames, end) {
  return frames.find((frame) => frame.keyframe && frame.time >= end - CLIP_MILLISECONDS);
}

// The fields, track number and track type of each TrackEntry in a Tracks element.
function trackEntries(bytes, start, end) {
  return elements(bytes, start, end)
    .filter((field) => field.id === 0xae)
    .map((track) => {
      const fields = elements(bytes, track.body, track.end),
        value = (id) => {
          const field = fields.find((child) => child.id === id);
          return field && uint(bytes.subarray(field.body, field.end));
        };
      return { fields, number: value(0xd7), type: value(0x83) };
    });
}

export function exportWebM(buffer, mime, end) {
  const first = clipStart(buffer.frames, end);
  if (!first || !buffer.header || !buffer.info || !buffer.tracks)
    throw new Error('No video frames were received');
  const frames = buffer.frames
      .filter((frame) => frame.time >= first.time && frame.time + frame.duration <= end)
      .sort((a, b) => a.time - b.time),
    tracks = new Map(),
    header = elements(buffer.tracks)[0];
  for (const { number, type } of trackEntries(buffer.tracks, header.body, header.end))
    tracks.set(type, number);
  const clusters = [];
  const timeScale = buffer.timeScale ?? 1000000,
    clusterSpan = Math.min(1000000000 / timeScale, 32767);
  let time = -clusterSpan,
    blocks = [];
  function flush() {
    if (blocks.length)
      clusters.push(element(0x1f43b675, join([element(0xe7, unsigned(time)), ...blocks])));
    blocks = [];
  }
  for (const frame of frames) {
    const exactTimestamp = ((frame.time - first.time) * 1000000) / timeScale,
      timestamp = Math.round(exactTimestamp);
    if (timestamp - time >= clusterSpan) {
      flush();
      time = timestamp;
    }
    blocks.push(
      rewriteBlock(
        frame.data,
        tracks.get(frame.kind),
        timestamp - time,
        (frame.sourceScale ?? timeScale) / timeScale,
        exactTimestamp,
      ),
    );
  }
  flush();
  if (!clusters.length) throw new Error('No video frames were received');
  const length = new Uint8Array(8);
  new DataView(length.buffer).setFloat64(0, ((end - first.time) * 1000000) / timeScale);
  return new Blob(
    [
      buffer.header,
      element(
        0x18538067,
        join([
          element(
            0x1549a966,
            join([element(0x2ad7b1, unsigned(timeScale)), ...buffer.info, element(0x4489, length)]),
          ),
          buffer.tracks,
          ...clusters,
        ]),
      ),
    ],
    { type: mime },
  );
}

function opusDuration(packet) {
  if (!packet.length) return 0;
  const config = packet[0] >> 3;
  let duration;
  if (config >= 16) duration = 2.5 * 2 ** (config & 3);
  else if (config >= 12) duration = 10 * 2 ** (config & 1);
  else duration = [10, 20, 40, 60][config & 3];
  const code = packet[0] & 3,
    count = code === 0 ? 1 : code === 3 ? packet[1] & 63 : 2;
  return duration * count;
}
function rewriteBlock(bytes, number, time, scale = 1, exactTime = time) {
  const field = elements(bytes)[0];
  if (field.id === 0xa0)
    return element(
      field.id,
      join(
        elements(bytes, field.body, field.end)
          .filter((child) => child.id !== 0xbf)
          .map((child) => {
            if (child.id === 0xa1)
              return rewriteBlock(bytes.subarray(child.start, child.end), number, time);
            if (scale !== 1 && (child.id === 0x9b || child.id === 0xfb)) {
              const content = bytes.subarray(child.body, child.end),
                value = child.id === 0xfb ? signed(content) : uint(content),
                scaled =
                  child.id === 0xfb
                    ? Math.round(exactTime + value * scale) - Math.round(exactTime)
                    : Math.round(value * scale);
              return element(child.id, child.id === 0xfb ? signedBytes(scaled) : unsigned(scaled));
            }
            return bytes.subarray(child.start, child.end);
          }),
      ),
    );
  const content = bytes.subarray(field.body, field.end),
    track = vint(content, 0);
  if (!number || number > 126) throw new Error('Unsupported WebM track');
  return element(
    field.id,
    join([
      Uint8Array.of(128 | number, (time >> 8) & 255, time & 255),
      content.subarray(track.width + 2),
    ]),
  );
}
function vint(bytes, offset, id = false) {
  if (offset >= bytes.length) return;
  let width = 1,
    bit = 128;
  while (width <= 8 && !(bytes[offset] & bit)) {
    width++;
    bit >>= 1;
  }
  if (width > 8) throw new Error('Invalid WebM element');
  if (offset + width > bytes.length) return;
  let value = id ? bytes[offset] : bytes[offset] & (bit - 1),
    unknown = !id && value === bit - 1;
  for (let i = 1; i < width; i++) {
    value = value * 256 + bytes[offset + i];
    unknown &&= bytes[offset + i] === 255;
  }
  return { width, value, unknown };
}
function elements(bytes, start = 0, end = bytes.length) {
  const result = [];
  for (let offset = start; offset < end;) {
    const id = vint(bytes, offset, true),
      size = id && vint(bytes, offset + id.width),
      body = size && offset + id.width + size.width;
    if (!size || size.unknown || body + size.value > end) throw new Error('Invalid WebM element');
    result.push({ id: id.value, start: offset, body, end: body + size.value });
    offset = body + size.value;
  }
  return result;
}
function uint(bytes) {
  return bytes.reduce((value, byte) => value * 256 + byte, 0);
}
function signed(bytes) {
  return bytes.reduce((value, byte) => value * 256 + byte, bytes[0] & 128 ? -1 : 0);
}
function signedBytes(value) {
  let width = 1;
  while (value < -(2 ** (8 * width - 1)) || value >= 2 ** (8 * width - 1)) width++;
  const bytes = new Uint8Array(width);
  for (let i = width - 1; i >= 0; i--) {
    bytes[i] = value;
    value = Math.floor(value / 256);
  }
  return bytes;
}
function unsigned(value) {
  const bytes = [];
  do {
    bytes.unshift(value % 256);
    value = Math.floor(value / 256);
  } while (value);
  return Uint8Array.from(bytes);
}
function join(parts) {
  const bytes = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let position = 0;
  for (const part of parts) {
    bytes.set(part, position);
    position += part.length;
  }
  return bytes;
}
function element(id, content) {
  let width = 1;
  while (content.length >= 2 ** (7 * width) - 1) width++;
  const size = new Uint8Array(width);
  let value = content.length;
  for (let i = width - 1; i >= 0; i--) {
    size[i] = value % 256;
    value = Math.floor(value / 256);
  }
  size[0] |= 1 << (8 - width);
  return join([unsigned(id), size, content]);
}
