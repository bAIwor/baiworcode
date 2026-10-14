# 🎭 bAIwor Code

> *"Saka Bawor dadi bAIwor — Jiwa Punakawan, Pikiran AI, Ati Banyumas"*  
> **Official Website:** [baiwor.my.id](https://baiwor.my.id) · **Bonus Token AI:** [agentik.my.id](https://agentik.my.id)

CLI coding agent pintar dengan estetika modern ala MCode dan arsitektur provider ala Hermes CLI untuk ekosistem AI [baiwor.my.id](https://baiwor.my.id).

```text
       ╭───▲───╮        ██████╗  █████╗ ██╗██╗    ██╗ ██████╗ ██████╗ 
     ▄▀▀   │   ▀▀▄      ██╔══██╗██╔══██╗██║██║    ██║██╔═══██╗██╔══██╗
   ( (O) ( o ) (O) )    ██████╔╝███████║██║██║ █╗ ██║██║   ██║██████╔╝
   ▄███████████████▄    ██╔══██╗██╔══██║██║██║███╗██║██║   ██║██╔══██╗
   █ █ █ █ █ █ █ █ █    ██████╔╝██║  ██║██║╚███╔███╔╝╚██████╔╝██║  ██║
    ▀█████████████▀     ╚═════╝ ╚═╝  ╚═╝╚═╝ ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝
       ╰───┴───╯      
```

---

## ⚡ Fitur Utama

- **Antarmuka Elegan ala MCode**:
  - Maskot Wajah Topeng Bawor Vektor presisi tinggi (19 kolom × 7 baris, simetris dan anti-menceng).
  - Banner 3D ASCII Shadow Merah-Putih presisi tinggi.
  - Kotak informasi terminal dinamis anti-pecah (*visual column aware*).
  - Status bar ringkas menampilkan workspace, model aktif, dan provider.
- **Navigasi Perintah Cerdas (Slash Commands)**:
  - Ketik `/` untuk memunculkan menu dropdown perintah secara real-time.
  - Navigasi pilihan menggunakan tombol panah atas/bawah (`↑` / `↓`).
  - Dukungan auto-complete instan menggunakan tombol `Tab`.
  - Eksekusi cepat langsung dengan menekan `Enter` atau batalkan dengan `Esc`.
- **Arsitektur Autentikasi & Provider ala Hermes CLI**:
  - Akses cepat via perintah `baiworcode model` (atau `baiwor model`).
  - **Google Gemini OAuth** via PKCE (loopback + S256) — login tanpa menyimpan API key di disk.
  - **Agentik AI** sebagai provider bawaan (endpoint OpenAI-compatible + bonus token dari [agentik.my.id](https://agentik.my.id)).
  - Dukungan **Custom OpenAI-compatible endpoints** lengkap dengan fetch otomatis `/models`, refresh model, dan ganti model aktif.
  - Perintah `baiworcode login [provider]`, `baiworcode logout [provider]`, dan `baiworcode status`.
  - Konfigurasi tersimpan otomatis & atomik di `~/.baiwor/config.json` dengan proteksi backup jika terjadi file korup.
- **Mesin Chat Streaming & Agentic Loop**:
  - Panggilan `/chat/completions` streaming (SSE) dengan line-buffering agar aman dari potongan TCP.
  - Dukungan token `reasoning_content` (DeepSeek R1 dsb.) dan pembatalan via `Ctrl+C` (AbortController).
  - Riwayat percakapan multi-turn dengan pemangkasan otomatis agar tidak melebihi context window.
  - **Autonomous Tool Execution (Tahap 3B)**: 5 tool bawaan (`read_file`, `write_file`, `edit_file`, `list_directory`, `run_command`) dengan loop hingga 10 putaran interaksi model-tool secara mandiri.
  - Indikator terminal interaktif bergaya visual modern (`⚡ Tool: ...` dengan hasil `✓`).

---

## 🚀 Instalasi & Menjalankan

### Prasyarat
- [Node.js](https://nodejs.org/) (versi 18+)
- npm & git (SSH terkonfigurasi)

### Langkah Instalasi
```bash
# Clone repository via SSH
git clone git@github.com:bAIwor/baiworcode.git

# Masuk ke folder proyek
cd baiworcode

# Install dependensi
npm install

# Link secara global ke sistem
npm link --force
```

### Menjalankan bAIwor Code
```bash
# Masuk ke mode interaktif
baiworcode
# (atau 'baiwor')

# Tanya langsung sekali jalan (non-interaktif)
baiworcode "jelaskan isi src/config.js"

# Cek status sistem & login provider
baiworcode status

# Kelola model & provider
baiworcode model
```

---

## 📖 Daftar Perintah

### Di Dalam Mode Interaktif (`baiworcode` / `baiwor`):
- `/help` — Menampilkan panduan bantuan & daftar perintah
- `/status` — Menampilkan status konfigurasi, model aktif & sesi login OAuth
- `/model` — Kelola model AI & provider (ala Hermes)
- `/provider` — Alias untuk perintah `/model`
- `/login` — Login ke provider OAuth (Google Gemini)
- `/logout` — Logout dari sesi provider OAuth
- `/clear` — Membersihkan layar & reset riwayat percakapan
- `/reset` — Reset konteks percakapan AI tanpa membersihkan layar
- `/exit` — Keluar dari bAIwor Code

### Perintah Langsung CLI:
- `baiworcode [prompt...]` — Kirim satu prompt langsung lalu keluar (non-interaktif)
- `baiworcode status` — Status konfigurasi dan sesi login
- `baiworcode model` — Buka menu kelola model dan endpoint
- `baiworcode login [provider]` — Login langsung ke provider OAuth
- `baiworcode logout [provider]` — Logout langsung dari provider OAuth

---

## 🎁 Bonus Kredit & Komunitas
Pengguna dan instalasi bAIwor Code berkesempatan mendapatkan bonus token/kredit API melalui partner resmi di [agentik.my.id](https://agentik.my.id).

---

## 📜 Lisensi
MIT License © 2026 [bAIwor](https://baiwor.my.id)
