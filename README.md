# 🎭 bAIwor Code

> *"Saka Bawor dadi bAIwor — Jiwa Punakawan, Pikiran AI, Ati Banyumas"*  
> **Official Website:** [baiwor.my.id](https://baiwor.my.id)

CLI coding agent pintar dengan estetika ala MCode dan arsitektur provider ala Hermes CLI untuk ekosistem AI [baiwor.my.id](https://baiwor.my.id).

```text
  ██████╗  █████╗ ██╗██╗    ██╗ ██████╗ ██████╗ 
  ██╔══██╗██╔══██╗██║██║    ██║██╔═══██╗██╔══██╗
  ██████╔╝███████║██║██║ █╗ ██║██║   ██║██████╔╝
  ██╔══██╗██╔══██║██║██║███╗██║██║   ██║██╔══██╗
  ██████╔╝██║  ██║██║╚███╔███╔╝╚██████╔╝██║  ██║
  ╚═════╝ ╚═╝  ╚═╝╚═╝ ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝
```

---

## ⚡ Fitur Utama

- **Antarmuka Elegan ala MCode**:
  - Banner 3D ASCII Shadow Merah-Putih presisi tinggi.
  - Kotak informasi terminal dinamis anti-pecah (*visual column aware*).
  - Status bar ringkas menampilkan workspace, model aktif, dan provider.
- **Navigasi Perintah Cerdas (Slash Commands)**:
  - Ketik `/` untuk memunculkan menu dropdown perintah secara real-time.
  - Navigasi pilihan menggunakan tombol panah atas/bawah (`↑` / `↓`).
  - Dukungan auto-complete instan menggunakan tombol `Tab` (dropdown langsung menutup).
  - Eksekusi cepat langsung dengan menekan `Enter` atau batalkan dengan `Esc`.
- **Manajemen Model & Provider ala Hermes CLI**:
  - Akses cepat via perintah `baiworcode model` (atau `baiwor model`).
  - 5 Provider OAuth terintegrasi (Gemini, OpenAI, Copilot, Qwen, MiniMax).
  - Dukungan **Custom OpenAI-compatible endpoints** (seperti AgentikMyID) lengkap dengan fetch otomatis `/models`, refresh model, dan ganti model aktif.
  - Konfigurasi tersimpan otomatis di `~/.baiwor/config.json`.

---

## 🚀 Instalasi & Menjalankan

### Prasyarat
- [Node.js](https://nodejs.org/) (versi 18+)
- npm & git (SSH terkonfigurasi)

### Langkah Instalasi
```bash
# Clone repository via SSH
git clone git@github.com:Baiwor/baiworcode.git

# Masuk ke folder proyek
cd baiworcode

# Install dependensi
npm install

# Link secara global ke sistem
npm link
```

### Menjalankan bAIwor Code
```bash
# Masuk ke mode interaktif
baiworcode
# (atau 'baiwor')

# Kelola model & provider
baiworcode model
```

---

## 📖 Daftar Perintah

Di dalam mode interaktif `baiwor`:
- `/help` — Menampilkan panduan bantuan
- `/model` — Kelola model AI & provider (ala Hermes)
- `/provider` — Alias untuk perintah `/model`
- `/clear` — Membersihkan layar dan menampilkan ulang banner
- `/exit` — Keluar dari bAIwor CLI

---

## 📜 Lisensi
MIT License © 2026 [bAIwor](https://baiwor.my.id)
