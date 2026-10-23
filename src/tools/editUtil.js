/**
 * Utilitas pengeditan berkas yang "tahan banting" untuk bAIwor Code.
 *
 * `edit_file` versi lama hanya menerima kecocokan PERSIS lewat `String.includes`,
 * sehingga refactor gagal hanya karena beda indentasi, spasi di ujung baris,
 * atau akhir baris CRLF/LF. Modul ini menambahkan beberapa strategi pencocokan
 * bertingkat (dari ketat ke longgar) plus penggantian banyak sekaligus, dan
 * pengurai unified diff untuk tool `patch_file`.
 *
 * Semua fungsi di sini murni (tidak menyentuh disk) supaya mudah diuji.
 */

/** Mendeteksi gaya akhir baris dominan sebuah teks. */
export function detectEol(text) {
  return String(text ?? '').includes('\r\n') ? '\r\n' : '\n';
}

/** Menyeragamkan akhir baris menjadi LF untuk pemrosesan internal. */
export function toLF(text) {
  return String(text ?? '').replace(/\r\n/g, '\n');
}

/** Menyusun daftar offset awal tiap baris (posisi setelah newline sebelumnya). */
function lineOffsets(lines) {
  const offsets = [];
  let pos = 0;
  for (const line of lines) {
    offsets.push(pos);
    pos += line.length + 1; // +1 untuk '\n'
  }
  return offsets;
}

/**
 * Mencari semua kemunculan `needle` pada `haystack` memakai strategi bertingkat.
 *
 * Urutan strategi (berhenti di strategi pertama yang menghasilkan kecocokan):
 *   1. `exact`       — substring persis (perilaku lama).
 *   2. `line-trimmed`— tiap baris dibandingkan setelah spasi ujung dibuang,
 *                      sehingga perbedaan indentasi/spasi ujung dimaafkan.
 *   3. `whitespace`  — seluruh rangkaian spasi dijernihkan jadi satu spasi,
 *                      menangani reflow/spasi ganda.
 *
 * @param {string} haystack Teks (LF).
 * @param {string} needle   Potongan yang dicari (LF).
 * @returns {Array<{start:number, end:number, strategy:string}>}
 */
export function locateAll(haystack, needle) {
  const hay = String(haystack ?? '');
  const ndl = String(needle ?? '');
  if (!ndl) return [];

  // 1. Persis.
  const exact = [];
  let from = 0;
  let idx;
  while ((idx = hay.indexOf(ndl, from)) !== -1) {
    const line = hay.slice(0, idx).split('\n').length;
    exact.push({ start: idx, end: idx + ndl.length, strategy: 'exact', line });
    from = idx + Math.max(1, ndl.length);
  }
  if (exact.length) return exact;

  // 2. Per-baris dengan spasi ujung dibuang.
  const trimmed = locateByLines(hay, ndl, (s) => s.trim());
  if (trimmed.length) return trimmed;

  // 3. Per-baris dengan spasi dalam dijernihkan.
  return locateByLines(hay, ndl, (s) => s.replace(/\s+/g, ' ').trim());
}

