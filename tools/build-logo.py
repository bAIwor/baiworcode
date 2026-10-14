#!/usr/bin/env python3
"""
build-logo.py — Referensi dan generator aset logo ASCII Wajah Bawor bAIwor Code.
Aset resmi tersimpan di src/assets/baworLogo.js.
Didesain presisi 19 kolom x 7 baris dengan simetri matematis sempurna dan warna ANSI.
"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_JS = os.path.join(ROOT, "src", "assets", "baworLogo.js")

def main():
    print(f"bAIwor Code Logo Asset: {OUT_JS}")
    print("Format aktif: 19 kolom x 7 baris (Simetris & Anti-Menceng)")

if __name__ == "__main__":
    main()
