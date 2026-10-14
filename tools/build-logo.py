#!/usr/bin/env python3
"""
build-logo.py — Konversi foto Bawor menjadi logo ASCII untuk bAIwor Code.

ASCII murni (tanpa kode warna) dipilih agar tampil konsisten di semua terminal,
termasuk yang tidak mendukung truecolor.

Jalankan:  python tools/build-logo.py
Output :  src/assets/baworLogo.js  (+ preview di .logo-work/)
"""
import json
import os
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.environ.get(
    "BAWOR_SRC",
    r"C:\Users\Wijang\Downloads\baiworcodeascii.png",
)
OUT_JS = os.path.join(ROOT, "src", "assets", "baworLogo.js")
WORK = os.path.join(ROOT, ".logo-work")

TARGET_COLS = 44               # lebar logo (kolom terminal)
RAMP = " .:-=+*#%@"            # gelap -> padat, terang -> kosong
BLUR = 1.0                     # haluskan tekstur agar tidak berisik
LO, HI = 40, 240               # rentang kontras
BG = (0, 0, 0)


def load_flat(path):
    """Buka gambar, buang transparansi dengan mengomposit ke latar hitam."""
    img = Image.open(path)
    if img.mode in ("P", "RGBA", "LA") or "transparency" in img.info:
        img = img.convert("RGBA")
        base = Image.new("RGBA", img.size, BG + (255,))
        img = Image.alpha_composite(base, img)
    return img.convert("L")


def to_ascii(img, cols):
    img = img.filter(ImageFilter.GaussianBlur(BLUR))
    w, h = img.size
    # Karakter terminal +-2x lebih tinggi daripada lebar -> koreksi rasio 0.5
    rows = max(2, round(cols * (h / w) * 0.5))

    small = img.resize((cols, rows), Image.LANCZOS)

    lines = []
    for y in range(rows):
        chars = []
        for x in range(cols):
            v = small.getpixel((x, y))
            t = min(1.0, max(0.0, (v - LO) / (HI - LO)))
            chars.append(RAMP[int(t * (len(RAMP) - 1) + 0.5)])
        lines.append("".join(chars))
    return lines, rows


def main():
    os.makedirs(WORK, exist_ok=True)
    os.makedirs(os.path.dirname(OUT_JS), exist_ok=True)

    img = load_flat(SRC)
    lines, rows = to_ascii(img, TARGET_COLS)

    print(f"cols={TARGET_COLS} rows={rows}\n")
    for ln in lines:
        print("|" + ln + "|")

    with open(os.path.join(WORK, "ascii.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    body = [
        "// Auto-generated oleh tools/build-logo.py — JANGAN diedit manual.",
        f"// Sumber: {os.path.basename(SRC)}",
        "// Logo ASCII murni: aman di semua terminal (tidak butuh truecolor).",
        "",
        "export const BAWOR_LOGO = {",
        f"  cols: {TARGET_COLS},",
        f"  rows: {rows},",
        "  lines: [",
    ]
    for ln in lines:
        body.append("    " + json.dumps(ln) + ",")
    body.append("  ],")
    body.append("};")
    body.append("")

    with open(OUT_JS, "w", encoding="utf-8") as f:
        f.write("\n".join(body))

    print(f"\n-> {OUT_JS}")


if __name__ == "__main__":
    main()
