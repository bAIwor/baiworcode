import { execFile } from 'node:child_process';
import { theme } from '../theme.js';
import { spinner } from '../spinner.js';
import { USER_AGENT } from '../branding.js';

export function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      // Jangan lewat cmd.exe: argumen URL dengan '&' (parameter OAuth) akan
      // dipotong/diinterpretasikan sebagai perintah lain. rundll32 menerima
      // URL apa adanya; explorer dipakai sebagai fallback.
      execFile('rundll32', ['url.dll,FileProtocolHandler', url], (err) => {
        if (err) {
          execFile('explorer', [url], () => {});
        }
      });
    } else if (process.platform === 'darwin') {
      execFile('open', [url], () => {});
    } else {
      execFile('xdg-open', [url], () => {});
    }
  } catch {
    // Abaikan jika gagal membuka browser secara otomatis
  }
}

/**
 * Menjalankan OAuth 2.0 Device Authorization Grant (RFC 8628)
 */
export async function runDeviceFlow(provider, clientId) {
  const s = spinner();
  s.start(`Menghubungi endpoint Device Authorization untuk ${provider.name}...`);

  let deviceData;
  try {
    const bodyParams = new URLSearchParams({
      client_id: clientId,
      scope: provider.scope || 'read:user',
    });

    const res = await fetch(provider.deviceEndpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
      },
      body: bodyParams.toString(),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errText}`);
    }

    deviceData = await res.json();
  } catch (err) {
    s.stop(theme.error(`Gagal meminta Device Code: ${err.message}`));
    throw err;
  }

  s.stop(theme.success('Kode otorisasi perangkat berhasil dibuat!'));

  const userCode = deviceData.user_code;
  const verificationUri = deviceData.verification_uri || deviceData.verification_url;
  const completeUri = deviceData.verification_uri_complete;
  const deviceCode = deviceData.device_code;
  let intervalMs = (deviceData.interval || 5) * 1000;
  const expiresInMs = (deviceData.expires_in || 900) * 1000;
  const deadline = Date.now() + Math.min(expiresInMs, 300000); // Maks 5 menit

  console.log();
  console.log(theme.warning.bold('  🔐 Panduan Otorisasi Perangkat:'));
  console.log(`    1. Salin kode verifikasi Anda : ${theme.success.bold(userCode)}`);
  console.log(`    2. Buka URL di peramban web   : ${theme.info.underline(verificationUri)}`);
  console.log();

  // Coba buka browser secara otomatis
  const targetUrl = completeUri || verificationUri;
  openBrowser(targetUrl);

  const pollSpinner = spinner();
  pollSpinner.start('Menunggu persetujuan Anda di peramban web...');

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));

    // Tandai error yang sudah sabotage polling supaya catch di bawah tidak
    // menelan dan mengulanginya. Tanpa penanda ini, error OAuth (mis.
    // "invalid_grant") ikut tertelan lalu polling berjalan terus hingga
    // batas 5 menit, dan pengguna tidak pernah melihat penyebabnya.
    let fatal = null;

    try {
      const pollParams = new URLSearchParams({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      });

      const tokenRes = await fetch(provider.tokenEndpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT,
        },
        body: pollParams.toString(),
        // Timeout per percobaan: tanpa ini satu request yang menggantung
        // membekukan alur login selamanya (tidak ada abort signal).
        signal: AbortSignal.timeout(20000),
      });

      if (!tokenRes.ok && tokenRes.status >= 500) {
        // Kesalahan server: transient, coba lagi pada iterasi berikutnya.
        continue;
      }

      const tokenData = await tokenRes.json();

      if (tokenData.access_token) {
        pollSpinner.stop(theme.success(`✓ Otorisasi ${provider.name} berhasil!`));
        const expiresAt = tokenData.expires_in
          ? Date.now() + tokenData.expires_in * 1000
          : Date.now() + 30 * 24 * 3600 * 1000; // default 30 hari

        return {
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token || null,
          expiresAt,
          method: 'device',
          tokenType: tokenData.token_type || 'Bearer',
        };
      }

      if (tokenData.error) {
        switch (tokenData.error) {
          case 'authorization_pending':
            // Lanjut menunggu
            break;
          case 'slow_down':
            // Hormati instruksi RFC 8628: tambah interval 5 detik
            intervalMs += 5000;
            break;
          case 'expired_token':
            pollSpinner.stop(theme.error('Kode otorisasi telah kedaluwarsa.'));
            fatal = new Error('Kode verifikasi kedaluwarsa. Silakan coba lagi.');
            break;
          case 'access_denied':
            pollSpinner.stop(theme.error('Otorisasi ditolak oleh pengguna.'));
            fatal = new Error('Otorisasi ditolak.');
            break;
          default:
            pollSpinner.stop(theme.error(`Error OAuth: ${tokenData.error_description || tokenData.error}`));
            fatal = new Error(tokenData.error_description || tokenData.error);
        }
      }
    } catch (err) {
      if (fatal) throw fatal;
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        // Timeout satu percobaan: transient, lanjut ke iterasi berikutnya.
        continue;
      }
      // Kesalahan jaringan sementara: coba lagi pada iterasi berikutnya
    }

    if (fatal) throw fatal;
  }

  pollSpinner.stop(theme.error('Waktu tunggu otorisasi habis (5 menit).'));
  throw new Error('Batas waktu otorisasi 5 menit telah habis.');
}
