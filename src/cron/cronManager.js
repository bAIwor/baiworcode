import fs from 'node:fs';
import path from 'node:path';

/**
 * Cron/Scheduled Tasks System untuk bAIwor Code.
 *
 * Memungkinkan pengguna menjadwalkan prompt/perintah untuk dijalankan secara
 * berkala (cron expression) atau satu kali (one-shot) pada waktu tertentu.
 *
 * Arsitektur:
 *   1. CronManager mengelola daftar scheduled tasks
 *   2. Setiap task memiliki: id, cron expression, prompt, options
 *   3. Task disimpan di ~/.baiwor/cron-tasks.json
 *   4. Scheduler berjalan di background dan trigger task saat waktunya tiba
 *   5. Support untuk recurring (cron) dan one-shot (scheduled wakeup) tasks
 */

/**
 * @typedef {Object} CronTask
 * @property {string} id - Unique identifier
 * @property {string} cron - Cron expression (5-field: minute hour day month weekday)
 * @property {string} prompt - Prompt yang akan dijalankan
 * @property {boolean} recurring - Apakah task berulang (true) atau one-shot (false)
 * @property {number} [maxTurns] - Batas maksimal turns per execution
 * @property {number} [maxCredits] - Batas maksimal credits per execution
 * @property {string} createdAt - Timestamp pembuatan
 * @property {string} [lastRun] - Timestamp eksekusi terakhir
 * @property {string} [nextRun] - Timestamp eksekusi berikutnya
 */

// Parse cron expression (5-field) dan return object dengan nilai-nilai.
// Format: minute hour dayOfMonth month dayOfWeek
// Contoh: "*\/5 * * * *" berarti setiap 5 menit (escape slash untuk menghindari syntax error)
/**
 * @param {string} cron - Cron expression
 * @returns {{minute: any, hour: any, dayOfMonth: any, month: any, dayOfWeek: any}}
 */
