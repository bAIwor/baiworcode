import chalk from 'chalk';
import * as p from '@clack/prompts';
import { theme } from './theme.js';
import { spinner } from './spinner.js';
import { getConfig, saveConfig, maskSecret } from './config.js';
import { CLI_USER_AGENT } from './branding.js';
import { listAliases, activeAliasName, switchToModel } from './modelAlias.js';

function cleanUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    return (u.host + u.pathname).replace(/\/+$/, '');
  } catch {
    return urlStr.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  }
}

/** Batas waktu probe /models. Singkat agar menu tidak terasa membeku. */
const MODELS_PROBE_TIMEOUT_MS = 5000;

/**
 * Menyusun endpoint /models dari base URL yang mungkin ditempel pengguna secara
 * lengkap (`…/chat/completions`, `…/responses`, atau `…/models`). Tanpa
 * normalisasi, probe menuju path yang tidak ada (404) dan menu melaporkan
 * "tidak bisa mengambil daftar model".
 *
 * @param {string} baseUrl
 * @returns {string}
 */
export function modelsEndpoint(baseUrl) {
  let base = String(baseUrl || '').trim().replace(/\/+$/, '');
  base = base
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/responses$/i, '')
    .replace(/\/models$/i, '');
  return `${base.replace(/\/+$/, '')}/models`;
}

/**
 * clack menghitung jendela opsi dari `process.stdout.rows`. Bila terminal
 * belum melaporkan ukuran (0/undefined), daftar opsi bisa dirender kosong
 * sehingga menu tampak tidak bisa dipakai. Pasang ukuran cadangan.
 */
function ensureMenuViewport() {
  if (!process.stdout.rows || process.stdout.rows < 6) {
    try {
      Object.defineProperty(process.stdout, 'rows', {
        value: 24,
        configurable: true,
        writable: true,
      });
    } catch {}
  }
}

const DEFAULT_AGENTIK_MODELS = [
  'gemini-3.8-flash-high',
  'gemini-3.5-flash',
  'claude-sonnet-5-5',
  'claude-sonnet-4-6',
  'gemini-3.7-flash',
  'gemini-3.1-flash-lite',
];

/**
 * Alur konfigurasi interaktif Agentik AI:
 * 1. Base URL (default https://api.agentik.my.id/v1)
 * 2. API Key (bonus token di https://agentik.my.id)
 * 3. Pilih Model (probe otomatis dari /models)
 */
