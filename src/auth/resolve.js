import chalk from 'chalk';
import { getConfig } from '../config.js';
import { PROVIDERS } from './registry.js';
import { getAccessToken } from './index.js';

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

    if (cp.baseUrl && cp.baseUrl.startsWith('http://')) {
      console.warn(
        chalk.yellow('  ⚠️  Peringatan Keamanan: Base URL menggunakan HTTP (tidak terenkripsi).')
      );
    }

    return {
      provider: cp.name,
      type: 'custom',
      baseUrl: cp.baseUrl,
      headers: {
        Authorization: `Bearer ${cp.apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'bAIwor-Code/1.0.0',
      },
      model: config.activeModel,
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

    return {
      provider: prov.name,
      type: 'oauth',
      baseUrl: prov.baseUrl,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'bAIwor-Code/1.0.0',
      },
      model: config.activeModel,
    };
  }

  throw new Error('Belum ada model atau provider yang aktif. Ketik /model untuk memilih.');
}
