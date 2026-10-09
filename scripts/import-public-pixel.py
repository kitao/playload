"""Extract the author's native 8px grid; no scaling or antialiasing.
Requires Pillow (development only). Runtime and normal font regeneration do not.
"""
from pathlib import Path
import hashlib, json, struct
from PIL import ImageFont, __version__ as pillow_version

root = Path(__file__).resolve().parent.parent
path = root / 'data/fonts/PublicPixel.ttf'
data = path.read_bytes()
u16 = lambda offset: struct.unpack_from('>H', data, offset)[0]
u32 = lambda offset: struct.unpack_from('>I', data, offset)[0]
tables = {data[o:o+4]: u32(o+8) for o in range(12, 12 + u16(4)*16, 16)}
cmap = tables[b'cmap']
characters = set()
for record in range(cmap+4, cmap+4+u16(cmap+2)*8, 8):
    offset = cmap + u32(record+4)
    if u16(offset) != 4:
        continue
    segments = u16(offset+6)//2
    ends = offset+14
    starts = ends+2*segments+2
    deltas = starts+2*segments
    ranges = deltas+2*segments
    for i in range(segments):
        for codepoint in range(u16(starts+2*i), u16(ends+2*i)+1):
            if codepoint == 0xffff:
                continue
            distance = u16(ranges+2*i)
            glyph = u16(ranges+2*i+distance+2*(codepoint-u16(starts+2*i))) if distance else codepoint
            if not distance or glyph:
                glyph = (glyph+u16(deltas+2*i)) & 0xffff
            if glyph:
                characters.add(codepoint)
font = ImageFont.truetype(str(path), 8)
lines, rejected, shifted = [], [], []
for cp in sorted(characters):
    ch = chr(cp)
    left, top, right, bottom = font.getbbox(ch)
    if right-left > 8 or bottom-top > 8 or left < 0:
        rejected.append(f'U+{cp:04X}')
        continue
    # A few native glyphs have a descender below the nominal cell. Translate
    # the whole bitmap by one row to fit, preserving every authored pixel.
    dy = min(0, 8-bottom)
    if top+dy < 0:
        rejected.append(f'U+{cp:04X}')
        continue
    mask = font.getmask(ch)
    assert set(mask) <= {0, 255}, f'antialiasing: {ch}'
    rows = [0]*8
    for y in range(mask.size[1]):
        for x in range(mask.size[0]):
            if mask[y*mask.size[0]+x]:
                rows[top+dy+y] |= 128 >> (left+x)
    if dy:
        shifted.append(f'U+{cp:04X}')
    lines.append(f'{cp:05X}:'+''.join(f'{row:02X}' for row in rows))
(root/'data/fonts/public-pixel-8.hex').write_text('\n'.join(lines)+'\n')
(root/'data/fonts/public-pixel-conversion.json').write_text(json.dumps({
    'version':'1.24', 'sourceSHA256':hashlib.sha256(data).hexdigest(),
    'size':8, 'pillow':pillow_version, 'glyphs':len(lines),
    'translatedUp':shifted, 'excludedLargerThanCell':rejected,
}, indent=2)+'\n')
print(f'{len(lines)} native glyphs; {len(rejected)} outside the 8x8 cell')
