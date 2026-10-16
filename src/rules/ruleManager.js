import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * Batas maksimum karakter aturan yang disuntikkan ke context window (~3.000 token).
 */
export const MAX_RULES_CHARS = 12000;

/**
 * Parsing sederhana frontmatter YAML pada file aturan (.md).
 *
 * @param {string} rawContent
 * @param {string} [filePath]
 * @returns {{ metadata: Object, content: string }}
 */
export function parseRuleContent(rawContent = '', filePath = '') {
  if (!rawContent || typeof rawContent !== 'string') {
    return { metadata: {}, content: '' };
  }

  const trimmed = rawContent.trim();
  const fmMatch = trimmed.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);

  if (!fmMatch) {
    const fallbackName = filePath ? path.basename(filePath, path.extname(filePath)) : 'rule';
    return {
      metadata: { name: fallbackName },
      content: trimmed,
    };
  }

  const rawYaml = fmMatch[1];
  const content = (fmMatch[2] || '').trim();
  const metadata = {};

  for (const line of rawYaml.split(/\r?\n/)) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      let val = line.slice(colonIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key) {
        metadata[key] = val;
      }
    }
  }

  if (!metadata.name && filePath) {
    metadata.name = path.basename(filePath, path.extname(filePath));
  }

  return { metadata, content };
}

/**
 * Menemukan seluruh berkas aturan koding yang berlaku di proyek lokal dan global:
 * 1. File root: BAIWORS.md, baiwors.md, RULES.md, rules.md
 * 2. Direktori proyek: .baiwor/rules/*.md
 * 3. Direktori global: ~/.baiwor/rules/*.md
 *
 * Aturan proyek meng-override aturan global dengan nama yang sama.
 *
 * @param {Object} [options]
 * @param {string} [options.cwd]
 * @param {string} [options.homeDir]
 * @returns {Map<string, { name: string, title?: string, path: string, scope: 'project'|'global', content: string, metadata: Object }>}
 */
export function discoverRules(options = {}) {
  const cwd = options.cwd || process.cwd();
  const homeDir = options.homeDir || os.homedir();
  const rules = new Map();

  // 1. Scan global rules: ~/.baiwor/rules/*.md
  const globalRulesDir = path.join(homeDir, '.baiwor', 'rules');
  if (fs.existsSync(globalRulesDir)) {
    try {
      const entries = fs.readdirSync(globalRulesDir, { withFileTypes: true });
      for (const ent of entries) {
        if (!ent.isFile() || !ent.name.endsWith('.md')) continue;
        const filePath = path.join(globalRulesDir, ent.name);
        try {
          const raw = fs.readFileSync(filePath, 'utf8');
          const { metadata, content } = parseRuleContent(raw, filePath);
          const name = metadata.name || path.basename(ent.name, '.md');
          rules.set(name, {
            name,
            title: metadata.title || name,
            path: filePath,
            scope: 'global',
            content,
            metadata,
          });
        } catch {}
      }
    } catch {}
  }

  // 2. Scan project directory rules: .baiwor/rules/*.md (override global)
  const projectRulesDir = path.join(cwd, '.baiwor', 'rules');
  if (fs.existsSync(projectRulesDir)) {
    try {
      const entries = fs.readdirSync(projectRulesDir, { withFileTypes: true });
      for (const ent of entries) {
        if (!ent.isFile() || !ent.name.endsWith('.md')) continue;
        const filePath = path.join(projectRulesDir, ent.name);
        try {
          const raw = fs.readFileSync(filePath, 'utf8');
          const { metadata, content } = parseRuleContent(raw, filePath);
          const name = metadata.name || path.basename(ent.name, '.md');
          rules.set(name, {
            name,
            title: metadata.title || name,
            path: filePath,
            scope: 'project',
            content,
            metadata,
          });
        } catch {}
      }
    } catch {}
  }

  // 3. Scan project root candidate files: BAIWORS.md, RULES.md, etc.
  const rootCandidates = ['BAIWORS.md', 'baiwors.md', 'RULES.md', 'rules.md'];
  for (const candidate of rootCandidates) {
    const candidatePath = path.join(cwd, candidate);
    if (fs.existsSync(candidatePath)) {
      try {
        const raw = fs.readFileSync(candidatePath, 'utf8');
        const { metadata, content } = parseRuleContent(raw, candidatePath);
        const name = 'root-' + candidate.toLowerCase().replace(/\.md$/, '');
        // Prioritas tertinggi untuk file root instruksi
        rules.set(name, {
          name,
          title: metadata.title || candidate,
          path: candidatePath,
          scope: 'project',
          content,
          metadata,
        });
      } catch {}
      break; // Ambil file root pertama yang cocok agar tidak menduplikasi
    }
  }

  return rules;
}

/**
 * Memformat daftar aturan menjadi teks prompt sistem yang rapi dan terstruktur.
 *
 * @param {Map<string, Object>|Array<Object>} rules
 * @param {number} [maxChars=MAX_RULES_CHARS]
 * @returns {string}
 */
export function formatRulesPrompt(rules, maxChars = MAX_RULES_CHARS) {
  if (!rules) return '';
  const list = rules instanceof Map ? Array.from(rules.values()) : Array.isArray(rules) ? rules : [];
  if (list.length === 0) return '';

  const blocks = [];
  let currentLength = 0;

  for (const rule of list) {
    const header = `### Aturan: ${rule.title || rule.name} (${rule.scope === 'project' ? 'Proyek' : 'Global'})\nSumber: \`${rule.path}\``;
    const body = rule.content ? rule.content.trim() : '';
    const section = `${header}\n${body}`;

    if (currentLength + section.length > maxChars) {
      const remaining = Math.max(0, maxChars - currentLength);
      if (remaining > 100) {
        blocks.push(
          `${header}\n${body.slice(0, remaining)}\n… [Sisa aturan dipotong agar hemat konteks]`
        );
      }
      break;
    }

    blocks.push(section);
    currentLength += section.length;
  }

  return (
    `Aturan Koding & Konvensi Proyek Lokal (Project Rules):\n` +
    `Perhatikan dan patuhi secara ketat instruksi di bawah ini saat menyusun, merevisi, atau menguji kode:\n\n` +
    blocks.join('\n\n---\n\n')
  );
}
