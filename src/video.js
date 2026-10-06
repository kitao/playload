// Join finalized MediaRecorder intervals without decoding frames or changing codecs.
// WebM clusters retain their encoded frames; only timestamps and track IDs change.
export async function video(intervals, mime) {
  intervals = intervals.filter(interval => interval.blob.size);
  if (!intervals.length) throw new Error('No video frames were received');
  const first = intervals[0].start, end = intervals.at(-1).end;
  const parts = await Promise.all(intervals.map(async interval => ({
    data: new Uint8Array(await interval.blob.arrayBuffer()), offset: interval.start - first
  })));
  return new Blob(webm(parts, end - first), { type: mime });
}

function vint(bytes, offset, id = false) {
  let width = 1, bit = 128;
  while (width <= 8 && !(bytes[offset] & bit)) { width++; bit >>= 1; }
  if (width > 8 || offset + width > bytes.length) throw new Error('Invalid WebM element');
  let value = id ? bytes[offset] : bytes[offset] & (bit - 1), unknown = !id && value === bit - 1;
  for (let i = 1; i < width; i++) { value = value * 256 + bytes[offset + i]; unknown &&= bytes[offset + i] === 255; }
  return { width, value, unknown };
}
function elements(bytes, start = 0, end = bytes.length) {
  const result = [];
  for (let offset = start; offset < end;) {
    const id = vint(bytes, offset, true), size = vint(bytes, offset + id.width), body = offset + id.width + size.width;
    let next = size.unknown ? end : body + size.value;
    if (size.unknown && id.value === 0x1f43b675) {
      // Unknown-sized clusters end at the next Segment-level element.
      let pos = body;
      while (pos < end) {
        const child = vint(bytes, pos, true);
        if ([0x1f43b675, 0x1c53bb6b, 0x1549a966, 0x1654ae6b].includes(child.value)) break;
        const length = vint(bytes, pos + child.width);
        if (length.unknown) throw new Error('Unsupported WebM child');
        pos += child.width + length.width + length.value;
      }
      next = pos;
    }
    if (next > end || next <= offset) throw new Error('Incomplete WebM element');
    result.push({ id: id.value, start: offset, body, end: next }); offset = next;
  }
  return result;
}
function uint(bytes) { return bytes.reduce((value, byte) => value * 256 + byte, 0); }
function unsigned(value) {
  const bytes = []; do { bytes.unshift(value % 256); value = Math.floor(value / 256); } while (value);
  return Uint8Array.from(bytes);
}
function join(parts) { const bytes = new Uint8Array(parts.reduce((size, part) => size + part.length, 0)); let i = 0; for (const part of parts) { bytes.set(part, i); i += part.length; } return bytes; }
function element(id, content) {
  let width = 1; while (content.length >= 2 ** (7 * width) - 1) width++;
  const size = new Uint8Array(width); let value = content.length;
  for (let i = width - 1; i >= 0; i--) { size[i] = value % 256; value = Math.floor(value / 256); }
  size[0] |= 1 << (8 - width);
  return join([unsigned(id), size, content]);
}
function webm(parts, milliseconds) {
  const output = [], clusters = [], trackNumbers = new Map(); let info, tracks, scale = 1000000;
  const candidates = [];
  for (const { data } of parts) for (const segment of elements(data).filter(field => field.id === 0x18538067)) {
    for (const field of elements(data, segment.body, segment.end).filter(field => field.id === 0x1654ae6b)) candidates.push(data.slice(field.start, field.end));
  }
  tracks = candidates.sort((a, b) => b.length - a.length)[0];
  if (!tracks) throw new Error('Missing WebM header');
  const header = elements(tracks)[0];
  for (const track of elements(tracks, header.body, header.end).filter(field => field.id === 0xae)) {
    const fields = elements(tracks, track.body, track.end), number = fields.find(field => field.id === 0xd7), type = fields.find(field => field.id === 0x83);
    trackNumbers.set(uint(tracks.slice(type.body, type.end)), uint(tracks.slice(number.body, number.end)));
  }
  for (const [index, { data, offset }] of parts.entries()) for (const top of elements(data)) {
    if (top.id === 0x1a45dfa3 && !index) output.push(data.slice(top.start, top.end));
    if (top.id !== 0x18538067) continue;
    const mapping = new Map();
    for (const child of elements(data, top.body, top.end)) {
      if (child.id === 0x1549a966 && !index) {
        const fields = elements(data, child.body, child.end);
        const time = fields.find(field => field.id === 0x2ad7b1); if (time) scale = uint(data.slice(time.body, time.end));
        info = fields.filter(field => field.id !== 0x4489 && field.id !== 0xbf).map(field => data.slice(field.start, field.end));
      }
      if (child.id === 0x1654ae6b) {
        for (const track of elements(data, child.body, child.end)) {
          if (track.id !== 0xae) continue;
          const fields = elements(data, track.body, track.end), number = fields.find(field => field.id === 0xd7), type = fields.find(field => field.id === 0x83);
          if (!number || !type) throw new Error('Missing WebM track');
          const n = uint(data.slice(number.body, number.end)), kind = uint(data.slice(type.body, type.end));
          mapping.set(n, trackNumbers.get(kind));
        }
      }
      if (child.id === 0x1f43b675) {
        const fields = elements(data, child.body, child.end).filter(field => field.id !== 0xbf);
        function block(field) {
          if (field.id === 0xa0) return element(field.id, join(elements(data, field.body, field.end).filter(child => child.id !== 0xbf).map(block)));
          if (field.id !== 0xa3 && field.id !== 0xa1) return data.slice(field.start, field.end);
          const content = data.slice(field.body, field.end), track = vint(content, 0), target = mapping.get(track.value);
          if (track.width !== 1 || !target || target > 126) throw new Error('Unsupported WebM track');
          content[0] = 128 | target; return element(field.id, content);
        }
        clusters.push(element(child.id, join(fields.map(field => field.id === 0xe7 ? element(0xe7, unsigned(uint(data.slice(field.body, field.end)) + Math.round(offset * 1000000 / scale))) : block(field)))));
      }
    }
  }
  if (!info || !tracks || !clusters.length) throw new Error('No video frames were received');
  const length = new Uint8Array(8); new DataView(length.buffer).setFloat64(0, milliseconds * 1000000 / scale);
  output.push(element(0x18538067, join([element(0x1549a966, join([...info, element(0x4489, length)])), tracks, ...clusters])));
  return output;
}
