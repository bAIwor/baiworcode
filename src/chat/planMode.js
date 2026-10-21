/**
 * Modul Mode Perencanaan (/plan) untuk bAIwor Code.
 * Memaksa AI bekerja sebagai arsitek murni (dry-run):
 * - Membatasi tool hanya ke pembacaan & perencanaan (read-only + todo_list).
 * - Mencegah tool write_file dan edit_file dieksekusi sebelum rencana disetujui.
 * - Menginjeksi panduan format arsitektur & checklist ke dalam instruksi.
 */

import { createPainter } from '../colors.js';
import { palette } from '../theme.js';

export const PLAN_ALLOWED_TOOLS = [
  'read_file',
  'list_directory',
  'search_files',
  'webfetch',
  'websearch',
  'todo_list',
  'ask_user',
];

/**
 * Spesialisasi 4 Peran Tim Punakawan AI (Punakawan Agent Roles)
 * Mengadopsi arsitektur multi-agent: Architect, Explorer, Worker, Verifier.
 */
export const PUNAKAWAN_ROLES = {
  semAIr: {
    name: 'semAIr',
    title: 'Sang Arsitek & Orchestrator',
    emoji: '👑',
    role: 'architect',
    description: 'Merancang breakdown tugas, analisis kebutuhan, struktur roadmap, dan memelihara konteks percakapan.',
    allowedTools: ['todo_list', 'read_file', 'list_directory', 'search_files', 'websearch', 'ask_user'],
  },
  pAItruk: {
    name: 'pAItruk',
    title: 'Sang Scout & Penjelajah',
    emoji: '🔭',
    role: 'explore',
    description: 'Investigasi kode read-only, pemetaan dependensi, dan penelusuran referensi tanpa mengubah berkas.',
    allowedTools: ['read_file', 'list_directory', 'search_files', 'webfetch', 'websearch'],
  },
  bAIwor: {
    name: 'bAIwor',
    title: 'Sang Master Builder & Worker',
    emoji: '🔨',
    role: 'worker',
    description: 'Eksekusi produksi konkrit, modifikasi kode presisi, refactoring, dan implementasi fitur.',
    allowedTools: ['edit_file', 'write_file', 'patch_file', 'run_command'],
  },
  gAIreng: {
    name: 'gAIreng',
    title: 'Sang Auditor & Verifier',
    emoji: '⚖️',
    role: 'verifier',
    description: 'Audit mutu independen, eksekusi unit test, verifikasi diagnostik, dan mitigasi regresi.',
    allowedTools: ['run_command', 'diagnostics', 'read_file'],
  },
};

/**
 * Mengambil metadata peran Punakawan berdasarkan nama atau alias
 * @param {string} roleName
 * @returns {object|null}
 */
export function getPunakawanRole(roleName) {
  if (!roleName || typeof roleName !== 'string') return null;
  const key = roleName.toLowerCase().trim();
  for (const [name, meta] of Object.entries(PUNAKAWAN_ROLES)) {
    if (name.toLowerCase() === key || meta.role.toLowerCase() === key) {
      return meta;
    }
  }
  return null;
}

/**
 * Menghasilkan badge teks peran Punakawan untuk display status UI
 * @param {string} roleName
 * @returns {string}
 */
export function formatPunakawanBadge(roleName) {
  const role = getPunakawanRole(roleName);
  if (!role) return '';
  return `[${role.emoji} ${role.name}: ${role.title}]`;
}

