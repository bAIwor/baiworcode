import fs from 'node:fs';
import path from 'node:path';

/**
 * Custom Agent Creator untuk bAIwor Code.
 *
 * Memungkinkan pengguna membuat custom agents dengan konfigurasi spesifik:
 * - System prompt kustom
 * - Tool access yang dibatasi
 * - Model override (optional)
 * - Temperature/max_tokens override (optional)
 *
 * Custom agents disimpan di .baiwor/agents/*.json dan bisa dipanggil via
 * delegate_task tool atau command /agent.
 */

/**
 * @typedef {Object} AgentDefinition
 * @property {string} name - Nama unik agent (identifier)
 * @property {string} title - Nama tampilan agent
 * @property {string} emoji - Emoji representasi agent
 * @property {string} systemPrompt - System prompt untuk agent
 * @property {string[]} allowedTools - Daftar tool yang boleh diakses
 * @property {string} [model] - Model override (optional)
 * @property {number} [temperature] - Temperature override (optional)
 * @property {number} [maxTokens] - Max tokens override (optional)
 * @property {string} createdAt - Timestamp pembuatan
 * @property {string} [updatedAt] - Timestamp update terakhir
 */

/** Default agents yang sudah predefined (Punakawan Squad). */
export const DEFAULT_AGENTS = {
  pAItruk: {
    name: 'pAItruk',
    title: 'Scout & Penjelajah',
    emoji: '🔭',
    systemPrompt: `Kamu adalah pAItruk — Sang Scout & Penjelajah handal tim Punakawan bAIwor Code.
Peranmu murni investigasi & eksplorasi (READ-ONLY).
Aturan ketat:
1. Kamu HANYA boleh membaca dan mencari berkas (read_file, search_files, list_directory, websearch, webfetch).
2. Dilarang keras mencoba mengubah berkas atau menjalankan perintah penulisan.
3. Setelah menemukan informasi yang diminta, berikan laporan akhir terstruktur (lokasi berkas, fungsi/baris relevan, dan analisis singkat) untuk agen utama.
Jawab lugas, to-the-point, dan jujur (blakasuta).`,
    allowedTools: ['read_file', 'list_directory', 'search_files', 'webfetch', 'websearch'],
  },
  gAIreng: {
    name: 'gAIreng',
    title: 'Auditor & Verifikator',
    emoji: '⚖️',
    systemPrompt: `Kamu adalah gAIreng — Sang Auditor & Verifikator mutu tim Punakawan bAIwor Code.
Peranmu menguji kebenaran, memeriksa test suite, linter, dan memvalidasi pekerjaan.
Aturan:
1. Gunakan run_command untuk menjalankan perintah pengujian (seperti npm test, linter, dsb.) dan diagnostics untuk validasi.
2. Periksa berkas bila perlu memverifikasi kode atau pesan galat.
3. Berikan laporan verifikasi jelas: LULUS atau GAGAL, beserta rincian kegagalan dan rekomendasi perbaikan.
Jawab lugas, to-the-point, dan jujur (blakasuta).`,
    allowedTools: ['read_file', 'search_files', 'list_directory', 'run_command', 'diagnostics'],
  },
  bAIwor: {
    name: 'bAIwor',
    title: 'Master Builder',
    emoji: '🔨',
    systemPrompt: `Kamu adalah bAIwor — Sang Master Builder tim Punakawan bAIwor Code.
Peranmu menyelesaikan sub-tugas penulisan atau pengubahan kode terfokus.
Tuntaskan tugas yang didelegasikan dan laporkan hasil konkretnya kepada agen utama.
Jawab lugas, to-the-point, dan jujur (blakasuta).`,
    allowedTools: [
      'read_file',
      'write_file',
      'edit_file',
      'patch_file',
      'list_directory',
      'search_files',
      'run_command',
      'diagnostics',
    ],
  },
};

export class AgentCreator {
  /**
   * @param {{cwd?: string, agentsDir?: string}} [options]
   */
  constructor(options = {}) {
    this.cwd = options.cwd || process.cwd();
    this.agentsDir = options.agentsDir || path.join(this.cwd, '.baiwor', 'agents');
    this.agents = new Map();
    this.#loadDefaultAgents();
    this.#loadCustomAgents();
  }

