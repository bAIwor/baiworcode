import { TextPrompt, isCancel } from '@clack/core';
import chalk from 'chalk';
import readline from 'node:readline';
import { theme } from './theme.js';
import { renderStatusLine, frameRules, terminalWidth } from './statusLine.js';
import { todoStore } from './tools/todoTool.js';
import { renderTodoWidget, toggleTodoCompactMode, getTodoCompactMode } from './chat/planMode.js';

export const COMMANDS = [
  { name: '/help', desc: 'Menampilkan panduan perintah & bantuan' },
  { name: '/plan', desc: 'Mode arsitek semAIr: susun rencana & analisis tanpa ubah kode' },
  { name: '/compact', desc: 'Ringkas konteks percakapan untuk menghemat token' },
  { name: '/timeline', desc: 'Ganti tampilan aktivitas: compact (satu baris) / detail (pohon)' },
  { name: '/session', desc: 'Kelola sesi percakapan (list, resume, delete, clear)' },
  { name: '/skill', desc: 'Kelola modul keahlian & plugin (.baiwor/skills)' },
  { name: '/rules', desc: 'Lihat aturan koding aktif (BAIWORS.md / .baiwor/rules)' },
  { name: '/status', desc: 'Status konfigurasi & model AI aktif' },
  { name: '/model', desc: 'Pilih model Agentik, Google Gemini, atau Custom' },
  { name: '/provider', desc: 'Alias untuk perintah /model' },
  { name: '/login', desc: 'Login ke Google Gemini OAuth' },
  { name: '/logout', desc: 'Logout dari sesi Google Gemini OAuth' },
  { name: '/clear', desc: 'Bersihkan layar & reset riwayat percakapan' },
  { name: '/reset', desc: 'Reset konteks percakapan AI tanpa clear layar' },
  { name: '/exit', desc: 'Keluar dari bAIwor Code (alias: /q, /quit)' },
  { name: '/q', desc: 'Keluar dari bAIwor Code (alias /exit)' },
];

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

    if (dropdownOpen && value.startsWith('/')) {
      const query = value.toLowerCase();
      const matches = COMMANDS.filter((c) => c.name.startsWith(query));
      const active = matches.length ? Math.min(selectedIndex, matches.length - 1) : 0;

      // Seluruh baris dropdown dijaga muat di lebar terminal. Sebelumnya kotak
      // bawah dipatok 76 kolom dan header 66 kolom, sehingga di terminal sempit
      // barisnya meluber dan kotak layout ikut patah. Satu kolom disisakan
      // supaya tidak ada baris yang persis selebar terminal (pemicu wrap).
      const width = currentCols - 1;
      const fit = (text, max = width) => {
        const s = String(text);
        if (max <= 0) return '';
        return s.length > max ? `${s.slice(0, Math.max(0, max - 1))}…` : s;
      };

      const header =
        '  ╭─ Perintah (↑/↓ pilih, Enter jalankan, Tab lengkapi, Esc tutup)';
      const shortHeader = '  ╭─ Perintah';
      out += '\n' + chalk.gray(fit(header.length <= width ? header : shortHeader)) + '\n';

      // Prefix tiap item selalu 21 kolom tampil (tanpa warna), jadi deskripsi
      // tinggal memakai sisa lebar yang tersedia.
      const NAME_LEN = 11;
      const PREFIX_LEN = 21;
      const descBudget = width - PREFIX_LEN;
      if (matches.length > 0) {
        matches.forEach((cmd, idx) => {
          const name = cmd.name.padEnd(NAME_LEN);
          const desc = fit(cmd.desc, descBudget);
          if (idx === active) {
            out += `  ${chalk.gray('│')}  ${chalk.cyan.bold('❯')} ${chalk.cyan.bold(name)} ${chalk.gray('─')} ${chalk.whiteBright.bold(desc)}\n`;
          } else {
            out += `  ${chalk.gray('│')}    ${chalk.dim(name)} ${chalk.gray('─')} ${chalk.dim(desc)}\n`;
          }
        });
      } else {
        out += `  ${chalk.gray('│')}  ${chalk.red(fit('Tidak ada perintah yang cocok', width - 5))}\n`;
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
    let lastVal = '';
    let lastCtrlCTime = 0;
    let ctrlCTimer = null;

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

    // Reset selection & update dropdown ONLY when the typed query actually changes
    this.on('value', (currentVal) => {
      const val = currentVal || '';
      if (val !== lastVal) {
        lastVal = val;
        if (val.startsWith('/')) {
          showDropdown = true;
          selectedIndex = 0;
        } else {
          showDropdown = false;
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
      const isSlash = val.startsWith('/');
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

      if (isSlash && showDropdown) {
        const query = val.toLowerCase();
        const matches = COMMANDS.filter((c) => c.name.startsWith(query));

        if (matches.length > 0) {
          // Panah Atas (↑): pindah 1 item ke atas tanpa lag
          if (key?.name === 'up') {
            selectedIndex = (selectedIndex - 1 + matches.length) % matches.length;
            this.render();
            return;
          }

          // Panah Bawah (↓): pindah 1 item ke bawah tanpa lag
          if (key?.name === 'down') {
            selectedIndex = (selectedIndex + 1) % matches.length;
            this.render();
            return;
          }

          // Tab: lengkapi nama perintah ke input line dan TUTUP dropdown
          if (key?.name === 'tab' || u === '\t') {
            const picked = matches[selectedIndex] || matches[0];
            if (picked) {
              const diff = picked.name.slice(val.length);
              if (diff && this.rl) {
                this.rl.write(diff);
              }
              this.value = picked.name;
              this._cursor = picked.name.length;
              showDropdown = false; // Langsung tutup dropdown setelah terpilih
              lastVal = picked.name;
              this.render();
            }
            return;
          }

          // Enter: langsung eksekusi perintah yang dipilih
          if (key?.name === 'return') {
            const picked = matches[selectedIndex] || matches[0];
            if (picked) {
              this.value = picked.name;
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
      return await promptInstance.prompt();
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
      resolve(answer);
    });
  });
}
