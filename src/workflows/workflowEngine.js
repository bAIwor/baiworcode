import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Workflows System untuk bAIwor Code.
 *
 * Multi-stage deterministic orchestration yang memungkinkan pengguna mendefinisikan
 * alur kerja kompleks dengan fase-fase (pipeline/parallel) dan agent-agent yang
 * berjalan secara deterministik.
 *
 * Arsitektur:
 *   1. Workflow didefinisikan sebagai file JavaScript (.baiwor/workflows/*.js)
 *   2. Setiap workflow memiliki meta (name, description, phases) dan script body
 *   3. Script body menggunakan API: agent(), parallel(), pipeline(), phase()
 *   4. WorkflowEngine mengeksekusi script dan mengelola state per fase
 *   5. Hasil dikumpulkan dan dikembalikan sebagai structured output
 *
 * Contoh workflow:
 *   export const meta = {
 *     name: 'review-code',
 *     description: 'Review kode dan verifikasi temuan',
 *     phases: [{ title: 'Review' }, { title: 'Verify' }],
 *   };
 *
 *   const results = await pipeline(
 *     [{ key: 'bugs', prompt: 'Cari bug' }, { key: 'perf', prompt: 'Cari masalah performa' }],
 *     item => agent(item.prompt, { label: `review:${item.key}`, phase: 'Review' }),
 *     review => parallel(review.map(r => () =>
 *       agent(`Verifikasi: ${r.title}`, { label: `verify:${r.file}`, phase: 'Verify' })
 *     ))
 *   );
 */

/**
 * @typedef {Object} WorkflowMeta
 * @property {string} name - Nama unik workflow
 * @property {string} description - Deskripsi singkat
 * @property {Array<{title: string, detail?: string}>} [phases] - Daftar fase eksekusi
 */

/**
 * @typedef {Object} AgentOptions
 * @property {string} [label] - Label untuk tracking
 * @property {string} [phase] - Fase saat agent berjalan
 * @property {Object} [schema] - JSON Schema untuk output terstruktur
 */

/**
 * @typedef {Object} WorkflowContext
 * @property {string} cwd - Working directory
 * @property {Object} args - Argumen workflow dari CLI
 * @property {Function} agent - API untuk spawn agent
 * @property {Function} parallel - API untuk eksekusi paralel
 * @property {Function} pipeline - API untuk pipeline multi-fase
 */

export class WorkflowEngine {
  /**
   * @param {{cwd?: string, workflowsDir?: string}} [options]
   */
  constructor(options = {}) {
    this.cwd = options.cwd || process.cwd();
    this.workflowsDir = options.workflowsDir || path.join(this.cwd, '.baiwor', 'workflows');
    this.workflows = new Map(); // name -> { meta, script }
    this.executionLog = [];
  }

  /**
   * Memuat semua workflow dari direktori workflows.
   */
  async loadWorkflows() {
    if (!fs.existsSync(this.workflowsDir)) {
      return;
    }

    // Berkas workflow memakai sintaks ESM (`export const meta = ...`). Tanpa
    // penanda "type": "module", Node 18/20 memperlakukan .js sebagai
    // CommonJS dan gagal parse ("Unexpected token 'export'"); Node 22+ baru
    // mendeteksi otomatis. package.json kecil ini menyamakan perilaku di
    // semua versi Node yang didukung.
    this._ensureEsmMarker();

    const files = fs.readdirSync(this.workflowsDir).filter((f) => f.endsWith('.js') || f.endsWith('.mjs'));
    for (const file of files) {
      try {
        const filePath = path.join(this.workflowsDir, file);
        const module = await import(pathToFileURL(filePath).href);

        if (!module.meta || !module.meta.name) {
          console.warn(`[Workflows] ${file} tidak memiliki meta.name, dilewati`);
          continue;
        }

        this.workflows.set(module.meta.name, {
          meta: module.meta,
          script: module.default || module.script,
        });
      } catch (err) {
        console.warn(`[Workflows] Gagal memuat ${file}: ${err.message}`);
      }
    }
  }

  /**
   * Menulis package.json penanda ESM di direktori workflow bila belum ada.
   * Berkas milik pengguna tidak pernah ditimpa.
   */
  _ensureEsmMarker() {
    const marker = path.join(this.workflowsDir, 'package.json');
    try {
      if (fs.existsSync(marker)) {
        const parsed = JSON.parse(fs.readFileSync(marker, 'utf8'));
        if (parsed && parsed.type === 'module') return;
        return; // package.json milik pengguna: biarkan apa adanya.
      }
      fs.writeFileSync(marker, JSON.stringify({ type: 'module' }, null, 2), { mode: 0o600 });
    } catch {}
  }

  /**
   * Menampilkan daftar workflow yang tersedia.
   *
   * @returns {WorkflowMeta[]}
   */
  listWorkflows() {
    return Array.from(this.workflows.values()).map(w => w.meta);
  }

  /**
   * Mendapatkan workflow berdasarkan nama.
   *
   * @param {string} name
   * @returns {{meta: WorkflowMeta, script: Function} | null}
   */
  getWorkflow(name) {
    return this.workflows.get(name) || null;
  }

  /**
   * API: Spawn agent untuk menjalankan tugas.
   *
   * @param {string} prompt - Instruksi untuk agent
   * @param {AgentOptions} [options] - Opsi agent
   * @returns {Promise<Object>} - Hasil agent
   */
  async agent(prompt, options = {}) {
    const startTime = Date.now();
    this.executionLog.push({
      type: 'agent',
      label: options.label || 'agent',
      phase: options.phase || 'default',
      prompt: prompt.slice(0, 100),
      startTime,
    });

    // Untuk saat ini, agent hanya return placeholder
    // Integrasi dengan subagent system akan dilakukan nanti
    const result = {
      success: true,
      output: `[Agent ${options.label || 'unnamed'}] Prompt: ${prompt}`,
      label: options.label,
      phase: options.phase,
      durationMs: Date.now() - startTime,
    };

    return result;
  }

  /**
   * API: Eksekusi beberapa task secara paralel.
   *
   * @param {Array<Function>} tasks - Array of task functions
   * @returns {Promise<Array>} - Array of results
   */
  async parallel(tasks) {
    if (!Array.isArray(tasks)) {
      throw new Error('parallel() membutuhkan array of functions');
    }

    this.executionLog.push({
      type: 'parallel',
      taskCount: tasks.length,
      startTime: Date.now(),
    });

    const results = await Promise.all(tasks.map(task => task()));
    return results;
  }

  /**
   * API: Pipeline multi-fase dengan transformasi data.
   *
   * @param {Array} items - Input items
   * @param {Function} mapFn - Function untuk map setiap item ke agent call
   * @param {Function} [reduceFn] - Function untuk reduce hasil per fase
   * @returns {Promise<Array>} - Array of results per fase
   */
  async pipeline(items, mapFn, reduceFn) {
    if (!Array.isArray(items)) {
      throw new Error('pipeline() membutuhkan array of items');
    }

    this.executionLog.push({
      type: 'pipeline',
      itemCount: items.length,
      startTime: Date.now(),
    });

    // Fase 1: Map items ke agent calls
    const phase1Results = await Promise.all(items.map(mapFn));

    // Fase 2: Reduce (jika ada)
    if (typeof reduceFn === 'function') {
      const phase2Results = await reduceFn(phase1Results);
      return [phase1Results, phase2Results];
    }

    return phase1Results;
  }

  /**
   * API: Define phase untuk grouping.
   *
   * @param {string} title - Judul fase
   * @param {Function} fn - Function yang dijalankan di fase ini
   * @returns {Promise<any>} - Hasil dari fn
   */
  async phase(title, fn) {
    this.executionLog.push({
      type: 'phase',
      title,
      startTime: Date.now(),
    });

    const result = await fn();

    this.executionLog.push({
      type: 'phase-end',
      title,
      endTime: Date.now(),
    });

    return result;
  }

  /**
   * Menjalankan workflow berdasarkan nama.
   *
   * @param {string} name - Nama workflow
   * @param {Object} [args={}] - Argumen untuk workflow
   * @returns {Promise<{success: boolean, output: any, log: Array}>}
   */
  async run(name, args = {}) {
    const workflow = this.getWorkflow(name);
    if (!workflow) {
      return {
        success: false,
        output: `Workflow '${name}' tidak ditemukan`,
        log: [],
      };
    }

    this.executionLog = [];
    const startTime = Date.now();

    try {
      // Buat context dengan API functions
      const context = {
        cwd: this.cwd,
        args,
        agent: this.agent.bind(this),
        parallel: this.parallel.bind(this),
        pipeline: this.pipeline.bind(this),
        phase: this.phase.bind(this),
      };

      // Jalankan script workflow
      const result = await workflow.script(context);

      return {
        success: true,
        output: result,
        log: this.executionLog,
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      return {
        success: false,
        output: `Workflow gagal: ${err.message}`,
        log: this.executionLog,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Membuat workflow baru dari template.
   *
   * @param {WorkflowMeta} meta - Metadata workflow
   * @param {string} scriptBody - Body script sebagai string
   */
  createWorkflow(meta, scriptBody) {
    if (!fs.existsSync(this.workflowsDir)) {
      fs.mkdirSync(this.workflowsDir, { recursive: true, mode: 0o700 });
    }
    this._ensureEsmMarker();

    const filePath = path.join(this.workflowsDir, `${meta.name}.js`);
    const content = `export const meta = ${JSON.stringify(meta, null, 2)};

export default async function(context) {
  const { agent, parallel, pipeline, phase, args, cwd } = context;

${scriptBody}
}
`;

    fs.writeFileSync(filePath, content, { mode: 0o600 });
    return filePath;
  }
}

/**
 * Singleton instance untuk digunakan di seluruh aplikasi.
 */
export const workflowEngine = new WorkflowEngine();
