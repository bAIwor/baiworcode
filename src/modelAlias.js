import chalk from 'chalk';
import { theme } from './theme.js';
import { getConfig, saveConfig } from './config.js';

/**
 * Sistem model aliases untuk bAIwor Code.
 *
 * Ide intinya:
 *   1. Alias bernama  — `/model fav`, `/model step` → switch langsung tanpa menu.
 *   2. Short form     — `provider/model`, mis. `stepfun/step-5-preview` atau
 *      `agentik/gemini-3.8-flash-high`.
 *   3. Alias boleh membawa kredensial sendiri (baseUrl + apiKey) lewat bentuk
 *      objek di config.json, jadi endpoint baru bisa langsung dipakai.
 *
 * Alias disimpan di `~/.baiwor/config.json` pada key `modelAliases`:
 *
 *   "modelAliases": {
 *     "step":  "stepfun/step-5-preview",                    // short form
 *     "theta": {                                            // bentuk panjang
 *       "model": "theta-1",
 *       "provider": "custom",                               // 'custom' → nama alias dipakai sebagai nama provider
 *       "baseUrl": "https://theta.example.com/v1",
 *       "apiKey": "${THETA_API_KEY}"
 *     }
 *   }
 *
 * Modul ini sengaja dipisah menjadi lapis murni (semua fungsi `resolve*` /
 * `apply*` / `build*` menerima `config` sebagai parameter sehingga bisa diuji
 * tanpa menyentuh disk) dan lapis pipih yang membaca/menulis config
 * (`switchToModel`, `setModelAlias`, `removeModelAlias`).
 */

const ALIAS_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}$/;

/**
 * Mengganti referensi environment variable di nilai rahasia:
 *   "${VAR}" atau "$VAR" → isi process.env.VAR (bila ada; bila tidak,
 * teks aslinya dibiarkan agar kekeliruan konfigurasi terlihat, bukan
 * berubah jadi string kosong yang membingungkan).
 */
function expandSecret(value) {
  return value.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
    (match, braced, bare) => {
      const name = braced || bare;
      return Object.prototype.hasOwnProperty.call(process.env, name)
        ? process.env[name]
        : match;
    }
  );
}

/* ------------------------------------------------------------------ */
/* Pembantu pencarian provider                                        */
/* ------------------------------------------------------------------ */

function findCustomProvider(config, name) {
  if (!name) return null;
  const needle = String(name).toLowerCase();
  return (
    (config?.customProviders || []).find(
      (cp) => cp && cp.name && cp.name.toLowerCase() === needle
    ) || null
  );
}

/* ------------------------------------------------------------------ */
/* Lapis murni: parsing & resolusi                                    */
/* ------------------------------------------------------------------ */

/**
 * Mem-parse satu nilai alias menjadi target resolusi.
 * Bentuk yang didukung:
 *   - string short form: "provider/model"
 *   - objek lengkap:     { model, provider, baseUrl?, apiKey? }
 * @returns {{provider:string, model:string, baseUrl?:string, apiKey?:string}|null}
 */
export function parseAliasValue(value) {
  if (typeof value === 'string') {
    const raw = value.trim();
    const slash = raw.indexOf('/');
    if (slash <= 0 || slash === raw.length - 1) return null;
    const provider = raw.slice(0, slash).trim();
    const model = raw.slice(slash + 1).trim();
    if (!provider || !model) return null;
    return { provider, model };
  }

  if (value && typeof value === 'object') {
    const provider = typeof value.provider === 'string' ? value.provider.trim() : '';
    const model = typeof value.model === 'string' ? value.model.trim() : '';
    if (!provider || !model) return null;
    const target = { provider, model };
    if (typeof value.baseUrl === 'string' && value.baseUrl.trim()) {
      target.baseUrl = value.baseUrl.trim().replace(/\/+$/, '');
    }
    if (typeof value.apiKey === 'string' && value.apiKey.trim()) {
      const rawApiKey = value.apiKey.trim();
      target.apiKey = expandSecret(rawApiKey);
      // Simpan referensi asli agar placeholder ${ENV} tidak ikut
      // dipersistensi sebagai nilai rahasia hasil ekspansi.
      if (/\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/.test(rawApiKey)) {
        target.apiKeyRef = rawApiKey;
      }
    }
    // Alternatif key_env — nama environment variable yang
    // menyimpan kunci, jadi rahasia tidak perlu ditulis di config.json.
    if (!target.apiKey && typeof value.key_env === 'string' && value.key_env.trim()) {
      const envName = value.key_env.trim();
      target.apiKeyRef = `\${${envName}}`;
      const fromEnv = process.env[envName];
      if (fromEnv) target.apiKey = fromEnv;
    }
    return target;
  }

  return null;
}

