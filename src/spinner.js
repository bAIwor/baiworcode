import chalk from 'chalk';
import { theme } from './theme.js';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Spinner yang AMAN untuk stdin.
 *
 * Menggantikan `p.spinner()` dari @clack/prompts. Spinner clack memakai
 * `block()` yang menyalakan raw mode dan membuat readline di `process.stdin`.
 * Pada Windows ConPTY, toggle raw mode / readline tambahan itu ikut memicu race
 * yang meninggalkan stdin dalam keadaan salah -> terminal membeku (persis yang
 * terjadi pada alur /model).
 *
 * Versi ini hanya menulis ke stdout dan tidak pernah menyentuh stdin.
 * API-nya kompatibel: `start(message)` · `message(text)` · `stop(finalMessage)`.
 */
export function spinner() {
  const out = process.stdout;
  const isTTY = Boolean(out && out.isTTY);
  let timer = null;
  let frame = 0;
  let text = '';

  const draw = () => {
    if (!isTTY) return;
    try {
      out.write(`\r\x1b[2K${theme.accent(FRAMES[frame])}  ${text}`);
    } catch {}
    frame = (frame + 1) % FRAMES.length;
  };

  return {
    start(message = '') {
      text = message;
      if (!isTTY) return;
      draw();
      if (timer) clearInterval(timer);
      timer = setInterval(draw, 90);
      if (typeof timer.unref === 'function') timer.unref();
    },
    message(next = '') {
      text = next;
      if (isTTY && timer) draw();
    },
    stop(finalMessage = '') {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      const line = finalMessage || text;
      try {
        if (isTTY) {
          out.write('\r\x1b[2K');
          if (line) out.write(`${line}\n`);
        } else if (line) {
          out.write(`${line}\n`);
        }
      } catch {}
    },
  };
}