export const PLAN_SYSTEM_INSTRUCTION = `
🚨 [MODE PERENCANAAN AKTIF (/plan) — Kearifan semAIr]
Kamu saat ini bertindak dengan kearifan semAIr — Sang Arsitek & Pamomong Strategi.
Tugasmu merancang blueprint solusi sebelum bAIwor (Sang Builder) turun tangan mengeksekusi kode dengan Kudi-nya.

Aturan ketat mode perencanaan:
1. DILARANG membuat file baru (write_file) atau mengedit file (edit_file/patch_file).
2. Gunakan read_file, search_files, dan list_directory (ketajaman pAItruk) untuk menganalisis struktur kode yang relevan.
3. Bila butuh dokumentasi atau referensi luar, gunakan webfetch/websearch — tetapi tetap dilarang menulis berkas.
4. Gunakan todo_list untuk menyusun checklist tahapan eksekusi secara terstruktur.
5. Gunakan ask_user jika memerlukan konfirmasi keputusan arsitektur, pemilihan dependensi, atau preferensi desain penting dari pengguna.
6. Sajikan jawaban dengan format:
   - 🎯 Tujuan & Analisis Masalah
   - 🏗️ Rancangan Arsitektur / Solusi (semAIr)
   - 📄 Berkas yang Akan Disentuh bAIwor (dibuat/diubah) beserta penjelasan ringkas
   - 🧪 Rencana Pengujian & Validasi Mutu (gAIreng)
   - ⚠️ Potensi Risiko atau Efek Samping
7. Akhiri selalu dengan meminta konfirmasi: "Ketik 'lanjutkan' atau 'eksekusi' untuk mulai menerapkan rencana ini."`;

/**
 * Mengecek apakah input pengguna merupakan perintah /plan.
 *
 * @param {string} input
 * @returns {boolean}
 */
export function isPlanCommand(input) {
  if (!input || typeof input !== 'string') return false;
  const trimmed = input.trim();
  return trimmed === '/plan' || trimmed.startsWith('/plan ');
}

/**
 * Mengekstrak instruksi di belakang perintah /plan.
 * Contoh: "/plan buat sistem auth" -> "buat sistem auth"
 *
 * @param {string} input
 * @returns {string}
 */
export function extractPlanPrompt(input) {
  if (!input || typeof input !== 'string') return '';
  const trimmed = input.trim();
  if (trimmed === '/plan') return '';
  if (trimmed.startsWith('/plan ')) {
    return trimmed.slice(6).trim();
  }
  return trimmed;
}

/**
 * Mengambil daftar nama tool yang diizinkan saat mode perencanaan aktif.
 *
 * @returns {Array<string>}
 */
export function getPlanAllowedTools() {
  return [...PLAN_ALLOWED_TOOLS];
}

/**
 * Membentuk pesan prompt user yang diperkaya dengan arahan mode perencanaan.
 *
 * @param {string} promptText
 * @returns {string}
 */
export function buildPlanUserPrompt(promptText) {
  const clean = promptText.trim();
  return `${PLAN_SYSTEM_INSTRUCTION}\n\n[Instruksi Perencanaan]:\n${clean}`;
}

/* ------------------------------------------------------------------ *
 * Penegakan mode Plan (arsitek read-only)
 *
 * Plan kini adalah salah satu permissionMode (lihat chat/permissionMode.js);
 * modul ini hanya menjaga aturan tool-nya: model bahkan tidak diberi
 * kemampuan menulis selama mode Plan aktif.
 * ------------------------------------------------------------------ */

/** Apakah tool ini dilarang saat agen berada di mode Plan (arsitek read-only). */
export function isToolBlockedInPlanMode(name) {
  return !PLAN_ALLOWED_TOOLS.includes(String(name || ''));
}

/** Pesan penolakan yang dibaca model saat mencoba memakai tool terlarang di mode Plan. */
export function planModeBlockMessage(name) {
  return (
    `Error: tool "${name}" tidak tersedia di mode Plan (arsitek read-only). ` +
    `Mode Plan hanya boleh memakai: ${PLAN_ALLOWED_TOOLS.join(', ')}. ` +
    'Sajikan rencana kepada pengguna, lalu minta ia berpindah ke mode Safe/Auto ' +
    'dengan /permission (atau Shift+Tab) sebelum berkas diubah.'
  );
}

/**
 * Menyaring definisi tool sesuai agen yang aktif.
 *
 * Mode Plan hanya mengirim tool read-only ke model — jadi model tidak sekadar
 * "diminta" tidak menulis, melainkan tidak diberi kemampuan menulis sama sekali.
 *
 * @param {Array} definitions
 * @param {'build'|'plan'} agentMode
 * @returns {Array}
 */
