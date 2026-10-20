import { createPainter } from '../colors.js';
import { palette } from '../theme.js';
import { sanitizeTerminalText } from './wrapText.js';

const DEFAULT_SUMMARY_LEN = 80;

/**
 * Warna nama tool per kategori, memakai token palet tema bAIwor Code (lihat
 * `src/theme.js`):
 *   - baca (`read_file`)            → info (cyan)
 *   - telusur (`list`/`search`)     → secondary (biru)
 *   - tulis & ubah (`write`/`edit`) → success (hijau)
 *   - jalankan (`run_command`)      → error (merah)
 *   - rencana (`todo_list`)         → warning (oranye tua)
 *
 * Kategori yang sama memakai warna yang sama, sejalan dengan standar tema
 * bAIwor Code yang memetakan jenis operasi ke warna semantik yang konsisten.
 */
const TOOL_TINTS = {
  read_file: palette.info, // cyan — membaca
  list_directory: palette.secondary, // biru — menjelajah
  search_files: palette.secondary, // biru — mencari (sama seperti list)
  write_file: palette.success, // hijau — membuat
  edit_file: palette.success, // hijau — mengubah (sama seperti write)
  patch_file: palette.success, // hijau — menempel patch (sama seperti edit)
  run_command: palette.error, // merah — menjalankan
  todo_list: palette.warning, // oranye tua — merencanakan
  webfetch: palette.info, // cyan — membaca halaman web
  websearch: palette.secondary, // biru — menelusuri web
  webautomate: palette.primary, // oranye aksen — otomasi browser
  diagnostics: palette.warning, // oranye tua — memeriksa mutu
  delegate_task: palette.primary, // oranye aksen — mendelegasikan subagent
  ask_user: palette.warning, // oranye tua — menanyakan keputusan ke pengguna
  instabox_exec: palette.primary, // oranye aksen — cloud sandbox MicroVM
};

/**
 * Pemetaan peran Tim Punakawan AI untuk setiap kategori tool:
 * - pAItruk : Riset & Penelusuran berkas (read_file, list_directory, search_files)
 * - bAIwor  : Master Builder eksekutor kode (write_file, edit_file)
 * - gAIreng : Quality Gate & Auditor penguji perintah (run_command)
 * - semAIr  : Arsitek & Pamomong strategi (todo_list, delegate_task, ask_user)
 */
export const PUNAKAWAN_ROLES = {
  read_file: 'pAItruk',
  list_directory: 'pAItruk',
  search_files: 'pAItruk',
  webfetch: 'pAItruk',
  websearch: 'pAItruk',
  webautomate: 'pAItruk',
  write_file: 'bAIwor',
  edit_file: 'bAIwor',
  patch_file: 'bAIwor',
  run_command: 'gAIreng',
  diagnostics: 'gAIreng',
  todo_list: 'semAIr',
  delegate_task: 'semAIr',
  ask_user: 'semAIr',
  instabox_exec: 'bAIwor',
};

/**
 * Palet warna representasi karakter Tim Punakawan AI.
 *
 * Semua anggota memakai SATU warna yang sama — kuning emas — supaya identitas
 * "siapa yang bertindak" seragam dan langsung terbaca. Kategori aksi sudah
 * dibedakan lewat warna nama tool (lihat TOOL_TINTS), jadi peran dan jenis
 * aksi tidak saling berebut perhatian.
 */
export const PUNAKAWAN_COLORS = {
  semAIr: palette.gold, // kuning emas — Arsitek & Pamomong
  bAIwor: palette.gold, // kuning emas — Master Builder
  pAItruk: palette.gold, // kuning emas — Penelusur & Periset
  gAIreng: palette.gold, // kuning emas — Auditor & Quality Gate
};

const DEFAULT_TOOL_TINT = palette.textMuted;

/**
 * Nama tampilan ramah (bahasa Indonesia) untuk tiap tool. Nama teknis
 * (`read_file`, `run_command`, …) tetap dipakai saat memanggil fungsi ke model —
 * alias ini murni kosmetik agar timeline tidak terkesan kaku.
 */
export const TOOL_LABELS = {
  read_file: 'Baca berkas',
  write_file: 'Tulis berkas',
  edit_file: 'Ubah berkas',
  patch_file: 'Terapkan patch',
  list_directory: 'Lihat folder',
  search_files: 'Cari berkas',
  run_command: 'Jalankan perintah',
  todo_list: 'Daftar tugas',
  webfetch: 'Ambil halaman',
  websearch: 'Cari di web',
  webautomate: 'Otomasi web',
  diagnostics: 'Periksa mutu',
  delegate_task: 'Delegasi tugas',
  ask_user: 'Tanya pengguna',
  instabox_exec: 'Eksekusi cloud (InstaBox)',
};

