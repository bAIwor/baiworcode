# Creation Note — bAIwor Code

> Catatan pembuatan untuk submission event **MiniMax Code × M3.1 Flash**.

---

## 1. Yang dibuat

**bAIwor Code** — *terminal AI coding agent* berbahasa Indonesia dengan Tokio
Punakawan (pewayangan Jawa) sebagai persona agen.

CLI open-source yang berjalan di terminal: mengobrol santai seperti biasa, lalu
langsung membaca, menulis, dan menjalankan perintah di proyekmu. 15 tool
bawaan (baca/edit/patch berkas, jalankan perintah, pencarian, delegasi ke
subagen, MCP, web), 4 kepribadian Punakawan yang dipilih otomatis menurut
jenis pekerjaan, approval gate untuk perintah berisiko, dan revert `/undo`.

| | |
|---|---|
| Repo | https://github.com/bAIwor/baiworcode |
| Paket npm | `@baiworcode/baiworcode` (v1.0.0-beta.6) |
| Website | https://baiwor.my.id |
| Lisensi | MIT |

**Skala:** 67 modul sumber (±19.700 baris) · 58 berkas uji (±11.260 baris) ·
945 test · 159 commit · tanpa dependensi runtime berat.

## 2. Dibangun dengan apa

**MiniMax Code** (terminal coding agent dari MiniMax) dengan model
**`MiniMax-M3.1-Flash` (M3.1 Flash)**.

MiniMax Code dipakai sebagai *bangun* (build tool) — bukan hanya sebagai obrolan.
Agen berjalan dalam loop: membaca berkas, menjalankan perintah, membaca
kembali hasilnya, lalu memutuskan langkah berikutnya, sampai pekerjaannya
selesai dan teruji.

Bukti yang bisa diperiksa di dalam repo:

- `src/chat/todoTool.js` — mengadaptasi perilaku `clearSettled` dari MiniMax Code.
- `src/chat/todoReminder.js` — mengadaptasi mekanisme `<task-reminder>` dari MiniMax Code.
- `src/chat/reasoningPlaceholder.js` — penanganan `reasoning_content` untuk
  kompatibilitas reasoning provider MiniMax.
- Seluruh 159 commit dikerjakan bersama agen, dengan satu author
  (`dev@baiwor.my.id`).

## 3. Kenapa M3.1 Flash, dan bagaimana dipakai

| Kemampuan M3.1 Flash | Dipakai untuk |
|---|---|
| **Konteks 1 juta token** | Membaca seluruh arsip codebase sekaligus. Arsitektur 67 modul dipahami sebagai satu keseluruhan, bukan berkas per berkas — vital untuk tool yang saling berinteraksi (`presenter.js` ↔ `punakawan.js` ↔ `answerStyle.js`). |
| **Tool calling agentik** | Model memutuskan sendiri tool apa yang dipakai, lalu membaca hasil tool untuk melangkah berikutnya. Lapis keamanan (approval gate, sandbox path containment, fencing output tool, redaksi session log) dirancang dari feedback loop ini. |
| **Penalaran yang bisa diatur** (`effort`) | Deep reasoning saat merancang arsitektur keamanan; penalaran ringan saat menulis kode rutin. |
| **Multimodal** | Mendukung lampiran gambar sebagai input agen (`src/chat/multimodal.js`) — payload multi-modal disusun sesuai standar OpenAI & Gemini. |
| **Streaming + reasoning** | `reasoning_content` jadi blok "Thinking" di terminal; blok itu yang jadi jejak audit keputusan agen. |

Konsekuensi praktisnya: **bAIwor Code yang sekarang berjalan di terminal ini
adalah hasil kerja M3.1 Flash** — mulai dari rancangan arsitektur, penambahan
tool, sampai suite uji yang hijau.

## 4. Yang bisa dicoba

```bash
# coba langsung tanpa install
npx @baiworcode/baiworcode "jelaskan struktur proyek ini"

# atau install global
npm install -g @baiworcode/baiworcode
baiworcode
```

---

## 5. Tangkapan layar

| Berkas | Isi |
|---|---|
| [`media/baiworcode-demo.mp4`](media/baiworcode-demo.mp4) | Demo video 32 detik — bAIwor Code berjalan nyata di terminal |
| [`screenshots/01-minimax-code-m31-flash.png`](screenshots/01-minimax-code-m31-flash.png) | MiniMax Code + M3.1 Flash bekerja di repo bAIwor Code |
| [`screenshots/02-baiworcode-agent-loop.png`](screenshots/02-baiworcode-agent-loop.png) | bAIwor Code menjalankan agent loop: blok Thinking, timeline tool, badge Punakawan |
| [`screenshots/03-baiworcode-cli.png`](screenshots/03-baiworcode-cli.png) | CLI bAIwor Code dan 15 toolnya |
| [`screenshots/04-baiworcode-banner.png`](screenshots/04-baiworcode-banner.png) | Banner bAIwor Code — logo Bawor & sapaan Punakawan |

Semua tangkapan layar dan video diambil dari keluaran asli aplikasi — bukan
rekonstruksi. Demo video direkam lewat pseudo-terminal sungguhan, lalu
dirakit frame per frame.

## 6. Penutup

bAIwor Code lahir dari satu tastes sederhana: coding agent terminal harus bisa
berbicara seperti manusia, punya watak, dan tetap bisa dipercaya. MiniMax Code
+ M3.1 Flash memberinya tangan; Banyumas memberinya jiwa.

---

*bAIwor Code — PT. bAIwor Agentic Indonesia · MIT License*
