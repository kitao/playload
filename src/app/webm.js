// Keep encoded WebM blocks; exporting changes only timestamps and track IDs.
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
        for (const track of elements(data, body, end).filter((field) => field.id === 0xae)) {
          const fields = elements(data, track.body, track.end),
            number = fields.find((field) => field.id === 0xd7),
            type = fields.find((field) => field.id === 0x83);
          if (!number || !type) throw new Error('Missing WebM track');
          this.trackTypes.set(
            uint(data.subarray(number.body, number.end)),
            uint(data.subarray(type.body, type.end)),
          );
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
    if (this.pending.length > 64 * 1024 * 1024) throw new Error('Video recording exceeded 64 MiB');
  }
  trim(end) {
    const cutoff = end - 10000,
      first = this.frames.find((frame) => frame.keyframe && frame.time >= cutoff),
      start = first?.time ?? cutoff;
    this.frames = this.frames.filter((frame) => frame.time >= start);
    while (this.bytes > 64 * 1024 * 1024 && this.frames.length) {
      const next = this.frames.find((frame) => frame.keyframe && frame.time > this.frames[0].time);
      this.frames = next ? this.frames.filter((frame) => frame.time >= next.time) : [];
    }
    if (this.bytes > 64 * 1024 * 1024) throw new Error('Video recording exceeded 64 MiB');
  }
  seconds(end) {
    const first = this.frames.find((frame) => frame.keyframe && frame.time >= end - 10000);
    return first ? Math.max(0, (end - first.time) / 1000) : 0;
  }
}

export function exportWebM(buffer, mime, end) {
  const first = buffer.frames.find((frame) => frame.keyframe && frame.time >= end - 10000);
  if (!first || first.time > end || !buffer.header || !buffer.info || !buffer.tracks)
    throw new Error('No video frames were received');
  const frames = buffer.frames
      .filter((frame) => frame.time >= first.time && frame.time + frame.duration <= end)
      .sort((a, b) => a.time - b.time),
    tracks = new Map(),
    header = elements(buffer.tracks)[0];
  for (const track of elements(buffer.tracks, header.body, header.end).filter(
    (field) => field.id === 0xae,
  )) {
    const fields = elements(buffer.tracks, track.body, track.end),
      number = fields.find((field) => field.id === 0xd7),
      type = fields.find((field) => field.id === 0x83);
    tracks.set(
      uint(buffer.tracks.subarray(type.body, type.end)),
      uint(buffer.tracks.subarray(number.body, number.end)),
    );
  }
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
    const timestamp = Math.round(((frame.time - first.time) * 1000000) / timeScale);
    if (timestamp - time >= clusterSpan) {
      flush();
      time = timestamp;
    }
    blocks.push(rewriteBlock(frame.data, tracks.get(frame.kind), timestamp - time));
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
function rewriteBlock(bytes, number, time) {
  const field = elements(bytes)[0];
  if (field.id === 0xa0)
    return element(
      field.id,
      join(
        elements(bytes, field.body, field.end)
          .filter((child) => child.id !== 0xbf)
          .map((child) =>
            child.id === 0xa1
              ? rewriteBlock(bytes.subarray(child.start, child.end), number, time)
              : bytes.subarray(child.start, child.end),
          ),
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
