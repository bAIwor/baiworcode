# tools/event — Penangkapan Layar Terminal

Alat kecil untuk membuat tangkapan layar terminal **dari keluaran asli
aplikasi**, bukan rekonstruksi. Dipakai untuk membuat aset visual di
`docs/screenshots/`.

## Kenapa perlu alat ini

CLI terminal menentukan tampilan dari beberapa hal sekaligus: dukungan ANSI,
lebar kolom, dan status TTY. Kalau keluarannya di-*pipe* ke berkas, warnanya
hilang dan TUI berantakan. Alat di folder ini menyelesaikan dua masalah itu:

1. **Pemalsuan TTY** (`spoof.mjs`) — membuat proses believes stdout-nya
   terminal sungguhan, sehingga warna dan layout aktif.
2. **Emulator terminal** (`ansi-html.mjs`) — merekonstruksi layar terakhir dari
   aliran ANSI, termasuk gerakan kursor, ECH, ED, dan *scrolling* viewport.

Hasil akhirnya dirender ke PNG dengan Chrome headless (`render-shot.mjs`).

## Berkas

| Berkas | Fungsi |
|---|---|
| `spoof.mjs` | Preloader: memalsukan `stdout.isTTY` + `columns`, lalu mengimpor target. |
| `tty-run.mjs` | Menjalankan CLI di bawah pseudo-TTY dan menyimpan keluaran ANSI mentah ke `.ansi`. |
| `pty-capture.mjs` | Menjalankan TUI sungguhan di dalam PTY (ConPTY di Windows) — untuk TUI yang menolak jalan tanpa TTY. |
| `pty-frames.mjs` | Merekam layar PTY menjadi rangkaian frame PNG (lewat Chrome DevTools Protocol). |
| `make-video.mjs` | Merakit frame PNG menjadi video MP4 (H.264) memakai ffmpeg. |
| `ansi-html.mjs` | Emulator terminal → grid sel bergaya → HTML. |
| `term-html.mjs` | Pembangun HTML bergaya terminal (dipakai render-shot & pty-frames). |
| `render-shot.mjs` | ANSI → HTML bergaya terminal → PNG via Chrome headless. |

## Pemakaian

```bash
# 1) jalankan CLI di bawah pseudo-TTY, simpan ANSI mentah
node tools/event/tty-run.mjs --out tools/event/out/help.ansi --cols 120 -- \
  node tools/event/spoof.mjs "$PWD/bin/baiwor.js" --help

# 2) render jadi PNG
node tools/event/render-shot.mjs tools/event/out/help.ansi docs/screenshots/03-baiworcode-cli.png \
  --title "baiworcode --help" --cols 120 --width 1500
```

Untuk TUI yang butuh TTY sungguhan (mis. MiniMax Code):

```bash
node tools/event/pty-capture.mjs --out tools/event/out/tui.ansi \
  --cwd "$PWD" --cols 120 --rows 40 --wait 60000 --type "prompt kamu" -- \
  "C:\Program Files\nodejs\node.exe" "C:\path\to\cli.js"

node tools/event/render-shot.mjs tools/event/out/tui.ansi docs/screenshots/01-minimax-code-m31-flash.png \
  --title "MiniMax Code · MiniMax-M3.1-Flash" --cols 120 --rows 40 --width 1500
```

`pty-capture.mjs` butuh [`node-pty`](https://github.com/microsoft/node-pty)
(dipasang terpisah, di luar repo):

```bash
npm install node-pty --prefix "$HOME/.baiwor/pty-tools"
```

## Catatan

- `--rows` = tinggi viewport. Untuk tangkapan non-TUI biarkan besar supaya tidak
  ada yang terpotong; untuk TUI gunakan ukuran terminal aslinya.
- Output `.ansi` di `tools/event/out/` tidak ikut ter-commit.
- Chrome headless butuh `--disable-component-update`; tanpa itu prosesnya
  macet di updater Windows.
