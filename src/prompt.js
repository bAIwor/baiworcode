import fs from 'node:fs';
import path from 'node:path';
import { Prompt, TextPrompt, isCancel } from '@clack/core';
import chalk from 'chalk';
import readline from 'node:readline';
import { theme } from './theme.js';
import { renderStatusLine, frameRules, terminalWidth } from './statusLine.js';
import { todoStore } from './tools/todoTool.js';
import { renderTodoWidget, toggleTodoCompactMode, getTodoCompactMode } from './chat/planMode.js';
import { CONFIG_DIR, getAccessMode, setAccessMode } from './config.js';

// Proteksi global untuk seluruh prompt @clack/core (@clack/prompts).
//
// PENTING: blok ini TIDAK BOLEH mem-pause process.stdin. Pada Windows ConPTY,
// memanggil pause()/resume() setiap kali prompt dibuka/ditutup membuat state
// stdin balapan dengan prompt berikutnya dan bisa meninggalkan stdin dalam
// keadaan paused tanpa listener 'keypress' — terminal membeku dan Ctrl+C pun
// mati. Inilah penyebab freeze pada alur /model yang membuka banyak prompt
// berurutan.
//
// Yang dijamin di sini hanya satu: raw mode aktif selama prompt hidup. Siklus
// penutupan (unpipe + setRawMode(false)) ditangani penuh oleh @clack/core.
if (typeof Prompt === 'function' && !Prompt.prototype._baiworStdinPatched) {
  Prompt.prototype._baiworStdinPatched = true;

  const origPrompt = Prompt.prototype.prompt;
  Prompt.prototype.prompt = function (...args) {
    const input = this.input || process.stdin;
    if (input && input.isTTY) {
      if (typeof input.setRawMode === 'function' && !input.isRaw) {
        try {
          input.setRawMode(true);
        } catch {}
      }
      // Hanya resume bila memang sedang paused; jangan pernah pause di sini.
      if (
        typeof input.isPaused === 'function' &&
        input.isPaused() &&
        typeof input.resume === 'function'
      ) {
        try {
          input.resume();
        } catch {}
      }
    }
    return origPrompt.apply(this, args);
  };

  const origOnKeypress = Prompt.prototype.onKeypress;
  Prompt.prototype.onKeypress = function (u, key) {
    const isCtrlC =
      (key?.name === 'c' && Boolean(key?.ctrl)) ||
      u === '\u0003' ||
      key?.sequence === '\u0003';

    if (isCtrlC) {
      this.state = 'cancel';
      this.emit('finalize');
      this.render();
      this.close();
      return;
    }

    return origOnKeypress.call(this, u, key);
  };
}

const HISTORY_FILE = path.join(CONFIG_DIR, 'history.json');
const MAX_HISTORY = 200;

let promptHistory = [];

export function loadPromptHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      if (Array.isArray(data)) {
        promptHistory = data.filter((x) => typeof x === 'string' && x.trim());
        return promptHistory;
      }
    }
  } catch {}
  return promptHistory;
}

export function savePromptHistory(entry) {
  if (!entry || typeof entry !== 'string') return;
  const trimmed = entry.trim();
  if (!trimmed) return;

  promptHistory = promptHistory.filter((item) => item !== trimmed);
  promptHistory.unshift(trimmed);
  if (promptHistory.length > MAX_HISTORY) {
    promptHistory.length = MAX_HISTORY;
  }

  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(promptHistory, null, 2), 'utf8');
  } catch {}
}

export function getPromptHistory() {
  return promptHistory;
}

export function resetPromptHistory() {
  promptHistory = [];
}

loadPromptHistory();

