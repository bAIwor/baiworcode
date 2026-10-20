# 🎭 bAIwor Code

<p align="left">
  <a href="https://github.com/bAIwor/baiworcode"><img src="https://img.shields.io/badge/Status-Alpha%20%7C%20Penyempurnaan%20Aktif-orange?style=flat-square" alt="Status: Alpha" /></a>
  <a href="https://baiwor.my.id"><img src="https://img.shields.io/badge/Website-baiwor.my.id-blue?style=flat-square" alt="Website" /></a>
  <a href="https://agentik.my.id"><img src="https://img.shields.io/badge/Bonus%20Token-agentik.my.id-10B981?style=flat-square" alt="Bonus Token" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node.js-%3E%3D18-green?style=flat-square" alt="Node.js" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-purple?style=flat-square" alt="License: MIT" /></a>
</p>

> *"Saka Bawor dadi bAIwor — Jiwa Punakawan, Pikiran AI, Guardian Banyumas"*  
> **Website Resmi:** [https://baiwor.my.id](https://baiwor.my.id) · **Bonus Token AI:** [https://agentik.my.id](https://agentik.my.id)

> [!NOTE]
> **Status Proyek: Tahap Alpha (Penyempurnaan Aktif) 🚧**  
> bAIwor Code saat ini berada dalam tahap **Alpha** dan sedang terus disempurnakan secara aktif. Fitur baru, stabilitas, dan optimasi performa terus diperbarui setiap hari. Dokumentasi resmi, update, dan ekosistem bAIwor dapat diakses di [baiwor.my.id](https://baiwor.my.id). Masukan dan laporan kendala dapat disampaikan melalui [GitHub Issues](https://github.com/bAIwor/baiworcode/issues).

CLI coding agent pintar berbahasa Indonesia — ngobrol santai di terminal, dan bAIwor langsung bekerja di berkas proyekmu.

```text
     ╭───▲───╮                                   PT. bAIwor Agentic Indonesia
   ▄▀▀   │   ▀▀▄     ██████╗  █████╗ ██╗██╗    ██╗ ██████╗ ██████╗     ██████╗ ███████╗ ██████╗ ███████╗
 ( (O) ( o ) (O) )   ██╔══██╗██╔══██╗██║██║    ██║██╔═══██╗██╔══██╗    ██╔════╝██╔═══██╗██╔══██╗██╔════╝
 ▄███████████████▄   ██████╔╝███████║██║██║ █╗ ██║██║   ██║██████╔╝    ██║     ██║   ██║██║  ██║█████╗  
 █ █ █ █ █ █ █ █ █   ██╔══██╗██╔══██║██║██║███╗██║██║   ██║██╔══██╗    ██║     ██║   ██║██║  ██║██╔══╝  
  ▀█████████████▀    ██████╔╝██║  ██║██║╚███╔███╔╝╚██████╔╝██║  ██║    ╚██████╗╚██████╔╝██████╔╝███████╗
     ╰───┴───╯       ╚═════╝ ╚═╝  ╚═╝╚═╝ ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝     ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝
                          🎭 "Saka Bawor dadi bAIwor — Jiwa Punakawan, Pikiran AI, Guardian Banyumas"
```

---

## 🚀 Instalasi Cepat

### ⚡ Cara Instan (One-Line Installer — Sangat Direkomendasikan untuk Pemula)

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/bAIwor/baiworcode/main/install.ps1 | iex
```

**Linux / macOS (Bash):**
```bash
curl -fsSL https://raw.githubusercontent.com/bAIwor/baiworcode/main/install.sh | bash
```

Installer di atas otomatis mengecek Node.js (minimal v18), memasang bAIwor Code secara global, dan langsung siap dipakai.

### Cara 2 — Install global via npm (tahap alpha)
```bash
npm install -g baiworcode@alpha
```
Setelah itu, perintah `baiworcode` (atau `baiwor`) bisa dipakai di mana saja.
> Paket npm dirilis dengan dist-tag **alpha** selama status proyek masih Alpha. Setelah stabil, `npm install -g baiworcode` akan menjadi jalur utama.

### Cara 3 — Coba dulu tanpa install
```bash
npx baiworcode@alpha
```

### Cara 4 — Dari sumber (untuk kontributor)
```bash
git clone https://github.com/bAIwor/baiworcode.git
cd baiworcode
npm install
npm link
```

### Prasyarat
- [Node.js](https://nodejs.org/) versi **18 atau lebih baru**. Node.js 22 LTS direkomendasikan karena Node 18/20 sudah melewati masa dukungan resmi.

Cek versi Node kamu:
```bash
node --version
```

---

## 🎓 Mulai dari Sini (Panduan Pemula)

Belum pernah pakai? Ikuti tiga langkah ini.

**1. Jalankan bAIwor Code**
```bash
baiworcode
```

**2. Pilih model AI-nya (sekali saja)**
```bash
/model
```
Pilih **Agentik AI** (paling praktis, ada bonus token gratis di [agentik.my.id](https://agentik.my.id)), atau **Google Gemini** kalau mau login pakai akun Google.

**3. Langsung ngobrol**

Ketik pertanyaan atau instruksi coding seperti sedang chat biasa:

```bash
baiworcode "jelaskan struktur proyek ini"
baiworcode "perbaiki error di src/index.js"
baiworcode "buatkan test untuk fungsi hitungTotal"
```

Atau masuk ke mode interaktif lalu ketik langsung tanpa keluar aplikasi.

### Contoh hal yang bisa kamu minta
| Mau apa | Tulis apa |
|---|---|
| Paham kode orang lain | `"jelaskan cara kerja fungsi login di file ini"` |
| Cari sesuatu di proyek | `"cari semua tempat yang memanggil fungsi hitungTotal"` |
| Perbaiki bug | `"kenapa hasilnya NaN? tolong perbaiki"` |
| Bikin fitur baru | `"tambahkan validasi email di form pendaftaran"` |
| Bikin test | `"buatkan test untuk src/utils/format.js"` |
| Rapikan kode | `"refactor fungsi ini supaya lebih mudah dibaca"` |
| Jalankan & cek | `"jalankan npm test dan perbaiki yang gagal"` |

---

## ⚡ Fitur Utama

- **Antarmuka Elegan & Bersih**:
  - Maskot Wajah Topeng Bawor presisi tinggi (19 kolom × 7 baris, simetris dan anti-menceng).
  - Banner 3D ASCII Shadow Merah-Putih.
  - Kotak informasi terminal dinamis anti-pecah (*visual column aware*).
  - Area input dibingkai dua garis pemisah, dengan baris status yang ikut bergerak saat kamu mengetik — `~ │ Full access │ ✦ <model> · <provider> │ Context 92% left`.
  - Kedua garis memakai jumlah tanda pisah yang sama dan hanya berbeda empat kolom, memberi kesan undakan. Baris status menyesuaikan diri bila terminal sempit: rincian token, nama provider, dan keterangan akses dikorbankan berurutan agar tidak pernah melewati lebar terminal dan merusak kotak layout.
- **Timeline Aktivitas**:
  - Setiap tool yang dijalankan dicatat sebagai pohon: nama tool, durasi, dan jumlah baris output.
  - **Nama tool diwarnai per kategori** agar jenis langkah langsung terbaca sekilas — baca (cyan) untuk `read_file`/`webfetch`, jelajah (biru) untuk `list_directory`/`search_files`/`websearch`, tulis & ubah (hijau) untuk `write_file`/`edit_file`/`patch_file`, jalankan `run_command` (merah), rencana `todo_list` dan pemeriksaan `diagnostics` (oranye tua). Batang pohon ikut mengambil warna tool-nya.
  - Setiap langkah juga menampilkan **nama Punakawan** pelakunya (semAIr, bAIwor, pAItruk, gAIreng) dengan satu warna kuning emas yang seragam — jadi jelas "siapa" yang bertindak, sementara warna nama tool menunjukkan "aksi apa" yang dilakukan.
  - Pohon digambar **secara langsung**: langkah muncul satu per satu begitu selesai, sementara langkah yang sedang berjalan ditandai penanda berputar (`⠋`) amber dan durasi `…` — jadi progres terlihat mengalir, bukan menunggu semua tool usai.
  - Prompt persetujuan perintah menyembunyikan blok aktivitas dulu agar tampilan tidak rusak, lalu menggambarnya kembali.
  - Tool yang gagal ditandai merah agar mudah dipindai sekilas, dan keluarannya ikut diringkas.
  - Daftar tugas dari `todo_list` dirender sebagai checklist di bawah node-nya, lengkap dengan progres `3/5 selesai`.
  - Saat keluaran dialihkan (`baiworcode "prompt" > hasil.txt`), animasi dilewati dan pohon dicetak sekali tanpa karakter escape.
- **Anggun Konteks**:
  - Indikator `Context 92% left` tampil di banner awal dan sekali lagi setelah setiap jawaban.
  - Riwayat dipangkas otomatis berdasarkan perkiraan **token**, bukan jumlah pesan — hasil `read_file` yang berukuran besar tidak lagi membuat request ditolak provider.
  - Pesan `tool` tidak pernah dilepas dari pesan `assistant` yang memanggilnya, karena pasangan yang terpotong akan membuat provider menolak request.
  - Peringatan muncul dan menyarankan `/clear` saat konteks tinggal sedikit.
  - **Angkanya adalah estimasi** (sekitar 4 karakter per token), bukan hitungan token dari provider: sebagian endpoint tidak mengirim `usage`, dan model kustom tidak punya angka jendela konteks yang bisa dikutip dengan jujur. Karena itu label selalu ditandai `≈`.
- **Navigasi Perintah Cerdas (Slash Commands & Subcommands)**:
  - Ketik `/` untuk memunculkan menu dropdown perintah secara real-time.
  - Navigasi cepat dengan tombol panah (`↑` / `↓`).
  - **Auto-complete presisi dengan `Tab`**: Menekan `Tab` langsung melengkapi nama perintah/subperintah ke dalam frame input dan menutup dropdown secara instan, siap dieksekusi via `Enter` atau ditambah argumen kustom.
  - Dukungan subperintah bertingkat untuk `/timeline` (`compact` / `detail`), `/session` (`list`, `resume`, `delete`, `clear`), dan `/skill` (`list`, `info`).
  - Riwayat prompt cerdas: tombol panah `↑` / `↓` saat dropdown tertutup memanggil kembali riwayat perintah sebelumnya.
- **Aturan Proyek Otomatis (Project Rules Engine)**:
  - Otomatis mendeteksi dan menerapkan panduan koding proyek dari `BAIWORS.md`, `BAIWORS.local.md`, atau berkas aturan di `.baiwor/rules/*.md`.
  - bAIwor otomatis mematuhi standar arsitektur, konvensi penamaan, dan batasan teknologi yang kamu tetapkan untuk proyekmu tanpa perlu diingatkan berulang kali.
- **Sistem Keahlian & Plugin (.baiwor/skills)**:
  - Kelola instruksi spesifik domain dan modul keahlian di `.baiwor/skills/` untuk memperkaya wawasan bAIwor dalam menangani alur kerja khusus timmu.
- **Arsitektur Autentikasi & Provider**:
  - **Google Gemini OAuth** via PKCE (loopback + S256) — login tanpa menyimpan API key di disk.
  - **Agentik AI** sebagai provider bawaan (endpoint OpenAI-compatible + bonus token).
  - Dukungan **Custom OpenAI-compatible endpoints** lengkap dengan fetch otomatis `/models` dan ganti model aktif.
  - Konfigurasi tersimpan otomatis & atomik di `~/.baiwor/config.json` dengan proteksi backup bila file korup.
- **Mesin Chat Streaming & Agentic Loop**:
  - Panggilan `/chat/completions` streaming (SSE) dengan line-buffering agar aman dari potongan TCP.
  - Percobaan ulang otomatis (retry + backoff) saat jaringan tersendat atau provider mengembalikan error 5xx — sebelum byte pertama diterima, jadi jawaban tidak pernah terduplikasi.
  - Pesan kegagalan yang ramah dan spesifik: autentikasi, rate limit, server provider, hingga timeout/jaringan (tidak lagi menampilkan `fetch failed` mentah).
  - Dukungan token `reasoning_content` (model reasoning seperti DeepSeek R1) dan pembatalan via `Ctrl+C`.
  - Menekan `Ctrl+C` juga menghentikan perintah terminal yang sedang berjalan, termasuk mematikan seluruh pohon proses di Windows.
  - Riwayat percakapan multi-turn dengan pemangkasan otomatis agar tidak melebihi context window.
  - Berkas berakhiran baris CRLF (khas Windows) dibaca dan disunting tanpa menyisakan `\r` atau mengubah akhir baris seluruh berkas.
  - Loop agentic hingga 100 putaran: model bisa memanggil tool, membaca hasilnya, lalu melanjutkan sendiri.
  - **Selalu berakhir dengan jawaban**: bila batas putaran tercapai — atau terdeteksi model mengulang rangkaian tool yang sama tiga kali — bAIwor otomatis meminta satu giliran kesimpulan **tanpa tool**, jadi pekerjaan tidak berhenti tanpa keputusan.
- **🛠️ 15 Tool Bawaan** — bAIwor tidak hanya menjawab, tapi benar-benar mengerjakan:
  - `read_file`, `write_file`, `edit_file`, `patch_file`, `list_directory` — baca, tulis, dan sunting berkas proyek. Dilengkapi **Visual Diff Review berwarna** di timeline aktivitas dan **Snapshot Rollback instan (`/undo`)** untuk membatalkan seluruh perubahan putaran terakhir secara aman.
  - `edit_file` **tahan banting** — pencocokannya toleran terhadap perbedaan indentasi, spasi ujung baris, dan CRLF/LF, jadi refactor tidak gagal hanya karena spasi. Ada `replace_all` untuk mengganti semua kemunculan, dan `edits` untuk banyak perubahan sekaligus secara **atomik** (semua berhasil atau tidak ada yang ditulis).
  - `patch_file` — menerapkan unified diff (format `git diff`); blok konteksnya dicari ulang sehingga patch tetap kena walau nomor baris bergeser.
  - `search_files` — cari fungsi/teks di seluruh proyek tanpa membuka berkas satu per satu, dengan pengaman anti-ReDoS agar pola berat tidak membuat proses menggantung.
  - `run_command` — jalankan `npm test`, linter, git, dan perintah terminal lain.
  - `webfetch` & `websearch` — baca dokumentasi/halaman web dan cari solusi di internet. Didukung **TinyFish Web Intelligence** (rendering JavaScript modern, anti-bot bypass, hasil terstruktur & markdown bersih untuk LLM) dengan fallback mulus ke DuckDuckGo & native fetch.
  - `webautomate` — mengemudikan browser headless (Web Agent TinyFish / Mako) untuk menyelesaikan misi interaktif, ekstraksi data dinamis, dan pengisian formulir.
  - `diagnostics` — deteksi & jalankan pemeriksaan mutu proyek (script `lint`/`typecheck`/`check`, atau `tsc`/`eslint`) supaya bAIwor memverifikasi pekerjaannya sebelum menyatakan selesai.
  - **Self-Healing Diagnostics Loop** — setelah bAIwor selesai mengedit berkas, sistem otomatis menjalankan pemeriksaan diagnostik (lint/typecheck). Jika ada error syntax atau tipe, model langsung diberi konteks error dan diminta memperbaiki secara otomatis (maksimal 2x retry) sebelum memberikan jawaban akhir. Jika auto-repair gagal, pengguna mendapat peringatan jelas dengan rincian error.
  - `todo_list` — susun rencana tugas untuk pekerjaan besar dan lacak progresnya.
  - `delegate_task` & `ask_user` — orkestrasi subagent (satu tugas atau **mode paralel hingga 6 tugas, 3 berjalan bersamaan**) dan konfirmasi interaktif.
  - Mode paralel cocok untuk eksplorasi/audit independen: setiap subagent Punakawan punya histori, tool, dan laporan terisolasi; hasilnya disintesis kembali ke agen utama.
- **🔗 Hooks System (Event-Driven Automation)**:
  - Otomatis menjalankan shell command saat event tertentu terjadi: `pre-tool-execute`, `post-tool-execute`, `session-start`, `session-end`.
  - **Pre-hook** bisa memblokir eksekusi tool (misal: validasi command berbahaya sebelum `run_command`).
  - **Post-hook** untuk logging/notifikasi setelah tool selesai (misal: auto-format setelah `edit_file`).
  - Konfigurasi fleksibel di `.baiwor/hooks.json` (per-proyek) atau `~/.baiwor/hooks.json` (global).
  - Kondisi opsional untuk trigger selektif (misal: hanya untuk tool tertentu).
  - Timeout default 30 detik per hook untuk mencegah hang.
- **🔄 Workflows (Multi-Stage Orchestration)**:
  - Skrip JavaScript untuk orkestrasi multi-agent deterministik dengan fase (pipeline/parallel).
  - API sederhana: `agent()`, `parallel()`, `pipeline()`, `phase()` untuk membangun alur kerja kompleks.
  - Workflow disimpan di `.baiwor/workflows/*.js` dan bisa dijalankan ulang kapan saja.
  - Contoh use case: Review kode → Verifikasi temuan → Generate laporan, semua berjalan paralel per dimensi.
  - Execution log terstruktur untuk debugging dan audit trail.
- **🎯 Goal/Task Management System**:
  - Structured task tracking dengan dependencies, turn budgets, dan status management.
  - **Goals**: Objective besar dengan optional turn budget untuk kontrol cost.
  - **Tasks**: Unit kerja individual dengan status (pending → in_progress → completed/deleted).
  - **Dependencies**: `blocks`/`blockedBy` untuk urutan eksekusi — task hanya bisa dijalankan jika semua blocker sudah completed.
  - Persistence otomatis ke `.baiwor/goals.json` (project) atau `~/.baiwor/goals.json` (global).
  - API lengkap: `createGoal`, `getGoal`, `updateGoalStatus`, `createTask`, `getTask`, `updateTask`, `addDependency`, `getAvailableTasks`.
- **🔒 Security Scanning Integration**:
  - **Secret Detection**: Scan hardcoded secrets (API keys, passwords, tokens) di berkas kode dengan pattern matching. Mendeteksi AWS keys, GitHub tokens, JWT, private keys, dan generic secrets.
  - **Dependency Audit**: Wrapper untuk `npm audit` dan `pip-audit` untuk mendeteksi vulnerable dependencies dengan severity levels (critical, high, medium, low).
  - **Auto-redaction**: Secret value otomatis di-redact di laporan (tampilkan hanya 4 karakter pertama).
  - **Skip patterns**: Otomatis skip `node_modules`, `.git`, binary files, dan lock files.
  - Laporan human-readable dengan rekomendasi perbaikan.
- **⏰ Cron/Scheduled Tasks**:
  - Jadwalkan prompt/perintah untuk dijalankan secara berkala (cron expression) atau one-shot.
  - **Cron expression parser**: 5-field format (minute hour day month weekday) dengan support untuk wildcards (`*`), step values (`*/5`), ranges (`9-17`), dan lists (`0,15,30,45`).
  - **Recurring tasks**: Task berulang sesuai cron schedule.
  - **One-shot tasks**: Task sekali jalan pada waktu tertentu (ScheduleWakeup).
  - **Background scheduler**: Berjalan di background dan trigger task saat waktunya tiba.
  - Persistence ke `~/.baiwor/cron-tasks.json`.
- **🤖 Custom Agent Creator**:
  - Buat custom agents dengan konfigurasi spesifik: system prompt kustom, tool access yang dibatasi, model/temperature/max_tokens override.
  - **Default agents**: Punakawan Squad (pAItruk 🔭, gAIreng ⚖️, bAIwor 🔨) sudah predefined.
  - **Custom agents**: Disimpan di `.baiwor/agents/*.json` dan bisa dipanggil via `delegate_task`.
  - **Tool filtering**: Otomatis filter tool definitions berdasarkan `allowedTools` agent.
  - API: `createAgent`, `updateAgent`, `deleteAgent`, `getAgent`, `listAgents`, `filterToolsForAgent`.
- **💬 Messaging Platforms (Telegram & WhatsApp)**:
  - Akses bAIwor Code dari Telegram Bot atau WhatsApp (Baileys) dengan unified API.
  - **Telegram Bot**: Integrasi dengan `node-telegram-bot-api`, long polling, Markdown formatting, typing indicator.
  - **WhatsApp Baileys**: Integrasi dengan `@whiskeysockets/baileys`, QR code authentication, session persistence, auto-reconnect.
  - **PlatformManager**: Abstraction layer untuk multi-platform dengan event-driven message routing.
  - Commands: `/platform start telegram|whatsapp`, `/platform stop`, `/platform status`.
  - Requirements: `npm install node-telegram-bot-api @whiskeysockets/baileys`
- **🔒 Keamanan Berlapis**:
  - **Sandbox workspace** — akses berkas dibatasi pada folder proyek; area kredensial seperti `.ssh` dan `~/.baiwor` selalu ditolak.
  - **Approval Gate (Y/n)** — perintah berisiko seperti `git push`, `npm publish`, atau penghapusan rekursif akan meminta konfirmasi lebih dulu, dengan default **Tidak**.

---

## 📖 Daftar Perintah

### Di Dalam Mode Interaktif (`baiworcode` / `baiwor`)
- `/help` — Panduan bantuan & daftar perintah
- `/plan [instruksi]` — Mode arsitek semAIr: susun rencana & analisis tanpa ubah kode (read-only + checklist)
- `/build` — Kembali ke agen Build (boleh mengubah kode) dari mode Plan
- `/access [safe|full]` — Atur gerbang persetujuan perintah: safe (selalu tanya) atau full (lewati konfirmasi perintah berisiko kelas confirm; kelas deny tetap ditolak)
- `/compact` — Ringkas konteks percakapan untuk menghemat ruang token
- `/timeline [compact|detail]` — Ganti mode tampilan timeline: compact (satu baris cepat) atau detail (pohon lengkap)
- `/session [list|resume|delete|clear]` — Kelola sesi percakapan proyek (daftar sesi, lanjutkan, hapus satu, atau hapus semua)
- `/cd <folder>` — Pindah folder kerja (workspace) aktif secara langsung di dalam sesi
- `/workspace [folder]` — Lihat status ruang kerja aktif atau ganti folder kerja
- `/sandbox [status|exec|sync|open|screenshot|pause|resume|key]` — Kelola MicroVM Cloud Sandbox Linux InstaBox
- `/update [sandbox]` — Perbarui bAIwor Code ke versi terbaru dari GitHub (opsional: sinkronkan ke InstaBox)
- `/doctor` — Inspeksi kesehatan komprehensif sistem, AI provider, dan sandbox cloud
- `/skill [list|info]` — Kelola modul keahlian & plugin (`.baiwor/skills` dan bawaan)
- `/rules` — Tampilkan aturan koding aktif proyek & global (`BAIWORS.md` / `.baiwor/rules`)
- `/status` — Status konfigurasi, provider aktif, **latency**, dan sesi login
- `/tinyfish [status|search|fetch|key]` — Kelola integrasi TinyFish Web Intelligence
- `/mcp [list|refresh]` — Kelola server & tool Model Context Protocol (MCP) eksternal
- `/model [target]` — Ganti model AI & provider. Tanpa argumen membuka menu; dengan argumen switch langsung: `/model <alias>` atau `/model <provider>/<model>`. Kelola alias: `/model alias list|add|remove`
- `/provider [target]` — Alias untuk perintah `/model`
- `/login` — Login ke provider OAuth (Google Gemini)
- `/logout` — Logout dari sesi provider OAuth
- `/undo` — Batalkan seluruh perubahan berkas pada putaran (turn) terakhir secara aman tanpa merusak riwayat Git
- `/clear` — Bersihkan layar & reset riwayat percakapan
- `/reset` — Reset konteks percakapan tanpa membersihkan layar
- `/exit` — Keluar dari bAIwor Code (alias: `/q`, `/quit`)
- `/q` — Keluar dari bAIwor Code (alias `/exit`)

### Perintah Langsung CLI
- `baiworcode [folder] [prompt...]` — Buka bAIwor di folder proyek tertentu atau jalankan instruksi coding langsung
- `baiworcode -C, --cwd <folder>` — Tentukan folder kerja (workspace) aktif (alias: `-d`, `--dir`)
- `baiworcode plan [prompt...]` — Rancang rencana arsitektur & solusi langsung dari terminal luar
- `baiworcode session [list|resume|delete|clear]` — Kelola riwayat sesi proyek (lihat, lanjutkan, hapus satu, atau hapus semua)
- `baiworcode skill [action] [target]` — Kelola modul keahlian & plugin (`.baiwor/skills`)
- `baiworcode rules` — Tampilkan aturan koding aktif proyek & global (`BAIWORS.md` / `.baiwor/rules`)
- `baiworcode doctor` — Inspeksi kesehatan komprehensif sistem, AI provider, dan sandbox cloud
- `baiworcode update [sandbox] [--yes]` — Perbarui bAIwor Code ke versi terbaru dari GitHub (verifikasi origin + konfirmasi; `--yes` untuk skrip)
- `baiworcode status` — Status konfigurasi dan sesi login
- `baiworcode mcp` — Jalankan bAIwor Code sebagai MCP Server (stdio) untuk berbagai klien MCP eksternal
- `baiworcode model [target]` — Tanpa argumen: menu kelola model/provider. Dengan argumen: switch langsung (`baiworcode model step`, `baiworcode model stepfun/step-5-preview`, `baiworcode model alias add ...`)
- `baiworcode provider [target]` — Alias untuk perintah `model`
- `baiworcode login [provider]` — Login langsung ke provider OAuth
- `baiworcode logout [provider]` — Logout langsung dari provider OAuth

### ⚡ Model Aliases — Switch Model Sekali Ketik

Selain menu interaktif, model & provider bisa di-switch langsung pakai nama pendek (alias) atau short form `provider/model`:

```bash
baiworcode model step                        # lewat alias tersimpan
baiworcode model stepfun/step-5-preview      # short form: provider/model
baiworcode model gemini                      # alias bawaan (Google Gemini)
baiworcode model agentik                     # alias bawaan (Agentik AI)
```

Kelola alias (tersimpan di `~/.baiwor/config.json`, key `modelAliases`):

```bash
baiworcode model alias list                                    # lihat semua alias
baiworcode model alias add step stepfun/step-5-preview          # simpan alias baru
baiworcode model alias remove step                             # hapus alias
```

Di dalam mode interaktif, cara pakainya sama — cukup `/model step`, `/model alias list`, dan seterusnya. Alias bentuk panjang (dengan `baseUrl` + `apiKey` sendiri) bisa disunting langsung di `config.json` untuk endpoint kustom yang butuh kredensial terpisah:

```json
{
  "modelAliases": {
    "theta": {
      "model": "theta-1",
      "provider": "custom",
      "baseUrl": "https://theta.example.com/v1",
      "apiKey": "${THETA_API_KEY}"
    }
  }
}
```

> Placeholder `${THETA_API_KEY}` (atau `$VAR` / `key_env`) diekspansi **saat request**, bukan saat disimpan. `config.json` tetap menyimpan placeholder sehingga nilai rahasia tidak ikut tersimpan ke disk.
>
> Endpoint yang hanya mendukung **OpenAI Responses API** bisa dipaksa lewat `"apiStyle": "responses"` pada entri `customProviders` di `config.json` (atau `"apiStyle": "chat"` untuk memaksa Chat Completions). Tanpa itu, bAIwor mendeteksi dari URL `/responses` atau nama model.

---

## 🛠️ Daftar Tool (15 Tools)

| Tool | Kegunaan |
|---|---|
| `read_file` | Membaca isi berkas beserta nomor baris |
| `write_file` | Membuat berkas baru atau menimpa berkas yang ada |
| `edit_file` | Mengganti potongan kode (toleran indentasi/spasi; mendukung `replace_all` & `edits` sekaligus) |
| `patch_file` | Menerapkan unified diff (`git diff`) ke sebuah berkas |
| `list_directory` | Melihat daftar berkas & folder (mengabaikan `node_modules`) |
| `search_files` | Mencari teks/fungsi di seluruh proyek, atau mencari nama berkas |
| `run_command` | Menjalankan perintah terminal di dalam workspace |
| `webfetch` | Mengambil & mengekstrak URL bersih (didukung **TinyFish** rendering JS & anti-bot, fallback fetch standar) |
| `websearch` | Mencari di web terstruktur & berperingkat (didukung **TinyFish Search**, fallback DuckDuckGo) |
| `webautomate` | Menjalankan otomasi browser headless (**TinyFish Web Agent / Mako**) untuk misi interaktif web |
| `diagnostics` | Menjalankan pemeriksaan mutu proyek (lint/typecheck/tsc/eslint) |
| `todo_list` | Menyusun dan memperbarui daftar tugas multi-langkah, ditampilkan sebagai checklist |
| `delegate_task` | Mendelegasikan satu tugas, atau 2-6 tugas **paralel** (maks 3 sekaligus), ke subagent Punakawan terisolasi |
| `ask_user` | Mengajukan pertanyaan atau mengonfirmasi pilihan interaktif kepada pengguna |
| `instabox_exec` | Menjalankan perintah di MicroVM Linux InstaBox (aktif bila API key sandbox dikonfigurasi) |

### 🐟 Integrasi TinyFish Web Intelligence

bAIwor Code kini terintegrasi secara bawaan dengan ekosistem [TinyFish](https://www.tinyfish.ai/):
- **Search API**: Pencarian web berperingkat tinggi, terstruktur, dan cepat tanpa risiko bot blocking.
- **Fetch API**: Mengambil konten web dengan rendering JavaScript lengkap, bypass Cloudflare/anti-bot secara otomatis, dan mengembalikan Markdown bersih yang hemat token LLM.
- **Web Automate (Mako Agent)**: Mengemudikan browser nyata via perintah alami untuk menyelesaikan alur multi-langkah di web.
- **Perintah REPL `/tinyfish`**:
  - `/tinyfish status` — Menampilkan status koneksi, API key aktif, dan saldo wallet TinyFish.
  - `/tinyfish search <query>` — Uji pencarian web langsung dari terminal.
  - `/tinyfish fetch <url>` — Uji ekstraksi halaman web langsung dari terminal.
  - `/tinyfish key <apiKey>` — Mengatur atau memperbarui TinyFish API Key.

### 🔌 Model Context Protocol (MCP)

bAIwor Code mendukung standar terbuka **Model Context Protocol (MCP)** secara dua arah:

#### 1. Sebagai MCP Client (Konsumsi Tool Eksternal)
bAIwor Code dapat terhubung ke berbagai server MCP (baik via **remote HTTP** maupun **stdio command**), membaca seluruh tools yang diekspos server tersebut, dan langsung menyediakannya ke dalam loop agentic bAIwor.
- Server dari konfigurasi **global** (`~/.baiwor/config.json` / `~/.baiwor/mcp.json`) aktif otomatis.
- Server dari berkas **proyek** (`.mcp.json` / `.baiwor/mcp.json`) **tidak dijalankan otomatis**. Saat masuk sesi interaktif, bAIwor menampilkan perintah/URL yang akan dijalankan dan meminta persetujuan. Persetujuan disimpan per folder + hash berkas; jika isi berkas berubah, persetujuan diminta ulang. Di mode non-TTY, server proyek dilewati.
- Konfigurasi server MCP tersimpan di `~/.baiwor/config.json` (key `"mcpServers"`) atau berkas lokal proyek `.baiwor/mcp.json`:
  ```json
  {
    "mcpServers": {
      "github": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-github"],
        "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "..." }
      },
      "custom_remote": {
        "type": "remote",
        "url": "https://mcp.example.com",
        "headers": { "Authorization": "Bearer ..." }
      }
    }
  }
  ```
- Integrasi TinyFish MCP otomatis aktif bila `tinyfishApiKey` tersedia di konfigurasi bAIwor.
- **Perintah REPL `/mcp`**:
  - `/mcp list` — Tampilkan seluruh server MCP dan daftar tool dinamis yang terhubung.
  - `/mcp refresh` — Muat ulang dan sambungkan kembali seluruh koneksi server MCP.

#### 2. Sebagai MCP Server (Gunakan bAIwor Code di Klien MCP Eksternal)
bAIwor Code dapat bertindak sebagai server MCP berstandar stdio JSON-RPC 2.0 untuk mengekspos **15 tools bawaan bAIwor Code** ke berbagai aplikasi klien MCP eksternal:
```bash
baiworcode mcp
```
Contoh konfigurasi di file konfigurasi MCP klien Anda:
```json
{
  "mcpServers": {
    "baiworcode": {
      "command": "baiworcode",
      "args": ["mcp"]
    }
  }
}
```

### Contoh Pemakaian Tool Baru

Cukup tulis dalam bahasa sehari-hari — bAIwor memilih tool-nya sendiri:

| Mau apa | Tulis apa |
|---|---|
| Baca dokumentasi | `"buka https://nodejs.org/api/fs.html lalu ringkas bagian promises"` |
| Cari solusi galat | `"cari di web kenapa fetch gagal dengan 'ECONNRESET' di Node.js"` |
| Ganti semua sekaligus | `"ganti semua console.log di src/ menjadi logger.info"` |
| Terapkan patch/diff | `"terapkan patch berikut ke src/utils.js: <tempel unified diff>"` |
| Periksa sebelum selesai | `"jalankan diagnostics dan perbaiki semua yang gagal"` |
| Cek tipe & lint | `"cek lint dan tipe proyek ini, lalu rapikan"` |

---

## 🔒 Keamanan

bAIwor Code dapat membaca, menulis, dan menjalankan perintah di komputermu. Karena itu ada beberapa lapis pengaman:

1. **Sandbox workspace** — akses berkas dibatasi pada folder proyek (dan folder temp). Pemeriksaan memakai **realpath**, sehingga symlink/junction yang mengarah ke luar workspace (`~/.ssh`, `~/.baiwor`, folder lain) ditolak. Upaya keluar lewat `cd ..`, `cd ./..`, path `..\\`, `$env:USERPROFILE`, dan UNC path juga ditolak. Pencocokannya sadar konteks: **menyebut** `.ssh` di dalam pesan commit tidak diblokir, tetapi **akses berkasnya** tetap ditolak.
2. **Approval Gate** — perintah berisiko (`git push`, `npm publish`, `rm -rf`, `git reset --hard`, `rmdir /s`, `Remove-Item -Recurse`, dan sejenisnya) tidak dijalankan sebelum kamu menyetujuinya. Jawaban default adalah **Tidak**.
3. **Trust MCP proyek** — server MCP dari `.mcp.json` proyek harus disetujui dulu; perintah yang akan dijalankan ditampilkan sebelum eksekusi. Environment MCP juga dibatasi (allowlist), tidak lagi mewariskan seluruh token/API key.
4. **Proteksi web fetch** — alamat loopback/privat/link-local dan hostname yang resolve ke IP privat ditolak (anti-SSRF), redirect divalidasi per hop, ukuran body dibatasi, dan konten web ditandai sebagai tidak tepercaya. Untuk pengembangan lokal, set `BAIWOR_ALLOW_PRIVATE_FETCH=1`.
5. **Update terkendali** — `baiwor update` memverifikasi origin repositori resmi, meminta konfirmasi, memakai `git pull --ff-only`, dan memasang dependensi dengan `--ignore-scripts`. Gunakan `--yes` hanya di skrip yang sudah kamu kontrol.

> **Catatan:** pengaman perintah bekerja dengan mengenali pola, jadi sifatnya berlapis — bukan isolasi tingkat sistem operasi. Untuk pekerjaan yang sangat sensitif, tetap periksa perintah yang diminta bAIwor sebelum menyetujuinya.
>
> **Repo tidak tepercaya:** saat agen diminta menjalankan test/lint/diagnostics, script dari `package.json` proyek ikut dieksekusi. Buka hanya proyek yang kamu percaya, atau jalankan dulu di InstaBox/container terpisah.

---

## 🎁 Bonus Kredit & Komunitas
Pengguna dan instalasi bAIwor Code berkesempatan mendapatkan bonus token/kredit API melalui partner resmi di [agentik.my.id](https://agentik.my.id) dengan kode kupon **"baiworcode"**.

---

## 🌐 Tentang bAIwor & Website Resmi

- **Website Resmi**: [https://baiwor.my.id](https://baiwor.my.id)
- **Ekosistem & Pembaruan**: Kunjungi [baiwor.my.id](https://baiwor.my.id) untuk dokumentasi lengkap, panduan setup, dan informasi rilis terbaru.
- **Bonus Token AI**: Dapatkan kuota token tambahan melalui [https://agentik.my.id](https://agentik.my.id) (Kupon: `baiworcode`).
- **Pengembang**: PT. bAIwor Agentic Indonesia.

---

## 📜 Lisensi
MIT License © 2026 [bAIwor](https://baiwor.my.id) — lihat berkas [LICENSE](LICENSE).
