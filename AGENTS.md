# AGENTS.md — Panduan Agen untuk baiworcode

## Lingkungan kerja

bAIwor Code berjalan sepenuhnya di komputer lokal: edit kode, git, dan perintah.
Untuk pekerjaan berat, pengguna dapat memilih sendiri menjalankannya di
lingkungan Linux terisolasi (container atau VM pribadi) di luar bAIwor Code —
CLI ini tidak mengelola mesin remote.

## Pembagian beban

- edit kode, git, baca/tulis file
- test suite penuh, `npm install`, `npm ci`
- build, benchmark, perintah >60 detik
- pekerjaan berisiko atau menghasilkan banyak file

## Catatan

- Penjaga sandbox bawaan (`src/tools/sandbox.js`) menolak perintah yang menyentuh
  berkas sensitif (mis. `~/.ssh`, `~/.baiwor`) atau keluar dari workspace.
- Untuk pencarian & pembacaan berkas, utamakan `search_files` dan `read_file`
  daripada perintah shell — keduanya aman dari penyaringan string.
- `diagnostics` dipakai untuk memastikan tak ada galat tipe atau pelanggaran lint
  sebelum menyatakan tugas selesai.
