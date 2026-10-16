/**
 * Penulis keluaran terminal yang sadar lebar kolom.
 *
 * Masalah yang dipecahkan: keluaran AI dulu hanya diberi indentasi pada
 * newline eksplisit. Ketika sebuah baris lebih panjang dari terminal,
 * terminal membungkusnya sendiri ke kolom 0 — tanpa indentasi. Hasilnya
 * baris pertama terindentasi rapi, baris lanjutan mepet ke kiri.
 *
 * Penulis ini membungkus baris di batas kata dan memberi *hanging indent*
 * pada setiap baris lanjutan supaya seluruh blok jawaban tetap sejajar.
 *
 * Aturan penting:
 *   - Lebar setiap baris fisik tidak pernah melebihi budget, sehingga terminal
 *     tidak lagi memicu soft wrap sendiri (penyebab utama layout patah).
 *   - Kode warna ANSI tidak dihitung sebagai lebar dan tidak putus di tengah.
 *   - Baris di dalam blok kode (fence) ditulis apa adanya — memotong kode
 *     bisa merusak potongan yang kemudian disalin pengguna.
 *   - Saat `indent` kosong (di luar TTY) penulis menjadi pass-through murni.
 */

import { wrapText, visibleWidth, hangingIndent, stripAnsi } from './wrapText.js';

/**
 * @param {{out?:NodeJS.WriteStream, indent?:string, width?:number}} [options]
 *   `out`    — stream tujuan.
 *   `indent` — indentasi dasar tiap baris (biasanya 2 spasi di TTY, '' di luar TTY).
 *   `width`  — budget kolom untuk baris (sudah termasuk `indent`).
 * @returns {{
 *   write:(text:string)=>void,
 *   writeVerbatim:(text:string)=>void,
 *   wrapReasoning:(text:string)=>string,
 *   reset:()=>void,
 *   flush:()=>void,
 * }}
 */
