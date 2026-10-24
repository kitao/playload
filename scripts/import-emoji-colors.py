# Freeze Twemoji color statistics. Pillow 12.3.0; no images are shipped.

import concurrent.futures
import hashlib
import io
import json
import math
import pathlib
import re
import tempfile
import urllib.request

try:
    from PIL import Image
except ImportError:
    raise SystemExit("Color import requires Pillow 12.3.0. See docs/glyphs.md.") from None

ROOT = pathlib.Path(__file__).resolve().parents[1]
REVISION = "b6b55fef1e8636b540a6d016a4729ca8cdf2e60b"
URL = f"https://raw.githubusercontent.com/jdecked/twemoji/{REVISION}/assets/72x72/"
CACHE = pathlib.Path(tempfile.gettempdir()) / "playload-twemoji-colors" / REVISION
OUTPUT = ROOT / "data/fonts/twemoji-colors.json"


def histogram(pixels):
    buckets = {}
    for r, g, b, a in pixels:
        if a < 128:
            continue
        bucket = buckets.setdefault((r >> 5, g >> 5, b >> 5), [0, 0, 0, 0])
        for i, value in enumerate((r, g, b)):
            bucket[i] += value * a
        bucket[3] += a

    result = []
    for r, g, b, weight in buckets.values():
        color = "#" + "".join(f"{math.floor(v / weight + 0.5):02x}" for v in (r, g, b))
        result.append([color, weight])
    return sorted(result)


def foreground(image):
    # Remove a flat colored backplate, only when a sizeable foreground remains.
    bounds = image.getchannel("A").point(lambda a: 255 if a >= 128 else 0).getbbox()
    if bounds is None:
        raise ValueError("Reference image has no opaque pixels")
    cropped = image.crop(bounds)
    pixels = list(cropped.get_flattened_data())
    opaque = sum(p[3] >= 128 for p in pixels)
    if opaque < 0.9 * len(pixels):
        return pixels, False

    width, height = cropped.size
    corners = [
        cropped.getpixel((int((width - 1) * x), int((height - 1) * y)))
        for x, y in ((0.12, 0.12), (0.88, 0.12), (0.12, 0.88), (0.88, 0.88))
    ]
    if any(p[3] < 128 for p in corners):
        return pixels, False
    color = min((p[:3] for p in corners), key=lambda c: sum(math.dist(c, p[:3]) for p in corners))
    if max(color) - min(color) < 40 or any(math.dist(p[:3], color) > 70 for p in corners):
        return pixels, False

    mask = {i for i, p in enumerate(pixels) if p[3] >= 128 and math.dist(p[:3], color) > 80}
    # The plate's dark perimeter is not part of the central symbol. Remove
    # residual components touching its outer edge, without character exceptions.
    pending = [i for i in mask if i % width in (0, width - 1) or i // width in (0, height - 1)]
    while pending:
        i = pending.pop()
        if i not in mask:
            continue
        mask.remove(i)
        x, y = i % width, i // width
        neighbors = (
            i - 1 if x else -1,
            i + 1 if x + 1 < width else -1,
            i - width if y else -1,
            i + width if y + 1 < height else -1,
        )
        pending.extend(j for j in neighbors if j in mask)

    remaining = [pixels[i] for i in sorted(mask)]
    share = sum(p[3] for p in remaining) / sum(p[3] for p in pixels)
    return (remaining, True) if 0.08 <= share <= 0.6 else (pixels, False)


def import_color(cp):
    name = f"{cp:x}.png"
    cached = CACHE / name
    if not cached.exists():
        with urllib.request.urlopen(URL + name, timeout=30) as response:
            cached.write_bytes(response.read())
    source = cached.read_bytes()
    with Image.open(io.BytesIO(source)) as image:
        if image.size != (72, 72):
            raise ValueError(f"Unexpected Twemoji image size: {name}: {image.size}")
        pixels, removed = foreground(image.convert("RGBA"))
    return f"{cp:04X}", {
        "sha256": hashlib.sha256(source).hexdigest(),
        "plateRemoved": removed,
        "samples": histogram(pixels),
    }


if __name__ == "__main__":
    fonts = set()
    for file in ("unscii-8.hex", "public-pixel-8.hex"):
        for line in (ROOT / "data/fonts" / file).read_text(encoding="utf-8").splitlines():
            cp, bits = line.split(":")
            if len(bits) == 16:
                fonts.add(int(cp, 16))

    selected = set()
    for line in (ROOT / "data/fonts/emoji-test.txt").read_text(encoding="utf-8").splitlines():
        match = re.match(r"^([0-9A-F ]+)\s*; fully-qualified", line)
        if match:
            points = [int(cp, 16) for cp in match[1].split() if cp not in ("FE0E", "FE0F")]
            if len(points) == 1 and points[0] in fonts:
                selected.add(points[0])

    CACHE.mkdir(parents=True, exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        glyphs = dict(pool.map(import_color, sorted(selected)))

    if OUTPUT.exists():
        previous = json.loads(OUTPUT.read_text(encoding="utf-8"))
        if previous["revision"] == REVISION:
            for cp, entry in glyphs.items():
                expected = previous["glyphs"].get(cp)
                if expected and entry["sha256"] != expected["sha256"]:
                    raise ValueError(f"Twemoji source hash changed: U+{cp}")

    output = {
        "source": "Twemoji, PNG at 72px",
        "revision": REVISION,
        "url": URL,
        "extractorSHA256": hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),
        "extraction": "RGBA alpha >= 128, alpha-weighted 3-bit RGB buckets with observed mean colors; flat-backplate removal as defined in scripts/import-emoji-colors.py",
        "glyphs": glyphs,
    }
    OUTPUT.write_text(
        json.dumps(output, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    print(f"Frozen color statistics for {len(glyphs)} emoji: {OUTPUT.stat().st_size} bytes")