/**
 * Menjawab target terhadap config yang ada: custom provider tersimpan, atau
 * provider custom baru bila alias membawa baseUrl + apiKey sendiri.
 */
function resolveAgainstConfig(parsed, config) {
  const cp = findCustomProvider(config, parsed.provider);
  if (cp) {
    return {
      provider: cp.name,
      model: parsed.model,
      type: 'custom',
      baseUrl: parsed.baseUrl || cp.baseUrl,
      apiKey: parsed.apiKey || cp.apiKey,
      apiKeyRef: parsed.apiKeyRef || null,
    };
  }

  // Provider custom belum tersimpan: hanya boleh lewat alias bentuk panjang
  // yang membawa kredensialnya sendiri.
  if (parsed.baseUrl && (parsed.apiKey || parsed.apiKeyRef)) {
    return {
      provider: parsed.provider,
      model: parsed.model,
      type: 'custom',
      baseUrl: parsed.baseUrl,
      apiKey: parsed.apiKey,
      apiKeyRef: parsed.apiKeyRef || null,
    };
  }

  return null;
}

/**
 * Alias bawaan deterministik untuk provider sponsor `agentik`.
 */
function resolveBuiltinAlias(name, config) {
  const needle = name.toLowerCase();

  if (needle === 'agentik') {
    const cp = findCustomProvider(config, 'agentik');
    if (cp) {
      return {
        provider: cp.name,
        model: cp.model,
        type: 'custom',
        baseUrl: cp.baseUrl,
        apiKey: cp.apiKey,
      };
    }
  }

  return null;
}

/**
 * Resolusi utama: alias pengguna → short form `provider/model` → alias bawaan.
 * @returns {{provider:string, model:string, type:'custom', baseUrl?:string, apiKey?:string, source:'alias'|'shortform'|'builtin', alias?:string}|null}
 */
export function resolveModelTarget(input, config) {
  if (!input || typeof input !== 'string') return null;
  const query = input.trim();
  if (!query) return null;

  // 1. Alias buatan pengguna — diperiksa LEBIH DULU, jadi bisa menutupi
  //    alias bawaan maupun short form.
  const aliases = config?.modelAliases || {};
  if (Object.prototype.hasOwnProperty.call(aliases, query)) {
    const parsed = parseAliasValue(aliases[query]);
    if (!parsed) return null;
    // Bentuk panjang dengan provider 'custom': nama alias jadi identitas provider.
    const adjusted =
      parsed.provider.toLowerCase() === 'custom' && parsed.baseUrl
        ? { ...parsed, provider: query }
        : parsed;
    const target = resolveAgainstConfig(adjusted, config);
    if (target) return { ...target, source: 'alias', alias: query };
    return null;
  }

  // 2. Short form "provider/model"
  if (query.includes('/')) {
    const parsed = parseAliasValue(query);
    if (!parsed) return null;
    const target = resolveAgainstConfig(parsed, config);
    if (target) return { ...target, source: 'shortform' };
    return null;
  }

  // 3. Alias bawaan
  const builtin = resolveBuiltinAlias(query, config);
  if (builtin) return { ...builtin, source: 'builtin' };

  return null;
}

/* ------------------------------------------------------------------ */
/* Lapis murni: penerapan target ke config                            */
/* ------------------------------------------------------------------ */

/**
 * Menghitung patch config untuk mengaktifkan sebuah target.
 * @returns {{ok:true, patch:object, target:object}|{ok:false, error:string}}
 */
export function applyModelTarget(target, config) {
  if (!target || !target.provider || !target.model) {
    return { ok: false, error: 'Target model tidak valid.' };
  }

  // Custom provider
  const list = Array.isArray(config?.customProviders)
    ? [...config.customProviders]
    : [];
  const idx = list.findIndex(
    (cp) => cp && cp.name && cp.name.toLowerCase() === target.provider.toLowerCase()
  );

  if (idx >= 0) {
    const cp = list[idx];
    // Kredensial hanya diperbarui bila alias memang membawanya (mis. API key
    // baru); jika tidak, kredensial tersimpan dipakai apa adanya dan daftar
    // provider tidak ikut ditulis ulang.
    let credentialChanged = false;
    // Untuk alias dengan placeholder ${ENV}, yang disimpan adalah placeholder,
    // bukan nilai rahasia hasil ekspansi.
    const storedApiKey = target.apiKeyRef || target.apiKey;
    if (storedApiKey && storedApiKey !== cp.apiKey) {
      list[idx] = { ...cp, apiKey: storedApiKey };
      credentialChanged = true;
    }
    if (target.baseUrl && target.baseUrl !== cp.baseUrl) {
      list[idx] = { ...list[idx], baseUrl: target.baseUrl };
      credentialChanged = true;
    }
    const patch = {
      activeProvider: list[idx].name,
      activeModel: target.model,
      activeType: 'custom',
    };
    if (credentialChanged) patch.customProviders = list;
    return {
      ok: true,
      patch,
      target: { ...target, provider: list[idx].name },
    };
  }

  // Provider custom baru — wajib punya kredensial sendiri (nilai langsung
  // atau referensi environment yang diekspansi saat request).
  const storedApiKey = target.apiKeyRef || target.apiKey;
  if (!target.baseUrl || !storedApiKey) {
    return {
      ok: false,
      error: `Provider '${target.provider}' belum tersimpan. Tambahkan dulu lewat menu /model atau simpan alias dengan baseUrl + apiKey.`,
    };
  }
  list.push({
    name: target.provider,
    baseUrl: target.baseUrl,
    apiKey: storedApiKey,
    model: target.model,
  });
  return {
    ok: true,
    patch: {
      activeProvider: target.provider,
      activeModel: target.model,
      activeType: 'custom',
      customProviders: list,
    },
    target,
  };
}

