import chalk from 'chalk';
import { getConfig } from '../config.js';
import { PROVIDERS } from './registry.js';
import { getAccessToken } from './index.js';
import { USER_AGENT } from '../branding.js';

/**
 * Menghubungkan kredensial provider aktif (Custom API Key atau OAuth Bearer Token)
 * Disiapkan untuk eksekusi chat streaming pada Tahap 3A.
 */
export async function resolveActiveCredentials() {
  const config = getConfig();

  if (config.activeType === 'custom') {
    const cp = (config.customProviders || []).find(
      (c) => c.name.toLowerCase() === (config.activeProvider || '').toLowerCase()
    );

    if (!cp) {
      throw new Error(`Custom provider '${config.activeProvider}' tidak ditemukan dalam konfigurasi.`);
    }

    if (!cp.baseUrl || !cp.baseUrl.trim()) {
      throw new Error(`Base URL untuk provider '${cp.name}' belum dikonfigurasi. Ketik /model untuk mengatur.`);
    }

    if (!cp.apiKey || !cp.apiKey.trim()) {
      throw new Error(`API Key untuk provider '${cp.name}' belum dikonfigurasi. Silakan simpan API key di ~/.baiwor/config.json atau atur via /model.`);
    }

    if (cp.baseUrl && cp.baseUrl.startsWith('http://')) {
      console.warn(
        chalk.yellow('  ⚠️  Peringatan Keamanan: Base URL menggunakan HTTP (tidak terenkripsi).')
      );
    }

    const activeModel =
      config.activeModel && config.activeModel !== 'Not configured'
        ? config.activeModel
        : cp.model;

    if (!activeModel) {
      throw new Error(`Model untuk provider '${cp.name}' belum dikonfigurasi. Ketik /model untuk memilih model.`);
    }

    return {
      provider: cp.name,
      type: 'custom',
      baseUrl: cp.baseUrl,
      headers: {
        Authorization: `Bearer ${cp.apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
      },
      model: activeModel,
    };
  }

  if (config.activeType === 'agy' || (config.activeProvider || '').toLowerCase().includes('antigravity')) {
    const prov = PROVIDERS['google-antigravity'];
    const activeModel =
      config.activeModel && config.activeModel !== 'Not configured'
        ? config.activeModel
        : prov.defaultModel;

    return {
      provider: prov.name,
      type: 'agy',
      baseUrl: 'local://antigravity',
      headers: {},
      model: activeModel,
    };
  }

  if (config.activeType === 'oauth') {
    const prov = Object.values(PROVIDERS).find(
      (p) => p.name.toLowerCase() === (config.activeProvider || '').toLowerCase()
    );

    if (!prov) {
      throw new Error(`OAuth provider '${config.activeProvider}' tidak dikenal.`);
    }

    const token = await getAccessToken(prov.id);
    if (!token) {
      throw new Error(
        `Token login untuk ${prov.name} tidak ditemukan atau telah kedaluwarsa. Ketik /login untuk masuk kembali.`
      );
    }

    const activeModel =
      config.activeModel && config.activeModel !== 'Not configured'
        ? config.activeModel
        : prov.defaultModel;

    return {
      provider: prov.name,
      type: 'oauth',
      baseUrl: prov.baseUrl,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
      },
      model: activeModel,
    };
  }

  throw new Error('Belum ada model atau provider yang aktif. Ketik /model untuk memilih.');
}