export function filterToolsForAgentMode(definitions, agentMode) {
  const list = Array.isArray(definitions) ? definitions : [];
  if (agentMode !== 'plan') return list;
  return list.filter((def) => PLAN_ALLOWED_TOOLS.includes(def?.function?.name));
}

/** Status global mode compact untuk Todo widget (default: false / show all) */
let todoCompactMode = false;

export function getTodoCompactMode() {
  return todoCompactMode;
}

export function setTodoCompactMode(val) {
  todoCompactMode = Boolean(val);
  return todoCompactMode;
}

export function toggleTodoCompactMode() {
  todoCompactMode = !todoCompactMode;
  return todoCompactMode;
}

export const WIDGET_TODO_ICONS = {
  completed: '✓',
  in_progress: '◐',
  pending: '○',
  cancelled: '✗',
};

/**
 * Merender Todo List Widget interaktif dengan header format bAIwor Code:
 * Format lengkap : "🧭 semAIr · Todo list {done}/{total} · {remaining} remaining · Ctrl+T {compact|expand}"
 * Format ringkas : "🧭 semAIr · Todo list {done}/{total}"
 * Default selalu menampilkan SEMUA item tugas (show all).
 *
 * @param {Array<{id?:string, content?:string, status?:string}>} items
 * @param {{useColor?:boolean, isCompact?:boolean, showDetails?:boolean}} [options]
 * @returns {string}
 */
export function renderTodoWidget(items, { useColor = true, isCompact = todoCompactMode, showDetails = true } = {}) {
  const list = (Array.isArray(items) ? items : []).filter(Boolean);
  if (!list.length) return '';

  const total = list.length;
  const completed = list.filter((i) => i.status === 'completed').length;
  const remaining = total - completed;
  const actionLabel = isCompact ? 'expand' : 'compact';

  // Pewarna opsional — sumber tunggal lewat colors.js (dulu escape code
  // ANSI ditulis manual di sini, sehingga bisa melenceng dari tema).
  const p = createPainter(useColor);
  const c = {
    bold: p.bold,
    dim: p.dim,
    gray: p.gray,
    green: p.green,
    yellow: p.yellow,
    // Kuning emas Tim Punakawan (sama dengan palette.gold) — identitas semAIr.
    gold: p.hex(palette.gold),
    strikethrough: p.strikethrough,
  };

  const dot = c.gray('·');
  // Daftar tugas disusun oleh semAIr (Sang Arsitek). Nama aktor ditampilkan di
  // header supaya identitasnya terbaca walau tidak ada node di pohon aktivitas.
  const actor = `${c.gold(c.bold('🧭 semAIr'))} ${dot} `;
  const header = showDetails
    ? `${actor}${c.bold('Todo list')} ${completed}/${total} ${dot} ${remaining} remaining ${dot} ${c.dim(`Ctrl+T ${actionLabel}`)}`
    : `${actor}${c.bold('Todo list')} ${completed}/${total}`;

  if (isCompact) {
    const active = list.find((i) => i.status === 'in_progress');
    if (!active) return header;
    const icon = c.yellow(WIDGET_TODO_ICONS.in_progress);
    const content = String(active.content || '').trim();
    return `${header}\n    ${icon} ${content}`;
  }

  const lines = list.map((item) => {
    const status = item.status || 'pending';
    let iconChar = WIDGET_TODO_ICONS[status] || WIDGET_TODO_ICONS.pending;
    let iconStyled = iconChar;
    let text = String(item.content || '').trim();

    if (status === 'completed') {
      iconStyled = c.green(iconChar);
      text = c.dim(text);
    } else if (status === 'in_progress') {
      iconStyled = c.yellow(iconChar);
      text = c.bold(text);
    } else if (status === 'cancelled') {
      iconStyled = c.gray(iconChar);
      text = c.strikethrough(c.gray(text));
    } else {
      iconStyled = c.dim(iconChar);
      text = c.dim(text);
    }

    return `    ${iconStyled} ${text}`;
  });

  return `${header}\n${lines.join('\n')}`;
}
