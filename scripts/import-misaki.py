"""Extract native kana from the author's frozen BDF archive; no rasterizer needed.

Usage: python3 scripts/import-misaki.py /path/to/misaki_bdf_2021-05-05.zip
Ordinary bank regeneration uses the checked-in subset, without this archive.
"""

import hashlib
import json
from pathlib import Path
import re
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1] / "data/fonts"
ARCHIVE_SHA = "a275f173cf5935890f84d3e65d05b1bf73028e4d4bf41cb3de0ef3b5ebe8e217"
archive = Path(sys.argv[1]).read_bytes()
assert hashlib.sha256(archive).hexdigest() == ARCHIVE_SHA, "Unexpected author archive"

with zipfile.ZipFile(sys.argv[1]) as source:
    raw = source.read("misaki_gothic.bdf")
    text = raw.decode("utf-8")
    ascent = int(re.search(r"^FONT_ASCENT (\d+)$", text, re.M)[1])
    blocks = []
    cells = []
    for match in re.finditer(r"STARTCHAR .*?ENDCHAR\n", text, re.S):
        block = match[0]
        cp = int(re.search(r"^ENCODING (\d+)$", block, re.M)[1])
        if not 0x3040 <= cp <= 0x30FF:
            continue

        width, height, x, y = map(int, re.search(r"^BBX (.+)$", block, re.M)[1].split())
        top = ascent - y - height
        assert 0 <= x and x + width <= 8 and 0 <= top and top + height <= 8
        bitmap = block.split("BITMAP\n", 1)[1].split("ENDCHAR", 1)[0].splitlines()
        assert len(bitmap) == height
        rows = [0] * 8
        for offset, byte in enumerate(bitmap):
            rows[top + offset] = int(byte, 16) >> x
        assert any(rows)
        cells.append(f"{cp:04X}:" + "".join(f"{byte:02X}" for byte in rows))
        blocks.append(block)

    # Retain exact author glyph records so source pixels can be audited locally.
    header = text.split("STARTCHAR", 1)[0]
    header = re.sub(r"^CHARS \d+$", f"CHARS {len(blocks)}", header, flags=re.M)
    subset = header + "".join(blocks) + "ENDFONT\n"
    ROOT.joinpath("misaki-kana.bdf").write_text(subset, encoding="utf-8", newline="\n")
    ROOT.joinpath("misaki-kana.hex").write_text(
        "\n".join(cells) + "\n", encoding="utf-8", newline="\n"
    )
    ROOT.joinpath("misaki.txt").write_bytes(source.read("misaki.txt"))
    ROOT.joinpath("misaki-bdf-readme.txt").write_bytes(source.read("readme.txt"))

    report = {
        "font": "Misaki Gothic 2021-05-05",
        "author": "Num Kadoma",
        "url": "https://littlelimit.net/arc/misaki/misaki_bdf_2021-05-05.zip",
        "archiveSHA256": ARCHIVE_SHA,
        "originalBDFSHA256": hashlib.sha256(raw).hexdigest(),
        "selection": "All source characters in Unicode Hiragana and Katakana blocks U+3040..U+30FF",
        "cells": len(cells),
        "fontAscent": ascent,
        "croppedOrRescaledCells": 0,
        "subsetBDFSHA256": hashlib.sha256(subset.encode()).hexdigest(),
    }
    ROOT.joinpath("misaki-conversion.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8", newline="\n"
    )
    print(json.dumps(report, indent=2))
