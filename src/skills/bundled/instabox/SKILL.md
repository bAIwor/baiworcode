---
name: instabox
description: Panduan lengkap memakai InstaBox Cloud Sandbox — mesin Linux 4 vCPU / 8 GiB untuk build besar, test suite berat, benchmarking, dan eksekusi berisiko tanpa membebani laptop user.
version: 1.0.0
author: Tim bAIwor Code
---

# InstaBox Cloud Sandbox

InstaBox memberi tiap agent **mesin Linux sendiri di cloud** (Firecracker MicroVM).
Gunalah untuk operasi berat agar komputer lokal user tetap adem dan tidak freeze/BSOD.

## Kapan wajib dipakai (bukan opsional)

- `npm test` / `npm run check` menyeluruh → 630+ test, rattle di Windows
- Build & kompilasi besar (bundle, Docker image, native module)
- Benchmarking & profiling
- Perintah berisiko (`rm -rf`, `mkfs`, migrasi DB) yang bisa merusak mesin user
- Setiap perintah yang butuh **Linux** (bukan cmd.exe/PowerShell)

Di Windows, perintah shell saja bisa **gagal** (bukan cuma lambat) — `rm`, `chmod`,
`apt`, `systemctl`, shebang `#!/bin/sh` tidak ada. Untuk itu InstaBox bukan opsional.

## Dua cara akses

### 1. Tool `instabox_exec` (utama, dari dalam sesi)

```
instabox_exec(command, machine_id?, timeout_ms?)
```

- `command` — perintah shell Linux. Boleh multi-line, pakai `&&`, `|`, heredoc.
- `machine_id` — opsional. Default: mesin terkonfigurasi (`baiwor`).
- `timeout_ms` — default 60 detik, **maksimum 600 detik** (10 menit).

Output balik: stdout + stderr + exit code. Non-zero exit = kegagalan, baca stderr-nya.

> Penting: `instabox_exec` dieksekusi dari **HOME** (`/data/home`), bukan root project.
> Selalu `cd` ke direktori kerja atau pakai `cwd` di dalam perintah:
> `cd /data/home/work/repo && npm test`

### 2. Perintah `/sandbox` (interaktif, dari prompt)

| Perintah | Fungsi |
|---|---|
| `/sandbox status` | Cek kesehatan mesin + spesifikasi |
| `/sandbox exec <perintah>` | Jalankan perintah shell Linux di MicroVM |
| `/sandbox sync` | Tarik update kode terbaru dari GitHub ke InstaBox |
| `/sandbox open <url>` | Buka website di browser GUI cloud |
| `/sandbox screenshot` | Unduh tangkapan layar GUI ke laptop |
| `/sandbox pause` | Bekukan mesin (hemat kuota, memory tetap) |
| `/sandbox resume` | Bangkitkan mesin kembali |
| `/sandbox machine <id>` | Ganti ID/nama mesin |
| `/sandbox key <ibk_...>` | Perbarui API Key |

## Spesifikasi mesin (fixed, tidak bisa diubah)

```
4 vCPU · 8 GiB RAM · 16 GiB root disk · 20 GiB /data (persistent)
HOME = /data/home   (root disk = ephemeral, /data = awet)
```

> `/data` bersifat persisten — paket `npm install` di sana bertahan antar-sesi.
> Root disk (16 GiB) berisi sistem dan **tidak** persisten.

## Batas keras (jangan dilanggar, akan ditolak server)

| Batas | Nilai | Catatan |
|---|---|---|
| Durasi perintah | 1–600 detik | >600 detik → error |
| Output per stream | 1 MiB | buffer, **tidak** streaming |
| stdin | 1 MiB | lebih besar → error sebelum request |
| File read/write | 10 MiB per operasi | transfer base64 ber-chunk |
| Loopback | 32 request/user | commands + file reads + desktop berbagi kuota |
| Ukuran sandbox | fixed | `vcpus`/`memMiB`/`diskGiB` → `400 spec_not_allowed` |

Perintah yang lewat batas waktu → `CommandExitError` dengan `timedOut: true`, exit code 124.

## Pola pakai yang benar

```bash
# ✅ Bawa dependensi + jalan test dalam satu perintah, cek exit code
instabox_exec("cd /data/home/work/repo && npm ci && npm test")

# ✅ Pisahkan supaya stderr mudah dibaca
instabox_exec("cd /data/home/work/repo && npm ci", timeout_ms=300000)
instabox_exec("cd /data/home/work/repo && npm test 2>&1 | tail -40", timeout_ms=600000)

# ❌ Jangan lupa cd — default cwd adalah HOME, bukan project
instabox_exec("npm test")   # → "no such file or directory"
```

### Sinkronisasi berkas lokal → sandbox

Untuk menguji berkas yang baru kamu ubah, pakai utilitas repo:

```bash
node scripts/instabox-sync.mjs src/tools/sandbox.js test/sandbox.test.js
node scripts/instabox-sync.mjs --run "npm test"
node scripts/instabox-sync.mjs src/tools/sandbox.js --run "npm test -- test/sandbox.test.js"
```

Opsi: `--dest <dir>` (default `/data/home/work/repo`), `--machine <id>`, `--run <cmd>`.

## Life-cycle: pause vs stop vs kill

| Aksi | Proses & memory | Disk | Pakai untuk |
|---|---|---|---|
| `pause()` | **Awat** | Awet | Istirahat, lanjut lagi besok |
| `stop()` | Mati | Awet | Selesai sementara, hemat memory |
| `kill()` | Hapus | **Hapus permanen** | Selesai total, bersih-bersih |

Server auto-pause setelah **30 menit idle** dan resume otomatis saat perintah berikutnya jalan.
`timeoutMs` (deadline satu kali) berbeda dari idle-pause: resume **tidak** mereset deadline.

## Snapshot & Vault

- **Snapshot** — simpan disk lalu buat mesin baru dari snapshot. Butuh scope `images:read/write`.
  Ingat: snapshot **tidak** menyimpan proses yang sedang jalan.
- **Vault** — secret milik akun ditulis ke setiap sandbox saat boot/resume.
  Untuk sandbox yang dipakai orang lain, WAJIB `vault: false` — isi Vault bisa dibaca isi sandbox.
  API key **tidak bisa** membaca/membuat item Vault.

## Autentikasi & scope

Header API: `X-API-Key: ibk_...` ke `https://api.instabox.sh`.
Environment: `INSTABOX_API_KEY`, `INSTABOX_API_URL`.

| Scope | Izin |
|---|---|
| `machines:read` | list/get mesin, template, operasi |
| `machines:write` | create, start/stop/pause/resume, exec, files, SSH |
| `machines:delete` | hapus mesin |
| `images:read/write/delete` | snapshot |

`403 insufficient_scope` → **jangan retry**, minta scope yang kurang.

## Stability & secret

- Jangan pernah print, commit, atau simpan API key ke metadata/snapshot.
- `getInfo().machine.runtime.ready` → true berarti guest siap dipakai.
- Timeout itu **batas satu kali**, bukan deteksi idle — setelah resume atur ulang bila perlu.
- Pakai `setAutoSuspend(0)` untuk sandbox yang harus hidup terus; simpan `sandboxId` untuk sambung ulang.

## Checklist sebelum eksekusi berat

1. sudah `cd` ke direktori project yang benar?
2. dependensi terpasang (`npm ci` / `npm install`)?
3. timeout cukup? (maks 600 detik)
4. output mungkin > 1 MiB? → pipe ke `tail`/`head` supaya tidak terpotong
5. perintah destruktif? → pastikan memang di sandbox, bukan mesin user
