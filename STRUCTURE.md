# Struktur Arsitektur bAIwor Code

Dokumen ini menjelaskan struktur direktori, pemetaan implementasi tools, alur eksekusi *agent loop*, serta daftar fitur yang belum ada / pengembangan lanjutan untuk repositori **bAIwor Code** (`baiworcode`).

---

## 1. Tree Struktur Folder (`bin/` & `src/`)

```text
baiworcode/
├── bin/
│   └── baiwor.js                   # CLI entry-point utama, parser argumen Commander.js, interactive REPL loop, dan slash commands handler
└── src/
    ├── agents/
    │   └── punakawan.js            # Metadata Punakawan: peran, warna, emoji, peta tool→aktor
    ├── assets/
    │   └── baworLogo.js            # Banner visual ASCII art maskot Bawor Banyumasan
    ├── auth/
    │   └── resolve.js              # Resolver kredensial provider custom (API key + baseUrl)
    ├── chat/
    │   ├── permissionMode.js       # Mode izin terpadu 4 level (safe/auto/plan/yolo) + warna pastel Google
    │   ├── answerStyle.js          # Parser dan penata gaya markdown streaming untuk terminal TTY
    │   ├── client.js               # HTTP client SSE streaming OpenAI-compatible dengan auto-retry & error-recovery
    │   ├── compact.js              # Engine perangkuman riwayat cerdas (/compact dan auto-compact)
    │   ├── context.js              # Penghitung konteks: usage ASLI provider bila ada, estimasi (≈) sebagai cadangan
    │   ├── conversation.js         # Pengelola status memori percakapan aktif
    │   ├── deliverables.js         # Parser tag <deliver-assets> dan perender kartu OSC 8 clickable link
    │   ├── index.js                # Orkestrator utama Agentic Loop interaksi LLM dan eksekusi tool
    │   ├── liveActivity.js         # Komponen visual status tool interaktif (animasi in-place spinner)
    │   ├── multimodal.js           # Penanganan multi-modal & media asset ingestion (gambar ke base64 data URI)
    │   ├── outputWriter.js         # Penulis keluaran terminal sadar kolom dengan hanging-indent
    │   ├── planMode.js             # Penegakan read-only permissionMode "plan" dan widget todo list
    │   ├── presenter.js            # Rotasi penyampai jawaban Punakawan (work-type + round-robin, badge & piket harian)
    │   ├── reasoningPlaceholder.js # Pengaman kompatibilitas reasoning_content untuk API provider
    │   ├── sessionManager.js       # Manajer persistensi sesi percakapan ke format JSONL di disk
    │   ├── sessionStats.js         # Statistik sesi duduk (giliran, tool, berkas) untuk kuitansi /exit
    │   ├── systemPrompt.js         # Generator prompt sistem bAIwor (Punakawan Banyumasan & instruksi kerja)
    │   ├── timeline.js             # Visualisasi riwayat pemanggilan tool (compact, detail, tree)
    │   ├── todoReminder.js         # Logika injeksi pengingat daftar tugas (<planning-reminder> & <task-reminder>)
    │   └── wrapText.js             # Utilitas pemotongan teks aman kode escape ANSI
    ├── mcp/
    │   ├── client.js               # Klien MCP (Model Context Protocol) untuk koneksi ke MCP Server eksternal (TinyFish)
    │   ├── index.js                # Ekspor modul integrasi MCP
    │   └── server.js               # MCP Server stdio: default read-only, tool tulis/perintah via opt-in eksplisit
    ├── rules/
    │   └── ruleManager.js          # Pemuat aturan proyek custom (BAIWORS.md dan .baiwor/rules/*.md)
    ├── skills/
    │   ├── bundled/                # Modul skill bawaan yang dikirim bersama paket (scope 'builtin')
    │   │   └── instabox/
    │   │       └── SKILL.md        # Panduan InstaBox Cloud Sandbox bawaan
    │   └── skillManager.js         # Pemuat skill modular (.baiwor/skills/*.md + bundled/)
    ├── tools/
    │   ├── approval.js             # Dialog interaktif konfirmasi pengguna untuk perintah berisiko
    │   ├── definitions.js          # Skema JSON Schema OpenAI function-calling untuk seluruh tools
    │   ├── diagnosticsTool.js      # Handler tool diagnostics (pemeriksaan lint & typecheck otomatis)
    │   ├── editUtil.js             # Engine manipulasi teks: EOL normalizer, search-replace, multi-edit, diff patcher
    │   ├── handlers.js             # Handler eksekusi berkas & terminal (read, write, edit, patch, list, run)
    │   ├── index.js                # Indeks tools, registrasi bawaan, dan dispatching
    │   ├── instaboxTool.js         # Handler tool instabox_exec & kontrol MicroVM cloud InstaBox
    │   ├── questionnaireTool.js    # Handler tool ask_user untuk pertanyaan interaktif pilihan ganda
    │   ├── registry.js             # Registri tool internal, pembatasan output (capToolOutput), dan pengelompokan toolset
    │   ├── sandbox.js              # Analisis keamanan perintah shell, path containment, dan pencegah perintah berbahaya
    │   ├── searchTool.js           # Handler tool search_files (pencarian regex isi berkas dan glob nama berkas)
    │   ├── subagentTool.js         # Handler tool delegate_task (subagent tunggal/paralel Punakawan: semAIr, pAItruk, gAIreng, bAIwor)
    │   ├── todoTool.js             # Handler tool todo_list dan in-memory todo store
    │   └── webTool.js              # Handler tool webfetch, websearch, dan webautomate (didukung TinyFish / DuckDuckGo)
    ├── branding.js                 # Konstanta identitas merek, slogan, dan entitas PT BAIWOR AGENTIC INDONESIA
    ├── cliHelp.js                  # Pemformat bantuan CLI (--help) dengan warna Chalk
    ├── colors.js                   # Utilitas deteksi kapabilitas warna terminal (16 color, 256 color, Truecolor)
    ├── config.js                   # Pembaca dan penyimpan konfigurasi lokal (~/.baiwor/config.json)
    ├── modelAlias.js               # Resolver alias pintas model (mis. 'agentik', 'deepseek')
    ├── modelMenu.js                # Menu interaktif pemilihan model AI dan konfigurasi endpoint
    ├── prompt.js                   # Prompt masukan kustom (SlashTextPrompt) dengan auto-complete dropdown perintah
    ├── spinner.js                  # Indikator loading terminal sederhana
    ├── statusLine.js               # Baris status bawah terminal (indikator model, token context budget, access mode)
    ├── theme.js                    # Skema warna dan border UI Banyumas Punakawan
    └── workspace.js                # Resolver jalur kerja workspace dan isolasi root direktori
```

