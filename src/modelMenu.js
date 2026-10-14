import chalk from 'chalk';
import * as p from '@clack/prompts';
import { getConfig, saveConfig } from './config.js';

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

    // 1. 5 OAuth Providers bawaan
    const oauthProviders = [
      { id: 'google-gemini', name: 'Google Gemini', desc: 'Google Account OAuth / Gemini CLI' },
      { id: 'openai', name: 'OpenAI', desc: 'ChatGPT / Codex Subscription OAuth' },
      { id: 'github-copilot', name: 'GitHub Copilot', desc: 'GitHub Device OAuth' },
      { id: 'qwen', name: 'Qwen', desc: 'Qwen Cloud CLI OAuth' },
      { id: 'minimax', name: 'MiniMax', desc: 'OAuth Coding Plan' },
    ];

    for (const prov of oauthProviders) {
      const isActive = config.activeType === 'oauth' && config.activeProvider === prov.name;
      const suffix = isActive ? chalk.green.bold(' ← currently active') : '';
      selectOptions.push({
        value: `oauth_${prov.id}`,
        label: `${optionNumber}. ${prov.name} ▸ (${prov.desc})${suffix}`,
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
    selectOptions.push(
      {
        value: 'action_add_custom',
        label: chalk.hex('#38BDF8')('+ Custom endpoint (enter URL manually)'),
      }
    );

    if (customList.length > 0) {
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

    // Aksi: 5 OAuth Providers
    if (choice.startsWith('oauth_')) {
      const provId = choice.replace('oauth_', '');
      const provObj = oauthProviders.find((x) => x.id === provId);
      const provName = provObj ? provObj.name : provId;

      p.note(
        `Alur login OAuth untuk ${chalk.bold(provName)} akan dihubungkan di Tahap 2B.\nSaat ini silakan gunakan Custom endpoint API (seperti AgentikMyID).`,
        'OAuth Provider'
      );
      continue;
    }

    // Aksi: Custom Provider yang sudah tersimpan
    if (choice.startsWith('custom_')) {
      const cpName = choice.replace('custom_', '');
      const cp = customList.find((x) => x.name === cpName);
      if (!cp) continue;

      const subChoice = await p.select({
        message: `Kelola Custom Provider: ${chalk.bold(cp.name)}`,
        options: [
          { value: 'activate', label: `Aktifkan ${cp.name} (${cp.model})` },
          { value: 'switch_model', label: 'Ganti model dari daftar tersimpan' },
          { value: 'refresh_models', label: `Refresh daftar model dari ${cleanUrl(cp.baseUrl)}/models` },
          { value: 'back', label: '← Kembali' },
        ],
      });

      if (p.isCancel(subChoice) || subChoice === 'back') {
        continue;
      }

      if (subChoice === 'activate') {
        saveConfig({
          activeProvider: cp.name,
          activeModel: cp.model,
          activeType: 'custom',
        });
        p.outro(chalk.green(`✓ Provider ${cp.name} (${cp.model}) sekarang aktif!`));
        return;
      }

      if (subChoice === 'switch_model') {
        const modelsList = cp.models && cp.models.length > 0 ? cp.models : [cp.model];
        const picked = await p.select({
          message: 'Pilih model baru:',
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
      const toRemove = await p.select({
        message: 'Pilih custom provider yang ingin dihapus:',
        options: [
          ...customList.map((cp) => ({
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
