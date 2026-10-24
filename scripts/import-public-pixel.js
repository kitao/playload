// Converts data/fonts/PublicPixel.ttf into public-pixel-8.hex. Public Pixel draws its glyphs
// with straight outlines on a 128-unit pixel grid, so the pixels whose centres lie inside the
// outlines are the author's 8x8 bitmaps, free of hinting.
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const UNIT = 128;

export function publicPixelCells(font) {
  const u16 = (offset) => font.readUInt16BE(offset),
    i16 = (offset) => font.readInt16BE(offset),
    u32 = (offset) => font.readUInt32BE(offset);
  const tables = {};
  for (let i = 0; i < u16(4); i++)
    tables[font.toString('latin1', 12 + i * 16, 16 + i * 16)] = u32(20 + i * 16);
  if (u16(tables.head + 18) !== UNIT * 8) throw new Error('Expected 8 pixels per em');
  const long = i16(tables.head + 50) === 1,
    location = (glyph) =>
      tables.glyf + (long ? u32(tables.loca + glyph * 4) : u16(tables.loca + glyph * 2) * 2);

  // The format 12 map covers the supplementary planes as well as the BMP.
  const maps = Array.from({ length: u16(tables.cmap + 2) }, (_, i) => u32(tables.cmap + 8 + i * 8));
  const map = maps.map((offset) => tables.cmap + offset).find((offset) => u16(offset) === 12);
  if (!map) throw new Error('Expected a format 12 character map');
  const characters = new Map();
  for (let group = 0; group < u32(map + 12); group++) {
    const [first, last, glyph] = [0, 4, 8].map((n) => u32(map + 16 + group * 12 + n));
    for (let cp = first; cp <= last; cp++)
      if (glyph + cp - first) characters.set(cp, glyph + cp - first);
  }

  // Contours in pixels, with component offsets applied.
  function contours(glyph, dx = 0, dy = 0) {
    const start = location(glyph);
    if (start === location(glyph + 1)) return [];
    const count = i16(start);
    if (count < 0) {
      const parts = [];
      for (let p = start + 10, more = true; more;) {
        const flags = u16(p),
          component = u16(p + 2),
          words = flags & 1;
        if (!(flags & 2) || flags & 0xc8) throw new Error('Unsupported composite glyph');
        const x = words ? i16(p + 4) : font.readInt8(p + 4),
          y = words ? i16(p + 6) : font.readInt8(p + 5);
        parts.push(...contours(component, dx + x / UNIT, dy + y / UNIT));
        p += words ? 8 : 6;
        more = flags & 0x20;
      }
      return parts;
    }
    const ends = Array.from({ length: count }, (_, i) => u16(start + 10 + i * 2));
    const points = ends.at(-1) + 1;
    let p = start + 12 + count * 2 + u16(start + 10 + count * 2);
    const flags = [];
    while (flags.length < points) {
      const flag = font[p++];
      flags.push(flag);
      if (flag & 8) for (let repeat = font[p++]; repeat; repeat--) flags.push(flag);
    }

    const coordinates = (short, same) => {
      let value = 0;
      return flags.map((flag) => {
        if (flag & short) value += flag & same ? font[p++] : -font[p++];
        else if (!(flag & same)) value += i16((p += 2) - 2);
        return value;
      });
    };

    const xs = coordinates(2, 16),
      ys = coordinates(4, 32);
    if (flags.some((flag) => !(flag & 1))) throw new Error('Expected straight outlines');
    return ends.map((end, i) =>
      xs
        .slice(i ? ends[i - 1] + 1 : 0, end + 1)
        .map((x, j) => [dx + x / UNIT, dy + ys[(i ? ends[i - 1] + 1 : 0) + j] / UNIT]),
    );
  }

  // The cell spans the baseline to the 8-pixel ascender, and every glyph fits inside it.
  const cells = new Map();
  for (const [cp, glyph] of characters) {
    const outline = contours(glyph),
      rows = new Array(8).fill(0);
    if (outline.flat().some(([x, y]) => x < 0 || x > 8 || y < 0 || y > 8))
      throw new Error(`U+${cp.toString(16).toUpperCase()} leaves the 8x8 cell`);
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) {
        // Non-zero winding at the pixel centre.
        let winding = 0;
        for (const contour of outline)
          contour.forEach(([x0, y0], i) => {
            const [x1, y1] = contour[(i + 1) % contour.length];
            if (
              y0 <= y + 0.5 !== y1 <= y + 0.5 &&
              x + 0.5 < x0 + ((y + 0.5 - y0) * (x1 - x0)) / (y1 - y0)
            )
              winding += y1 > y0 ? 1 : -1;
          });
        if (winding) rows[7 - y] |= 128 >> x;
      }
    cells.set(cp, rows);
  }
  return cells;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fonts = new URL('../data/fonts/', import.meta.url);
  const cells = publicPixelCells(readFileSync(new URL('PublicPixel.ttf', fonts)));
  const lines = [...cells]
    .sort(([a], [b]) => a - b)
    .map(([cp, rows]) => {
      const bits = rows.map((row) => row.toString(16).toUpperCase().padStart(2, '0')).join('');
      return cp.toString(16).toUpperCase().padStart(5, '0') + ':' + bits;
    });
  writeFileSync(new URL('public-pixel-8.hex', fonts), lines.join('\n') + '\n');
  console.log(`${lines.length} Public Pixel cells`);
}