---

## 2. Daftar Tools yang Sudah Diimplementasi

bAIwor Code memiliki **15 tools bawaan** yang didaftarkan ke OpenAI Function Calling format:

| No | Nama Tool | Berkas Implementasi | Toolset | Fungsi Utama |
|---|---|---|---|---|
| 1 | `read_file` | `src/tools/handlers.js` | `file` | Membaca isi berkas dalam workspace dengan penomoran baris, mendukung pagination (`offset`, `limit`). |
| 2 | `write_file` | `src/tools/handlers.js` | `file` | Membuat berkas baru atau menulis ulang berkas secara utuh di dalam batas workspace. |
| 3 | `edit_file` | `src/tools/handlers.js`<br>`src/tools/editUtil.js` | `file` | Mengganti potongan kode/teks secara presisi (*search-and-replace* toleran indentasi) atau multi-edit atomik. |
| 4 | `patch_file` | `src/tools/handlers.js`<br>`src/tools/editUtil.js` | `file` | Menerapkan patch berkas berbasis format unified diff (*git diff hunk*). |
| 5 | `list_directory` | `src/tools/handlers.js` | `file` | Menampilkan struktur berkas dan folder, menyaring `node_modules` dan `.git`, mendukung rekursif & kedalaman. |
| 6 | `run_command` | `src/tools/handlers.js`<br>`src/tools/sandbox.js` | `terminal` | Mengeksekusi perintah shell lokal di dalam workspace. Mendukung eksekusi asinkron latar belakang (*background task* via `run`, `status`, `stop`, `list`). |
| 7 | `search_files` | `src/tools/searchTool.js` | `file` | Mencari pola regex di seluruh berkas (`target: "content"`) atau mencari berkas berdasarkan pola glob (`target: "files"`). |
| 8 | `todo_list` | `src/tools/todoTool.js` | `todo` | Menyusun, memperbarui status (`pending`, `in_progress`, `completed`, `cancelled`), dan mengelola checklist multi-langkah. |
| 9 | `webfetch` | `src/tools/webTool.js` | `web` | Mengambil dan membersihkan isi halaman web (HTML ke Markdown) via TinyFish Fetch API atau fallback native fetch. |
| 10 | `websearch` | `src/tools/webTool.js` | `web` | Melakukan pencarian informasi terkini di internet (TinyFish Search API / DuckDuckGo). |
| 11 | `webautomate` | `src/tools/webTool.js` | `web` | Otomasi browser interaktif (ekstraksi data dinamis, interaksi halaman) via Web Agent TinyFish. |
| 12 | `diagnostics` | `src/tools/diagnosticsTool.js` | `quality` | Menjalankan pemeriksaan otomatis mutu proyek (skrip `check`, `typecheck`, `lint` di package.json, `tsc`, atau `eslint`). |
| 13 | `delegate_task` | `src/tools/subagentTool.js` | `agent` | Mendelegasikan satu tugas atau 2-6 tugas paralel (konkurensi 3) ke peran Punakawan (`semAIr` perencanaan read-only, `pAItruk` eksplorasi read-only, `gAIreng` audit/test, `bAIwor` coding). Tiap subagent terisolasi; batas 5 menit/40 tool call per subagent. |
| 14 | `ask_user` | `src/tools/questionnaireTool.js` | `interactive` | Mengajukan pertanyaan interaktif dengan pilihan jawaban (*single-select* atau *multi-select*) ke pengguna di terminal. |
| 15 | `instabox_exec` | `src/tools/instaboxTool.js` | `sandbox` | Menjalankan perintah di MicroVM Linux InstaBox (aktif bila API key sandbox dikonfigurasi). |

