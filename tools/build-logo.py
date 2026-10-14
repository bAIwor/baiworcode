#!/usr/bin/env python3
"""
build-logo.py — Catatan referensi aset logo bAIwor Code.

Aset logo resmi sudah final dan tersimpan di src/assets/baworLogo.js:
Wajah Topeng Bawor, 19 kolom x 7 baris, simetris, berwarna ANSI
(dengan varian `mono` sebagai fallback terminal tanpa warna).

Skrip ini SENGAJA tidak menghasilkan maupun menulis file apa pun.
Versi sebelumnya pernah men-generate aset secara otomatis, dan itu berisiko
menimpa aset resmi bila dijalankan tanpa sengaja. Sekarang fungsinya hanya
mencetak informasi aset.
"""

ASSET_PATH = "src/assets/baworLogo.js"


def main():
    print(f"bAIwor Code — aset logo resmi: {ASSET_PATH}")
    print("Format: 19 kolom x 7 baris (simetris, ANSI color + fallback mono)")
    print("Skrip ini tidak menulis file apa pun.")


if __name__ == "__main__":
    main()