/* ------------------------------------------------------------------ */
/* Lapis murni: kelola alias                                          */
/* ------------------------------------------------------------------ */

/** @returns {string|null} pesan error, atau null bila nama valid */
export function validateAliasName(name) {
  if (!name || !ALIAS_NAME_RE.test(name)) {
    return 'Nama alias hanya boleh huruf/angka/-/_ (maks 32 karakter, tanpa spasi & slash).';
  }
  return null;
}

/**
 * Menghitung patch untuk menyimpan alias baru.
 * @returns {{ok:true, patch:object, name:string, value:*}|{ok:false, error:string}}
 */
export function buildAliasUpsert(config, name, value) {
  const nameErr = validateAliasName(name);
  if (nameErr) return { ok: false, error: nameErr };

  const parsed = parseAliasValue(value);
  if (!parsed) {
    return {
      ok: false,
      error: 'Nilai alias harus short form "provider/model" (contoh: stepfun/step-5-preview).',
    };
  }

  const stored = typeof value === 'string' ? value.trim() : value;
  const aliases = { ...(config?.modelAliases || {}) };
  aliases[name] = stored;
  return { ok: true, patch: { modelAliases: aliases }, name, value: stored };
}

/**
 * Menghitung patch untuk menghapus alias.
 * @returns {{ok:true, patch:object, name:string}|{ok:false, error:string}}
 */
export function buildAliasRemoval(config, name) {
  if (!name) return { ok: false, error: 'Nama alias wajib diisi.' };
  const aliases = { ...(config?.modelAliases || {}) };
  if (!Object.prototype.hasOwnProperty.call(aliases, name)) {
    return { ok: false, error: `Alias "${name}" tidak ditemukan.` };
  }
  delete aliases[name];
  return { ok: true, patch: { modelAliases: aliases }, name };
}

/** Daftar alias ternormalisasi untuk tampilan. */
export function listAliases(config) {
  const aliases = config?.modelAliases || {};
  return Object.entries(aliases).map(([name, value]) => {
    const parsed = parseAliasValue(value) || {};
    return {
      name,
      provider: parsed.provider || '?',
      model: parsed.model || '?',
      baseUrl: parsed.baseUrl || null,
    };
  });
}

/**
 * Nama alias yang targetnya sedang aktif (provider + model cocok), atau null.
 * Dipakai untuk badge "← currently active" di menu dan daftar alias.
 */
