import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

/** Direktori modul skillManager.js (dipakai untuk menemukan skill bawaan). */
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * Parsing sederhana frontmatter YAML dan markdown tanpa dependensi library eksternal berat.
 *
 * @param {string} rawContent - Isi mentah file SKILL.md
 * @param {string} [filePath] - Lokasi file untuk debugging
 * @returns {{ metadata: Object, instructions: string }}
 */
export function parseSkillContent(rawContent = '', filePath = '') {
  if (!rawContent || typeof rawContent !== 'string') {
    return { metadata: {}, instructions: '' };
  }

  const trimmed = rawContent.trim();
  const fmMatch = trimmed.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);

  if (!fmMatch) {
    // Tidak ada frontmatter, anggap seluruh isi sebagai instruksi
    const fallbackName = filePath ? path.basename(path.dirname(filePath)) : 'unnamed-skill';
    return {
      metadata: {
        name: fallbackName,
        description: 'Skill tanpa frontmatter',
      },
      instructions: trimmed,
    };
  }

  const rawYaml = fmMatch[1];
  const instructions = (fmMatch[2] || '').trim();
  const metadata = {};

  for (const line of rawYaml.split(/\r?\n/)) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      let val = line.slice(colonIdx + 1).trim();
      // Bersihkan tanda kutip bila ada
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key) {
        metadata[key] = val;
      }
    }
  }

  if (!metadata.name && filePath) {
    metadata.name = path.basename(path.dirname(filePath));
  }

  return { metadata, instructions };
}

/**
 * Menemukan seluruh skill yang tersedia di proyek (.baiwor/skills/) dan global (~/.baiwor/skills/).
 *
 * @param {Object} [options]
 * @param {string} [options.cwd] - Direktori workspace proyek aktif
 * @param {string} [options.homeDir] - Direktori home pengguna
 * @returns {Map<string, { name: string, description: string, version?: string, path: string, scope: 'project'|'global', instructions: string }>}
 */
export function discoverSkills(options = {}) {
  const cwd = options.cwd || process.cwd();
  const homeDir = options.homeDir || os.homedir();
  const skills = new Map();

  const scanDir = (dirPath, scope) => {
    if (!fs.existsSync(dirPath)) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const skillName = ent.name;
      const skillFilePath = path.join(dirPath, skillName, 'SKILL.md');
      if (fs.existsSync(skillFilePath)) {
        try {
          const raw = fs.readFileSync(skillFilePath, 'utf8');
          const { metadata, instructions } = parseSkillContent(raw, skillFilePath);
          const name = metadata.name || skillName;
          skills.set(name, {
            name,
            description: metadata.description || 'Tidak ada deskripsi',
            version: metadata.version || '1.0.0',
            author: metadata.author || 'Anonim',
            path: skillFilePath,
            scope,
            instructions,
          });
        } catch {}
      }
    }
  };

  // 1. Scan skill bawaan (shipped dengan bAIwor Code) — prioritas terendah.
  scanDir(path.join(MODULE_DIR, 'bundled'), 'builtin');

  // 2. Scan global skills (~/.baiwor/skills/) — menimpa builtin bila duplikasi nama
  scanDir(path.join(homeDir, '.baiwor', 'skills'), 'global');

  // 3. Scan project skills (.baiwor/skills/) — menimpa global bila duplikasi nama
  scanDir(path.join(cwd, '.baiwor', 'skills'), 'project');

  return skills;
}

/**
 * Mengambil satu skill berdasarkan nama.
 *
 * @param {string} name
 * @param {Object} [options]
 * @returns {Object|null}
 */
export function getSkill(name, options = {}) {
  const all = discoverSkills(options);
  return all.get(name) || null;
}

/**
 * Memformat daftar skill untuk disisipkan ke dalam System Prompt.
 *
 * @param {Map<string, Object>|Array<Object>} skills
 * @returns {string}
 */
export function formatSkillsPrompt(skills) {
  const list = skills instanceof Map ? Array.from(skills.values()) : Array.isArray(skills) ? skills : [];
  if (list.length === 0) return '';

  const lines = list.map(
    (s) => `- \`${s.name}\` (${s.scope}): ${s.description}`
  );

  return `Modul Keahlian / Ekstensi Proyek (.baiwor/skills):
${lines.join('\n')}`;
}