/**
 * Mengembalikan nama tampilan sebuah tool. Tool yang tak dikenal jatuh ke nama
 * teknisnya supaya tetap informatif.
 *
 * @param {string} name
 * @returns {string}
 */
export function toolLabel(name) {
  return TOOL_LABELS[name] || name;
}

/**
 * Mengembalikan kode warna hex untuk sebuah nama tool.
 * @param {string} name
 * @returns {string}
 */
export function toolColorHex(name) {
  return TOOL_TINTS[name] || DEFAULT_TOOL_TINT;
}

/**
 * Memilih pewarna sesuai kondisi terminal.
 * Painter terpusat dari `colors.js` — sumber tunggal untuk seluruh modul
 * yang butuh pewarna opsional.
 * @param {boolean} useColor
 */
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
  const flat = sanitizeTerminalText(text, { preserveNewlines: false })
    .replace(/\s+/g, ' ')
    .trim();
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
    let cleanVal = value;
    if (typeof cleanVal === 'string' && (key.toLowerCase().includes('path') || key === 'file')) {
      try {
        const cwd = process.cwd();
        if (cleanVal.startsWith(cwd)) {
          const rel = cleanVal.slice(cwd.length).replace(/^[\\/]+/, '').replace(/\\/g, '/');
          if (rel) cleanVal = rel;
        }
      } catch {}
    }
    let serialized;
    try {
      serialized = JSON.stringify(cleanVal) ?? String(cleanVal);
    } catch {
      serialized = String(cleanVal);
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
  const c = createPainter(useColor);
  const list = (Array.isArray(items) ? items : []).filter(Boolean);
  if (!list.length) return '';

  return list
    .map((item) => {
      const status = TODO_ICONS[item.status] ? item.status : 'pending';
      const tint =
        status === 'completed'
          ? c.hex(palette.success)
          : status === 'in_progress'
            ? c.hex(palette.info)
            : status === 'cancelled'
              ? c.hex(palette.textMuted)
              : c.dim;

      const icon = tint(TODO_ICONS[status]);
      const indent = '  '.repeat(todoDepth(list, item));
      // Content bisa sampai 4000 karakter (batas TodoStore) — tanpa dipotong,
      // satu item saja sudah cukup untuk memenuhi layar.
      const text = summarize(item.content ?? '', maxItem);
      const label = status === 'cancelled' ? c.hex(palette.textMuted)(text) : text;

      return `${indent}${icon} ${label}`;
    })
    .join('\n');
}

/**
 * Merender daftar aktivitas tool sebagai pohon:
 * setiap node membawa nama tool, durasi, jumlah baris output, dan ringkasan.
 *
 * Sebuah event boleh bertanda `running: true` — dipakai saat blok digambar
 * ulang secara langsung (lihat `LiveActivity`). Node yang berjalan memakai
 * penanda berputar dan durasi `…`, bukan centang/silang.
 *
 * @param {Array<{name:string, args?:object, durationMs:number, output?:string, success?:boolean, detail?:string, extraMeta?:string, running?:boolean}>} events
 * @param {{useColor?:boolean, maxSummary?:number, spinnerFrame?:string}} [options]
 * @returns {string} blok teks siap cetak (tanpa baris kosong di akhir)
 */
