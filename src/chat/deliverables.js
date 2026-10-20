import path from 'node:path';
import { createPainter } from '../colors.js';
import { palette } from '../theme.js';
import { sanitizeTerminalText } from './wrapText.js';

/**
 * Menghasilkan hyperlink OSC 8 standar terminal agar tautan atau berkas
 * dapat diklik langsung di terminal modern (VS Code, Windows Terminal, iTerm2, dll).
 *
 * @param {string} text - Teks yang ditampilkan
 * @param {string} target - Path berkas atau URL
 * @param {Object} [options]
 * @param {boolean} [options.useColor=true]
 * @returns {string}
 */
export function createOsc8Link(text, target, { useColor = true } = {}) {
  if (!text || !target) return text || '';
  const safeText = sanitizeTerminalText(text, { preserveNewlines: false });
  const safeTarget = String(target).replace(/[\x00-\x1f\x7f\u0080-\u009f]/g, '');
  text = safeText;
  target = safeTarget;

  // Normalisasi target ke format file:// jika berupa path lokal
  let url = target;
  if (!target.startsWith('http://') && !target.startsWith('https://') && !target.startsWith('file://')) {
    const absPath = path.isAbsolute(target) ? target : path.resolve(process.cwd(), target);
    const normalized = absPath.replace(/\\/g, '/');
    url = `file:///${normalized.replace(/^\/+/, '')}`;
  }

  // Jika di terminal TTY dengan dukungan ANSI/OSC 8
  if (useColor && process.stdout?.isTTY !== false) {
    return `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`;
  }

  return `${text} (${url})`;
}

/**
 * Parsing teks di dalam blok penanda <deliver-assets>...</deliver-assets>
 *
 * @param {string} rawContent
 * @returns {Array<{ path: string, action?: string, detail?: string }>}
 */
export function parseDeliverAssetsContent(rawContent = '') {
  if (!rawContent || typeof rawContent !== 'string') return [];

  const lines = rawContent.split(/\r?\n/);
  const items = [];

  for (const line of lines) {
    const trimmed = line.trim().replace(/^[-*•]\s*/, '').trim();
    if (!trimmed) continue;

    // Format umum: path/to/file.ext (Status/Detail) atau path/to/file.ext: Status
    const m = trimmed.match(/^([^\s:(]+)(?:\s*(?:[:(])\s*([^)]*)\)?)?/);
    if (m && m[1]) {
      const filePath = m[1].trim();
      const meta = (m[2] || '').trim();

      let action = 'diperbarui';
      const metaLower = meta.toLowerCase();
      if (metaLower.includes('hapus') || metaLower.includes('delete') || metaLower.includes('remove')) {
        action = 'dihapus';
      } else if (metaLower.includes('ubah') || metaLower.includes('perbarui') || metaLower.includes('update') || metaLower.includes('edit')) {
        action = 'diperbarui';
      } else if (metaLower.includes('buat') || metaLower.includes('create') || metaLower.includes('new') || /\bbaru\b/.test(metaLower)) {
        action = 'dibuat';
      }

      items.push({
        path: filePath,
        action,
        detail: meta,
      });
    }
  }

  return items;
}

/**
 * Merender kartu visual rapi di terminal untuk daftar deliverable assets.
 *
 * @param {Array<{ path: string, action?: string, detail?: string }>} items
 * @param {Object} [options]
 * @param {boolean} [options.useColor=true]
 * @returns {string}
 */
export function renderDeliverableCard(items = [], { useColor = true } = {}) {
  if (!Array.isArray(items) || items.length === 0) return '';

  const c = createPainter(useColor);

  const border = c.gray('─'.repeat(66));
  const lines = [];

  lines.push(`  ${c.gray('┌')}${border}${c.gray('┐')}`);
  lines.push(`  ${c.gray('│')}  ${c.hex(palette.gold).bold('📦 BERKAS HASIL PEKERJAAN (DELIVERABLES)')}${' '.repeat(26)}${c.gray('│')}`);
  lines.push(`  ${c.gray('├')}${border}${c.gray('┤')}`);

  for (const item of items) {
    const icon = item.action === 'dibuat' ? '📄' : item.action === 'dihapus' ? '🗑️' : '📝';
    const actionLabel = item.action === 'dibuat' ? c.green('[Dibuat]') : item.action === 'dihapus' ? c.red('[Dihapus]') : c.yellow('[Diperbarui]');
    const clickableFile = createOsc8Link(item.path, item.path, { useColor });
    const detailText = item.detail
      ? c.dim(` (${sanitizeTerminalText(item.detail, { preserveNewlines: false })})`)
      : '';

    lines.push(`  ${c.gray('│')}  ${icon} ${c.bold(clickableFile)} ${actionLabel}${detailText}`);
  }

  lines.push(`  ${c.gray('└')}${border}${c.gray('┘')}`);

  return lines.join('\n');
}

/**
 * Mendeteksi tag <deliver-assets>...</deliver-assets> dalam teks output
 * dan menggantinya dengan render kartu deliverable terminal interaktif.
 *
 * @param {string} text
 * @param {Object} [options]
 * @returns {string}
 */
export function renderDeliverAssetsIfPresent(text = '', options = {}) {
  if (!text || typeof text !== 'string') return text || '';

  const tagPattern = /<deliver-assets>([\s\S]*?)<\/deliver-assets>/i;
  const match = text.match(tagPattern);
  if (!match) return text;

  const rawInside = match[1];
  const items = parseDeliverAssetsContent(rawInside);
  if (items.length === 0) return text.replace(tagPattern, '').trim();

  const renderedCard = renderDeliverableCard(items, options);
  // Replacer fungsi: hindari interpretasi `$&`/`$1` yang bisa muncul di kartu.
  return text.replace(tagPattern, () => `\n\n${renderedCard}\n\n`).trim();
}
