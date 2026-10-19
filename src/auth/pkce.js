import http from 'node:http';
import crypto from 'node:crypto';
import { theme } from '../theme.js';
import { spinner } from '../spinner.js';
import { openBrowser } from './device.js';
import { USER_AGENT } from '../branding.js';

function base64url(buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Menjalankan OAuth 2.0 Authorization Code Flow dengan PKCE via Loopback
 */
export async function runPkceFlow(provider, clientId, clientSecret = '') {
  const codeVerifier = base64url(crypto.randomBytes(32));
  const codeChallenge = base64url(
    crypto.createHash('sha256').update(codeVerifier).digest()
  );
  const expectedState = crypto.randomBytes(16).toString('hex');

  return new Promise((resolve, reject) => {
    let serverClosed = false;
    let timeoutTimer = null;

    const cleanup = () => {
      if (!serverClosed) {
        serverClosed = true;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        try {
          server.close();
        } catch {}
      }
    };

    const server = http.createServer(async (req, res) => {
      try {
        const reqUrl = new URL(req.url, 'http://127.0.0.1');

        const validPaths = ['/callback', '/oauth2callback'];
        if (provider.redirectPath && !validPaths.includes(provider.redirectPath)) {
          validPaths.push(provider.redirectPath);
        }

        if (!validPaths.includes(reqUrl.pathname)) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
          return;
        }

        const code = reqUrl.searchParams.get('code');
        const state = reqUrl.searchParams.get('state');
        const error = reqUrl.searchParams.get('error');
        const errorDesc = reqUrl.searchParams.get('error_description');

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
            <html><body style="font-family:sans-serif; text-align:center; padding:50px; background:#1e1e2e; color:#f38ba8;">
              <h2>❌ Otorisasi Dibatalkan</h2>
              <p>${errorDesc || error}</p>
              <p>Anda dapat menutup jendela ini.</p>
            </body></html>
          `);
          cleanup();
          reject(new Error(`Otorisasi dibatalkan: ${errorDesc || error}`));
          return;
        }

        if (state !== expectedState) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<h2>❌ State Mismatch (Kemungkinan serangan CSRF)</h2>');
          cleanup();
          reject(new Error('State CSRF tidak cocok. Otorisasi digagalkan.'));
          return;
        }

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<h2>❌ Authorization Code tidak ditemukan</h2>');
          cleanup();
          reject(new Error('Kode otorisasi tidak ditemukan.'));
          return;
        }

        // Tampilkan halaman sukses ke browser
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <html><body style="font-family:sans-serif; text-align:center; padding:50px; background:#181825; color:#a6e3a1;">
            <h2>✓ Login bAIwor Code Berhasil!</h2>
            <p>Otorisasi ${provider.name} berhasil. Anda dapat menutup tab ini dan kembali ke terminal.</p>
          </body></html>
        `);

        // Tukar authorization code dengan access token
        const port = server.address().port;
        const redirectPath = provider.redirectPath || '/oauth2callback';
        const redirectHost = provider.redirectHost || 'localhost';
        const redirectUri = `http://${redirectHost}:${port}${redirectPath}`;

        const s = spinner();
        s.start('Menukarkan kode otorisasi dengan Access Token...');

        const tokenBody = new URLSearchParams({
          grant_type: 'authorization_code',
          code: code,
          redirect_uri: redirectUri,
          client_id: clientId,
          code_verifier: codeVerifier,
        });

        const sec =
          clientSecret ||
          (provider.getClientSecret ? provider.getClientSecret() : provider.clientSecret);
        if (sec) {
          tokenBody.set('client_secret', sec);
        }

        const tokenRes = await fetch(provider.tokenEndpoint, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': USER_AGENT,
          },
          body: tokenBody.toString(),
        });

        if (!tokenRes.ok) {
          const errText = await tokenRes.text();
          s.stop(theme.error('Gagal menukar token.'));
          cleanup();
          reject(new Error(`Gagal menukar token (HTTP ${tokenRes.status}): ${errText}`));
          return;
        }

        const tokenData = await tokenRes.json();
        s.stop(theme.success(`✓ Berhasil terautentikasi dengan ${provider.name}!`));

        const expiresAt = tokenData.expires_in
          ? Date.now() + tokenData.expires_in * 1000
          : Date.now() + 3600 * 1000; // default 1 jam

        cleanup();
        resolve({
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token || null,
          expiresAt,
          method: 'pkce',
          tokenType: tokenData.token_type || 'Bearer',
        });
      } catch (err) {
        cleanup();
        reject(err);
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const redirectPath = provider.redirectPath || '/oauth2callback';
      const redirectHost = provider.redirectHost || 'localhost';
      const redirectUri = `http://${redirectHost}:${port}${redirectPath}`;

      const authUrl = new URL(provider.authEndpoint);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('client_id', clientId);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('scope', provider.scope);
      authUrl.searchParams.set('state', expectedState);
      authUrl.searchParams.set('code_challenge', codeChallenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');
      authUrl.searchParams.set('access_type', 'offline');
      authUrl.searchParams.set('prompt', 'consent');

      console.log();
      console.log(theme.warning.bold(`  🔐 Otorisasi Browser untuk ${provider.name}:`));
      console.log(`    Membuka tautan login di peramban web Anda...`);
      console.log(`    Jika peramban tidak terbuka otomatis, buka URL ini:`);
      console.log(`    ${theme.info.underline(authUrl.toString())}`);
      console.log();

      openBrowser(authUrl.toString());

      // Timeout 5 menit
      timeoutTimer = setTimeout(() => {
        cleanup();
        reject(new Error('Batas waktu otorisasi PKCE habis (5 menit).'));
      }, 300000);
    });

    server.on('error', (err) => {
      cleanup();
      reject(new Error(`Gagal memulai server loopback lokal: ${err.message}`));
    });
  });
}
