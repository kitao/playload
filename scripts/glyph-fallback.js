// Catalog-only WOFF fallback for supplementary symbols missing from OS fonts.
// Outline rectangles preserve the selected CC0 8x8 source artwork.
import { deflateSync } from 'node:zlib';

const align = (n) => (n + 3) & ~3;
function checksum(bytes) {
  const padded = Buffer.alloc(align(bytes.length));
  bytes.copy(padded);
  let sum = 0;
  for (let i = 0; i < padded.length; i += 4) sum = (sum + padded.readUInt32BE(i)) >>> 0;
  return sum;
}
function outline(rows) {
  const contours = [];
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      if (!(rows[y] & (128 >> x))) continue;
      const left = x;
      while (x + 1 < 8 && rows[y] & (128 >> (x + 1))) x++;
      const x0 = left * 128,
        x1 = (x + 1) * 128,
        y0 = (7 - y) * 128,
        y1 = (8 - y) * 128;
      contours.push([
        [x0, y0],
        [x0, y1],
        [x1, y1],
        [x1, y0],
      ]);
    }
  const points = contours.flat(),
    data = Buffer.alloc(12 + contours.length * 2 + points.length * 5);
  data.writeInt16BE(contours.length, 0);
  if (points.length) {
    data.writeInt16BE(Math.min(...points.map((p) => p[0])), 2);
    data.writeInt16BE(Math.min(...points.map((p) => p[1])), 4);
    data.writeInt16BE(Math.max(...points.map((p) => p[0])), 6);
    data.writeInt16BE(Math.max(...points.map((p) => p[1])), 8);
  }
  for (let i = 0; i < contours.length; i++) data.writeUInt16BE(i * 4 + 3, 10 + i * 2);
  const flags = 12 + contours.length * 2;
  data.fill(1, flags, flags + points.length);
  let previous = [0, 0];
  for (let i = 0; i < points.length; i++) {
    data.writeInt16BE(points[i][0] - previous[0], flags + points.length + i * 2);
    data.writeInt16BE(points[i][1] - previous[1], flags + points.length * 3 + i * 2);
    previous = points[i];
  }
  return data;
}
function names(sources) {
  const credit = { unscii: 'Unscii-8', 'public-pixel': 'Public Pixel' };
  // Records sorted by platform, encoding, language and name ID, as OpenType requires.
  const entries = [
    [
      0,
      `Derived from ${sources.map((source) => credit[source]).join(' and ')}. ` +
        'Public domain / CC0. See src/site/index.md#license.',
    ],
    [1, 'Playload Symbol Fallback'],
    [2, 'Regular'],
    [3, 'Playload-Symbol-Fallback-1'],
    [4, 'Playload Symbol Fallback'],
    [5, 'Version 1.0'],
    [6, 'PlayloadSymbolFallback'],
  ];
  const header = Buffer.alloc(6 + entries.length * 12),
    strings = [];
  header.writeUInt16BE(entries.length, 2);
  header.writeUInt16BE(header.length, 4);
  let offset = 0;
  entries.forEach(([id, text], i) => {
    const bytes = Buffer.from(text, 'utf16le');
    bytes.swap16();
    strings.push(bytes);
    const p = 6 + i * 12;
    [3, 1, 0x409, id, bytes.length, offset].forEach((n, j) => header.writeUInt16BE(n, p + j * 2));
    offset += bytes.length;
  });
  return Buffer.concat([header, ...strings]);
}
export function glyphFallback(glyphs) {
  const selected = glyphs.filter((g) => g.group === 'symbols' && g.ch.codePointAt(0) > 0xffff);
  if (selected.some((g) => !['unscii', 'public-pixel'].includes(g.source)))
    throw new Error('Fallback requires CC0 source artwork');
  const count = selected.length + 1,
    tables = new Map();
  const shapes = [outline([]), ...selected.map((g) => outline(g.rows))],
    offsets = [0],
    padded = [];
  for (const shape of shapes) {
    const bytes = Buffer.alloc(align(shape.length));
    shape.copy(bytes);
    padded.push(bytes);
    offsets.push(offsets.at(-1) + bytes.length);
  }
  tables.set('glyf', Buffer.concat(padded));
  const loca = Buffer.alloc(offsets.length * 4);
  offsets.forEach((n, i) => loca.writeUInt32BE(n, i * 4));
  tables.set('loca', loca);
  const hmtx = Buffer.alloc(count * 4);
  for (let i = 0; i < count; i++) {
    hmtx.writeUInt16BE(1024, i * 4);
    hmtx.writeInt16BE(shapes[i].readInt16BE(2), i * 4 + 2);
  }
  tables.set('hmtx', hmtx);
  const head = Buffer.alloc(54);
  head.writeUInt32BE(0x10000, 0);
  head.writeUInt32BE(0x10000, 4);
  head.writeUInt32BE(0x5f0f3cf5, 12);
  head.writeUInt16BE(1024, 18);
  head.writeInt16BE(1024, 40);
  head.writeInt16BE(1024, 42);
  head.writeUInt16BE(8, 46);
  head.writeInt16BE(2, 48);
  head.writeInt16BE(1, 50);
  tables.set('head', head);
  const hhea = Buffer.alloc(36);
  hhea.writeUInt32BE(0x10000);
  hhea.writeInt16BE(1024, 4);
  hhea.writeUInt16BE(1024, 10);
  hhea.writeInt16BE(1024, 16);
  hhea.writeInt16BE(1, 18);
  hhea.writeUInt16BE(count, 34);
  tables.set('hhea', hhea);
  const maxp = Buffer.alloc(32);
  maxp.writeUInt32BE(0x10000);
  maxp.writeUInt16BE(count, 4);
  maxp.writeUInt16BE(128, 6);
  maxp.writeUInt16BE(32, 8);
  maxp.writeUInt16BE(1, 14);
  tables.set('maxp', maxp);
  const os2 = Buffer.alloc(78);
  os2.writeInt16BE(1024, 2);
  os2.writeUInt16BE(400, 4);
  os2.writeUInt16BE(5, 6);
  os2.write('PLYL', 58);
  os2.writeUInt16BE(0x40, 62);
  os2.writeUInt16BE(0xffff, 64);
  os2.writeUInt16BE(0xffff, 66);
  os2.writeInt16BE(1024, 68);
  os2.writeUInt16BE(1024, 74);
  tables.set('OS/2', os2);
  const post = Buffer.alloc(32);
  post.writeUInt32BE(0x30000);
  post.writeUInt32BE(1, 12);
  tables.set('post', post);
  const sources = ['unscii', 'public-pixel'].filter((source) =>
    selected.some((g) => g.source === source),
  );
  tables.set('name', names(sources));
  const cmap = Buffer.alloc(28 + selected.length * 12);
  cmap.writeUInt16BE(1, 2);
  cmap.writeUInt16BE(3, 4);
  cmap.writeUInt16BE(10, 6);
  cmap.writeUInt32BE(12, 8);
  cmap.writeUInt16BE(12, 12);
  cmap.writeUInt32BE(cmap.length - 12, 16);
  cmap.writeUInt32BE(selected.length, 24);
  selected.forEach((g, i) => {
    const cp = g.ch.codePointAt(0),
      p = 28 + i * 12;
    cmap.writeUInt32BE(cp, p);
    cmap.writeUInt32BE(cp, p + 4);
    cmap.writeUInt32BE(i + 1, p + 8);
  });
  tables.set('cmap', cmap);
  const entries = [...tables].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    n = entries.length,
    sfnt = Buffer.alloc(12 + n * 16);
  sfnt.writeUInt32BE(0x10000);
  sfnt.writeUInt16BE(n, 4);
  const power = 2 ** Math.floor(Math.log2(n));
  sfnt.writeUInt16BE(power * 16, 6);
  sfnt.writeUInt16BE(Math.log2(power), 8);
  sfnt.writeUInt16BE(n * 16 - power * 16, 10);
  let sfntOffset = sfnt.length;
  entries.forEach(([tag, data], i) => {
    const p = 12 + i * 16;
    sfnt.write(tag, p);
    sfnt.writeUInt32BE(checksum(data), p + 4);
    sfnt.writeUInt32BE(sfntOffset, p + 8);
    sfnt.writeUInt32BE(data.length, p + 12);
    sfntOffset += align(data.length);
  });
  let total = checksum(sfnt);
  for (const [, data] of entries) total = (total + checksum(data)) >>> 0;
  head.writeUInt32BE((0xb1b0afba - total) >>> 0, 8);
  const directory = Buffer.alloc(44 + n * 20),
    parts = [];
  let woffOffset = directory.length;
  directory.write('wOFF');
  directory.writeUInt32BE(0x10000, 4);
  directory.writeUInt16BE(n, 12);
  directory.writeUInt32BE(sfntOffset, 16);
  directory.writeUInt16BE(1, 20);
  entries.forEach(([tag, data], i) => {
    const compressed = deflateSync(data),
      payload = compressed.length < data.length ? compressed : data,
      p = 44 + i * 20;
    directory.write(tag, p);
    directory.writeUInt32BE(woffOffset, p + 4);
    directory.writeUInt32BE(payload.length, p + 8);
    directory.writeUInt32BE(data.length, p + 12);
    if (tag === 'head') {
      const zero = Buffer.from(data);
      zero.writeUInt32BE(0, 8);
      directory.writeUInt32BE(checksum(zero), p + 16);
    } else directory.writeUInt32BE(checksum(data), p + 16);
    const padded = Buffer.alloc(align(payload.length));
    payload.copy(padded);
    parts.push(padded);
    woffOffset += padded.length;
  });
  directory.writeUInt32BE(woffOffset, 8);
  return { bytes: Buffer.concat([directory, ...parts]), glyphCount: selected.length };
}
