# AGENTS.md — Panduan Agen untuk baiworcode

## Lingkungan kerja

Komputer lokal dipakai untuk mengedit, git, dan perintah ringan. Pekerjaan berat
dijalankan di InstaBox Cloud Sandbox (MicroVM Linux 4 vCPU / 8 GiB):

- Akses: `ssh instabox` (alias di `~/.ssh/config`, key `~/.ssh/id_ed25519_instabox`)
- Repo di sandbox: `/data/workspace/baiworcode`
- Machine ID + API key: `~/.baiwor/config.json` (`instaboxMachineId`, `instaboxApiKey`)
- Certificate SSH berlaku 8 jam. Bila ditolak: `node scripts/instabox-ssh.mjs`

## Pembagian beban

Jalankan di InstaBox:

- `npm test` / test suite penuh
- `npm install`, `npm ci`
- build, benchmark, perintah >60 detik
- pekerjaan berisiko atau menghasilkan banyak file

Jalankan di lokal:

- edit kode, git, baca/tulis file
- perintah ringan dan cepat (satu file test, cek versi)

## Sinkronisasi kode ke sandbox

Perubahan yang sudah di-commit dan di-push:

```sh
ssh instabox 'cd /data/workspace/baiworcode && git pull --ff-only'
```

Perubahan yang belum di-commit:

```sh
node scripts/instabox-sync.mjs src/foo.js --run "npm test"
```

## Catatan

- SDK `box.commands.run` dibatasi 600 detik; untuk proses lebih lama pakai SSH.
- Sandbox auto-pause setelah 30 menit idle, memori tetap; perintah berikutnya membangunkan.
