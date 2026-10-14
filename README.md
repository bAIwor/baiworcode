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
  - 5 Provider OAuth terintegrasi (GitHub Copilot via Device Flow RFC 8628, Google Gemini, OpenAI, Qwen, MiniMax).
  - Perintah `baiworcode login [provider]`, `baiworcode logout [provider]`, dan `baiworcode status`.
  - Dukungan **Custom OpenAI-compatible endpoints** (seperti AgentikMyID) lengkap dengan fetch otomatis `/models`, refresh model, dan ganti model aktif.
  - Konfigurasi tersimpan otomatis & atomik di `~/.baiwor/config.json` dengan proteksi backup jika terjadi file korup.

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
- `/login` — Login ke provider OAuth (Gemini, Copilot, OpenAI, Qwen, MiniMax)
- `/logout` — Logout dari sesi provider OAuth
- `/clear` — Membersihkan layar dan menampilkan ulang banner
- `/exit` — Keluar dari bAIwor Code

### Perintah Langsung CLI:
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