export function createOutputWriter({ out, indent = '', width = 80 } = {}) {
  const stream = out ?? process.stdout;
  // Budget isi baris: lebar total dikurangi indentasi dasar.
  const contentWidth = Math.max(10, width - indent.length);

  /**
   * Sisa teks di baris yang belum selesai (belum diakhiri newline).
   * Streaming menyalurkan potongan kecil-kecil, jadi sebuah baris logis
   * sering tersebar di beberapa panggilan `write`.
   */
  let buffer = '';

  const isBlank = (s) => stripAnsi(s).trim() === '';

  /**
   * Mencetak satu baris logis lengkap.
   *
   * Selalu dibungkus oleh `wrapText`, termasuk paragraf biasa (tanpa penanda
   * daftar). Dulu paragraf biasa dicetak mentah dan diserahkan ke terminal;
   * soft-wrap terminal selalu kembali ke kolom 0 tanpa indentasi, sehingga
   * hanya baris pertama yang rata sementara sisanya mepet kiri.
   *
   * Dengan membungkus di sini, setiap baris fisik dijamin muat di budget kolom
   * sehingga terminal tidak lagi memicu soft-wrap sendiri, dan semua baris —
   * pertama maupun lanjutan — mendapat indentasi dari kita.
   */
  const emitLine = (line) => {
    const pad = hangingIndent(line);
    const restWidth = Math.max(5, contentWidth - pad);
    const parts = wrapText(line, { width: contentWidth, restWidth });
    // Baris lanjutan disejajarkan dengan teks setelah penanda. Spasi biasa
    // (bukan warna) dipakai sebagai gutter agar hasil salinan tetap rapi.
    const gutter = ' '.repeat(pad);
    parts.forEach((part, i) => {
      stream.write(i === 0 ? `${indent}${part}\n` : `${indent}${gutter}${part}\n`);
    });
  };

  /**
   * Menangani satu baris logis yang sudah pasti utuh.
   * Baris kosong dicetak tanpa indentasi agar paragraf tidak menumpuk spasi
   * tak terlihat.
   */
  const commitLine = (line) => {
    if (isBlank(line)) {
      stream.write('\n');
      return;
    }
    emitLine(line);
  };

  const write = (text) => {
    if (text == null) return;
    let s = buffer + String(text);
    buffer = '';
    if (!s) return;

    if (!indent) {
      // Di luar TTY: keluaran harus apa adanya agar berkas hasil
      // pipe/redirect tetap bersih tanpa spasi atau baris tambahan.
      stream.write(s);
      return;
    }

    let idx;
    while ((idx = s.indexOf('\n')) !== -1) {
      const line = s.slice(0, idx);
      s = s.slice(idx + 1);
      commitLine(line);
    }

    buffer = s;
  };

  /**
   * Menulis teks apa adanya, hanya menambahkan indentasi dasar per baris.
   * Dipakai untuk blok kode yang tidak boleh dibungkus.
   */
  const writeVerbatim = (text) => {
    if (text == null) return;
    const s = String(text);
    if (!s) return;

    if (!indent) {
      stream.write(s);
      return;
    }

    // Sisa buffer (potongan baris yang belum utuh) dicetak lebih dulu supaya
    // urutan teks tidak terbalik.
    if (buffer) {
      const held = buffer;
      buffer = '';
      writeVerbatim(held);
    }

    const lines = s.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const isLast = i === lines.length - 1;
      const line = lines[i];
      if (line === '') {
        // Elemen terakhir yang kosong hanya penanda newline penutup, bukan
        // baris baru. Mencetaknya sebagai baris akan menyisakan indentasi
        // menggantung di ekor keluaran.
        if (!isLast) stream.write('\n');
        continue;
      }
      if (isLast) {
        if (s.endsWith('\n')) stream.write(`${indent}${line}\n`);
        // Sisa tanpa newline ditulis langsung, bukan ditahan di buffer.
        // writeVerbatim dipakai untuk blok kode yang sudah utuh; menahannya
        // di buffer berarti teks itu bisa tidak pernah keluar sama sekali.
        else stream.write(`${indent}${line}`);
        continue;
      }
      // Potongan kode bisa lebih panjang dari terminal; dibiarkan membungkus
      // alami daripada dipotong, karena memotong kode lebih berbahaya.
      stream.write(`${indent}${line}\n`);
    }
  };

  /**
   * Membungkus teks reasoning dan mengembalikan string siap cetak.
   * Pemanggil membungkusnya dengan warna abu-abu, jadi di sini ANSI tidak
   * pernah hadir — cukup teks polos.
   *
   * Sisa baris terakhir ditahan sampai newline berikutnya (atau reset) supaya
   * tidak terpotong di tengah kata saat token masih menyusup.
   */
  const wrapReasoning = (text) => {
    if (text == null) return '';
    const s = String(text);
    if (!s) return '';
    if (!indent) return s;

    const merged = buffer + s;
    buffer = '';

    const idx = merged.lastIndexOf('\n');
    const ready = idx === -1 ? '' : merged.slice(0, idx + 1);
    buffer = idx === -1 ? merged : merged.slice(idx + 1);

    if (!ready) return '';

    const out = [];
    for (const line of ready.split('\n')) {
      if (line === '') continue;
      for (const part of wrapText(line, { width: contentWidth })) {
        out.push(`${indent}${part}\n`);
      }
    }
    return out.join('');
  };

  /** Membuang buffer — dipakai saat beralih dari reasoning ke jawaban. */
  const reset = () => {
    buffer = '';
  };

  /** Mencetak sisa buffer yang belum diakhiri newline. */
  const flush = () => {
    if (!buffer) return;
    const rest = buffer;
    buffer = '';
    if (isBlank(rest)) return;
    if (!indent) {
      stream.write(rest);
      return;
    }
    for (const line of wrapText(rest, { width: contentWidth })) {
      stream.write(`${indent}${line}\n`);
    }
  };

  return { write, writeVerbatim, wrapReasoning, reset, flush };
}

/**
 * Lebar tampilan sebuah string — diekspor ulang untuk kemudahan pengujian.
 */
export { visibleWidth };
