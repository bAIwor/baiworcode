import { TextPrompt, isCancel } from '@clack/core';
import chalk from 'chalk';
import readline from 'node:readline';

export const COMMANDS = [
  { name: '/help', desc: 'Menampilkan panduan perintah & bantuan' },
  { name: '/status', desc: 'Status konfigurasi, model aktif & sesi login' },
  { name: '/model', desc: 'Pilih & kelola model AI / provider (ala Hermes)' },
  { name: '/provider', desc: 'Alias untuk perintah /model' },
  { name: '/login', desc: 'Login ke provider OAuth (Gemini, Copilot, dll)' },
  { name: '/logout', desc: 'Logout dari sesi provider OAuth' },
  { name: '/clear', desc: 'Membersihkan layar dan menampilkan ulang banner' },
  { name: '/exit', desc: 'Keluar dari bAIwor Code' },
];

class SlashTextPrompt extends TextPrompt {
  constructor(opts) {
    const placeholder = opts.placeholder || '';
    let selectedIndex = 0;
    let showDropdown = false;
    let lastVal = '';

    super({
      ...opts,
      render() {
        const val = this.value || '';
        const cursorText = this.valueWithCursor;
        const displayInput = val ? cursorText : chalk.dim(placeholder);

        let out = '';
        if (this.state === 'submit') {
          out = `  ${chalk.cyan('›')} ${chalk.white(val || placeholder)}`;
        } else if (this.state === 'cancel') {
          out = `  ${chalk.red('›')} ${chalk.strikethrough(chalk.gray(val))}`;
        } else {
          out = `  ${chalk.cyan('›')} ${displayInput}`;

          if (showDropdown && val.startsWith('/')) {
            const query = val.toLowerCase();
            const matches = COMMANDS.filter((c) => c.name.startsWith(query));

            if (selectedIndex >= matches.length) {
              selectedIndex = 0;
            }

            out += '\n  ' + chalk.gray('╭─ Perintah (↑/↓ pilih, Enter jalankan, Tab lengkapi, Esc tutup)') + '\n';
            if (matches.length > 0) {
              matches.forEach((cmd, idx) => {
                const isSelected = idx === selectedIndex;
                if (isSelected) {
                  out += `  ${chalk.gray('│')}  ${chalk.cyan.bold('❯')} ${chalk.cyan.bold(cmd.name.padEnd(11))} ${chalk.gray('─')} ${chalk.white.bold(cmd.desc)}\n`;
                } else {
                  out += `  ${chalk.gray('│')}    ${chalk.dim(cmd.name.padEnd(11))} ${chalk.gray('─')} ${chalk.dim(cmd.desc)}\n`;
                }
              });
            } else {
              out += `  ${chalk.gray('│')}  ${chalk.red('Tidak ada perintah yang cocok')}\n`;
            }
            out += '  ' + chalk.gray('╰─────────────────────────────────────────────────────────────────────────');
          }
        }
        return out;
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
