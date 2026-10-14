import chalk from 'chalk';
import * as p from '@clack/prompts';
import { getConfig, saveConfig } from './config.js';
import { login, logout, PROVIDERS } from './auth/index.js';

function cleanUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    return (u.host + u.pathname).replace(/\/+$/, '');
  } catch {
    return urlStr.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  }
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

    // 1. 5 OAuth Providers bawaan dari Registry
    for (const prov of Object.values(PROVIDERS)) {
      const isActive = config.activeType === 'oauth' && config.activeProvider === prov.name;
      const authData = config.oauth?.[prov.id];
      const isLoggedIn = Boolean(authData && (authData.accessToken || authData.apiKey));
      const loginBadge = isLoggedIn ? chalk.cyan.dim(' [Logged In]') : '';
      const suffix = isActive ? chalk.green.bold(' ← currently active') : '';

      selectOptions.push({
        value: `oauth_${prov.id}`,
        label: `${optionNumber}. ${prov.name} ▸ (${prov.desc})${loginBadge}${suffix}`,
      });
      optionNumber++;
    }

    // 2. Custom Providers Tersimpan
    const customList = config.customProviders || [];
    for (const cp of customList) {
      const isActive = config.activeType === 'custom' && config.activeProvider === cp.name;
      const suffix = isActive ? chalk.green.bold(' ← currently active') : '';
      const displayUrl = cleanUrl(cp.baseUrl);
      selectOptions.push({
        value: `custom_${cp.name}`,
        label: `${optionNumber}. ${cp.name} (${displayUrl}) — ${cp.model}${suffix}`,
      });
      optionNumber++;
    }

    // 3. Menu Aksi di bagian bawah
    selectOptions.push({
      value: 'action_add_custom',
      label: chalk.hex('#38BDF8')('+ Custom endpoint (enter URL manually)'),
    });

    const removableList = customList.filter(
      (cp) => cp && cp.name && cp.name.toLowerCase() !== 'agentik'
    );
    if (removableList.length > 0) {
      selectOptions.push({
        value: 'action_remove_custom',
        label: chalk.redBright('- Remove a saved custom provider'),
      });
    }

    selectOptions.push({
      value: 'action_leave',
      label: chalk.gray('← Leave unchanged'),
    });

    const choice = await p.select({
      message: 'Select model or provider:',
      options: selectOptions,
    });

    if (p.isCancel(choice) || choice === 'action_leave') {
      return;
    }

    // Aksi: OAuth Provider (Google Gemini)
    if (choice.startsWith('oauth_')) {
      const provId = choice.replace('oauth_', '');
      const provObj = PROVIDERS[provId];
      if (!provObj) continue;

      const authData = config.oauth?.[provId];
      const isLoggedIn = Boolean(authData && (authData.accessToken || authData.apiKey));

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
          activeType: 'oauth',
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
          activeType: 'oauth',
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
      const cp = customList.find((x) => x.name === cpName);
      if (!cp) continue;

      const isAgentik = cp.name.toLowerCase() === 'agentik';
      const typeLabel = isAgentik ? 'Lokal bAIwor' : 'Custom';

      const subChoice = await p.select({
        message: `Kelola ${chalk.bold(cp.name)} (${typeLabel}):`,
        options: [
          { value: 'activate', label: `Aktifkan ${cp.name} (${cp.model})` },
          { value: 'switch_model', label: 'Ganti model aktif' },
          { value: 'refresh_models', label: `Refresh daftar model dari ${cleanUrl(cp.baseUrl)}/models` },
          { value: 'edit_key', label: `Ubah API Key (${maskSecret(cp.apiKey)})` },
          { value: 'back', label: '← Kembali' },
        ],
      });

      if (p.isCancel(subChoice) || subChoice === 'back') {
        continue;
      }

      if (subChoice === 'activate') {
        if (!cp.apiKey || !cp.apiKey.trim()) {
          console.log(chalk.yellow(`\n  ℹ️  API Key untuk ${cp.name} belum diatur.`));
          if (isAgentik) {
            console.log(chalk.gray('     Dapatkan bonus token/credit di https://agentik.my.id\n'));
          }
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
          placeholder: isAgentik ? 'Dapatkan di https://agentik.my.id' : '',
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
        const defaultAgentikModels = [
          'gemini-3.8-flash-high',
          'gemini-3.5-flash',
          'claude-sonnet-5-5',
          'claude-sonnet-4-6',
          'gemini-3.7-flash',
          'gemini-3.1-flash-lite',
        ];

        const modelsList =
          cp.models && cp.models.length > 0
            ? cp.models
            : isAgentik
            ? defaultAgentikModels
            : [cp.model];

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
              'User-Agent': 'bAIwor-cli/1.0.0',
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
            'User-Agent': 'bAIwor-cli/1.0.0',
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