  #loadDefaultAgents() {
    for (const [name, agent] of Object.entries(DEFAULT_AGENTS)) {
      this.agents.set(name, { ...agent, isDefault: true });
    }
  }

  #loadCustomAgents() {
    if (!fs.existsSync(this.agentsDir)) {
      return;
    }

    try {
      const files = fs.readdirSync(this.agentsDir).filter((f) => f.endsWith('.json'));
      for (const file of files) {
        try {
          const filePath = path.join(this.agentsDir, file);
          const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          if (content.name) {
            this.agents.set(content.name, { ...content, isDefault: false });
          }
        } catch (err) {
          console.warn(`[Agents] Gagal memuat ${file}: ${err.message}`);
        }
      }
    } catch (err) {
      console.warn(`[Agents] Gagal membaca direktori ${this.agentsDir}: ${err.message}`);
    }
  }

  /**
   * Buat custom agent baru.
   *
   * @param {Object} config - Konfigurasi agent
   * @param {string} config.name - Nama unik agent
   * @param {string} config.title - Nama tampilan
   * @param {string} [config.emoji='🤖'] - Emoji representasi
   * @param {string} config.systemPrompt - System prompt
   * @param {string[]} config.allowedTools - Daftar tool yang boleh diakses
   * @param {string} [config.model] - Model override
   * @param {number} [config.temperature] - Temperature override
   * @param {number} [config.maxTokens] - Max tokens override
   * @returns {AgentDefinition}
   */
  createAgent(config) {
    if (!config.name || typeof config.name !== 'string') {
      throw new Error('Agent name is required');
    }

    if (this.agents.has(config.name)) {
      throw new Error(`Agent '${config.name}' already exists. Use updateAgent() to modify.`);
    }

    if (!config.systemPrompt || typeof config.systemPrompt !== 'string') {
      throw new Error('System prompt is required');
    }

    if (!Array.isArray(config.allowedTools) || config.allowedTools.length === 0) {
      throw new Error('Allowed tools must be a non-empty array');
    }

    const agent = {
      name: config.name,
      title: config.title || config.name,
      emoji: config.emoji || '🤖',
      systemPrompt: config.systemPrompt,
      allowedTools: config.allowedTools,
      model: config.model || null,
      temperature: config.temperature || null,
      maxTokens: config.maxTokens || null,
      createdAt: new Date().toISOString(),
      isDefault: false,
    };

    this.agents.set(config.name, agent);
    this.#saveAgent(agent);
    return agent;
  }

  /**
   * Update custom agent yang sudah ada.
   *
   * @param {string} name - Nama agent yang akan diupdate
   * @param {Partial<AgentDefinition>} updates - Field yang akan diupdate
   * @returns {AgentDefinition}
   */
  updateAgent(name, updates) {
    const agent = this.agents.get(name);
    if (!agent) {
      throw new Error(`Agent '${name}' not found`);
    }

    if (agent.isDefault) {
      throw new Error(`Cannot modify default agent '${name}'. Create a new agent instead.`);
    }

    const updated = {
      ...agent,
      ...updates,
      name, // name tidak boleh diubah
      updatedAt: new Date().toISOString(),
    };

    this.agents.set(name, updated);
    this.#saveAgent(updated);
    return updated;
  }

  /**
   * Hapus custom agent.
   *
   * @param {string} name - Nama agent yang akan dihapus
   */
  deleteAgent(name) {
    const agent = this.agents.get(name);
    if (!agent) {
      throw new Error(`Agent '${name}' not found`);
    }

    if (agent.isDefault) {
      throw new Error(`Cannot delete default agent '${name}'`);
    }

    this.agents.delete(name);

    const filePath = path.join(this.agentsDir, `${name}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  /**
   * Dapatkan agent berdasarkan nama.
   *
   * @param {string} name
   * @returns {AgentDefinition | null}
   */
  getAgent(name) {
    return this.agents.get(name) || null;
  }

  /**
   * Dapatkan daftar semua agents.
   *
   * @param {{includeDefaults?: boolean}} [options]
   * @returns {AgentDefinition[]}
   */
  listAgents(options = {}) {
    const { includeDefaults = true } = options;
    const agents = Array.from(this.agents.values());

    if (includeDefaults) {
      return agents;
    }

    return agents.filter((a) => !a.isDefault);
  }

  /**
   * Dapatkan daftar default agents saja.
   *
   * @returns {AgentDefinition[]}
   */
  listDefaultAgents() {
    return Array.from(this.agents.values()).filter((a) => a.isDefault);
  }

  /**
   * Dapatkan daftar custom agents saja.
   *
   * @returns {AgentDefinition[]}
   */
  listCustomAgents() {
    return Array.from(this.agents.values()).filter((a) => !a.isDefault);
  }

  #saveAgent(agent) {
    if (!fs.existsSync(this.agentsDir)) {
      fs.mkdirSync(this.agentsDir, { recursive: true, mode: 0o700 });
    }

    const filePath = path.join(this.agentsDir, `${agent.name}.json`);
    fs.writeFileSync(filePath, JSON.stringify(agent, null, 2), { mode: 0o600 });
  }

  /**
   * Filter tool definitions berdasarkan allowed tools agent.
   *
   * @param {string} agentName
   * @param {Object[]} allToolDefinitions - Semua tool definitions
   * @returns {Object[]} - Filtered tool definitions
   */
  filterToolsForAgent(agentName, allToolDefinitions) {
    const agent = this.getAgent(agentName);
    if (!agent) {
      return allToolDefinitions;
    }

    return allToolDefinitions.filter((tool) => agent.allowedTools.includes(tool.name || tool.function?.name));
  }

  /**
   * Reset ke default agents saja (hapus semua custom agents).
   */
  reset() {
    const customAgents = this.listCustomAgents();
    for (const agent of customAgents) {
      this.deleteAgent(agent.name);
    }
    this.agents.clear();
    this.#loadDefaultAgents();
  }
}

/**
 * Singleton instance untuk digunakan di seluruh aplikasi.
 */
export const agentCreator = new AgentCreator();