async function configureAgentikFlow(existingCp, customList, config) {
  const currentUrl = existingCp?.baseUrl || 'https://api.agentik.my.id/v1';
  const currentKey = existingCp?.apiKey || '';
  const currentModel = existingCp?.model || 'gemini-3.8-flash-high';

  console.log();
  console.log(
    theme.muted('  🎁 Dapatkan bonus token/credit di: ') +
      theme.info('https://agentik.my.id') +
      theme.muted(' (kode kupon "baiworcode")')
  );
  console.log();

  // 1. Base URL
  const inputUrl = await p.text({
    message: '1. API Base URL:',
    defaultValue: currentUrl,
    placeholder: 'https://api.agentik.my.id/v1',
    validate(val) {
      if (!val || !val.trim()) return 'Base URL tidak boleh kosong';
      if (!val.startsWith('http://') && !val.startsWith('https://')) {
        return 'URL harus diawali dengan http:// atau https://';
      }
    },
  });
  if (p.isCancel(inputUrl)) return;
  const baseUrl = inputUrl.trim().replace(/\/+$/, '');

  // 2. API Key
  const inputKey = await p.password({
    message: `2. API Key Agentik${currentKey ? ` [tersimpan: ${maskSecret(currentKey)}]` : ''}:`,
    mask: '•',
    validate(val) {
      if (!val && !currentKey) return 'API Key tidak boleh kosong. Dapatkan di https://agentik.my.id';
    },
  });
  if (p.isCancel(inputKey)) return;
  const apiKey = (inputKey && inputKey.trim()) ? inputKey.trim() : currentKey;

  // 3. Probe daftar model dari server (endpoint /models)
  const probeUrl = modelsEndpoint(baseUrl);
  const s = spinner();
  s.start(`Menghubungi ${cleanUrl(probeUrl)}...`);

  let fetchedModels = [];
  try {
    const res = await fetch(probeUrl, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'User-Agent': CLI_USER_AGENT,
      },
      signal: AbortSignal.timeout(MODELS_PROBE_TIMEOUT_MS),
    });

    if (res.ok) {
      const data = await res.json();
      const list = Array.isArray(data.data)
        ? data.data
        : Array.isArray(data.models)
        ? data.models
        : Array.isArray(data)
        ? data
        : [];
      fetchedModels = list
        .map((m) => (typeof m === 'string' ? m : m.id || m.name))
        .filter(Boolean);
    }
  } catch {}

  // Fallback berurutan: hasil probe → daftar tersimpan → rekomendasi bawaan.
  const savedModels = Array.isArray(existingCp?.models) ? existingCp.models.filter(Boolean) : [];
  const availableModels =
    fetchedModels.length > 0
      ? fetchedModels
      : savedModels.length > 0
        ? savedModels
        : DEFAULT_AGENTIK_MODELS;

  if (fetchedModels.length > 0) {
    s.stop(chalk.green(`✓ Terhubung! Ditemukan ${fetchedModels.length} model di server Agentik.`));
  } else {
    s.stop(chalk.yellow('Menggunakan daftar model rekomendasi Agentik.'));
  }

  // 4. Pilih Model
  const pickedModel = await p.select({
    message: '3. Pilih model aktif:',
    maxItems: 10,
    options: [
      ...availableModels.map((m) => ({
        value: m,
        label: m === currentModel ? `${m} (saat ini)` : m,
      })),
      { value: '__custom__', label: '✎ Ketik nama model lain...' },
    ],
  });
  if (p.isCancel(pickedModel)) return;

  let finalModel = pickedModel;
  if (pickedModel === '__custom__') {
    const typed = await p.text({
      message: 'Ketik nama model:',
      defaultValue: currentModel,
      validate(val) {
        if (!val || !val.trim()) return 'Nama model tidak boleh kosong';
      },
    });
    if (p.isCancel(typed)) return;
    finalModel = typed.trim();
  }

  // 5. Simpan dan Aktifkan
  // Model yang diketik manual belum tentu ada di daftar probe — selipkan agar
  // ia tetap muncul pada menu "Ganti model" berikutnya.
  const modelsWithFinal = availableModels.includes(finalModel)
    ? availableModels
    : [finalModel, ...availableModels];

  const agentikObj = {
    name: 'Agentik',
    baseUrl,
    apiKey,
    model: finalModel,
    models: modelsWithFinal,
  };

  const updatedCustom = [...customList];
  const idx = updatedCustom.findIndex((c) => c && c.name && c.name.toLowerCase() === 'agentik');
  if (idx >= 0) {
    updatedCustom[idx] = agentikObj;
  } else {
    updatedCustom.unshift(agentikObj);
  }

  saveConfig({
    customProviders: updatedCustom,
    activeProvider: 'Agentik',
    activeModel: finalModel,
    activeType: 'custom',
  });

  p.outro(chalk.green(`✓ Agentik AI (${finalModel}) sekarang aktif! Siap nggarap kodingan, Lur!`));
}

