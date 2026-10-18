import chalk from 'chalk';
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
    if (provider.clientSecret) {
      bodyParams.set('client_secret', provider.clientSecret);
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
    console.log(chalk.red(`Provider '${targetId}' tidak dikenal.`));
    return null;
  }

  if (provider.method === 'agy') {
    const s = spinner();
    s.start('Memeriksa status Antigravity CLI (agy)...');

    const agyExe = process.env.ANTIGRAVITY_AGENTAPI_EXE || 'agy';
    let isAvailable = false;
    try {
      const { exec } = await import('node:child_process');
      isAvailable = await new Promise((resolve) => {
        exec(`"${agyExe}" --version`, { timeout: 3000 }, (err) => {
          resolve(!err);
        });
      });
    } catch {}

    if (!isAvailable) {
      s.stop(chalk.red('✗ Antigravity CLI (agy) belum terdeteksi atau belum login.'));
      console.log(chalk.yellow('  Pastikan Antigravity CLI sudah terpasang dan login dengan akun Google Anda.'));
      return null;
    }

    s.stop(chalk.green('✓ Terhubung ke Antigravity CLI (Akun Google aktif)!'));

    const modelChoice = await p.select({
      message: `Pilih model aktif untuk ${provider.name}:`,
      options: [
        { value: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High) — Bawaan Cepat & Cerdas' },
        { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Thinking) — Penalaran Mendalam' },
        { value: 'claude-opus-4-6-thinking', label: 'Claude Opus 4.6 (Thinking) — Arsitektur & Refactor' },
        { value: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B (Medium) — Open-weights' },
        { value: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash (Medium)' },
        { value: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash (Low)' },
      ],
    });

    if (p.isCancel(modelChoice)) return null;

    saveConfig({
      oauth: {
        [provider.id]: {
          active: true,
          method: 'agy',
          connectedAt: Date.now(),
        },
      },
      activeProvider: provider.name,
      activeModel: modelChoice,
      activeType: 'agy',
    });

    p.outro(chalk.green(`✓ Berhasil mengaktifkan ${provider.name} (${modelChoice})!`));
    return { success: true, method: 'agy', model: modelChoice };
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
      console.log(chalk.yellow.bold(`  ℹ️  Konfigurasi OAuth Client ID untuk ${provider.name}:`));
      console.log(chalk.gray(`     ${provider.setupGuide}`));
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

    p.outro(chalk.green(`✓ Berhasil menyimpan API Key untuk ${provider.name} (${finalModel})!`));
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

  if ((config.activeType === 'oauth' || config.activeType === 'agy') && config.activeProvider === provName) {
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
    const isAgy = prov.method === 'agy';
    const auth = config.oauth?.[prov.id];
    const isLoggedIn = isAgy
      ? Boolean((auth && (auth.active || auth.connectedAt)) || (config.activeType === 'agy' && config.activeProvider === prov.name))
      : Boolean(auth && (auth.accessToken || auth.apiKey));
    const tokenVal = isAgy ? 'Google OAuth (agy)' : (auth?.accessToken || auth?.apiKey || '');
    const masked = isAgy ? 'agy cli (local session)' : maskSecret(tokenVal);
    const expiresAt = auth?.expiresAt || null;

    let expiryStatus = isAgy ? 'Aktif (Sesi Google)' : 'Aktif';
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
