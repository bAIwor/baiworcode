import chalk from 'chalk';
import * as p from '@clack/prompts';
import { getConfig, saveConfig, maskSecret } from './config.js';
import { login, logout, PROVIDERS } from './auth/index.js';
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
    chalk.gray('  🎁 Dapatkan bonus token/credit di: ') +
      chalk.cyan('https://agentik.my.id') +
      chalk.dim(' (kode kupon "baiworcode")')
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
  const s = p.spinner();
  s.start(`Menghubungi ${cleanUrl(baseUrl)}/models...`);

  let fetchedModels = [];
  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'User-Agent': CLI_USER_AGENT,
      },
      signal: AbortSignal.timeout(10000),
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

  const availableModels = fetchedModels.length > 0 ? fetchedModels : DEFAULT_AGENTIK_MODELS;

  if (fetchedModels.length > 0) {
    s.stop(chalk.green(`✓ Terhubung! Ditemukan ${fetchedModels.length} model di server Agentik.`));
  } else {
    s.stop(chalk.yellow('Menggunakan daftar model rekomendasi Agentik.'));
  }

  // 4. Pilih Model
  const pickedModel = await p.select({
    message: '3. Pilih model aktif:',
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
    const config = getConfig();

    console.log();
    console.log(`  ${chalk.dim('Current model:')}    ${chalk.cyan.bold(config.activeModel)}`);
    console.log(`  ${chalk.dim('Active provider:')}  ${chalk.cyan.bold(config.activeProvider)}`);
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
        label: `${optionNumber}. 👑 ${chalk.yellow.bold('Agentik AI')} ⭐ ${chalk.dim(`(${displayUrl})`)} — ${chalk.cyan(agentikCp.model)}${suffix}`,
      });
      optionNumber++;
    }

    // 2. Google OAuth (Google Antigravity & Google Gemini)
    const googleActiveProv = Object.values(PROVIDERS).find((prov) => {
      const isAgy = prov.method === 'agy';
      return isAgy
        ? (config.activeType === 'agy' && config.activeProvider === prov.name)
        : (config.activeType === 'oauth' && config.activeProvider === prov.name);
    });
    const isGoogleActive = Boolean(googleActiveProv);
    const googleSuffix = isGoogleActive
      ? chalk.green.bold(` ← currently active (${googleActiveProv.name}: ${config.activeModel})`)
      : '';
    const agyAuth = config.oauth?.['google-antigravity'];
    const geminiAuth = config.oauth?.['google-gemini'];
    const agyLoggedIn = Boolean(agyAuth && (agyAuth.active || agyAuth.connectedAt));
    const geminiLoggedIn = Boolean(geminiAuth && (geminiAuth.accessToken || geminiAuth.apiKey));
    const isAnyGoogleLoggedIn = agyLoggedIn || geminiLoggedIn;
    const googleBadge = isAnyGoogleLoggedIn ? chalk.cyan.dim(' [Logged In]') : '';

    selectOptions.push({
      value: 'group_google',
      label: `${optionNumber}. 🌐 ${chalk.bold('Google')} ▸ (Antigravity & Gemini OAuth)${googleBadge}${googleSuffix}`,
    });
    optionNumber++;

    // 3. Custom Providers lain yang tersimpan (selain Agentik)
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

    // 4. Model aliases (switch langsung tanpa sub-menu, gaya Hermes)
    const activeAlias = activeAliasName(config);
    for (const a of listAliases(config)) {
      const suffix = a.name === activeAlias ? chalk.green.bold(' ← currently active') : '';
      selectOptions.push({
        value: `alias_${a.name}`,
        label: `${optionNumber}. ⚡ ${chalk.yellow.bold(a.name)} ${chalk.dim('→')} ${a.provider}/${a.model}${suffix}`,
      });
      optionNumber++;
    }

    // 5. Menu Aksi di bagian bawah
    selectOptions.push({
      value: 'action_add_custom',
      label: chalk.hex('#38BDF8')('+ Custom endpoint (enter URL manually)'),
    });

    if (otherCustomList.length > 0) {
      selectOptions.push({
        value: 'action_remove_custom',
        label: chalk.redBright('- Remove a saved custom provider'),
      });
    }

    selectOptions.push({
      value: 'action_leave',
      label: chalk.gray('← Leave unchanged'),
    });

    let choice = await p.select({
      message: 'Select model or provider:',
      options: selectOptions,
    });

    if (p.isCancel(choice) || choice === 'action_leave') {
      return;
    }

    // Aksi: Google Group (Pilih Antigravity atau Gemini)
    if (choice === 'group_google') {
      const googleOptions = Object.values(PROVIDERS).map((prov, idx) => {
        const isAgy = prov.method === 'agy';
        const isActive = isAgy
          ? (config.activeType === 'agy' && config.activeProvider === prov.name)
          : (config.activeType === 'oauth' && config.activeProvider === prov.name);
        const authData = config.oauth?.[prov.id];
        const isLoggedIn = isAgy
          ? Boolean(authData && (authData.active || authData.connectedAt))
          : Boolean(authData && (authData.accessToken || authData.apiKey));
        const badge = isLoggedIn ? chalk.cyan.dim(' [Logged In]') : '';
        const activeSuffix = isActive ? chalk.green.bold(` ← currently active (${config.activeModel})`) : '';
        const descText = prov.desc ? ` ▸ (${prov.desc})` : '';
        return {
          value: `oauth_${prov.id}`,
          label: `${idx + 1}. ${prov.name}${descText}${badge}${activeSuffix}`,
        };
      });

      googleOptions.push({
        value: 'back',
        label: chalk.gray('← Kembali'),
      });

      const pickedGoogle = await p.select({
        message: 'Pilih varian Google (OAuth):',
        options: googleOptions,
      });

      if (p.isCancel(pickedGoogle) || pickedGoogle === 'back') {
        continue;
      }

      choice = pickedGoogle;
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

    // Aksi: OAuth Provider (Google Gemini / Google Antigravity)
    if (choice.startsWith('oauth_')) {
      const provId = choice.replace('oauth_', '');
      const provObj = PROVIDERS[provId];
      if (!provObj) continue;

      const isAgy = provObj.method === 'agy';
      const authData = config.oauth?.[provId];
      const isLoggedIn = isAgy
        ? Boolean(authData && (authData.active || authData.connectedAt))
        : Boolean(authData && (authData.accessToken || authData.apiKey));

      if (!isLoggedIn) {
        // Belum login -> tawarkan login
        const res = await login(provId);
        if (res && res.success) {
          return;
        }
        continue;
      }

      // Sudah login -> Tawarkan: Aktifkan, Ganti model, Logout, ← Kembali
      const activeModelForProv =
        config.activeProvider === provObj.name ? config.activeModel : provObj.defaultModel;

      const subChoice = await p.select({
        message: `Kelola ${chalk.bold(provObj.name)} (${chalk.green('Logged In')}):`,
        options: [
          {
            value: 'activate',
            label: `Aktifkan ${provObj.name} (${activeModelForProv})`,
          },
          {
            value: 'switch_model',
            label: 'Ganti model aktif',
          },
          {
            value: 'logout',
            label: chalk.redBright(`Logout dari ${provObj.name}`),
          },
          {
            value: 'back',
            label: '← Kembali',
          },
        ],
      });

      if (p.isCancel(subChoice) || subChoice === 'back') {
        continue;
      }

      if (subChoice === 'activate') {
        saveConfig({
          activeProvider: provObj.name,
          activeModel: activeModelForProv,
          activeType: isAgy ? 'agy' : 'oauth',
        });
        p.outro(chalk.green(`✓ ${provObj.name} (${activeModelForProv}) sekarang aktif!`));
        return;
      }

      if (subChoice === 'switch_model') {
        const picked = await p.select({
          message: `Pilih model untuk ${provObj.name}:`,
          options: [
            ...provObj.models.map((m) => ({ value: m, label: m })),
            { value: '__custom__', label: '✎ Ketik model lain...' },
          ],
        });

        if (p.isCancel(picked)) continue;

        let finalModel = picked;
        if (picked === '__custom__') {
          const typed = await p.text({
            message: 'Ketik nama model:',
            defaultValue: provObj.defaultModel,
          });
          if (p.isCancel(typed)) continue;
          finalModel = typed.trim();
        }

        saveConfig({
          activeProvider: provObj.name,
          activeModel: finalModel,
          activeType: isAgy ? 'agy' : 'oauth',
        });
        p.outro(chalk.green(`✓ Model ${provObj.name} diubah menjadi: ${finalModel}`));
        return;
      }

      if (subChoice === 'logout') {
        await logout(provId);
        continue;
      }
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
          message: `Kelola ${chalk.bold('Agentik AI')} 👑 ⭐ (Sponsor Resmi):`,
          options: [
            { value: 'activate', label: `Aktifkan Agentik (${cp.model})` },
            { value: 'setup_flow', label: '⚡ Konfigurasi cepat (Base URL, API Key & Model)' },
            { value: 'switch_model', label: 'Ganti model aktif' },
            { value: 'refresh_models', label: `Refresh daftar model dari ${cleanUrl(cp.baseUrl)}/models` },
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
          const inputKey = await p.text({
            message: 'Masukkan API Key baru untuk Agentik:',
            placeholder: 'Dapatkan token/credit di https://agentik.my.id',
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
          const s = p.spinner();
          s.start(`Menghubungi ${cleanUrl(cp.baseUrl)}/models...`);

          try {
            const res = await fetch(`${cp.baseUrl}/models`, {
              headers: {
                Authorization: `Bearer ${cp.apiKey}`,
                'User-Agent': CLI_USER_AGENT,
              },
              signal: AbortSignal.timeout(10000),
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
            s.stop(chalk.red(`Gagal me-refresh model: ${err.message}`));
            continue;
          }
        }

        continue;
      }

      // Handler untuk Custom Provider selain Agentik
      const subChoice = await p.select({
        message: `Kelola Custom Provider: ${chalk.bold(cp.name)}`,
        options: [
          { value: 'activate', label: `Aktifkan ${cp.name} (${cp.model})` },
          { value: 'switch_model', label: 'Ganti model aktif' },
          { value: 'refresh_models', label: `Refresh daftar model dari ${cleanUrl(cp.baseUrl)}/models` },
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
          const inputKey = await p.text({
            message: `Masukkan API Key ${cp.name}:`,
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
        const inputKey = await p.text({
          message: `Masukkan API Key baru untuk ${cp.name}:`,
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
        const s = p.spinner();
        s.start(`Menghubungi ${cleanUrl(cp.baseUrl)}/models...`);

        try {
          const res = await fetch(`${cp.baseUrl}/models`, {
            headers: {
              Authorization: `Bearer ${cp.apiKey}`,
              'User-Agent': CLI_USER_AGENT,
            },
            signal: AbortSignal.timeout(10000),
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
          s.stop(chalk.red(`Gagal me-refresh model: ${err.message}`));
        }
        continue;
      }
    }

    // Aksi: Custom endpoint (enter URL manually)
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
      const s = p.spinner();
      s.start(`Menghubungi ${cleanBase}/models...`);

      let fetchedModels = [];
      let fetchSuccess = false;

      try {
        const res = await fetch(`${cleanBase}/models`, {
          headers: {
            Authorization: `Bearer ${apiKey.trim()}`,
            'User-Agent': CLI_USER_AGENT,
          },
          signal: AbortSignal.timeout(10000),
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
          options: fetchedModels.map((m) => ({ value: m, label: m })),
        });
        if (p.isCancel(selectedModel)) continue;
      } else {
        s.stop(chalk.yellow('Tidak dapat mengambil daftar model secara otomatis.'));
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
