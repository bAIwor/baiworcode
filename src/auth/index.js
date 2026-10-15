import chalk from 'chalk';
import * as p from '@clack/prompts';
import { getConfig, saveConfig, maskSecret } from '../config.js';
import { PROVIDERS } from './registry.js';
import { runDeviceFlow } from './device.js';
import { runPkceFlow } from './pkce.js';
import { USER_AGENT } from '../branding.js';

export { PROVIDERS } from './registry.js';

/**
 * Memperbarui access token yang kedaluwarsa menggunakan refresh_token
 */
async function refreshAccessToken(provider, currentAuth) {
  if (!currentAuth?.refreshToken) return null;

  try {
    const config = getConfig();
    const clientId = provider.getClientId(config);

    const bodyParams = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: currentAuth.refreshToken,
      client_id: clientId,
    });

    const res = await fetch(provider.tokenEndpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
      },
      body: bodyParams.toString(),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return null;

    const data = await res.json();
    if (!data.access_token) return null;

    const newAuth = {
      ...currentAuth,
      accessToken: data.access_token,
      refreshToken: data.refresh_token || currentAuth.refreshToken,
      expiresAt: data.expires_in
        ? Date.now() + data.expires_in * 1000
        : Date.now() + 3600 * 1000,
    };

    saveConfig({
      oauth: {
        [provider.id]: newAuth,
      },
    });

    return newAuth.accessToken;
  } catch {
    return null;
  }
}

/**
 * Mengambil Access Token aktif (otomatis me-refresh jika < 60 detik kedaluwarsa)
 */
export async function getAccessToken(providerId) {
  const config = getConfig();
  const auth = config.oauth?.[providerId];
  if (!auth) return null;

  // Jika menggunakan API key fallback
  if (auth.apiKey) return auth.apiKey;
  if (!auth.accessToken) return null;

  // Cek apakah token hampir kedaluwarsa (< 60 detik)
  const isNearExpiry = auth.expiresAt && Date.now() >= auth.expiresAt - 60000;
  if (isNearExpiry && auth.refreshToken) {
    const provider = PROVIDERS[providerId];
    if (provider) {
      const refreshed = await refreshAccessToken(provider, auth);
      if (refreshed) return refreshed;
    }
  }

  // Jika sudah kedaluwarsa dan tidak bisa di-refresh
  if (auth.expiresAt && Date.now() >= auth.expiresAt) {
    return null;
  }

  return auth.accessToken;
}

/**
 * Alur Login Provider OAuth
 */
export async function login(providerId) {
  let targetId = providerId;

  // Jika tidak disebutkan provider-nya, minta user memilih
  if (!targetId || !PROVIDERS[targetId]) {
    const choice = await p.select({
      message: 'Pilih provider yang ingin di-login:',
      options: Object.values(PROVIDERS).map((prov) => ({
        value: prov.id,
        label: `${prov.name} ▸ (${prov.desc})`,
      })),
    });

    if (p.isCancel(choice)) return null;
    targetId = choice;
  }

  const provider = PROVIDERS[targetId];
  if (!provider) {
    console.log(chalk.red(`Provider '${targetId}' tidak dikenal.`));
    return null;
  }

  let config = getConfig();
  let clientId = provider.getClientId(config);

  // Jika Client ID kosong, beri petunjuk dan tawarkan opsi
  if (!clientId) {
    console.log();
    console.log(chalk.yellow.bold(`  ℹ️  Konfigurasi Client ID untuk ${provider.name}:`));
    console.log(chalk.gray(`     ${provider.setupGuide}`));
    console.log();

    const opt = await p.select({
      message: `Client ID untuk ${provider.name} belum tersedia. Pilih langkah:`,
      options: [
        {
          value: 'input_client_id',
          label: '✎ Masukkan Client ID OAuth milik Anda',
        },
        {
          value: 'api_key_fallback',
          label: '🔑 Gunakan API Key secara langsung (Fallback)',
        },
        {
          value: 'cancel',
          label: '← Batal',
        },
      ],
    });

    if (p.isCancel(opt) || opt === 'cancel') return null;

    if (opt === 'input_client_id') {
      const inputCid = await p.text({
        message: `Masukkan Client ID untuk ${provider.name}:`,
        validate(val) {
          if (!val || !val.trim()) return 'Client ID tidak boleh kosong';
        },
      });
      if (p.isCancel(inputCid)) return null;
      clientId = inputCid.trim();

      saveConfig({
        oauth: {
          [provider.id]: { clientId },
        },
      });
      config = getConfig();
    } else if (opt === 'api_key_fallback') {
      const apiKey = await p.password({
        message: `Masukkan API Key untuk ${provider.name}:`,
        mask: '•',
        validate(val) {
          if (!val || !val.trim()) return 'API Key tidak boleh kosong';
        },
      });
      if (p.isCancel(apiKey)) return null;

      // Pilih model
      const modelChoice = await p.select({
        message: `Pilih model default untuk ${provider.name}:`,
        options: [
          ...provider.models.map((m) => ({ value: m, label: m })),
          { value: '__custom__', label: '✎ Ketik model lain...' },
        ],
      });
      if (p.isCancel(modelChoice)) return null;

      let finalModel = modelChoice;
      if (modelChoice === '__custom__') {
        const typed = await p.text({
          message: 'Ketik nama model:',
          defaultValue: provider.defaultModel,
        });
        if (p.isCancel(typed)) return null;
        finalModel = typed.trim();
      }

      saveConfig({
        oauth: {
          [provider.id]: {
            apiKey: apiKey.trim(),
            method: 'apikey',
            savedAt: Date.now(),
          },
        },
        activeProvider: provider.name,
        activeModel: finalModel,
        activeType: 'oauth',
      });

      p.outro(chalk.green(`✓ Berhasil menyimpan API Key untuk ${provider.name} (${finalModel})!`));
      return { success: true, method: 'apikey' };
    }
  }

  // Jalankan alur OAuth (Device Flow atau PKCE)
  try {
    let tokenData;
    if (provider.method === 'device') {
      tokenData = await runDeviceFlow(provider, clientId);
    } else {
      tokenData = await runPkceFlow(provider, clientId);
    }

    // Pilih model aktif
    const modelChoice = await p.select({
      message: `Pilih model aktif untuk ${provider.name}:`,
      options: [
        ...provider.models.map((m) => ({ value: m, label: m })),
        { value: '__custom__', label: '✎ Ketik model lain...' },
      ],
    });

    let finalModel = provider.defaultModel;
    if (!p.isCancel(modelChoice)) {
      if (modelChoice === '__custom__') {
        const typed = await p.text({
          message: 'Ketik nama model:',
          defaultValue: provider.defaultModel,
        });
        if (!p.isCancel(typed) && typed.trim()) {
          finalModel = typed.trim();
        }
      } else {
        finalModel = modelChoice;
      }
    }

    saveConfig({
      oauth: {
        [provider.id]: {
          ...tokenData,
          clientId,
        },
      },
      activeProvider: provider.name,
      activeModel: finalModel,
      activeType: 'oauth',
    });

    p.outro(chalk.green(`✓ Berhasil login ke ${provider.name} (${finalModel})!`));
    return { success: true, ...tokenData, model: finalModel };
  } catch (err) {
    p.outro(chalk.red(`Gagal login ke ${provider.name}: ${err.message}`));
    return null;
  }
}