export async function runModelMenu() {
  while (true) {
    // Catatan: jangan mengelola pause/resume process.stdin di sini.
    // Biarkan @clack/core menjaga stdin.
    ensureMenuViewport();
    const config = getConfig();

    console.log();
      console.log(`  ${theme.muted('Current model:')}    ${theme.info.bold(config.activeModel)}`);
      console.log(`  ${theme.muted('Active provider:')}  ${theme.info.bold(config.activeProvider)}`);
    console.log();

    let optionNumber = 1;
    const selectOptions = [];
    const customList = config.customProviders || [];

    // 1. AGENTIK AI (Sponsor Resmi & Token Bonus - Wajib Nomor 1 Paling Atas)
    const agentikCp = customList.find(
      (cp) => cp && cp.name && cp.name.toLowerCase() === 'agentik'
    );
    if (agentikCp) {
      const isAgentikActive =
        config.activeType === 'custom' && config.activeProvider.toLowerCase() === 'agentik';
      const suffix = isAgentikActive ? chalk.green.bold(' ← currently active') : '';
      const displayUrl = cleanUrl(agentikCp.baseUrl);
      selectOptions.push({
        value: 'custom_Agentik',
        label: `${optionNumber}. 👑 ${theme.warning.bold('Agentik AI')} ${theme.muted(`(${displayUrl})`)} — ${theme.info(agentikCp.model)}${suffix}`,
      });
      optionNumber++;
    }

    // 2. Custom Providers lain yang tersimpan (selain Agentik)
    const otherCustomList = customList.filter(
      (cp) => cp && cp.name && cp.name.toLowerCase() !== 'agentik'
    );
    for (const cp of otherCustomList) {
      const isActive = config.activeType === 'custom' && config.activeProvider === cp.name;
      const suffix = isActive ? chalk.green.bold(' ← currently active') : '';
      const displayUrl = cleanUrl(cp.baseUrl);
      selectOptions.push({
        value: `custom_${cp.name}`,
        label: `${optionNumber}. ${cp.name} (${displayUrl}) — ${cp.model}${suffix}`,
      });
      optionNumber++;
    }

    // 3. Model aliases (switch langsung tanpa sub-menu)
    const activeAlias = activeAliasName(config);
    for (const a of listAliases(config)) {
      const suffix = a.name === activeAlias ? chalk.green.bold(' ← currently active') : '';
      selectOptions.push({
        value: `alias_${a.name}`,
        label: `${optionNumber}. ⚡ ${chalk.yellow.bold(a.name)} ${chalk.dim('→')} ${a.provider}/${a.model}${suffix}`,
      });
      optionNumber++;
    }

    // 4. Menu Aksi di bagian bawah
    selectOptions.push({
      value: 'action_add_custom',
      label: theme.cliLink('+ Kustom API (manual URL)'),
    });

    if (otherCustomList.length > 0) {
      selectOptions.push({
        value: 'action_remove_custom',
        label: chalk.redBright('- Remove a saved custom provider'),
      });
    }

    selectOptions.push({
      value: 'action_leave',
      label: theme.muted('← Leave unchanged'),
    });

    let choice = await p.select({
      message: 'Select model or provider:',
      maxItems: 10,
      options: selectOptions,
    });

    if (p.isCancel(choice) || choice === 'action_leave') {
      return;
    }

    // Aksi: Model alias — switch langsung tanpa sub-menu
    if (choice.startsWith('alias_')) {
      const aliasName = choice.slice('alias_'.length);
      const res = switchToModel(aliasName);
      if (!res.ok) {
        console.log(chalk.red(`\n  ❌ ${res.error}\n`));
        continue;
      }
      p.outro(
        chalk.green(
          `✓ Model aktif: ${res.target.model} · provider ${res.target.provider} (alias "${aliasName}")`
        )
      );
      return;
    }

    // Aksi: Custom Provider yang sudah tersimpan (termasuk Agentik)
    if (choice.startsWith('custom_')) {
      const cpName = choice.replace('custom_', '');
      const cp = customList.find(
        (x) => x && x.name && x.name.toLowerCase() === cpName.toLowerCase()
      );
      if (!cp) continue;

      const isAgentik = cp.name.toLowerCase() === 'agentik';

      if (isAgentik) {
        // Jika belum ada API Key, langsung buka wizard konfigurasi
        if (!cp.apiKey || !cp.apiKey.trim()) {
          await configureAgentikFlow(cp, customList, config);
          return;
        }

        const subChoice = await p.select({
          message: `Kelola ${chalk.bold('Agentik AI')} 👑 (Sponsor Resmi):`,
          maxItems: 10,
          options: [
            { value: 'activate', label: `Aktifkan Agentik (${cp.model})` },
            { value: 'setup_flow', label: '⚡ Konfigurasi cepat (Base URL, API Key & Model)' },
            { value: 'switch_model', label: 'Ganti model aktif' },
            { value: 'refresh_models', label: `Refresh daftar model dari ${cleanUrl(modelsEndpoint(cp.baseUrl))}` },
            { value: 'edit_key', label: `Ubah API Key (${maskSecret(cp.apiKey)})` },
            { value: 'back', label: '← Kembali' },
          ],
        });

        if (p.isCancel(subChoice) || subChoice === 'back') {
          continue;
        }

        if (subChoice === 'setup_flow') {
          await configureAgentikFlow(cp, customList, config);
          return;
        }

        if (subChoice === 'activate') {
          saveConfig({
            activeProvider: cp.name,
            activeModel: cp.model,
            activeType: 'custom',
          });
          p.outro(chalk.green(`✓ Agentik AI (${cp.model}) sekarang aktif! Siap nggarap kodingan, Lur!`));
          return;
        }

        if (subChoice === 'edit_key') {
          const inputKey = await p.password({
            message: 'Masukkan API Key baru untuk Agentik:',
            mask: '•',
            validate(val) {
              if (!val || !val.trim()) return 'API Key tidak boleh kosong';
            },
          });
          if (p.isCancel(inputKey)) continue;

          const updatedCustom = customList.map((item) => {
            if (item.name.toLowerCase() === 'agentik') {
              return { ...item, apiKey: inputKey.trim() };
            }
            return item;
          });

          saveConfig({ customProviders: updatedCustom });
          p.outro(chalk.green('✓ API Key untuk Agentik berhasil diperbarui!'));
          return;
        }

        if (subChoice === 'switch_model') {
          const modelsList =
            cp.models && cp.models.length > 0 ? cp.models : DEFAULT_AGENTIK_MODELS;

          const picked = await p.select({
            message: 'Pilih model aktif untuk Agentik:',
            maxItems: 10,
            options: [
              ...modelsList.map((m) => ({ value: m, label: m })),
              { value: '__manual__', label: '✎ Ketik nama model lain...' },
            ],
          });

          if (p.isCancel(picked)) continue;

          let finalModel = picked;
          if (picked === '__manual__') {
            finalModel = await p.text({
              message: 'Ketik nama model:',
              placeholder: 'contoh: gemini-3.8-flash-high',
              validate(val) {
                if (!val || !val.trim()) return 'Nama model tidak boleh kosong';
              },
            });
            if (p.isCancel(finalModel)) continue;
            finalModel = finalModel.trim();
          }

          const updatedCustom = customList.map((item) => {
            if (item.name.toLowerCase() === 'agentik') {
              const currentModels = Array.isArray(item.models) ? item.models : [];
              const nextModels = currentModels.includes(finalModel) ? currentModels : [...currentModels, finalModel];
              return { ...item, model: finalModel, models: nextModels };
            }
            return item;
          });

          const updates = { customProviders: updatedCustom };
          if (config.activeType === 'custom' && config.activeProvider.toLowerCase() === 'agentik') {
            updates.activeModel = finalModel;
          }
          saveConfig(updates);
          p.outro(chalk.green(`✓ Model Agentik diubah menjadi: ${finalModel}`));
          return;
        }

        if (subChoice === 'refresh_models') {
          const probeUrl = modelsEndpoint(cp.baseUrl);
          const s = spinner();
          s.start(`Menghubungi ${cleanUrl(probeUrl)}...`);

          try {
            const res = await fetch(probeUrl, {
              headers: {
                Authorization: `Bearer ${cp.apiKey}`,
                'User-Agent': CLI_USER_AGENT,
              },
              signal: AbortSignal.timeout(MODELS_PROBE_TIMEOUT_MS),
            });

            if (!res.ok) {
              throw new Error(`HTTP ${res.status}: ${res.statusText}`);
            }

            const data = await res.json();
            const list = Array.isArray(data.data)
              ? data.data
              : Array.isArray(data.models)
              ? data.models
              : Array.isArray(data)
              ? data
              : [];
            const fetched = list
              .map((m) => (typeof m === 'string' ? m : m.id || m.name))
              .filter(Boolean);

            if (fetched.length === 0) {
              s.stop(chalk.yellow('Tidak ada model yang ditemukan dari server.'));
              continue;
            }

            s.stop(chalk.green(`Berhasil memperbarui ${fetched.length} model dari Agentik!`));

            const updatedCustom = customList.map((item) => {
              if (item.name.toLowerCase() === 'agentik') {
                return { ...item, models: fetched };
              }
              return item;
            });
            saveConfig({ customProviders: updatedCustom });
            continue;
          } catch (err) {
            s.stop(chalk.red(`Gagal me-refresh model dari ${cleanUrl(probeUrl)}: ${err.message}`));
            continue;
          }
        }

        continue;
      }

      // Handler untuk Custom Provider selain Agentik
      const subChoice = await p.select({
        message: `Kelola Custom Provider: ${chalk.bold(cp.name)}`,
        maxItems: 10,
        options: [
          { value: 'activate', label: `Aktifkan ${cp.name} (${cp.model})` },
          { value: 'switch_model', label: 'Ganti model aktif' },
          { value: 'refresh_models', label: `Refresh daftar model dari ${cleanUrl(modelsEndpoint(cp.baseUrl))}` },
          { value: 'edit_key', label: `Ubah API Key (${maskSecret(cp.apiKey)})` },
          { value: 'delete', label: chalk.redBright(`Hapus provider ${cp.name}`) },
          { value: 'back', label: '← Kembali' },
        ],
      });

      if (p.isCancel(subChoice) || subChoice === 'back') {
        continue;
      }

      if (subChoice === 'delete') {
        const confirm = await p.confirm({
          message: `Apakah Anda yakin ingin menghapus custom provider "${cp.name}"?`,
          initialValue: false,
        });
        if (p.isCancel(confirm) || !confirm) continue;

        const filtered = customList.filter((x) => x.name !== cp.name);
        const updates = { customProviders: filtered };
        if (config.activeProvider === cp.name) {
          updates.activeProvider = 'Agentik';
          const agentikObj = customList.find((x) => x && x.name && x.name.toLowerCase() === 'agentik');
          updates.activeModel = agentikObj?.model || 'gemini-3.8-flash-high';
          updates.activeType = 'custom';
        }
        saveConfig(updates);
        p.outro(chalk.yellow(`✓ Provider ${cp.name} berhasil dihapus.`));
        return;
      }

      if (subChoice === 'activate') {
        if (!cp.apiKey || !cp.apiKey.trim()) {
          console.log(chalk.yellow(`\n  ℹ️  API Key untuk ${cp.name} belum diatur.`));
          const inputKey = await p.password({
            message: `Masukkan API Key ${cp.name}:`,
            mask: '•',
            validate(val) {
              if (!val || !val.trim()) return 'API Key tidak boleh kosong';
            },
          });
          if (p.isCancel(inputKey)) continue;
          cp.apiKey = inputKey.trim();
          const updatedCustom = customList.map((item) => {
            if (item.name === cp.name) {
              return { ...item, apiKey: inputKey.trim() };
            }
            return item;
          });
          saveConfig({ customProviders: updatedCustom });
        }

        saveConfig({
          activeProvider: cp.name,
          activeModel: cp.model,
          activeType: 'custom',
        });
        p.outro(chalk.green(`✓ Provider ${cp.name} (${cp.model}) sekarang aktif!`));
        return;
      }

      if (subChoice === 'edit_key') {
        const inputKey = await p.password({
          message: `Masukkan API Key baru untuk ${cp.name}:`,
          mask: '•',
          validate(val) {
            if (!val || !val.trim()) return 'API Key tidak boleh kosong';
          },
        });
        if (p.isCancel(inputKey)) continue;

        const updatedCustom = customList.map((item) => {
          if (item.name === cp.name) {
            return { ...item, apiKey: inputKey.trim() };
          }
          return item;
        });

        saveConfig({ customProviders: updatedCustom });
        p.outro(chalk.green(`✓ API Key untuk ${cp.name} berhasil diperbarui!`));
        return;
      }

      if (subChoice === 'switch_model') {
        const modelsList =
          cp.models && cp.models.length > 0 ? cp.models : [cp.model];

        const picked = await p.select({
          message: `Pilih model untuk ${cp.name}:`,
          maxItems: 10,
          options: [
            ...modelsList.map((m) => ({ value: m, label: m })),
            { value: '__manual__', label: '✎ Ketik nama model lain...' },
          ],
        });

        if (p.isCancel(picked)) continue;

        let finalModel = picked;
        if (picked === '__manual__') {
          finalModel = await p.text({
            message: 'Ketik nama model:',
            placeholder: 'contoh: gemini-3.8-flash-high',
            validate(val) {
              if (!val || !val.trim()) return 'Nama model tidak boleh kosong';
            },
          });
          if (p.isCancel(finalModel)) continue;
          finalModel = finalModel.trim();
        }

        const updatedCustom = customList.map((item) => {
          if (item.name === cp.name) {
            const currentModels = Array.isArray(item.models) ? item.models : [];
            const nextModels = currentModels.includes(finalModel) ? currentModels : [...currentModels, finalModel];
            return { ...item, model: finalModel, models: nextModels };
          }
          return item;
        });

        const updates = { customProviders: updatedCustom };
        if (config.activeType === 'custom' && config.activeProvider === cp.name) {
          updates.activeModel = finalModel;
        }
        saveConfig(updates);
        p.outro(chalk.green(`✓ Model untuk ${cp.name} diubah menjadi: ${finalModel}`));
        return;
      }

      if (subChoice === 'refresh_models') {
        const probeUrl = modelsEndpoint(cp.baseUrl);
        const s = spinner();
        s.start(`Menghubungi ${cleanUrl(probeUrl)}...`);

        try {
          const res = await fetch(probeUrl, {
            headers: {
              Authorization: `Bearer ${cp.apiKey}`,
              'User-Agent': CLI_USER_AGENT,
            },
            signal: AbortSignal.timeout(MODELS_PROBE_TIMEOUT_MS),
          });

          if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
          }

          const data = await res.json();
          const list = Array.isArray(data.data)
            ? data.data
            : Array.isArray(data.models)
            ? data.models
            : Array.isArray(data)
            ? data
            : [];
          const fetched = list
            .map((m) => (typeof m === 'string' ? m : m.id || m.name))
            .filter(Boolean);

          if (fetched.length === 0) {
            s.stop(chalk.yellow('Daftar model kosong dari endpoint.'));
          } else {
            s.stop(chalk.green(`Berhasil menemukan ${fetched.length} model!`));
            const newPicked = await p.select({
              message: 'Pilih model aktif:',
              maxItems: 10,
              options: fetched.map((m) => ({ value: m, label: m })),
            });

            if (p.isCancel(newPicked)) continue;

            const updatedCustom = customList.map((item) => {
              if (item.name === cp.name) {
                return { ...item, model: newPicked, models: fetched };
              }
              return item;
            });

            const updates = { customProviders: updatedCustom };
            if (config.activeType === 'custom' && config.activeProvider === cp.name) {
              updates.activeModel = newPicked;
            }
            saveConfig(updates);
            p.outro(chalk.green(`✓ Model ${newPicked} berhasil diperbarui!`));
            return;
          }
        } catch (err) {
          s.stop(chalk.red(`Gagal me-refresh model dari ${cleanUrl(probeUrl)}: ${err.message}`));
        }
        continue;
      }
    }

    // Aksi: Kustom API (manual URL)
    if (choice === 'action_add_custom') {
      const name = await p.text({
        message: '1. Nama Provider:',
        placeholder: 'contoh: AgentikMyID',
        validate(val) {
          if (!val || !val.trim()) return 'Nama provider tidak boleh kosong';
        },
      });
      if (p.isCancel(name)) continue;

      const baseUrl = await p.text({
        message: '2. Base URL (OpenAI compatible):',
        placeholder: 'contoh: https://api.agentik.my.id/v1',
        validate(val) {
          if (!val || !val.trim()) return 'Base URL tidak boleh kosong';
          if (!val.startsWith('http://') && !val.startsWith('https://')) {
            return 'URL harus diawali dengan http:// atau https://';
          }
        },
      });
      if (p.isCancel(baseUrl)) continue;

      if (baseUrl.trim().startsWith('http://')) {
        p.note(
          chalk.yellow('Peringatan: URL menggunakan protokol HTTP (tidak terenkripsi).\nPastikan Anda berada di jaringan terpercaya demi keamanan API Key Anda.'),
          'Peringatan Keamanan'
        );
      }

      const apiKey = await p.password({
        message: '3. API Key:',
        mask: '•',
        validate(val) {
          if (!val || !val.trim()) return 'API Key tidak boleh kosong';
        },
      });
      if (p.isCancel(apiKey)) continue;

      const cleanBase = baseUrl.trim().replace(/\/+$/, '');
      const probeUrl = modelsEndpoint(cleanBase);
      const s = spinner();
      s.start(`Menghubungi ${cleanUrl(probeUrl)}...`);

      let fetchedModels = [];
      let fetchSuccess = false;

      try {
        const res = await fetch(probeUrl, {
          headers: {
            Authorization: `Bearer ${apiKey.trim()}`,
            'User-Agent': CLI_USER_AGENT,
          },
          signal: AbortSignal.timeout(MODELS_PROBE_TIMEOUT_MS),
        });

        if (res.ok) {
          const data = await res.json();
          const list = Array.isArray(data.data)
            ? data.data
            : Array.isArray(data.models)
            ? data.models
            : Array.isArray(data)
            ? data
            : [];
          fetchedModels = list
            .map((m) => (typeof m === 'string' ? m : m.id || m.name))
            .filter(Boolean);
          if (fetchedModels.length > 0) {
            fetchSuccess = true;
          }
        }
      } catch {
        // Fetch error ditangani fallback manual
      }

      let selectedModel = '';
      if (fetchSuccess) {
        s.stop(chalk.green(`Berhasil menemukan ${fetchedModels.length} model!`));
        selectedModel = await p.select({
          message: 'Pilih model yang ingin digunakan:',
          maxItems: 10,
          options: fetchedModels.map((m) => ({ value: m, label: m })),
        });
        if (p.isCancel(selectedModel)) continue;
      } else {
        s.stop(
          chalk.yellow(
            `Tidak dapat mengambil ${cleanUrl(probeUrl)} — ketik nama model secara manual.`
          )
        );
        selectedModel = await p.text({
          message: 'Ketik nama model secara manual:',
          placeholder: 'contoh: gemini-3.8-flash-high',
          validate(val) {
            if (!val || !val.trim()) return 'Nama model tidak boleh kosong';
          },
        });
        if (p.isCancel(selectedModel)) continue;
        fetchedModels = [selectedModel.trim()];
      }

      const providerObj = {
        name: name.trim(),
        baseUrl: cleanBase,
        apiKey: apiKey.trim(),
        model: selectedModel.trim(),
        models: fetchedModels,
      };

      const existingIdx = customList.findIndex(
        (c) => c.name.toLowerCase() === providerObj.name.toLowerCase()
      );
      const updatedList = [...customList];
      if (existingIdx >= 0) {
        updatedList[existingIdx] = providerObj;
      } else {
        updatedList.push(providerObj);
      }

      saveConfig({
        customProviders: updatedList,
        activeProvider: providerObj.name,
        activeModel: providerObj.model,
        activeType: 'custom',
      });

      p.outro(chalk.green(`✓ Provider ${providerObj.name} berhasil disimpan dan diaktifkan!`));
      return;
    }

    // Aksi: Remove a saved custom provider
    if (choice === 'action_remove_custom') {
      const removableList = customList.filter(
        (cp) => cp && cp.name && cp.name.toLowerCase() !== 'agentik'
      );
      const toRemove = await p.select({
        message: 'Pilih custom provider yang ingin dihapus:',
        maxItems: 10,
        options: [
          ...removableList.map((cp) => ({
            value: cp.name,
            label: `${cp.name} (${cleanUrl(cp.baseUrl)}) — ${cp.model}`,
          })),
          { value: '__cancel__', label: '← Batal' },
        ],
      });

      if (p.isCancel(toRemove) || toRemove === '__cancel__') {
        continue;
      }

      const filtered = customList.filter((cp) => cp.name !== toRemove);
      const updates = { customProviders: filtered };

      if (config.activeProvider === toRemove) {
        updates.activeProvider = 'Not configured';
        updates.activeModel = 'Not configured';
        updates.activeType = 'none';
      }

      saveConfig(updates);
      p.outro(chalk.yellow(`Provider ${toRemove} telah dihapus dari konfigurasi.`));
      return;
    }
  }
}