export function renderTimeline(
  events,
  { useColor = true, maxSummary = DEFAULT_SUMMARY_LEN, spinnerFrame = '⠋' } = {}
) {
  const c = createPainter(useColor);
  const list = (events || []).filter(Boolean);
  if (!list.length) return '';

  const out = [];

  list.forEach((ev, index) => {
    const isLast = index === list.length - 1;
    const isRunning = ev.running === true;
    // Warna nama tool mengikuti kategorinya; batang pohon ikut diwarnai tipis
    // agar satu node terlihat sebagai satu kesatuan saat dipindai.
    const tint = c.hex(toolColorHex(ev.name));
    //Cabang pohon pakai gaya pohon standar (├── / └──) sehingga struktur
    // hierarki terbaca jelas dan tidak terlihat terlalu tipis.
    const branch = c.gray(isLast ? '└──' : '├──');
    const stem = tint(isLast ? ' ' : '│');
    // Jarakkan baris anak agar selaras dengan label di cabang induk.
    // Dengan cabang '├── ' (4 karakter) + spasi, label dimulai di kolom ke-8.
    // Stem '│' + 5 spasi juga mencapai kolom ke-8.
    const childIndent = '     ';
    const icon = isRunning
      ? c.hex(palette.warning)(spinnerFrame)
      : ev.success === false
        ? c.hex(palette.error)('✗')
        : c.hex(palette.success)('✓');
    const dot = c.gray('·');

    const meta = [c.gray(isRunning ? '…' : formatDuration(ev.durationMs))];
    const lineCount = isRunning ? 0 : countOutputLines(ev.output);
    if (lineCount > 0) meta.push(c.gray(`${lineCount} baris`));
    if (ev.extraMeta) meta.push(c.gray(ev.extraMeta));

    const punakawan = PUNAKAWAN_ROLES[ev.name];
    // Nama karakter Punakawan selalu kuning emas (seragam) agar identitas aktor
    // langsung terbaca; warna kategori tetap dipegang oleh nama tool di
    // sampingnya.
    const actorTint = c.hex(PUNAKAWAN_COLORS[punakawan] || palette.gold);
    const actorPrefix = punakawan ? `${actorTint(c.bold(punakawan))} ${c.gray('·')} ` : '';

    // Nama tool memakai warna kategorinya; saat gagal ditonjolkan merah agar
    // mudah dipindai — nama Punakawan tetap emas, hanya aksinya yang menyala.
    const failed = !isRunning && ev.success === false;
    const toolName = (failed ? c.hex(palette.error) : tint)(c.bold(toolLabel(ev.name)));
    const label = `${actorPrefix}${toolName}`;

    const head = `  ${branch} ${icon} ${label} ${dot} ${meta.join(` ${dot} `)}`;
    out.push(head);

    // `detail` dipakai tool yang keluaran mentahnya tidak berguna bagi manusia
    // (mis. `todo_list` yang mengembalikan JSON) — ia menggantikan ringkasan
    // argumen/hasil, bukan menambahkannya.
    if (ev.detail) {
      // Detail dihasilkan aplikasi (mis. checklist todo) setelah kontennya
      // disanitasi di summarize(); warna internalnya harus dipertahankan.
      for (const line of String(ev.detail).split('\n')) {
        out.push(`  ${stem}${childIndent}${line}`);
      }
      return;
    }

    const argsText = sanitizeTerminalText(summarizeArgs(ev.args, maxSummary), {
      preserveNewlines: false,
    });
    if (argsText) out.push(`  ${stem}${childIndent}${c.dim(argsText)}`);

    // Saat masih berjalan belum ada keluaran untuk diringkas.
    if (isRunning) return;

    const rawOut = sanitizeTerminalText(ev.output).trim();
    if (!rawOut) {
      out.push(`  ${stem}${childIndent}${c.dim('selesai')}`);
    } else {
      const allLines = rawOut.split('\n');
      if (allLines.length <= 1) {
        const resultText =
          ev.success === false
            ? summarize(rawOut, maxSummary)
            : summarizeResult(rawOut, maxSummary);
        if (resultText) out.push(`  ${stem}${childIndent}${c.dim(resultText)}`);
      } else {
        const MAX_OPEN_LINES = 10;
        const displayLines = allLines.slice(0, MAX_OPEN_LINES);
        for (const line of displayLines) {
          const trimmed = line.trimEnd();
          if (trimmed.length > 0) {
            out.push(`  ${stem}${childIndent}${c.dim(summarize(trimmed, maxSummary))}`);
          }
        }
        if (allLines.length > MAX_OPEN_LINES) {
          out.push(`  ${stem}${childIndent}${c.dim(`… (+${allLines.length - MAX_OPEN_LINES} baris lagi)`)}`);
        }
      }
    }
  });

  return out.join('\n');
}

/**
 * Mode tampilan timeline yang didukung.
 *
 * - `detail`  : pohon dua baris per node (argumen + ringkasan hasil).
 * - `compact` : satu baris per node, gaya CLI bAIwor Code yang ringkas dan modern —
 *               hanya ikon status, aktor, nama tool, dan meta ringkas.
 *
 * @type {ReadonlyArray<'detail'|'compact'>}
 */
export const TIMELINE_MODES = Object.freeze(['detail', 'compact']);

