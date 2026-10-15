import { TextPrompt, isCancel } from '@clack/core';
import chalk from 'chalk';
import readline from 'node:readline';
import { renderStatusLine, frameRules, terminalWidth } from './statusLine.js';

export const COMMANDS = [
  { name: '/help', desc: 'Menampilkan panduan perintah & bantuan' },
  { name: '/status', desc: 'Status konfigurasi & model AI aktif' },
  { name: '/model', desc: 'Pilih model Agentik, Google Gemini, atau Custom' },
  { name: '/provider', desc: 'Alias untuk perintah /model' },
  { name: '/login', desc: 'Login ke Google Gemini OAuth' },
  { name: '/logout', desc: 'Logout dari sesi Google Gemini OAuth' },
  { name: '/clear', desc: 'Bersihkan layar & reset riwayat percakapan' },
  { name: '/reset', desc: 'Reset konteks percakapan AI tanpa clear layar' },
  { name: '/exit', desc: 'Keluar dari bAIwor Code' },
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
} = {}) {
  const shown = displayInput !== null ? displayInput : value;

  const rules = frameRules();
  let out = rules.top + '\n';

  if (state === 'submit') {
    out += `  ${chalk.cyan('›')}  ${chalk.white(value || placeholder)}`;
  } else if (state === 'cancel') {
    out += `  ${chalk.red('›')}  ${chalk.strikethrough(chalk.gray(value))}`;
  } else {
    out += `  ${chalk.cyan('›')}  ${shown || chalk.dim(placeholder)}`;

    if (dropdownOpen && value.startsWith('/')) {
      const query = value.toLowerCase();
      const matches = COMMANDS.filter((c) => c.name.startsWith(query));
      const active = matches.length ? Math.min(selectedIndex, matches.length - 1) : 0;

      // Seluruh baris dropdown dijaga muat di lebar terminal. Sebelumnya kotak
      // bawah dipatok 76 kolom dan header 66 kolom, sehingga di terminal sempit
      // barisnya meluber dan kotak layout ikut patah.
      const width = terminalWidth();
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
            out += `  ${chalk.gray('│')}  ${chalk.cyan.bold('❯')} ${chalk.cyan.bold(name)} ${chalk.gray('─')} ${chalk.white.bold(desc)}\n`;
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
  out += `\n\n${renderStatusLine()}`;
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

    super({
      ...opts,
      render() {
        const val = this.value || '';
        return buildPromptFrame({
          value: val,
          state: this.state,
          placeholder,
          displayInput: val ? this.valueWithCursor : null,
          dropdownOpen: showDropdown,
          selectedIndex,
        });
      },
    });

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

    // Hook readline history so arrow keys don't fight with history lookup or cause lag/jumping
    const ensureRlHooked = () => {
      if (this.rl && !this.rl._baiworHooked) {
        this.rl._baiworHooked = true;
        const origPrev = this.rl._historyPrev ? this.rl._historyPrev.bind(this.rl) : () => {};
        const origNext = this.rl._historyNext ? this.rl._historyNext.bind(this.rl) : () => {};
        this.rl._historyPrev = () => {
          if (showDropdown) return;
          return origPrev();
        };
        this.rl._historyNext = () => {
          if (showDropdown) return;
          return origNext();
        };
      }
    };

    const origOnKeypress = this.onKeypress.bind(this);
    this.onKeypress = (u, key) => {
      ensureRlHooked();

      const val = this.value || '';
      const isSlash = val.startsWith('/');

      // Esc: tutup dropdown menu perintah
      if (key?.name === 'escape') {
        if (showDropdown) {
          showDropdown = false;
          this.render();
          return;
        }
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