export const COMMANDS = [
  { name: '/help', desc: 'Menampilkan panduan perintah & bantuan' },
  { name: '/plan', desc: 'Mode arsitek semAIr: susun rencana & analisis tanpa ubah kode' },
  { name: '/compact', desc: 'Ringkas konteks percakapan untuk menghemat token' },
  { name: '/timeline', desc: 'Ganti tampilan aktivitas: compact (satu baris) / detail (pohon)' },
  { name: '/session', desc: 'Kelola sesi percakapan (list, resume, delete, clear)' },
  { name: '/skill', desc: 'Kelola modul keahlian & plugin (.baiwor/skills)' },
  { name: '/rules', desc: 'Lihat aturan koding aktif (BAIWORS.md / .baiwor/rules)' },
  { name: '/status', desc: 'Status konfigurasi & model AI aktif' },
  { name: '/tinyfish', desc: 'Kelola integrasi TinyFish (status, wallet, key, search, fetch)' },
  { name: '/mcp', desc: 'Kelola Model Context Protocol server & tool eksternal' },
  { name: '/model', desc: 'Pilih model: /model (menu) · /model <alias|provider/model>' },
  { name: '/provider', desc: 'Alias untuk perintah /model' },
  { name: '/login', desc: 'Login ke Google Gemini OAuth' },
  { name: '/logout', desc: 'Logout dari sesi Google Gemini OAuth' },
  { name: '/clear', desc: 'Bersihkan layar & reset riwayat percakapan' },
  { name: '/reset', desc: 'Reset konteks percakapan AI tanpa clear layar' },
  { name: '/exit', desc: 'Keluar dari bAIwor Code (alias: /q, /quit)' },
  { name: '/q', desc: 'Keluar dari bAIwor Code (alias /exit)' },
];

export const SUBCOMMANDS = {
  '/timeline': [
    { name: 'compact', desc: 'Satu baris per langkah — alur cepat & ringkas' },
    { name: 'detail', desc: 'Pohon lengkap dengan argumen & ringkasan hasil' },
  ],
  '/session': [
    { name: 'list', desc: 'Tampilkan daftar sesi percakapan proyek' },
    { name: 'resume', desc: 'Lanjutkan sesi percakapan (terakhir atau spesifik)' },
    { name: 'delete', desc: 'Hapus sesi percakapan proyek' },
    { name: 'clear', desc: 'Bersihkan seluruh riwayat sesi proyek' },
  ],
  '/skill': [
    { name: 'list', desc: 'Tampilkan daftar modul keahlian & plugin yang terpasang' },
    { name: 'info', desc: 'Tampilkan detail instruksi modul keahlian' },
  ],
  '/tinyfish': [
    { name: 'status', desc: 'Lihat status koneksi TinyFish & saldo wallet' },
    { name: 'key', desc: 'Simpan API Key TinyFish: /tinyfish key <sk-tinyfish-...>' },
    { name: 'search', desc: 'Tes pencarian web: /tinyfish search <query>' },
    { name: 'fetch', desc: 'Tes ekstraksi URL: /tinyfish fetch <url>' },
  ],
  '/mcp': [
    { name: 'list', desc: 'Tampilkan daftar MCP server & tool aktif' },
    { name: 'refresh', desc: 'Muat ulang & sambungkan kembali seluruh MCP server' },
  ],
};

/**
 * Mengurai konteks perintah slash dari teks input yang sedang diketik.
 * Menentukan apakah pengguna sedang memilih perintah utama atau sub-opsi.
 *
 * @param {string} value
 * @returns {{ type: 'none'|'command'|'subcommand'|'freeform', parentCmd: string|null, query: string, matches: Array<{name:string, desc:string}> }}
 */