export function activeAliasName(config) {
  if (!config) return null;
  for (const name of Object.keys(config.modelAliases || {})) {
    const target = resolveModelTarget(name, config);
    if (
      target &&
      target.type === config.activeType &&
      String(target.provider).toLowerCase() ===
        String(config.activeProvider || '').toLowerCase() &&
      String(target.model) === String(config.activeModel || '')
    ) {
      return name;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Lapis pipih: baca/tulis config nyata                               */
/* ------------------------------------------------------------------ */

/**
 * Switch model aktif berdasarkan alias / short form / alias bawaan.
 * @returns {{ok:true, target:object}|{ok:false, error:string, hint:string}}
 */
export function switchToModel(input) {
  const config = getConfig();
  const target = resolveModelTarget(input, config);
  if (!target) {
    return {
      ok: false,
      error: `Model/alias "${input}" tidak dikenali.`,
      hint: 'Coba: /model <alias> · /model provider/model · /model alias list · /model (menu)',
    };
  }
  const applied = applyModelTarget(target, config);
  if (!applied.ok) {
    return { ok: false, error: applied.error, hint: 'Ketik /model untuk membuka menu provider.' };
  }
  saveConfig(applied.patch);
  return { ok: true, target: applied.target };
}

/** Menyimpan alias baru (nilai: short form string atau objek). */
export function setModelAlias(name, value) {
  const config = getConfig();
  const built = buildAliasUpsert(config, name, value);
  if (!built.ok) return built;
  saveConfig(built.patch);
  return built;
}

/** Menghapus alias according to name. */
export function removeModelAlias(name) {
  const config = getConfig();
  const built = buildAliasRemoval(config, name);
  if (!built.ok) return built;
  saveConfig(built.patch);
  return built;
}

/* ------------------------------------------------------------------ */
/* Tampilan                                                           */
/* ------------------------------------------------------------------ */

/** Baris konfirmasi setelah switch berhasil. */
export function renderSwitchResult(res) {
  if (!res || !res.ok || !res.target) return '';
  const t = res.target;
  const via = t.alias ? theme.muted(` (alias "${t.alias}")`) : '';
  const lines = [
    `✓ Model aktif: ${theme.info.bold(t.model)} ${theme.muted('·')} provider ${theme.info.bold(t.provider)}${via}`,
  ];
  return lines.join('\n');
}

/** Daftar alias untuk ditampilkan di REPL. */
export function renderAliasList(config) {
  const aliases = listAliases(config);
  if (aliases.length === 0) {
    return (
      theme.warning('\n  Belum ada alias tersimpan.') +
      '\n' +
      theme.muted('  Tambahkan dengan: /model alias add <nama> <provider/model>') +
      '\n' +
      theme.muted('  Contoh        : /model alias add step stepfun/step-5-preview\n')
    );
  }
  const active = activeAliasName(config);
  const lines = [theme.info.bold('\n  ⚡ Model Aliases:')];
  for (const a of aliases) {
    const badge = a.name === active ? theme.success.bold(' ← currently active') : '';
    const url = a.baseUrl
      ? theme.muted(` (${a.baseUrl.replace(/^https?:\/\//i, '').replace(/\/+$/, '')})`)
      : '';
    lines.push(
      `    ${theme.warning.bold(a.name.padEnd(16))} → ${theme.text(a.provider)}/${theme.text(a.model)}${url}${badge}`
    );
  }
  lines.push(
    theme.muted('\n  Pakai: /model <nama> · Kelola: /model alias add|remove <nama> <provider/model>\n')
  );
  return lines.join('\n');
}

/**
 * Penanganan argumen `/model <arg>` / `baiwor model <arg>`.
 * @returns {{needsMenu:boolean, output:string}} needsMenu=true → argumen kosong, pemanggil membuka menu.
 */
export function handleModelCommand(arg) {
  const raw = (arg || '').trim();
  if (!raw) return { needsMenu: true, output: '' };

  const parts = raw.split(/\s+/);

  // Sub-perintah kelola alias: /model alias [list|add|remove] ...
  if (parts[0].toLowerCase() === 'alias') {
    const action = (parts[1] || 'list').toLowerCase();

    if (action === 'list') {
      return { needsMenu: false, output: renderAliasList(getConfig()) };
    }

    if (action === 'add') {
      const name = parts[2];
      const value = parts.slice(3).join(' ');
      if (!name || !value) {
        return {
          needsMenu: false,
          output: chalk.red('\n  Format: /model alias add <nama> <provider/model>\n'),
        };
      }
      const res = setModelAlias(name, value);
      return {
        needsMenu: false,
        output: res.ok
          ? chalk.green(
              `\n  ✓ Alias "${name}" → ${res.value} tersimpan. Ketik /model ${name} untuk switch.\n`
            )
          : chalk.red(`\n  ✗ ${res.error}\n`),
      };
    }

    if (action === 'remove' || action === 'rm' || action === 'delete') {
      const name = parts[2];
      if (!name) {
        return {
          needsMenu: false,
          output: chalk.red('\n  Format: /model alias remove <nama>\n'),
        };
      }
      const res = removeModelAlias(name);
      return {
        needsMenu: false,
        output: res.ok
          ? chalk.green(`\n  ✓ Alias "${name}" dihapus.\n`)
          : chalk.red(`\n  ✗ ${res.error}\n`),
      };
    }

    return {
      needsMenu: false,
      output: chalk.yellow(
        `\n  Sub-perintah alias "${parts[1]}" tidak dikenal. Pakai: list · add · remove\n`
      ),
    };
  }

  // Switch langsung: alias, short form, atau alias bawaan.
  const res = switchToModel(raw);
  if (!res.ok) {
    return {
      needsMenu: false,
      output: theme.error(`\n  ✗ ${res.error}`) + '\n' + theme.muted(`  ${res.hint}\n`),
    };
  }
  return { needsMenu: false, output: '\n  ' + renderSwitchResult(res) + '\n' };
}