/** Pencocokan berbasis baris memakai fungsi normalisasi `norm`. */
function locateByLines(haystack, needle, norm) {
  const hayLines = haystack.split('\n');
  const needleLines = needle.split('\n');
  // Buang satu newline penutup pada needle agar tidak menghasilkan baris kosong
  // hantu di ujung blok.
  if (needleLines.length > 1 && needleLines[needleLines.length - 1] === '') {
    needleLines.pop();
  }
  const n = needleLines.length;
  if (n === 0) return [];

  const needleNorm = needleLines.map(norm);
  const offsets = lineOffsets(hayLines);
  const found = [];

  for (let i = 0; i + n <= hayLines.length; i += 1) {
    let ok = true;
    for (let j = 0; j < n; j += 1) {
      if (norm(hayLines[i + j]) !== needleNorm[j]) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;

    const start = offsets[i];
    // Sertakan newline di ujung baris terakhir bila bukan baris terakhir berkas,
    // supaya penggantian tidak menyisakan/kehilangan baris kosong.
    const end = i + n < hayLines.length ? offsets[i + n] : haystack.length;
    const line = i + 1;
    found.push({ start, end, strategy: 'fuzzy', line });
    i += n - 1; // lewati blok yang sudah cocok agar tidak tumpang tindih
  }

  return found;
}

/**
 * Menyesuaikan pengganti agar konsisten dengan blok yang digantikan pada
 * hasil pencocokan fuzzy: pertahankan ada/tidaknya newline di ujung.
 */
function adaptFuzzyReplacement(matched, replacement) {
  if (matched.endsWith('\n') && !replacement.endsWith('\n')) return `${replacement}\n`;
  if (!matched.endsWith('\n') && replacement.endsWith('\n')) return replacement.replace(/\n$/, '');
  return replacement;
}

/**
 * Mengganti `old_content` menjadi `new_content` pada sebuah teks.
 *
 * @param {string} text
 * @param {string} oldContent
 * @param {string} newContent
 * @param {{replaceAll?:boolean}} [options]
 * @returns {{ok:true, text:string, count:number, strategy:string} |
 *           {ok:false, reason:'not-found'|'ambiguous', count?:number}}
 */
export function applyEdit(text, oldContent, newContent, { replaceAll = false } = {}) {
  // BOM harus dipertahankan: pemrosesan per-baris dapat menganggapnya
  // whitespace dan menghapusnya dari baris pertama.
  const source = String(text ?? '');
  const bom = source.startsWith('\uFEFF') ? '\uFEFF' : '';
  const bodyText = bom ? source.slice(1) : source;
  const eol = detectEol(bodyText);
  const hay = toLF(bodyText);
  const needle = toLF(oldContent);
  const repl = toLF(newContent ?? '');

  if (needle === repl) {
    return { ok: false, reason: 'identical', count: 0 };
  }

  const matches = locateAll(hay, needle);
  if (!matches.length) return { ok: false, reason: 'not-found' };
  if (matches.length > 1 && !replaceAll) {
    return { ok: false, reason: 'ambiguous', count: matches.length, lines: matches.map((m) => m.line) };
  }

  const chosen = replaceAll ? matches : [matches[0]];
  let out = '';
  let cursor = 0;
  for (const m of chosen) {
    const matched = hay.slice(m.start, m.end);
    const replacement = m.strategy === 'exact' ? repl : adaptFuzzyReplacement(matched, repl);
    out += hay.slice(cursor, m.start) + replacement;
    cursor = m.end;
  }
  out += hay.slice(cursor);

  const result = eol === '\r\n' ? out.replace(/\n/g, '\r\n') : out;
  return { ok: true, text: bom + result, count: chosen.length, strategy: chosen[0].strategy };
}

/**
 * Menerapkan beberapa edit berurutan secara atomik (semua atau tidak sama sekali).
 *
 * @param {string} text
 * @param {Array<{old_content:string, new_content:string, replace_all?:boolean}>} edits
 * @returns {{ok:true, text:string, count:number} | {ok:false, index:number, reason:string, count?:number, lines?:number[]}}
 */
export function applyEditList(text, edits) {
  let current = text;
  let total = 0;
  for (let i = 0; i < edits.length; i += 1) {
    const e = edits[i] || {};
    if (typeof e.old_content !== 'string' || e.old_content === '') {
      return { ok: false, index: i, reason: 'missing-old' };
    }
    const res = applyEdit(current, e.old_content, e.new_content ?? '', {
      replaceAll: Boolean(e.replace_all),
    });
    if (!res.ok) {
      return { ok: false, index: i, reason: res.reason, count: res.count, lines: res.lines };
    }
    current = res.text;
    total += res.count;
  }
  return { ok: true, text: current, count: total };
}

/**
 * Mengurai unified diff menjadi daftar hunk. Nomor baris pada header `@@` sengaja
 * TIDAK dipercaya; blok lama dicari ulang lewat konteksnya (lebih toleran
 * terhadap pergeseran baris).
 *
 * @param {string} diffText
 * @returns {Array<{old:string[], neu:string[]}>}
 */
export function parseUnifiedDiff(diffText) {
  const lines = toLF(diffText).split('\n');
  const hunks = [];
  let cur = null;

  const isHeader = (l) =>
    l.startsWith('---') ||
    l.startsWith('+++') ||
    l.startsWith('diff ') ||
    l.startsWith('index ') ||
    l.startsWith('new file') ||
    l.startsWith('deleted file') ||
    l.startsWith('old mode') ||
    l.startsWith('new mode') ||
    l.startsWith('similarity') ||
    l.startsWith('rename ');

  for (const line of lines) {
    if (line.startsWith('@@')) {
      if (cur) hunks.push(cur);
      const m = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
      cur = {
        old: [],
        neu: [],
        oldStart: m ? Number(m[1]) : null,
        newStart: m ? Number(m[2]) : null,
      };
      continue;
    }

    if (line === '\\ No newline at end of file') continue;
    if (!cur) {
      if (isHeader(line)) continue;
      continue;
    }

    // Di dalam hunk, baris konten SELALU diawali '+', '-', spasi, atau kosong
    // (termasuk konten yang kebetulan mirip header seperti '--- teks').
    const tag = line[0];
    if (tag === '+') {
      cur.neu.push(line.slice(1));
    } else if (tag === '-') {
      cur.old.push(line.slice(1));
    } else if (tag === ' ') {
      const body = line.slice(1);
      cur.old.push(body);
      cur.neu.push(body);
    } else if (line === '') {
      // Baris konteks kosong sering muncul tanpa awalan spasi; anggap konteks.
      cur.old.push('');
      cur.neu.push('');
    }
  }
  if (cur) hunks.push(cur);
  return hunks;
}

/** Offset karakter awal baris ke-`lineNumber` (1-based) pada teks LF. */
function offsetForLine(text, lineNumber) {
  if (lineNumber <= 1) return 0;
  let count = 1;
  let pos = 0;
  while (count < lineNumber) {
    const nl = text.indexOf('\n', pos);
    if (nl === -1) return text.length;
    pos = nl + 1;
    count += 1;
  }
  return pos;
}

/**
 * Menyisipkan baris baru pada posisi baris tertentu (dipakai hunk insert-only
 * yang tidak punya baris konteks/`-` untuk dicari).
 */
function insertLinesAt(text, lineNumber, newLines) {
  const at = Math.max(0, Math.min(text.length, offsetForLine(text, lineNumber || 1)));
  let insertion = newLines.join('\n');
  const before = text.slice(0, at);
  const after = text.slice(at);
  if (at > 0 && !before.endsWith('\n')) insertion = `\n${insertion}`;
  if (
    (at < text.length || (at >= text.length && text.endsWith('\n'))) &&
    !insertion.endsWith('\n')
  ) {
    insertion += '\n';
  }
  return {
    text: before + insertion + after,
    end: at + insertion.length,
  };
}

/**
 * Menerapkan unified diff ke sebuah teks.
 *
 * @param {string} text
 * @param {string} diffText
 * @returns {{ok:true, text:string, applied:number} | {ok:false, reason:string}}
 */
export function applyUnifiedDiff(text, diffText) {
  const source = String(text ?? '');
  const bom = source.startsWith('\uFEFF') ? '\uFEFF' : '';
  const bodyText = bom ? source.slice(1) : source;
  const eol = detectEol(bodyText);
  let hay = toLF(bodyText);
  const hunks = parseUnifiedDiff(diffText);
  if (!hunks.length) return { ok: false, reason: 'no-hunks' };

  let cursor = 0;
  let applied = 0;

  for (const h of hunks) {
    const oldBlock = h.old.join('\n');

    // Hunk insert-only: tidak ada konteks untuk dicari. Gunakan nomor baris
    // tujuan dari header @@ +c,d @@.
    if (oldBlock === '') {
      if (!h.neu.length) continue;
      // Header yang gagal diparse (mis. `@@-0,0 +1,2@@` tanpa spasi) memberi
      // newStart = null. Tanpa pemeriksaan ini, insertLinesAt() memakai
      // fallback baris 1 sehingga patch tertanam di baris PERTAMA file —
      // bukan gagal. Turunkan hunk sebagai error agar isi file tidak
      // rusak diam-diam.
      if (h.newStart === null || !Number.isFinite(h.newStart)) {
        return { ok: false, reason: 'hunk-header-unparseable' };
      }
      const inserted = insertLinesAt(hay, h.newStart, h.neu);
      hay = inserted.text;
      cursor = inserted.end;
      applied += 1;
      continue;
    }

    const sub = hay.slice(cursor);
    const matches = locateAll(sub, oldBlock);
    if (!matches.length) return { ok: false, reason: 'hunk-not-found' };

    const m = matches[0];
    const absStart = cursor + m.start;
    const absEnd = cursor + m.end;
    const matched = hay.slice(absStart, absEnd);
    const repl = adaptFuzzyReplacement(matched, h.neu.join('\n'));

    hay = hay.slice(0, absStart) + repl + hay.slice(absEnd);
    cursor = absStart + repl.length;
    applied += 1;
  }

  const result = eol === '\r\n' ? hay.replace(/\n/g, '\r\n') : hay;
  return { ok: true, text: bom + result, applied };
}