export function parseCronExpression(cron) {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: ${cron}. Expected 5 fields (minute hour day month weekday)`);
  }

  const parseField = (field, min, max) => {
    if (field === '*') return null; // wildcard
    if (field.includes('/')) {
      // Step values: */5 = every 5 units
      const [, step] = field.split('/');
      return { step: parseInt(step, 10) };
    }
    if (field.includes(',')) {
      // List: 1,3,5
      return field.split(',').map((v) => parseInt(v, 10));
    }
    if (field.includes('-')) {
      // Range: 1-5
      const [start, end] = field.split('-').map((v) => parseInt(v, 10));
      return { range: [start, end] };
    }
    const value = parseInt(field, 10);
    if (isNaN(value) || value < min || value > max) {
      throw new Error(`Invalid cron field: ${field} (expected ${min}-${max})`);
    }
    return value;
  };

  return {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    dayOfMonth: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12),
    dayOfWeek: parseField(parts[4], 0, 6), // 0 = Sunday
  };
}

/**
 * Cek apakah waktu saat ini cocok dengan cron expression.
 *
 * @param {string} cron - Cron expression
 * @param {Date} [now=new Date()] - Waktu yang akan dicek
 * @returns {boolean}
 */
export function matchesCron(cron, now = new Date()) {
  const parsed = parseCronExpression(cron);
  const minute = now.getMinutes();
  const hour = now.getHours();
  const dayOfMonth = now.getDate();
  const month = now.getMonth() + 1; // JavaScript months are 0-indexed
  const dayOfWeek = now.getDay(); // 0 = Sunday

  const matchField = (field, value) => {
    if (field === null) return true; // wildcard
    if (typeof field === 'number') return field === value;
    if (Array.isArray(field)) return field.includes(value);
    if (field.step) return value % field.step === 0;
    if (field.range) return value >= field.range[0] && value <= field.range[1];
    return false;
  };

  return (
    matchField(parsed.minute, minute) &&
    matchField(parsed.hour, hour) &&
    matchField(parsed.dayOfMonth, dayOfMonth) &&
    matchField(parsed.month, month) &&
    matchField(parsed.dayOfWeek, dayOfWeek)
  );
}

/**
 * Hitung waktu eksekusi berikutnya dari cron expression.
 *
 * @param {string} cron - Cron expression
 * @param {Date} [from=new Date()] - Waktu mulai
 * @returns {Date}
 */
export function getNextCronTime(cron, from = new Date()) {
  const next = new Date(from);
  next.setSeconds(0, 0);
  next.setMinutes(next.getMinutes() + 1);

  // Simple brute-force: increment by minute until match (max 24 hours)
  const maxIterations = 24 * 60;
  for (let i = 0; i < maxIterations; i++) {
    if (matchesCron(cron, next)) {
      return next;
    }
    next.setMinutes(next.getMinutes() + 1);
  }

  // If no match found in 24 hours, return null
  return null;
}

export class CronManager {
  /**
   * @param {{storagePath?: string}} [options]
   */
  constructor(options = {}) {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    this.storagePath = options.storagePath || path.join(homeDir, '.baiwor', 'cron-tasks.json');
    this.tasks = new Map();
    this.nextTaskId = 1;
    this.schedulerInterval = null;
    this.#load();
  }

  #load() {
    if (!fs.existsSync(this.storagePath)) {
      return;
    }

    try {
      const content = JSON.parse(fs.readFileSync(this.storagePath, 'utf8'));
      if (content.tasks) {
        for (const task of content.tasks) {
          this.tasks.set(task.id, task);
        }
      }
      if (content.nextTaskId) this.nextTaskId = content.nextTaskId;
    } catch (err) {
      console.warn(`[Cron] Gagal memuat dari ${this.storagePath}: ${err.message}`);
    }
  }

  #save() {
    const dir = path.dirname(this.storagePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    const data = {
      tasks: Array.from(this.tasks.values()),
      nextTaskId: this.nextTaskId,
    };

    fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2), { mode: 0o600 });
  }

  /**
   * Buat scheduled task baru.
   *
   * @param {string} cron - Cron expression
   * @param {string} prompt - Prompt yang akan dijalankan
   * @param {{recurring?: boolean, maxTurns?: number, maxCredits?: number}} [options]
   * @returns {CronTask}
   */
  create(cron, prompt, options = {}) {
    // Validate cron expression
    parseCronExpression(cron);

    const id = String(this.nextTaskId++);
    const task = {
      id,
      cron,
      prompt,
      recurring: options.recurring !== false, // default true
      maxTurns: options.maxTurns || null,
      maxCredits: options.maxCredits || null,
      createdAt: new Date().toISOString(),
      lastRun: null,
      nextRun: getNextCronTime(cron)?.toISOString() || null,
    };

    this.tasks.set(id, task);
    this.#save();
    return task;
  }

  /**
   * Buat one-shot scheduled task (ScheduleWakeup).
   *
   * @param {number} delaySeconds - Delay dalam detik
   * @param {string} prompt - Prompt yang akan dijalankan
   * @param {{maxTurns?: number, maxCredits?: number}} [options]
   * @returns {CronTask}
   */
  scheduleWakeup(delaySeconds, prompt, options = {}) {
    const executeAt = new Date(Date.now() + delaySeconds * 1000);
    const cron = `${executeAt.getMinutes()} ${executeAt.getHours()} ${executeAt.getDate()} ${executeAt.getMonth() + 1} *`;

    const task = this.create(cron, prompt, { ...options, recurring: false });
    return task;
  }

  /**
   * Dapatkan task berdasarkan ID.
   *
   * @param {string} id
   * @returns {CronTask | null}
   */
  get(id) {
    return this.tasks.get(id) || null;
  }

  /**
   * Hapus task berdasarkan ID.
   *
   * @param {string} id
   */
  delete(id) {
    if (!this.tasks.has(id)) {
      throw new Error(`Task '${id}' tidak ditemukan`);
    }
    this.tasks.delete(id);
    this.#save();
  }

  /**
   * Dapatkan daftar semua tasks.
   *
   * @returns {CronTask[]}
   */
  list() {
    return Array.from(this.tasks.values());
  }

  /**
   * Dapatkan tasks yang siap dijalankan (nextRun <= now).
   *
   * @returns {CronTask[]}
   */
  getReadyTasks() {
    const now = new Date();
    return Array.from(this.tasks.values()).filter((task) => {
      if (!task.nextRun) return false;
      return new Date(task.nextRun) <= now;
    });
  }

  /**
   * Tandai task sebagai sudah dijalankan dan update nextRun.
   *
   * @param {string} id
   */
  markAsRun(id) {
    const task = this.tasks.get(id);
    if (!task) return;

    task.lastRun = new Date().toISOString();

    if (task.recurring) {
      task.nextRun = getNextCronTime(task.cron)?.toISOString() || null;
    } else {
      // One-shot task: hapus setelah dijalankan
      this.tasks.delete(id);
    }

    this.#save();
  }

  /**
   * Mulai scheduler background.
   *
   * @param {(task: CronTask) => void} onTaskReady - Callback saat task siap dijalankan
   * @param {number} [checkIntervalMs=60000] - Interval pengecekan (default 1 menit)
   */
  startScheduler(onTaskReady, checkIntervalMs = 60000) {
    if (this.schedulerInterval) {
      console.warn('[Cron] Scheduler sudah berjalan');
      return;
    }

    this.schedulerInterval = setInterval(() => {
      const readyTasks = this.getReadyTasks();
      for (const task of readyTasks) {
        try {
          onTaskReady(task);
          this.markAsRun(task.id);
        } catch (err) {
          console.error(`[Cron] Error menjalankan task ${task.id}: ${err.message}`);
        }
      }
    }, checkIntervalMs);

    // Jangan biarkan scheduler mencegah process exit
    if (this.schedulerInterval.unref) {
      this.schedulerInterval.unref();
    }
  }

  /**
   * Hentikan scheduler background.
   */
  stopScheduler() {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
    }
  }

  /**
   * Reset semua tasks.
   */
  reset() {
    this.tasks.clear();
    this.nextTaskId = 1;
    this.#save();
  }
}

/**
 * Singleton instance untuk digunakan di seluruh aplikasi.
 */
export const cronManager = new CronManager();