/**
 * Alur Logout Provider OAuth
 */
export async function logout(providerId) {
  let targetId = providerId;
  const config = getConfig();

  // Jika tidak disebutkan, cari yang sedang login
  if (!targetId) {
    const loggedInIds = Object.keys(config.oauth || {}).filter(
      (id) => config.oauth[id] && (config.oauth[id].accessToken || config.oauth[id].apiKey)
    );

    if (loggedInIds.length === 0) {
      console.log(chalk.yellow('  Tidak ada sesi OAuth yang sedang login saat ini.'));
      return;
    }

    const choice = await p.select({
      message: 'Pilih provider yang ingin di-logout:',
      options: [
        ...loggedInIds.map((id) => ({
          value: id,
          label: PROVIDERS[id]?.name || id,
        })),
        { value: '__cancel__', label: '← Batal' },
      ],
    });

    if (p.isCancel(choice) || choice === '__cancel__') return;
    targetId = choice;
  }

  const provObj = PROVIDERS[targetId];
  const provName = provObj ? provObj.name : targetId;

  const updates = {
    oauth: {
      [targetId]: null, // Deep merge di config.js akan menghapus key ini
    },
  };

  if (config.activeType === 'oauth' && config.activeProvider === provName) {
    updates.activeProvider = 'Not configured';
    updates.activeModel = 'Not configured';
    updates.activeType = 'none';
  }

  saveConfig(updates);
  p.outro(chalk.yellow(`✓ Berhasil logout dari ${provName}.`));
}

/**
 * Status autentikasi seluruh provider
 */
export function authStatus() {
  const config = getConfig();
  return Object.values(PROVIDERS).map((prov) => {
    const auth = config.oauth?.[prov.id];
    const isLoggedIn = Boolean(auth && (auth.accessToken || auth.apiKey));
    const tokenVal = auth?.accessToken || auth?.apiKey || '';
    const masked = maskSecret(tokenVal);
    const expiresAt = auth?.expiresAt || null;

    let expiryStatus = 'Aktif';
    if (expiresAt) {
      if (Date.now() >= expiresAt) {
        expiryStatus = 'Kedaluwarsa';
      } else {
        const remainingMinutes = Math.round((expiresAt - Date.now()) / 60000);
        expiryStatus = `Sisa ~${remainingMinutes} mnt`;
      }
    }

    return {
      id: prov.id,
      name: prov.name,
      loggedIn: isLoggedIn,
      method: auth?.method || prov.method,
      maskedToken: masked,
      expiresAt,
      expiryStatus,
    };
  });
}
