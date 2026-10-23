import { Chalk } from 'chalk';
import { sanitizeTerminalText } from '../chat/wrapText.js';

const colorChalk = new Chalk({ level: 2 });

/**
 * Utilitas visual diff untuk bAIwor Code.
 * Menghasilkan unified diff berwarna (ANSI) dan statistik penambahan/penghapusan (+X -Y)
 * untuk ditampilkan pada timeline terminal, konfirmasi Safe Mode, atau review perubahan.
 */

/**
 * Memotong baris menjadi array string tanpa trailing carriage return.
 * Membuang satu trailing newline agar baris kosong semu di akhir berkas tidak dihitung.
 */
function splitLines(text) {
  if (text === null || text === undefined || text === '') return [];
  const normalized = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (normalized.endsWith('\n')) {
    return normalized.slice(0, -1).split('\n');
  }
  return normalized.split('\n');
}

/**
 * Menghitung LCS (Longest Common Subsequence) untuk baris yang berbeda
 * setelah memangkas common prefix dan common suffix.
 */
function computeLineDiff(oldLines, newLines) {
  const n = oldLines.length;
  const m = newLines.length;

  // 1. Pangkas common prefix
  let prefix = 0;
  while (prefix < n && prefix < m && oldLines[prefix] === newLines[prefix]) {
    prefix += 1;
  }

  // 2. Pangkas common suffix
  let suffix = 0;
  while (
    suffix < n - prefix &&
    suffix < m - prefix &&
    oldLines[n - 1 - suffix] === newLines[m - 1 - suffix]
  ) {
    suffix += 1;
  }

  const midOld = oldLines.slice(prefix, n - suffix);
  const midNew = newLines.slice(prefix, m - suffix);

  // Jika bagian tengah kosong, teks identik
  if (midOld.length === 0 && midNew.length === 0) {
    return [];
  }

  // DP table untuk bagian tengah (dibatasi maks 1500 baris untuk mencegah memory spike)
  const maxRows = Math.min(midOld.length, 1500);
  const maxCols = Math.min(midNew.length, 1500);
  const dp = Array.from({ length: maxRows + 1 }, () => new Uint16Array(maxCols + 1));

  for (let i = 1; i <= maxRows; i += 1) {
    for (let j = 1; j <= maxCols; j += 1) {
      if (midOld[i - 1] === midNew[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack untuk menghasilkan urutan operasi
  const midChanges = [];
  let i = maxRows;
  let j = maxCols;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && midOld[i - 1] === midNew[j - 1]) {
      midChanges.push({ type: 'context', line: midOld[i - 1], oldLine: prefix + i, newLine: prefix + j });
      i -= 1;
      j -= 1;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      midChanges.push({ type: 'add', line: midNew[j - 1], newLine: prefix + j });
      j -= 1;
    } else if (i > 0) {
      midChanges.push({ type: 'delete', line: midOld[i - 1], oldLine: prefix + i });
      i -= 1;
    }
  }

  midChanges.reverse();

  // Gabungkan prefix, middle changes, dan suffix
  const allOps = [];
  for (let p = 0; p < prefix; p += 1) {
    allOps.push({ type: 'context', line: oldLines[p], oldLine: p + 1, newLine: p + 1 });
  }
  for (const op of midChanges) {
    allOps.push(op);
  }
  for (let s = 0; s < suffix; s += 1) {
    const oldIdx = n - suffix + s + 1;
    const newIdx = m - suffix + s + 1;
    allOps.push({ type: 'context', line: oldLines[n - suffix + s], oldLine: oldIdx, newLine: newIdx });
  }

  return allOps;
}

/**
 * Mengelompokkan operasi diff menjadi hunk-hunk unified diff dengan konteks sekitar.
 *
 * @param {Array<Object>} ops
 * @param {number} contextSize
 * @returns {Array<Object>} hunks
 */
function groupIntoHunks(ops, contextSize = 3) {
  const diffIndices = [];
  for (let i = 0; i < ops.length; i += 1) {
    if (ops[i].type !== 'context') {
      diffIndices.push(i);
    }
  }

  if (diffIndices.length === 0) return [];

  // Cari rentang indeks ops yang dicakup oleh tiap hunk
  const ranges = [];
  let currentStart = Math.max(0, diffIndices[0] - contextSize);
  let currentEnd = Math.min(ops.length - 1, diffIndices[0] + contextSize);

  for (let k = 1; k < diffIndices.length; k += 1) {
    const idx = diffIndices[k];
    const neededStart = Math.max(0, idx - contextSize);
    const neededEnd = Math.min(ops.length - 1, idx + contextSize);

    if (neededStart <= currentEnd + 1) {
      // Overlap atau berdampingan: gabung ke hunk saat ini
      currentEnd = Math.max(currentEnd, neededEnd);
    } else {
      ranges.push({ start: currentStart, end: currentEnd });
      currentStart = neededStart;
      currentEnd = neededEnd;
    }
  }
  ranges.push({ start: currentStart, end: currentEnd });

  // Susun setiap hunk
  const hunks = [];
  for (const range of ranges) {
    const hunkOps = ops.slice(range.start, range.end + 1);
    const firstOp = hunkOps[0];
    const oldStart = firstOp.oldLine || 1;
    const newStart = firstOp.newLine || 1;

    let oldCount = 0;
    let newCount = 0;
    for (const op of hunkOps) {
      if (op.type === 'context' || op.type === 'delete') oldCount += 1;
      if (op.type === 'context' || op.type === 'add') newCount += 1;
    }

    hunks.push({
      oldStart,
      oldCount,
      newStart,
      newCount,
      ops: hunkOps,
    });
  }

  return hunks;
}

/**
 * Menghasilkan visual diff representatif antara dua string teks.
 *
 * @param {string} oldText - Isi berkas sebelumnya (atau empty string bila berkas baru)
 * @param {string} newText - Isi berkas sesudahnya
 * @param {Object} [options]
 * @param {string} [options.filePath='file'] - Nama atau path berkas
 * @param {number} [options.contextLines=3] - Jumlah baris konteks sebelum & sesudah perubahan
 * @param {number} [options.maxDiffLines=35] - Batas maksimum baris diff yang dirender
 * @param {boolean} [options.useColor=true] - Aktifkan pewarnaan ANSI
 * @returns {{
 *   hasChanges: boolean,
 *   additions: number,
 *   deletions: number,
 *   diffStats: string,
 *   diffText: string,
 *   coloredDiff: string
 * }}
 */
export function generateVisualDiff(oldText, newText, options = {}) {
  const {
    filePath = 'file',
    contextLines = 3,
    maxDiffLines = 35,
    useColor = true,
  } = options;

  if (oldText === newText) {
    return {
      hasChanges: false,
      additions: 0,
      deletions: 0,
      diffStats: '+0 -0',
      diffText: '',
      coloredDiff: '',
    };
  }

  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  const ops = computeLineDiff(oldLines, newLines);

  let additions = 0;
  let deletions = 0;
  for (const op of ops) {
    if (op.type === 'add') additions += 1;
    if (op.type === 'delete') deletions += 1;
  }

  const hunks = groupIntoHunks(ops, contextLines);
  const plainLines = [];
  const colorLines = [];

  const statText = `+${additions} -${deletions}`;
  const coloredStat = useColor
    ? `${colorChalk.green.bold(`+${additions}`)} ${colorChalk.red.bold(`-${deletions}`)}`
    : statText;

  // Header file
  plainLines.push(`--- a/${filePath}`);
  plainLines.push(`+++ b/${filePath}`);

  if (useColor) {
    colorLines.push(colorChalk.dim.red(`--- a/${filePath}`));
    colorLines.push(colorChalk.dim.green(`+++ b/${filePath}`));
  } else {
    colorLines.push(`--- a/${filePath}`);
    colorLines.push(`+++ b/${filePath}`);
  }

  let totalLinesPrinted = 0;
  let truncated = false;

  for (const hunk of hunks) {
    if (totalLinesPrinted >= maxDiffLines) {
      truncated = true;
      break;
    }

    const header = `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`;
    plainLines.push(header);
    colorLines.push(useColor ? colorChalk.cyan(header) : header);
    totalLinesPrinted += 1;

    for (const op of hunk.ops) {
      if (totalLinesPrinted >= maxDiffLines) {
        truncated = true;
        break;
      }

      // Isi diff berasal dari berkas proyek — bisa memuat escape sequence
      // terminal (ESC[2J, OSC 52 clipboard, dll). Sanitasi SEBELUM diberi
      // warna, supaya file yang disorot tidak bisa menyalin isi
      // layar pengguna atau mengosongkan layar tepat di saat approval.
      const safeLine = sanitizeTerminalText(op.line, { preserveNewlines: false });

      if (op.type === 'add') {
        const text = `+ ${safeLine}`;
        plainLines.push(text);
        colorLines.push(useColor ? colorChalk.green(text) : text);
      } else if (op.type === 'delete') {
        const text = `- ${safeLine}`;
        plainLines.push(text);
        colorLines.push(useColor ? colorChalk.red(text) : text);
      } else {
        const text = `  ${safeLine}`;
        plainLines.push(text);
        colorLines.push(useColor ? colorChalk.gray(text) : text);
      }
      totalLinesPrinted += 1;
    }
  }

  if (truncated) {
    const msg = `... (perubahan lebih lanjut disingkat)`;
    plainLines.push(msg);
    colorLines.push(useColor ? colorChalk.yellow.italic(msg) : msg);
  }

  return {
    hasChanges: true,
    additions,
    deletions,
    diffStats: coloredStat,
    diffText: plainLines.join('\n'),
    coloredDiff: colorLines.join('\n'),
  };
}