*Catatan Tambahan:*  
Selain 15 tool bawaan di atas, sistem mendukung integrasi protokol **MCP (Model Context Protocol)** melalui `src/mcp/client.js` (klien) dan `src/mcp/server.js` (server stdio). Tool MCP dinamis didaftarkan dengan prefix nama server. Server MCP dari konfigurasi proyek (`.mcp.json` / `.baiwor/mcp.json`) memerlukan persetujuan pengguna per folder + hash konfigurasi sebelum dijalankan.

---

## 3. Alur Agent Loop (Input Pengguna → Eksekusi Tool)

Alur kerja agen dari pengetikan input hingga pemanggilan tool berlangsung dalam siklus berikut:

```text
[Input Pengguna]
       │
       ▼
1. CLI REPL & Prompt Parsing (bin/baiwor.js & src/prompt.js)
   • Menangkap prompt dari argumen CLI atau interactive REPL.
   • Memeriksa apakah input merupakan slash command (/model, /permission, /compact, dll.).
   • Jika chat biasa, dialihkan ke handleUserChat() di src/chat/index.js.
       │
       ▼
2. Resolusi Kredensial & Sinkronisasi Konteks
   • Membaca kredensial provider aktif melalui src/auth/resolve.js.
   • Menyusun System Prompt (src/chat/systemPrompt.js) dengan injeksi aturan proyek (BAIWORS.md via src/rules/ruleManager.js) dan skill lokal.
   • Menambahkan pesan pengguna ke memori Conversation (src/chat/conversation.js).
       │
       ▼
3. Pemeriksaan Anggaran Token & Pemadatan Konteks
   • Auto-Compact Guard: Jika estimasi token mencapai ambang batas (>= 80% context window), jalankan autoCompactConversation() (src/chat/compact.js).
   • Token Budgeting: Memangkas pesan terlama yang melebihi jendela konteks dengan tetap mempertahankan system prompt dan integritas pasangan blok tool.
   • Perencanaan Nudge: Menyuntikkan peringatan sementara (<planning-reminder> atau <task-reminder>) bila agen mengeksekusi banyak tool tanpa rencana.
       │
       ▼
4. Streaming Request ke LLM Provider (src/chat/client.js)
   • Mengirim payload messages dan daftar tool (difilter berdasarkan mode izin: Plan mengirim hanya tool read-only).
   • Menerima respons SSE (Server-Sent Events) secara streaming:
     - onReasoning: Menampilkan blok berpikir ("💭 Thinking") dengan perataan indentasi.
     - onDelta: Menata gaya keluaran markdown secara langsung ke terminal via AnswerStyler dan OutputWriter.
     - tool_calls: Mengakumulasi argumen function call JSON parsial.
       │
       ▼
5. Deteksi Tool Call & Gerbang Keamanan (Approval Gate)
   • Jika LLM tidak memanggil tool: Siklus selesai, respons asisten disimpan, menunggu input berikutnya.
   • Jika LLM meminta pemanggilan tool:
     1. Simpan pesan assistant beserta tool_calls dan reasoning ke Conversation.
     2. Validasi Sandbox (src/tools/sandbox.js): Mengklasifikasikan perintah (allow, confirm, deny).
     3. Mode Izin (src/chat/permissionMode.js): safe=semua perubahan tanya, auto=hanya perintah berisiko yang tanya, yolo=lewati confirm (deny tetap ditolak). Dialog persetujuan via src/tools/approval.js.
     4. Mode Plan Guard (src/chat/planMode.js): Menolak keras jika ada tool pengubah berkas terpanggil saat permissionMode "plan" aktif.
       │
       ▼
6. Eksekusi Tool (src/tools/registry.js -> dispatchTool)
   • **Pre-tool-execute Hook** (src/hooks/hookManager.js): Sebelum tool dijalankan, trigger hook `pre-tool-execute` (jika terdaftar). Hook bisa memblokir eksekusi jika exit code non-zero atau output mengandung "BLOCK:". Kondisi opsional untuk trigger selektif (misal: hanya untuk tool tertentu).
   • Menjalankan fungsi handler terkait.
   • Memotong keluaran jika melampaui batas MAX_TOOL_OUTPUT_CHARS dan menyimpannya ke berkas laporan (.baiwor/reports/tool-outputs/).
   • Memasukkan hasil keluaran sebagai pesan dengan peran role: "tool" ke Conversation.
   • Memperbarui visual LiveActivity (ceklis hijau bila berhasil, silang merah bila gagal).
   • **Post-tool-execute Hook** (src/hooks/hookManager.js): Setelah tool selesai, trigger hook `post-tool-execute` untuk logging/notifikasi. Hook error tidak mempengaruhi hasil tool.
       │
       ▼
7. Evaluasi Loop (Agentic Turn Iteration)
   • Memeriksa deteksi loop macet (stuckLoop: pemanggilan tool identik >= 3 kali berturut-turut).
   • Memeriksa batas putaran maksimum (MAX_AGENT_TURNS = 100).
   • **Self-Healing Diagnostics Loop** (src/chat/selfHealing.js): Jika ada berkas yang berhasil dimodifikasi oleh tool write_file/edit_file/patch_file pada turn ini, jalankan pemeriksaan diagnostik otomatis (lint/typecheck) pada proyek. Jika diagnostik gagal dan retry < 2, inject pesan auto-repair ke model agar memperbaiki error sebelum lanjut. Jika retry >= 2, tampilkan peringatan ke pengguna dengan rincian error.
   • **Security Scanning** (src/security/): Integrated security scanning dengan secret detection (src/security/secretDetector.js) untuk hardcoded secrets dan dependency audit (src/security/dependencyAuditor.js) untuk vulnerable packages. Main entry point: src/security/scanner.js.
   • Jika berulang atau mencapai batas: Kirim WRAPUP_INSTRUCTION tanpa definisi tool agar LLM menyimpulkan pekerjaan.
   • Jika normal: Ulangi langkah 4 dengan riwayat pesan yang telah diperbarui.
```