/**
 * Menormalkan masukan mode timeline menjadi nilai yang dikenal.
 * Nilai asing/kosong jatuh ke `fallback` supaya konfigurasi yang rusak
 * tidak pernah membuat renderer melempar error.
 *
 * @param {unknown} value
 * @param {'detail'|'compact'} [fallback]
 * @returns {'detail'|'compact'}
 */
export function resolveTimelineMode(value, fallback = 'detail') {
  const mode = String(value ?? '')
    .trim()
    .toLowerCase();
  if (mode === 'open' || mode === 'expanded' || mode === 'expand') return 'detail';
  if (mode === 'fold' || mode === 'folded' || mode === 'close' || mode === 'closed') return 'compact';
  return TIMELINE_MODES.includes(mode) ? mode : fallback;
}

/**
 * Merender timeline dalam mode ringkas: SATU baris per aktivitas.
 *
 * Pola tampilan ringkas di mana tiap langkah cukup
 * `├ ✓ Baca berkas · 120ms · 3 baris` — tanpa baris anak argumen/hasil,
 * sehingga alur kerja tetap terbaca utuh walau satu giliran memanggil
 * belasan tool. Identitas Tim Punakawan tetap dipertahankan di depannya.
 *
 * Node yang gagal menyertakan alasan singkat supaya diagnosis tidak
 * memaksa pengguna pindah ke mode detail.
 *
 * @param {Array<{name:string, args?:object, durationMs:number, output?:string, success?:boolean, extraMeta?:string, running?:boolean}>} events
 * @param {{useColor?:boolean, spinnerFrame?:string, maxSummary?:number}} [options]
 * @returns {string} baris-baris siap cetak (tanpa baris kosong di akhir)
 */
export function renderTimelineCompact(
  events,
  { useColor = true, spinnerFrame = '⠋', maxSummary = DEFAULT_SUMMARY_LEN } = {}
) {
  const c = createPainter(useColor);
  const list = (events || []).filter(Boolean);
  if (!list.length) return '';

  return list
    .map((ev, index) => {
      const isLast = index === list.length - 1;
      const isRunning = ev.running === true;
      const failed = !isRunning && ev.success === false;

      const branch = c.gray(isLast ? '└' : '├');
      const icon = isRunning
        ? c.hex(palette.warning)(spinnerFrame)
        : failed
          ? c.hex(palette.error)('✗')
          : c.hex(palette.success)('✓');
      const dot = c.gray('·');

      const tint = c.hex(toolColorHex(ev.name));
      const toolName = (failed ? c.hex(palette.error) : tint)(c.bold(toolLabel(ev.name)));

      // Aktor Punakawan tetap tampil (kuning emas) agar "siapa yang bertindak" tetap jelas.
      const punakawan = PUNAKAWAN_ROLES[ev.name];
      const actorPart = punakawan
        ? `${c.hex(PUNAKAWAN_COLORS[punakawan] || palette.gold)(c.bold(punakawan))} ${dot} `
        : '';

      const meta = [c.gray(isRunning ? '…' : formatDuration(ev.durationMs))];
      if (!isRunning) {
        const lineCount = countOutputLines(ev.output);
        if (lineCount > 0) meta.push(c.gray(`${lineCount} baris`));
      }
      if (ev.extraMeta) meta.push(c.gray(ev.extraMeta));

      // Hanya kegagalan membawa alasan; sukses tidak perlu memakan kolom.
      if (failed) {
        const reason = summarizeResult(ev.output, Math.min(48, maxSummary));
        if (reason) meta.push(c.hex(palette.error)(reason));
      }

      return `  ${branch} ${icon} ${actorPart}${toolName} ${dot} ${meta.join(` ${dot} `)}`;
    })
    .join('\n');
}

/**
 * Menjalankan renderer timeline sesuai mode yang diminta.
 *
 * @param {Array} events
 * @param {{mode?:'detail'|'compact', useColor?:boolean, spinnerFrame?:string, maxSummary?:number}} [options]
 * @returns {string}
 */
export function renderTimelineByMode(
  events,
  { mode = 'detail', useColor = true, spinnerFrame = '⠋', maxSummary = DEFAULT_SUMMARY_LEN } = {}
) {
  const resolved = resolveTimelineMode(mode);
  const opts = { useColor, spinnerFrame, maxSummary };
  return resolved === 'compact'
    ? renderTimelineCompact(events, opts)
    : renderTimeline(events, opts);
}