export function getPromptContext(value = '') {
  const trimmedStart = (value || '').trimStart();
  if (!trimmedStart.startsWith('/')) {
    return { type: 'none', parentCmd: null, query: '', matches: [] };
  }

  const spaceIdx = trimmedStart.search(/\s/);
  if (spaceIdx !== -1) {
    const rawCmd = trimmedStart.slice(0, spaceIdx).toLowerCase();
    const cleanCmd = rawCmd.replace(/^\/+/, '');

    // Jika hanya "/" lalu spasi ("/ "), anggap masih melihat semua root COMMANDS
    if (!cleanCmd) {
      return {
        type: 'command',
        parentCmd: null,
        query: '',
        matches: COMMANDS,
      };
    }

    if (SUBCOMMANDS[rawCmd]) {
      const rest = trimmedStart.slice(spaceIdx).trimStart().toLowerCase();
      const subs = SUBCOMMANDS[rawCmd];
      const matches = !rest
        ? subs
        : subs.filter((s) => s.name.toLowerCase().startsWith(rest));
      return {
        type: 'subcommand',
        parentCmd: rawCmd,
        query: rest,
        matches,
      };
    }

    // Perintah tanpa sub-opsi terdaftar (misal /plan sesuatu)
    const rest = trimmedStart.slice(spaceIdx).trimStart().toLowerCase();
    return {
      type: 'freeform',
      parentCmd: rawCmd,
      query: rest,
      matches: [],
    };
  }

  // Tanpa spasi: "/", "/t", "/timeline"
  const rawQuery = trimmedStart.toLowerCase();
  const cleanWord = rawQuery.replace(/^\/+\s*/, '');
  const matches = !cleanWord
    ? COMMANDS
    : COMMANDS.filter((c) => {
        const cmdWord = c.name.replace(/^\//, '');
        return c.name.startsWith(rawQuery) || cmdWord.startsWith(cleanWord);
      });

  return {
    type: 'command',
    parentCmd: null,
    query: cleanWord,
    matches,
  };
}

/**
 * Menyusun seluruh frame area input: garis atas, baris input, dropdown
 * perintah bila terbuka, garis bawah, lalu baris status.
 *
 * Dipisah dari kelas prompt karena fungsi ini murni — tidak menyentuh terminal —
 * sehingga layout-nya bisa diuji tanpa menjalankan TTY sungguhan.
 *
 * @param {{value?:string, state?:string, placeholder?:string, displayInput?:string, dropdownOpen?:boolean, selectedIndex?:number}} options
 * @returns {string}
 */
export function buildPromptFrame({
  value = '',
  state = 'initial',
  placeholder = '',
  displayInput = null,
  dropdownOpen = false,
  selectedIndex = 0,
  exitPending = false,
  columns = null,
  todoItems = null,
  isCompact = false,
} = {}) {
  const shown = displayInput !== null ? displayInput : value;

  const currentCols = columns ?? terminalWidth();
  const rules = frameRules(currentCols);
  let out = '';

  if (Array.isArray(todoItems) && todoItems.length > 0) {
    const widget = renderTodoWidget(todoItems, { useColor: true, isCompact });
    if (widget) {
      out += `${widget}\n\n`;
    }
  }

  out += rules.top + '\n';

  if (state === 'submit') {
    out += `  ${theme.input('›')}  ${theme.input(value || placeholder)}`;
  } else if (state === 'cancel') {
    out += `  ${theme.error('›')}  ${chalk.strikethrough(chalk.gray(value))}`;
  } else if (exitPending && !value) {
    const width = currentCols - 1;
    const msg =
      width < 65
        ? 'Tekan Ctrl+C lagi untuk keluar'
        : 'Tekan Ctrl+C sekali lagi untuk keluar (atau ketik /exit)';
    out += `  ${theme.warning.bold('›')}  ${theme.warning(msg)}`;
  } else {
    out += `  ${theme.input('›')}  ${shown ? theme.input(shown) : chalk.dim(placeholder)}`;

    const ctx = getPromptContext(value);
    if (dropdownOpen && (ctx.type === 'command' || ctx.type === 'subcommand')) {
      const matches = ctx.matches;
      const active = matches.length ? Math.min(selectedIndex, matches.length - 1) : 0;

      // Seluruh baris dropdown dijaga muat di lebar terminal. Satu kolom disisakan
      // supaya tidak ada baris yang persis selebar terminal (pemicu wrap).
      const width = currentCols - 1;
      const fit = (text, max = width) => {
        const s = String(text);
        if (max <= 0) return '';
        return s.length > max ? `${s.slice(0, Math.max(0, max - 1))}…` : s;
      };

      const isSub = ctx.type === 'subcommand';
      const headerTitle = isSub ? `Pilihan ${ctx.parentCmd}` : 'Perintah';
      const header =
        `  ╭─ ${headerTitle} (↑/↓/Tab pilih, Enter jalankan, Esc tutup)`;
      const shortHeader = `  ╭─ ${headerTitle}`;
      out += '\n' + chalk.gray(fit(header.length <= width ? header : shortHeader)) + '\n';

      // Prefix tiap item selalu 21 kolom tampil (tanpa warna), jadi deskripsi
      // tinggal memakai sisa lebar yang tersedia.
      const NAME_LEN = isSub ? 10 : 11;
      const PREFIX_LEN = isSub ? 20 : 21;
      const descBudget = width - PREFIX_LEN;
      if (matches.length > 0) {
        matches.forEach((item, idx) => {
          const name = item.name.padEnd(NAME_LEN);
          const desc = fit(item.desc, descBudget);
          if (idx === active) {
            out += `  ${chalk.gray('│')}  ${chalk.cyan.bold('❯')} ${chalk.cyan.bold(name)} ${chalk.gray('─')} ${chalk.whiteBright.bold(desc)}\n`;
          } else {
            out += `  ${chalk.gray('│')}    ${chalk.dim(name)} ${chalk.gray('─')} ${chalk.dim(desc)}\n`;
          }
        });
      } else {
        const noMatchMsg = isSub ? 'Tidak ada pilihan yang cocok' : 'Tidak ada perintah yang cocok';
        out += `  ${chalk.gray('│')}  ${chalk.red(fit(noMatchMsg, width - 5))}\n`;
      }
      out += '  ' + chalk.gray(`╰${'─'.repeat(Math.max(0, width - 3))}`);
    }
  }

  // Garis bawah dan baris status mengikuti area input —
  // sehingga angka konteks ikut ter-update di setiap pengetikan.
  out += `\n${rules.bottom}`;
  out += `\n\n${renderStatusLine({ maxWidth: currentCols })}`;
  return out;
}

/**
 * Input baris slash-command dengan dropdown Perintah.
 * Diekspor agar layout-nya bisa diuji tanpa harus menjalankan terminal sungguhan.
 */
export class SlashTextPrompt extends TextPrompt {
  constructor(opts) {
    const placeholder = opts.placeholder || '';
    let selectedIndex = 0;
    let showDropdown = false;
    let userNavigated = false;
    let lastVal = '';
    let lastCtrlCTime = 0;
    let ctrlCTimer = null;
    let historyIndex = -1;
    let savedInputBuffer = '';

    super({
      ...opts,
      render() {
        const val = this.value || '';
        const currentCols = this.output?.columns || terminalWidth();
        return buildPromptFrame({
          value: val,
          state: this.state,
          placeholder,
          displayInput: val ? this.valueWithCursor : null,
          dropdownOpen: showDropdown,
          selectedIndex,
          exitPending: lastCtrlCTime > 0,
          columns: currentCols,
          todoItems: todoStore.read(),
          isCompact: getTodoCompactMode(),
        });
      },
    });

    const stripAnsi = (str) => String(str).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

    const outStream = opts.output || process.stdout;
    let prevCols = outStream.columns || terminalWidth();
    let forceFullRepaint = false;

    const handleResize = () => {
      if (this.state === 'cancel' || this.state === 'submit') return;
      forceFullRepaint = true;
      this.render();
    };

    if (typeof outStream.on === 'function') {
      outStream.on('resize', handleResize);
    }

    const hookRl = (val) => {
      if (!val) return;
      if (typeof val.listenerCount === 'function' && val.listenerCount('SIGINT') === 0) {
        val.on('SIGINT', () => {});
      }
      if (!val._baiworHooked) {
        val._baiworHooked = true;
        const origPrev = val._historyPrev ? val._historyPrev.bind(val) : () => {};
        const origNext = val._historyNext ? val._historyNext.bind(val) : () => {};
        val._historyPrev = () => {
          if (showDropdown) return;
          return origPrev();
        };
        val._historyNext = () => {
          if (showDropdown) return;
          return origNext();
        };
      }
    };

    const ensureRlHooked = () => hookRl(this.rl);

    // Intersep assignment this.rl dari @clack/core
    // Pasang listener SIGINT kosong supaya Node.js readline internal TIDAK PERNAH
    // memanggil rl.close() atau mem-pause stdin saat Ctrl+C ditekan.
    let _rl = undefined;
    Object.defineProperty(this, 'rl', {
      configurable: true,
      enumerable: true,
      get() {
        return _rl;
      },
      set: (val) => {
        _rl = val;
        hookRl(val);
      },
    });

    // Mode pembaruan sinkron (DEC private mode 2026) dan buffer atomik
    // Menghilangkan strobing/flickering pada Windows Terminal dan terminal modern.
    const SYNC_START = '\x1b[?2026h';
    const SYNC_END = '\x1b[?2026l';

    this.render = () => {
      const currentCols = outStream.columns || terminalWidth();
      const isResized = forceFullRepaint || currentCols !== prevCols;
      forceFullRepaint = false;

      const currentFrame = (this._render(this) ?? '').replace(/\r\n/g, '\n');
      if (!isResized && currentFrame === this._prevFrame) return;

      let buf = SYNC_START;

      if (this.state === 'initial') {
        buf += '\x1b[?25l'; // Sembunyikan kursor hardware selama interaksi input
        buf += currentFrame;
        this.state = 'active';
      } else if (isResized) {
        // Saat terminal di-resize (fullscreen atau diperkecil),
        // hitung jumlah baris fisik yang ditempati frame sebelumnya
        // agar kursor kembali tepat ke baris paling awal frame.
        const prevLines = this._prevFrame ? this._prevFrame.split('\n') : [];
        const physicalRows = prevLines.reduce((acc, line) => {
          const len = stripAnsi(line).length;
          return acc + Math.max(1, Math.ceil(len / Math.max(1, currentCols)));
        }, 0);

        const moveUp = physicalRows > 1 ? physicalRows - 1 : 0;
        if (moveUp > 0) buf += `\x1b[${moveUp}A`;
        buf += '\r\x1b[J'; // Hapus bersih dari kursor hingga ke bawah layar
        buf += currentFrame;
      } else {
        const prevLines = this._prevFrame ? this._prevFrame.split('\n') : [];
        const nextLines = currentFrame.split('\n');
        const prevH = prevLines.length;
        const nextH = nextLines.length;

        // Optimasi 1 baris: pengetikan biasa yang hanya mengubah baris input.
        // Timpa baris secara in-place dengan \r + teks + \x1b[K (tanpa \x1b[2K
        // yang mengosongkan baris ke spasi) agar tidak timbul flicker / kedipan layar.
        if (prevH === nextH) {
          const diffs = [];
          for (let i = 0; i < nextH; i++) {
            if (prevLines[i] !== nextLines[i]) diffs.push(i);
          }

          if (diffs.length === 1) {
            const lineIdx = diffs[0];
            const moveUp = prevH - 1 - lineIdx;
            if (moveUp > 0) buf += `\x1b[${moveUp}A`;
            buf += '\r' + nextLines[lineIdx] + '\x1b[K';
            if (moveUp > 0) buf += `\x1b[${moveUp}B`;
            buf += '\r' + SYNC_END;
            this.output.write(buf);
            this._prevFrame = currentFrame;
            prevCols = currentCols;
            return;
          }
        }

        // Multi-line atau perubahan tinggi frame (dropdown buka/tutup, navigasi panah)
        const moveUp = prevH > 1 ? prevH - 1 : 0;
        if (moveUp > 0) buf += `\x1b[${moveUp}A`;
        buf += '\r';

        for (let i = 0; i < nextH; i++) {
          if (i > 0) buf += '\n\r';
          buf += nextLines[i] + '\x1b[K';
        }

        // Jika frame sebelumnya lebih tinggi (mis. dropdown tertutup),
        // bersihkan sisa baris di bawahnya tanpa memicu scroll buffer terminal
        if (prevH > nextH) {
          const extra = prevH - nextH;
          for (let k = 0; k < extra; k++) {
            buf += '\x1b[1B\x1b[2K';
          }
          buf += `\x1b[${extra}A\r`;
        } else {
          buf += '\r';
        }
      }

      buf += SYNC_END;
      this.output.write(buf);
      this._prevFrame = currentFrame;
      prevCols = currentCols;
    };

    this.restoreCursor = () => {
      const currentCols = outStream.columns || terminalWidth();
      const prevLines = this._prevFrame ? this._prevFrame.split('\n') : [];
      const physicalRows = prevLines.reduce((acc, line) => {
        const len = stripAnsi(line).length;
        return acc + Math.max(1, Math.ceil(len / Math.max(1, currentCols)));
      }, 0);
      if (physicalRows > 1) {
        this.output.write(`\x1b[${physicalRows - 1}A\r`);
      } else {
        this.output.write('\r');
      }
    };

    let lastContextKey = '';

    // Reset selection & update dropdown ONLY when the typed query actually changes
    this.on('value', (currentVal) => {
      const val = currentVal || '';
      if (val !== lastVal) {
        lastVal = val;
        const ctx = getPromptContext(val);
        const contextKey = `${ctx.type}:${ctx.parentCmd || ''}`;
        if (contextKey !== lastContextKey) {
          selectedIndex = 0;
          userNavigated = false;
          lastContextKey = contextKey;
        }

        if (ctx.type === 'command' || ctx.type === 'subcommand') {
          showDropdown = true;
          if (!userNavigated) {
            selectedIndex = 0;
          }
        } else {
          showDropdown = false;
          userNavigated = false;
          selectedIndex = 0;
        }
      }
    });

    const origClose = this.close.bind(this);
    this.close = () => {
      if (ctrlCTimer) {
        clearTimeout(ctrlCTimer);
        ctrlCTimer = null;
      }
      lastCtrlCTime = 0;
      if (typeof outStream.off === 'function') {
        outStream.off('resize', handleResize);
      } else if (typeof outStream.removeListener === 'function') {
        outStream.removeListener('resize', handleResize);
      }
      return origClose();
    };

    const origOnKeypress = this.onKeypress.bind(this);
    this.onKeypress = (u, key) => {
      ensureRlHooked();

      const val = this.value || '';
      const isSlash = val.trimStart().startsWith('/');
      const isCtrlC =
        (key?.name === 'c' && Boolean(key?.ctrl)) ||
        u === '\u0003' ||
        key?.sequence === '\u0003';

      // 1. Proteksi penekanan Ctrl+C
      if (isCtrlC) {
        // Jika ada teks yang sedang diketik: hapus teks baris input (seperti shell/REPL)
        // Pengguna tidak kehilangan sesi atau keluar dari bAIwor Code karena salah pencet
        if (val.length > 0) {
          lastCtrlCTime = 0;
          if (ctrlCTimer) {
            clearTimeout(ctrlCTimer);
            ctrlCTimer = null;
          }
          this.value = '';
          this._cursor = 0;
          if (this.rl) {
            this.rl.line = '';
            this.rl.cursor = 0;
          }
          showDropdown = false;
          lastVal = '';
          this.emit('value', '');
          this.render();
          return;
        }

        const now = Date.now();
        const elapsed = now - lastCtrlCTime;

        // Cegah auto-repeat / key bounce dari penekanan fisik yang sama (< 400ms).
        // Pada Windows, menahan Ctrl+C sedikit saja mengirimkan event berulang.
        if (lastCtrlCTime > 0 && elapsed < 400) {
          return;
        }

        // Penekanan kedua yang sah (antara 400ms dan 3000ms): izinkan keluar
        if (lastCtrlCTime > 0 && elapsed <= 3000) {
          if (ctrlCTimer) {
            clearTimeout(ctrlCTimer);
            ctrlCTimer = null;
          }
          lastCtrlCTime = 0;
          return origOnKeypress(u, key);
        }

        // Penekanan pertama pada baris kosong: pasang waktu & timer peringatan
        lastCtrlCTime = now;
        if (ctrlCTimer) {
          clearTimeout(ctrlCTimer);
        }
        ctrlCTimer = setTimeout(() => {
          lastCtrlCTime = 0;
          ctrlCTimer = null;
          if (this.state === 'active') {
            this.render();
          }
        }, 3000);
        this.render();
        return;
      }

      // Jika tombol lain ditekan saat peringatan keluar aktif, batalkan status peringatan
      if (lastCtrlCTime > 0) {
        lastCtrlCTime = 0;
        if (ctrlCTimer) {
          clearTimeout(ctrlCTimer);
          ctrlCTimer = null;
        }
      }

      // 2. Tombol Escape: jangan langsung mematikan aplikasi
      if (key?.name === 'escape') {
        if (showDropdown) {
          showDropdown = false;
          this.render();
          return;
        }
        if (val.length > 0) {
          this.value = '';
          this._cursor = 0;
          if (this.rl) {
            this.rl.line = '';
            this.rl.cursor = 0;
          }
          lastVal = '';
          this.emit('value', '');
          this.render();
          return;
        }
        // Jika baris sudah kosong dan dropdown tertutup, abaikan Escape (tidak keluar)
        return;
      }

      // 3. Tombol Ctrl+T: toggle mode compact / expand untuk Todo widget
      const isCtrlT =
        (key?.name === 't' && Boolean(key?.ctrl)) ||
        u === '\u0014' ||
        key?.sequence === '\u0014';
      if (isCtrlT) {
        toggleTodoCompactMode();
        this.render();
        return;
      }

      // 3b. Tombol Shift+Tab: siklus mode akses normal <-> full.
      //     Label di status line ikut berganti via renderStatusLine, sehingga
      //     perubahan mode selalu terlihat pada frame yang digambar ulang.
      const isShiftTab =
        key?.name === 'tab' && key?.shift === true && !key?.ctrl;
      if (isShiftTab) {
        setAccessMode(getAccessMode() === 'full' ? 'normal' : 'full');
        this.render();
        return;
      }

      // 4. Navigasi riwayat prompt dengan Panah Atas (↑) dan Panah Bawah (↓)
      // hanya aktif jika dropdown slash TIDAK sedang terbuka dan bukan awalan slash '/'
      if (!showDropdown && !isSlash) {
        if (key?.name === 'up' && promptHistory.length > 0) {
          if (historyIndex + 1 < promptHistory.length) {
            if (historyIndex === -1) {
              savedInputBuffer = this.value || '';
            }
            historyIndex++;
            const recalled = promptHistory[historyIndex];
            this.value = recalled;
            this._cursor = recalled.length;
            if (this.rl) {
              this.rl.line = recalled;
              this.rl.cursor = recalled.length;
            }
            lastVal = recalled;
            this.emit('value', recalled);
            this.render();
            return;
          }
        }

        if (key?.name === 'down' && historyIndex >= 0) {
          historyIndex--;
          const recalled = historyIndex === -1 ? savedInputBuffer : promptHistory[historyIndex];
          this.value = recalled;
          this._cursor = recalled.length;
          if (this.rl) {
            this.rl.line = recalled;
            this.rl.cursor = recalled.length;
          }
          lastVal = recalled;
          this.emit('value', recalled);
          this.render();
          return;
        }

        if (key?.name !== 'up' && key?.name !== 'down' && key?.name !== 'left' && key?.name !== 'right' && historyIndex !== -1) {
          historyIndex = -1;
          savedInputBuffer = '';
        }
      }

      // Tab saat baris masih kosong: langsung munculkan '/' dan buka dropdown
      if (!val && (key?.name === 'tab' || u === '\t')) {
        this.value = '/';
        this._cursor = 1;
        if (this.rl) {
          this.rl.line = '/';
          this.rl.cursor = 1;
        }
        showDropdown = true;
        selectedIndex = 0;
        userNavigated = false;
        lastVal = '/';
        this.emit('value', '/');
        this.render();
        return;
      }

      if (isSlash) {
        const ctx = getPromptContext(val);
        const matches = ctx.matches;

        // Jika perintah free-form (seperti /plan teks): Enter langsung submit
        if (ctx.type === 'freeform') {
          if (key?.name === 'return') {
            showDropdown = false;
            this.state = 'submit';
            this.emit('finalize');
            this.render();
            this.close();
            return;
          }
          return origOnKeypress(u, key);
        }

        // Spasi saat navigasi root command yang punya subcommand
        // (contoh: user tekan panah bawah ke /timeline lalu tekan Spasi)
        const isSpace = key?.name === 'space' || u === ' ';
        if (isSpace && ctx.type === 'command' && userNavigated) {
          const picked = matches[selectedIndex] || matches[0];
          if (picked) {
            const nextVal = picked.name + ' ';
            this.value = nextVal;
            this._cursor = nextVal.length;
            if (this.rl) {
              this.rl.line = nextVal;
              this.rl.cursor = nextVal.length;
            }
            lastVal = nextVal;
            lastContextKey = `subcommand:${picked.name}`;
            selectedIndex = 0;
            userNavigated = false;
            showDropdown = true;
            this.render();
            return;
          }
        }

        if (matches.length > 0) {
          // Panah Atas (↑): pindah 1 item ke atas tanpa lag
          if (key?.name === 'up') {
            if (!showDropdown) return origOnKeypress(u, key);
            selectedIndex = (selectedIndex - 1 + matches.length) % matches.length;
            userNavigated = true;
            this.render();
            return;
          }

          // Panah Bawah (↓): pindah 1 item ke bawah tanpa lag
          if (key?.name === 'down') {
            if (!showDropdown) return origOnKeypress(u, key);
            selectedIndex = (selectedIndex + 1) % matches.length;
            userNavigated = true;
            this.render();
            return;
          }

          // Tab: lengkapi perintah atau subperintah yang dipilih ke frame input dan TUTUP dropdown
          if (key?.name === 'tab' || u === '\t') {
            const picked = matches[selectedIndex] || matches[0];
            if (picked) {
              let nextVal = '';
              if (ctx.type === 'command') {
                nextVal = picked.name + ' ';
              } else if (ctx.type === 'subcommand') {
                nextVal = `${ctx.parentCmd} ${picked.name} `;
              }

              if (nextVal) {
                this.value = nextVal;
                this._cursor = nextVal.length;
                if (this.rl) {
                  this.rl.line = nextVal;
                  this.rl.cursor = nextVal.length;
                }
                lastVal = nextVal;
                showDropdown = false;
                userNavigated = false;
                selectedIndex = 0;
                this.render();
                return;
              }
            }
          }

          // Enter: eksekusi perintah yang dipilih atau buka opsi subcommand
          if (key?.name === 'return') {
            // Jika dropdown sedang tertutup (karena ditutup dengan Tab atau Esc),
            // Enter langsung submit nilai di frame input saat ini
            if (!showDropdown) {
              this.state = 'submit';
              this.emit('finalize');
              this.render();
              this.close();
              return;
            }

            // Kasus 1: Sedang berada dalam mode Subcommand (misal /timeline ...)
            if (ctx.type === 'subcommand') {
              const pickedSub = matches[selectedIndex] || matches[0];
              if (pickedSub) {
                this.value = `${ctx.parentCmd} ${pickedSub.name}`;
                showDropdown = false;
                this.state = 'submit';
                this.emit('finalize');
                this.render();
                this.close();
                return;
              }
            }

            // Kasus 2: Sedang berada dalam mode Command utama
            let pickedCmd = null;

            if (userNavigated) {
              pickedCmd = matches[selectedIndex] || matches[0];
            } else {
              const exact = matches.find((m) => m.name.toLowerCase() === val.trim().toLowerCase());
              if (exact) {
                pickedCmd = exact;
              } else if (!ctx.query) {
                // Hanya "/" (atau "/ ") dan tekan Enter tanpa navigasi -> submit "/" agar bin/baiwor.js buka p.select
                this.value = '/';
                showDropdown = false;
                this.state = 'submit';
                this.emit('finalize');
                this.render();
                this.close();
                return;
              } else if (matches.length === 1) {
                pickedCmd = matches[0];
              }
            }

            if (pickedCmd) {
              // Jika perintah punya subcommand terdaftar (seperti /timeline, /session, /skill):
              // Jangan langsung eksekusi! Buka pilihan sub-opsi untuk dipilih pengguna.
              if (SUBCOMMANDS[pickedCmd.name]) {
                const nextVal = pickedCmd.name + ' ';
                this.value = nextVal;
                this._cursor = nextVal.length;
                if (this.rl) {
                  this.rl.line = nextVal;
                  this.rl.cursor = nextVal.length;
                }
                lastVal = nextVal;
                lastContextKey = `subcommand:${pickedCmd.name}`;
                selectedIndex = 0;
                userNavigated = false;
                showDropdown = true;
                this.render();
                return;
              }

              // Perintah biasa tanpa subcommand
              this.value = pickedCmd.name;
              showDropdown = false;
              this.state = 'submit';
              this.emit('finalize');
              this.render();
              this.close();
              return;
            }
          }
        }
      }

      return origOnKeypress(u, key);
    };
  }
}

export async function askBaiworInput(opts = {}) {
  const placeholder = opts.placeholder || 'Ask bAIwor Code to do anything...';

  if (process.stdin.isTTY) {
    try {
      const promptInstance = new SlashTextPrompt({
        placeholder,
        defaultValue: '',
      });
      const input = await promptInstance.prompt();
      if (typeof input === 'string' && !isCancel(input)) {
        savePromptHistory(input);
      }
      return input;
    } catch {
      // Fallback to readline below if TTY initialization fails
    }
  }

  // Non-TTY / Fallback
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(chalk.bold('› '), (answer) => {
      rl.close();
      if (typeof answer === 'string') {
        savePromptHistory(answer);
      }
      resolve(answer);
    });
  });
}