---

## 4. Fitur yang Belum Ada atau Masih TODO / Pengembangan Lanjutan

Berdasarkan tinjauan arsitektur dan status fase Alpha saat ini, berikut adalah daftar area pengembangan lanjutan yang belum diimplementasikan:

1. **Terminal Stateful / Pseudo-TTY (PTY) Runner**:
   - `run_command` saat ini dieksekusi menggunakan `child_process.exec` perintah tunggal tanpa menjaga status *stateful shell session* (misal: perintah `export VAR=...` atau `cd ...` tidak bertahan ke pemanggilan berikutnya). Diperlukan backend PTY (misal `node-pty`) untuk sesi terminal interaktif persisten.

2. **Visual Diff Review & Staging Berwarna** (Sudah Diimplementasikan / Shipped):
   - Modul `src/tools/diffView.js` menghasilkan *unified diff* berwarna (ANSI) dan ringkasan statistik (`+X -Y`) saat berkas ditulis atau diedit via `write_file`, `edit_file`, atau `patch_file`, ditampilkan secara langsung pada timeline aktivitas terminal.

3. **Multi-Modal / Media Asset Ingestion** (Sudah Diimplementasikan / Shipped):
   - Modul `src/chat/multimodal.js` menangani deteksi lampiran berkas gambar (`@gambar.png` atau sintaks `/image <path>`), membaca dan mengonversi berkas biner/gambar (PNG, JPG, WebP, GIF, SVG maks 10MB) menjadi base64 data URI, serta menyusun payload konten multi-modal vision untuk model AI.

4. **Pembaruan & Verifikasi Rilis**:
   - `/update` dan `baiwor update` sudah tersedia untuk instalasi berbasis Git (verifikasi origin, konfirmasi, `--ff-only`, `--ignore-scripts`). Pembaruan untuk instalasi npm masih mengandalkan `npm update -g baiworcode`; verifikasi signature/checksum rilis belum diimplementasikan.

5. **Snapshot Undo / Rollback Workspace (`/undo`)** (Sudah Diimplementasikan / Shipped):
   - Modul `src/tools/snapshot.js` secara otomatis mencatat kondisi awal berkas sesaat sebelum dimodifikasi oleh tool pengubah berkas, dan perintah slash `/undo` mengembalikan berkas-berkas tersebut ke kondisi sebelum putaran terakhir (termasuk menghapus berkas baru yang sempat dibuat).
