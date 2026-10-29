# Panduan Posting — Event MiniMax Code × M3.1 Flash

> Semua teks siap-paste ada di folder `post/` (satu berkas per tweet).
> Semua media ada di `docs/screenshots/` dan `docs/media/`.

---

## 1. Aset yang dilampirkan

| File | Ukuran | Dipakai di |
|---|---|---|
| `docs/media/baiworcode-demo.mp4` | ~0,8 MB · 32 detik · 1920×1080 | Tweet utama (video) |
| `docs/screenshots/04-baiworcode-banner.png` | ~135 KB | Tweet utama |
| `docs/screenshots/01-minimax-code-m31-flash.png` | ~207 KB | Tweet utama |
| `docs/screenshots/02-baiworcode-agent-loop.png` | ~453 KB | Tweet utama |
| `docs/screenshots/03-baiworcode-cli.png` | ~364 KB | Tweet utama |

> X menerima maksimal 4 gambar per tweet. Kalau unggahan 4 gambar sekaligus
> gagal, lampirkan 1 video + 2 gambar di tweet utama, sisanya di tweet 2–3.

## 2. Teks siap-paste

| Berkas | Isi |
|---|---|
| `post/tweet-1-main-en.txt` | Tweet utama (English) — 278/280 karakter |
| `post/tweet-2-reply-en.txt` | Balasan + media (English) — 275/280 karakter |
| `post/thread-en.txt` | Thread lanjutan (English) — 6 tweet |
| `post/tweet-1-main-id.txt` | Tweet utama (Indonesia) — 279/280 karakter |
| `post/tweet-2-reply-id.txt` | Balasan + media (Indonesia) — 279/280 karakter |
| `post/thread-id.txt` | Thread lanjutan (Indonesia) — 6 tweet |
| `post/discord-submission.txt` | Teks submission Discord — 1969/2000 karakter |

Panjang tiap tweet sudah diverifikasi ≤ 280 karakter dengan aturan X
(URL dihitung 23 karakter). Cek ulang kapan saja:

```bash
node tools/event/check-length.mjs docs/event/post
```

## 3. Urutan posting di X

1. **Tweet utama** — tempel `post/tweet-1-main-en.txt` (atau versi Indonesia),
   lampirkan video + 2–4 gambar. Publish.
2. **Tweet 2–6** — tempel isi `post/thread-en.txt` satu per satu (pisah dengan
   baris `--- TWEET N ---`)._reply ke tweet utama.
3. Balas thread itu dengan satu tweet penutup berisi tautan creation note:
   `github.com/bAIwor/baiworcode/blob/main/docs/CREATION_NOTE.md`

## 4. Submission ke Discord — 🧩丨show-your-case

Salin seluruh isi `post/discord-submission.txt` ke channel
`🧩丨show-your-case`, lalu lampirkan video + screenshot yang sama.

## 5. Checklist sebelum kirim

- [ ] Link GitHub, npm, dan website bisa dibuka publik
- [ ] `docs/CREATION_NOTE.md` sudah ter-*push* ke `main` ✅
- [ ] Media terlampir di tweet utama
- [ ] Post menyebut **MiniMax Code** dan **M3.1 Flash** (wajib)
- [ ] `#MiniMaxCode` tercantum
- [ ] Post **tetap publik** sampai pemenang diumumkan (setelah 3 Nov 2026)
- [ ] Link + creation note sudah dikirim ke Discord `🧩丨show-your-case`

## 6. Kalau X menolak 4 gambar

Unggah 1 video + 2 gambar di tweet utama. Sisanya ditempel di tweet 2 dan 3.
