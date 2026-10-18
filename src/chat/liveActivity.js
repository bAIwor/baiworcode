import { renderTimelineByMode } from './timeline.js';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const FRAME_MS = 90;
const ANSI_RE = /^\x1b\[[0-9;]*m/;

/**
 * Memotong string yang mengandung escape code ANSI tanpa menghitung
 * escape-nya sebagai lebar tampilan. Baris yang lebih panjang dari terminal
 * akan membungkus dan merusak hitungan baris saat blok digambar ulang,
 * jadi tiap baris dipangkas ke lebar kolom.
 *
 * @param {string} str
 * @param {number} maxWidth
 * @returns {string}
 */
function truncateAnsi(str, maxWidth) {
  if (maxWidth <= 0) return '';
  // Sisakan satu kolom untuk elipsis bila baris ternyata harus dipotong.
  const cap = Math.max(0, maxWidth - 1);
  let out = '';
  let width = 0;
  let i = 0;
  while (i < str.length && width < cap) {
    const esc = ANSI_RE.exec(str.slice(i));
    if (esc) {
      out += esc[0];
      i += esc[0].length;
      continue;
    }
    out += str[i];
    width += 1;
    i += 1;
  }
  if (i >= str.length) return out; // seluruh isi muat
  // Potongan warna bisa tertinggal tanpa penutup; reset dulu agar tidak bocor.
  return `${out}\x1b[0m…`;
}

/**
 * Blok aktivitas tool yang "hidup": digambar ulang di tempat sementara tool
 * berjalan, sehingga pengguna melihat langkah muncul satu per satu dengan
 * penanda berputar pada langkah yang sedang aktif — pola khas antarmuka
 * terminal bAIwor Code.
 *
 * Di luar TTY seluruh operasi gambar menjadi no-op (`enabled === false`);
 * pemanggil bertanggung jawab mencetak satu kali lewat `renderTimeline`.
 *
 * Kode escape yang dipakai aman selama blok adalah keluaran terakhir di layar:
 * sebelum menjalankan tool yang mungkin mencetak sesuatu (mis. prompt
 * persetujuan), panggil {@link LiveActivity#suspend} lalu
 * {@link LiveActivity#resume}.
 */
export class LiveActivity {
  /**
   * @param {{stream?:NodeJS.WriteStream, useColor?:boolean, enabled?:boolean, maxSummary?:number, mode?:'detail'|'compact'}} [options]
   */
  constructor({ stream = process.stdout, useColor = true, enabled = true, maxSummary, mode = 'detail' } = {}) {
    this.stream = stream;
    this.useColor = useColor;
    this.maxSummary = maxSummary;
    this.mode = mode;
    // Animasi bergantung pada kemampuan menimpa baris (TTY).
    this.enabled = Boolean(enabled && stream && stream.isTTY);
    this.events = [];
    this.renderedLines = 0;
    this.frame = 0;
    this.timer = null;
    this.paused = false;
    this.#attachResize();
  }

  #attachResize() {
    if (!this.enabled || typeof this.stream?.on !== 'function') return;
    this.resizeHandler = () => {
      if (this.enabled && !this.paused && this.renderedLines > 0) {
        this.#draw();
      }
    };
    this.stream.on('resize', this.resizeHandler);
  }

  #detachResize() {
    if (this.resizeHandler && typeof this.stream?.off === 'function') {
      this.stream.off('resize', this.resizeHandler);
      this.resizeHandler = null;
    }
  }

  /** Menandai tool mulai berjalan, menggambar ulang blok, dan memutar frame. */
  addTool(name, args) {
    const index = this.events.length;
    this.events.push({ name, args, running: true, durationMs: 0, success: true });
    this.#draw();
    this.#ensureTimer();
    return index;
  }

  /** Menyelesaikan tool pada `index` dengan data hasilnya. */
  settleTool(index, patch = {}) {
    const ev = this.events[index];
    if (!ev) return;
    Object.assign(ev, patch, { running: false });
    this.#draw();
    if (!this.events.some((e) => e.running)) this.#stopTimer();
  }

  /**
   * Menyembunyikan blok agar keluaran lain (prompt persetujuan, dll.) tidak
   * menabraknya. Data event tetap utuh dan digambar lagi oleh {@link resume}.
   */
  suspend() {
    this.paused = true;
    this.#stopTimer();
    if (!this.enabled || this.renderedLines === 0) {
      this.renderedLines = 0;
      return;
    }
    this.stream.write(`\x1b[${this.renderedLines}A\x1b[J`);
    this.renderedLines = 0;
  }

  /** Menggambar ulang blok setelah {@link suspend}. */
  resume() {
    this.paused = false;
    if (!this.enabled) return;
    this.#draw();
    if (this.events.some((e) => e.running)) this.#ensureTimer();
  }

  /**
   * Menyelesaikan blok: tampilan terakhir dibiarkan permanen di layar dan
   * penghitung internal direset, siap dipakai giliran berikutnya.
   */
  commit() {
    this.#stopTimer();
    this.#detachResize();
    this.renderedLines = 0;
    this.events = [];
  }

  /** Menghentikan animasi tanpa mengubah tampilan. */
  stop() {
    this.#stopTimer();
    this.#detachResize();
  }

  #draw() {
    if (!this.enabled || this.paused) return;
    const columns = this.stream.columns || 80;
    const maxWidth = Math.max(20, columns - 1);

    const lines = renderTimelineByMode(this.events, {
      mode: this.mode,
      useColor: this.useColor,
      maxSummary: this.maxSummary,
      spinnerFrame: FRAMES[this.frame],
    })
      .split('\n')
      .map((line) => truncateAnsi(line, maxWidth));

    let out = '';
    // Kembali ke awal blok lalu hapus dari sana ke bawah sebelum menggambar ulang.
    if (this.renderedLines > 0) out += `\x1b[${this.renderedLines}A`;
    out += '\x1b[J';
    out += lines.join('\n') + '\n';

    this.stream.write(out);
    this.renderedLines = lines.length;
  }

  #ensureTimer() {
    if (!this.enabled || this.timer) return;
    this.timer = setInterval(() => {
      if (this.paused || !this.events.some((e) => e.running)) return;
      this.frame = (this.frame + 1) % FRAMES.length;
      this.#draw();
    }, FRAME_MS);
    if (this.timer.unref) this.timer.unref();
  }

  #stopTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
