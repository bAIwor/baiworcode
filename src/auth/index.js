import chalk from 'chalk';
import { theme } from '../theme.js';
import * as p from '@clack/prompts';
import { spinner } from '../spinner.js';
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
    const clientSecret = provider.getClientSecret
      ? provider.getClientSecret(config)
      : provider.clientSecret;
    if (clientSecret) {
      bodyParams.set('client_secret', clientSecret);
    }

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
  if (providerId === 'google-gemini' && process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
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
        label: prov.desc ? `${prov.name} ▸ (${prov.desc})` : prov.name,
      })),
    });

    if (p.isCancel(choice)) return null;
    targetId = choice;
  }

  const provider = PROVIDERS[targetId];
  if (!provider) {
    console.log(theme.error(`Provider '${targetId}' tidak dikenal.`));
    return null;
  }


  let config = getConfig();
  let clientId = provider.getClientId(config);
  let clientSecret = provider.getClientSecret ? provider.getClientSecret(config) : (provider.clientSecret || '');

  const envKey = provider.id === 'google-gemini' ? process.env.GEMINI_API_KEY : null;

  // Tampilkan pilihan metode login
  const opt = await p.select({
    message: `Pilih metode autentikasi untuk ${provider.name}:`,
    options: [
      {
        value: 'oauth_browser',
        label: '🌐 Login dengan Akun Google di Browser (OAuth 2.0 PKCE)',
      },
      {
        value: 'api_key',
        label: envKey
          ? `🔑 Gunakan GEMINI_API_KEY dari environment (${maskSecret(envKey)})`
          : '🔑 Gunakan API Key (Google AI Studio via aistudio.google.com)',
      },
      {
        value: 'custom_client_id',
        label: '✎ Atur / Ubah OAuth Client ID Google Cloud',
      },
      {
        value: 'cancel',
        label: '← Batal',
      },
    ],
  });

  if (p.isCancel(opt) || opt === 'cancel') return null;

  if (opt === 'custom_client_id' || (opt === 'oauth_browser' && !clientId)) {
    if (opt === 'oauth_browser' && !clientId) {
      console.log();
      console.log(theme.warning.bold(`  ℹ️  Konfigurasi OAuth Client ID untuk ${provider.name}:`));
      console.log(theme.muted(`     ${provider.setupGuide}`));
      console.log();
    }

    const inputCid = await p.text({
      message: `Masukkan Client ID untuk ${provider.name}:`,
      defaultValue: clientId || '',
      validate(val) {
        if (!val || !val.trim()) return 'Client ID tidak boleh kosong';
      },
    });
    if (p.isCancel(inputCid)) return null;
    clientId = inputCid.trim();

    const inputSec = await p.password({
      message: 'Masukkan Client Secret (opsional untuk desktop PKCE, tekan Enter jika tidak ada):',
      mask: '•',
    });
    if (p.isCancel(inputSec)) return null;
    clientSecret = inputSec ? inputSec.trim() : '';

    saveConfig({
      oauth: {
        [provider.id]: {
          ...(config.oauth?.[provider.id] || {}),
          clientId,
          ...(clientSecret ? { clientSecret } : {}),
        },
      },
    });
    config = getConfig();
  } else if (opt === 'api_key') {
    let apiKey = envKey;
    if (apiKey) {
      const useEnv = await p.confirm({
        message: `Ditemukan GEMINI_API_KEY di environment (${maskSecret(apiKey)}). Gunakan kunci ini?`,
        initialValue: true,
      });
      if (p.isCancel(useEnv)) return null;
      if (!useEnv) apiKey = null;
    }
    if (!apiKey) {
      const inputKey = await p.password({
        message: `Masukkan API Key untuk ${provider.name} (dapatkan di https://aistudio.google.com/apikey):`,
        mask: '•',
        validate(val) {
          if (!val || !val.trim()) return 'API Key tidak boleh kosong';
        },
      });
      if (p.isCancel(inputKey)) return null;
      apiKey = inputKey.trim();
    }

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

    p.outro(theme.success(`✓ Berhasil menyimpan API Key untuk ${provider.name} (${finalModel})!`));
    return { success: true, method: 'apikey' };
  }

  // Jalankan alur OAuth (Device Flow atau PKCE)
  try {
    let tokenData;
    if (provider.method === 'device') {
      tokenData = await runDeviceFlow(provider, clientId);
    } else {
      tokenData = await runPkceFlow(provider, clientId, clientSecret);
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

    p.outro(theme.success(`✓ Berhasil login ke ${provider.name} (${finalModel})!`));
    return { success: true, ...tokenData, model: finalModel };
  } catch (err) {
    p.outro(theme.error(`Gagal login ke ${provider.name}: ${err.message}`));
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
    const loggedInIds = Object.keys(config.oauth || {}).filter((id) => {
      const o = config.oauth[id];
      return Boolean(o && (o.accessToken || o.apiKey));
    });

    if (loggedInIds.length === 0) {
      console.log(theme.warning('  Tidak ada sesi OAuth yang sedang login saat ini.'));
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

  const isActiveMatch =
    config.activeProvider === provName || config.activeProvider === targetId;

  if (isActiveMatch) {
    updates.activeProvider = 'Not configured';
    updates.activeModel = 'Not configured';
    updates.activeType = 'none';
  }

  saveConfig(updates);
  p.outro(theme.warning(`✓ Berhasil logout dari ${provName}.`));
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
