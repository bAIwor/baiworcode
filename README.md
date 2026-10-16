# 🎭 bAIwor Code

> *"Saka Bawor dadi bAIwor — Jiwa Punakawan, Pikiran AI, Ati Banyumas"*  
> **Official Website:** [baiwor.my.id](https://baiwor.my.id) · **Bonus Token AI:** [agentik.my.id](https://agentik.my.id)

CLI coding agent pintar berbahasa Indonesia — ngobrol santai di terminal, dan bAIwor langsung bekerja di berkas proyekmu.

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

### Cara 2 — Install global via npm
```bash
npm install -g baiworcode
```
Setelah itu, perintah `baiworcode` (atau `baiwor`) bisa dipakai di mana saja.

### Cara 3 — Coba dulu tanpa install
```bash
npx baiworcode
```

### Cara 4 — Dari sumber (untuk kontributor)
```bash
git clone https://github.com/bAIwor/baiworcode.git
cd baiworcode
npm install
npm link
```

### Prasyarat
- [Node.js](https://nodejs.org/) versi **18 atau lebih baru**

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
- **Navigasi Perintah Cerdas (Slash Commands)**:
  - Ketik `/` untuk memunculkan menu dropdown perintah secara real-time.
  - Navigasi dengan tombol panah (`↑` / `↓`), auto-complete dengan `Tab`, eksekusi dengan `Enter`, batal dengan `Esc`.
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
  - Loop agentic hingga 12 putaran: model bisa memanggil tool, membaca hasilnya, lalu melanjutkan sendiri.
  - **Selalu berakhir dengan jawaban**: bila batas putaran tercapai — atau terdeteksi model mengulang rangkaian tool yang sama tiga kali — bAIwor otomatis meminta satu giliran kesimpulan **tanpa tool**, jadi pekerjaan tidak berhenti tanpa keputusan.
- **🛠️ 11 Tool Bawaan** — bAIwor tidak hanya menjawab, tapi benar-benar mengerjakan:
  - `read_file`, `write_file`, `edit_file`, `patch_file`, `list_directory` — baca, tulis, dan sunting berkas proyek.
  - `edit_file` **tahan banting** — pencocokannya toleran terhadap perbedaan indentasi, spasi ujung baris, dan CRLF/LF, jadi refactor tidak gagal hanya karena spasi. Ada `replace_all` untuk mengganti semua kemunculan, dan `edits` untuk banyak perubahan sekaligus secara **atomik** (semua berhasil atau tidak ada yang ditulis).
  - `patch_file` — menerapkan unified diff (format `git diff`); blok konteksnya dicari ulang sehingga patch tetap kena walau nomor baris bergeser.
  - `search_files` — cari fungsi/teks di seluruh proyek tanpa membuka berkas satu per satu, dengan pengaman anti-ReDoS agar pola berat tidak membuat proses menggantung.
  - `run_command` — jalankan `npm test`, linter, git, dan perintah terminal lain.
  - `webfetch` & `websearch` — baca dokumentasi/halaman web dan cari solusi galat di internet tanpa perlu `curl`. Halaman HTML dibersihkan menjadi teks agar hemat konteks.
  - `diagnostics` — deteksi & jalankan pemeriksaan mutu proyek (script `lint`/`typecheck`/`check`, atau `tsc`/`eslint`) supaya bAIwor memverifikasi pekerjaannya sebelum menyatakan selesai.
  - `todo_list` — susun rencana tugas untuk pekerjaan besar dan lacak progresnya.
- **🔒 Keamanan Berlapis**:
  - **Sandbox workspace** — akses berkas dibatasi pada folder proyek; area kredensial seperti `.ssh` dan `~/.baiwor` selalu ditolak.
  - **Approval Gate (Y/n)** — perintah berisiko seperti `git push`, `npm publish`, atau penghapusan rekursif akan meminta konfirmasi lebih dulu, dengan default **Tidak**.

---

## 📖 Daftar Perintah

### Di Dalam Mode Interaktif (`baiworcode` / `baiwor`)
- `/help` — Panduan bantuan & daftar perintah
- `/plan [instruksi]` — Mode arsitek semAIr: susun rencana & analisis tanpa ubah kode (read-only + checklist)
- `/compact` — Ringkas konteks percakapan untuk menghemat ruang token
- `/session [list|resume|delete|clear]` — Kelola sesi percakapan proyek (daftar sesi, lanjutkan, hapus satu, atau hapus semua)
- `/status` — Status konfigurasi, provider aktif, **latency**, dan sesi login
- `/model` — Ganti model AI & provider tanpa keluar aplikasi
- `/provider` — Alias untuk perintah `/model`
- `/login` — Login ke provider OAuth (Google Gemini)
- `/logout` — Logout dari sesi provider OAuth
- `/clear` — Bersihkan layar & reset riwayat percakapan
- `/reset` — Reset konteks percakapan tanpa membersihkan layar
- `/exit` — Keluar dari bAIwor Code

### Perintah Langsung CLI
- `baiworcode [prompt...]` — Kirim satu prompt langsung lalu keluar (non-interaktif)
- `baiworcode plan [prompt...]` — Rancang rencana arsitektur & solusi langsung dari terminal luar
- `baiworcode session [list|resume|delete|clear]` — Kelola riwayat sesi proyek (lihat, lanjut, hapus satu, atau hapus semua)
- `baiworcode status` — Status konfigurasi dan sesi login
- `baiworcode model` — Buka menu kelola model dan endpoint
- `baiworcode login [provider]` — Login langsung ke provider OAuth
- `baiworcode logout [provider]` — Logout langsung dari provider OAuth

---

## 🛠️ Daftar Tool

| Tool | Kegunaan |
|---|---|
| `read_file` | Membaca isi berkas beserta nomor baris |
| `write_file` | Membuat berkas baru atau menimpa berkas yang ada |
| `edit_file` | Mengganti potongan kode (toleran indentasi/spasi; mendukung `replace_all` & `edits` sekaligus) |
| `patch_file` | Menerapkan unified diff (`git diff`) ke sebuah berkas |
| `list_directory` | Melihat daftar berkas & folder (mengabaikan `node_modules`) |
| `search_files` | Mencari teks/fungsi di seluruh proyek, atau mencari nama berkas |
| `run_command` | Menjalankan perintah terminal di dalam workspace |
| `webfetch` | Mengambil isi sebuah URL dan mengembalikannya sebagai teks bersih |
| `websearch` | Mencari di web (tanpa API key) untuk dokumentasi/solusi galat |
| `diagnostics` | Menjalankan pemeriksaan mutu proyek (lint/typecheck) |
| `todo_list` | Menyusun dan memperbarui daftar tugas multi-langkah, ditampilkan sebagai checklist |

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

bAIwor Code dapat membaca, menulis, dan menjalankan perintah di komputermu. Karena itu ada dua lapis pengaman:

1. **Sandbox workspace** — semua akses berkas dibatasi pada folder proyek tempat kamu menjalankannya. Percobaan keluar dari folder (misalnya `cd ..`) atau menyentuh area kredensial (`.ssh`, `.aws`, `~/.baiwor`) akan ditolak, dan penolakannya disertai penjelasan. Pencocokannya sadar konteks: **menyebut** `.ssh` di dalam pesan commit tidak diblokir, tetapi **akses berkasnya** tetap ditolak.
2. **Approval Gate** — perintah yang berpotensi mengubah status sistem atau repositori (`git push`, `npm publish`, `rm -rf`, `git reset --hard`, dan sejenisnya) tidak dijalankan sebelum kamu menyetujuinya. Jawaban default adalah **Tidak**.

> **Catatan:** pengaman ini bekerja dengan mengenali pola perintah, jadi sifatnya berlapis — bukan isolasi tingkat sistem operasi. Untuk pekerjaan yang sangat sensitif, tetap periksa perintah yang diminta bAIwor sebelum menyetujuinya.

---

## 🎁 Bonus Kredit & Komunitas
Pengguna dan instalasi bAIwor Code berkesempatan mendapatkan bonus token/kredit API melalui partner resmi di [agentik.my.id](https://agentik.my.id) dengan kode kupon **"baiworcode"**.

---

## 📜 Lisensi
MIT License © 2026 [bAIwor](https://baiwor.my.id) — lihat berkas [LICENSE](LICENSE).
