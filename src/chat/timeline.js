import chalk from 'chalk';

const DEFAULT_SUMMARY_LEN = 80;

/**
 * Objek pewarna tiruan chalk yang tidak melakukan apa pun.
 * Dipakai saat stdout bukan terminal sungguhan agar tidak ada
 * escape code yang mengotori berkas hasil pipe/redirect.
 */
const NO_COLOR = (() => {
  const identity = (v) => String(v);
  return {
    dim: identity,
    gray: identity,
    cyan: identity,
    green: identity,
    red: identity,
    yellow: identity,
    white: identity,
    bold: identity,
    hex: () => identity,
  };
})();

/**
 * Memilih pewarna sesuai kondisi terminal.
 * @param {boolean} useColor
 */
function painter(useColor) {
  return useColor ? chalk : NO_COLOR;
}

/**
 * Memubah durasi milidetik menjadi label ringkas seperti `120ms` atau `1.4s`.
 * Durasi di bawah 1 detik tidak pernah dibulatkan ke `0ms` supaya informasi
 * bahwa tool benar-benar berjalan tidak hilang.
 *
 * @param {number} ms
 * @returns {string}
 */
export function formatDuration(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value < 0) return '0ms';
  if (value < 1000) return `${Math.max(1, Math.round(value))}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

/**
 * Menghitung jumlah baris output yang berarti.
 * Baris kosong di ujung dibuang karena hampir semua tool menutup
 * keluarannya dengan newline — tanpa itu, hitungan selalu meleset satu.
 *
 * @param {string|null|undefined} text
 * @returns {number}
 */
export function countOutputLines(text) {
  if (text == null) return 0;
  const lines = String(text).split('\n');
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  return lines.length;
}

/**
 * Meratakan teks multi-baris menjadi satu baris ringkas.
 * Spasi yang berulang dijernihkan agar hasil tool yang berformat
 * (mis. `read_file`) tetap terbaca sebagai satu kalimat.
 *
 * @param {string|null|undefined} text
 * @param {number} [maxLen]
 * @returns {string}
 */
export function summarize(text, maxLen = DEFAULT_SUMMARY_LEN) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  return flat.length > maxLen ? `${flat.slice(0, maxLen - 1)}…` : flat;
}

/**
 * Meringkas argumen tool menjadi satu baris `kunci: nilai` yang informatif.
 * Nilai dipotong per-argumen lebih dulu supaya satu nilai besar (mis. regex
 * panjang pada `search_files`) tidak menelan seluruh ruang ringkasan.
 *
 * @param {object|null|undefined} args
 * @param {number} [maxLen]
 * @returns {string}
 */
export function summarizeArgs(args, maxLen = DEFAULT_SUMMARY_LEN) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return summarize(String(args ?? ''), maxLen);
  }

  const entries = Object.entries(args);
  if (!entries.length) return 'tanpa parameter';

  // Bagi rata ruang ringkasan antar-argumen supaya nilai pertama yang besar
  // tidak menelan seluruh baris. Batas minimum 12 mencegah nilai pendek
  // terpotong jadi tidak berguna.
  const perArg = Math.max(12, Math.floor(maxLen / entries.length));
  const parts = entries.map(([key, value]) => {
    let serialized;
    try {
      serialized = JSON.stringify(value) ?? String(value);
    } catch {
      serialized = String(value);
    }
    return `${key}: ${summarize(serialized, perArg)}`;
  });

  return summarize(parts.join(', '), maxLen);
}

/**
 * Menyusun ringkasan hasil tool: preferensi baris pertama, dengan
 * penyesuaian agar baris pertama yang tidak informatif (mis. angka baris
 * dari `read_file`) tidak menutupi isi sebenarnya.
 *
 * @param {string|null|undefined} output
 * @param {number} [maxLen]
 * @returns {string}
 */
export function summarizeResult(output, maxLen = DEFAULT_SUMMARY_LEN) {
  const text = String(output ?? '').trim();
  if (!text) return 'selesai';

  const lines = text.split('\n').filter((l) => l.trim() !== '');
  if (!lines.length) return 'selesai';

  // Baris pertama yang terlalu pendek biasanya penanda format (nomor baris,
  // pemisah, atau header), bukan inti hasil — lewati dan pakai baris berikutnya.
  let picked = lines[0];
  if (lines.length > 1 && picked.trim().length < 3) {
    picked = lines[1];
  }

  return summarize(picked, maxLen);
}

/**
 * Ikon per status daftar tugas.
 * `in_progress` memakai setengah lingkaran supaya berbeda jelas dari centang
 * dan lingkaran kosong — ketiganya sering berdiri berdekatan.
 */
const TODO_ICONS = {
  completed: '✓',
  in_progress: '◐',
  pending: '○',
  cancelled: '✗',
};

/**
 * Menyusun label progres daftar tugas, mis. `4/5 selesai`.
 * Item yang dibatalkan tetap dihitung pada total — disembunyikan hanya bila
 * tidak ada satu pun item tersisa, agar pengguna tidak melihat `0/0 selesai`.
 *
 * @param {Array<{status?:string}>} items
 * @returns {string}
 */
export function formatTodoProgress(items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return '';
  const done = list.filter((i) => i?.status === 'completed').length;
  return `${done}/${list.length} selesai`;
}

/**
 * Menghitung kedalaman sebuah item terhadap daftar, mengikuti rantai `parent`.
 * Rantai siklis sudah dibersihkan oleh TodoStore, tapi kita tetap menjaga
 * batas agar modul ini aman dipanggil dengan data apa pun.
 *
 * @param {Array} items
 * @param {object} item
 * @returns {number}
 */
function todoDepth(items, item) {
  const byId = new Map(items.map((i) => [i?.id, i]));
  let depth = 0;
  let cursor = item;
  const seen = new Set([item?.id]);
  while (cursor?.parent && depth < 8) {
    const parent = byId.get(cursor.parent);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    cursor = parent;
    depth += 1;
  }
  return depth;
}

/**
 * Merender daftar tugas sebagai checklist yang terbaca manusia.
 * Berbeda dengan tool lain, keluaran `todo_list` justru paling perlu
 * ditampilkan utuh — JSON-nya tidak pernah berguna bagi pengguna.
 *
 * @param {Array<{id:string, content:string, status:string, parent?:string}>} items
 * @param {{useColor?:boolean, maxItem?:number}} [options]
 * @returns {string} baris-baris checklist, atau string kosong bila tidak ada item
 */
export function renderTodoChecklist(items, { useColor = true, maxItem = 70 } = {}) {
  const c = painter(useColor);
  const list = (Array.isArray(items) ? items : []).filter(Boolean);
  if (!list.length) return '';

  return list
    .map((item) => {
      const status = TODO_ICONS[item.status] ? item.status : 'pending';
      const tint =
        status === 'completed'
          ? c.green
          : status === 'in_progress'
            ? c.cyan
            : status === 'cancelled'
              ? c.gray
              : c.dim;

      const icon = tint(TODO_ICONS[status]);
      const indent = '  '.repeat(todoDepth(list, item));
      // Content bisa sampai 4000 karakter (batas TodoStore) — tanpa dipotong,
      // satu item saja sudah cukup untuk memenuhi layar.
      const text = summarize(item.content ?? '', maxItem);
      const label = status === 'cancelled' ? c.gray(text) : text;

      return `${indent}${icon} ${label}`;
    })
    .join('\n');
}

/**
 * Merender daftar aktivitas tool sebagai pohon:
 * setiap node membawa nama tool, durasi, jumlah baris output, dan ringkasan.
 *
 * @param {Array<{name:string, args?:object, durationMs:number, output?:string, success?:boolean, detail?:string, extraMeta?:string}>} events
 * @param {{useColor?:boolean, maxSummary?:number}} [options]
 * @returns {string} blok teks siap cetak (tanpa baris kosong di akhir)
 */
export function renderTimeline(events, { useColor = true, maxSummary = DEFAULT_SUMMARY_LEN } = {}) {
  const c = painter(useColor);
  const list = (events || []).filter(Boolean);
  if (!list.length) return '';

  const out = [];

  list.forEach((ev, index) => {
    const isLast = index === list.length - 1;
    const branch = c.gray(isLast ? '└' : '├');
    const stem = c.gray(isLast ? ' ' : '│');
    const icon = ev.success === false ? c.red('✗') : c.green('✓');
    const dot = c.gray('·');

    const meta = [c.gray(formatDuration(ev.durationMs))];
    const lineCount = countOutputLines(ev.output);
    if (lineCount > 0) meta.push(c.gray(`${lineCount} baris`));
    if (ev.extraMeta) meta.push(c.gray(ev.extraMeta));

    // Nama tool dicetak tebal; yang gagal ditonjolkan merah agar mudah dipindai.
    const label = ev.success === false ? c.red(c.bold(ev.name)) : c.bold(c.white(ev.name));

    const head = `  ${branch} ${icon} ${label} ${dot} ${meta.join(` ${dot} `)}`;
    out.push(head);

    // `detail` dipakai tool yang keluaran mentahnya tidak berguna bagi manusia
    // (mis. `todo_list` yang mengembalikan JSON) — ia menggantikan ringkasan
    // argumen/hasil, bukan menambahkannya.
    if (ev.detail) {
      for (const line of String(ev.detail).split('\n')) {
        out.push(`  ${stem}   ${line}`);
      }
      return;
    }

    const argsText = summarizeArgs(ev.args, maxSummary);
    const resultText =
      ev.success === false
        ? summarize(ev.output, maxSummary)
        : summarizeResult(ev.output, maxSummary);

    if (argsText) out.push(`  ${stem}   ${c.dim(argsText)}`);
    if (resultText) out.push(`  ${stem}   ${c.dim(resultText)}`);
  });

  return out.join('\n');
}
