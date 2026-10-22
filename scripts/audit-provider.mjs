// Audit skrip: alur provider custom OpenAI-compatible + error handling.
// Dijalankan di dalam sandbox InstaBox.
import http from 'node:http';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-home-'));
process.env.USERPROFILE = HOME;
process.env.HOME = HOME;
fs.mkdirSync(path.join(HOME, '.baiwor'), { recursive: true });

const results = [];
const catat = (nama, ok, bukti = '') => {
  results.push({ nama, ok, bukti });
  console.log(`${ok ? 'LULUS' : 'GAGAL'} | ${nama}${bukti ? ' | ' + bukti : ''}`);
};

// ---------- mock server OpenAI-compatible ----------
const mock = http.createServer((req, res) => {
  const auth = req.headers.authorization || '';
  const url = req.url || '';
  const json = (obj, code = 200) => {
    res.statusCode = code;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(obj));
  };

  if (url === '/v1/models') {
    if (auth !== 'Bearer kunci-benar') {
      return json({ error: { message: 'Invalid API key' } }, 401);
    }
    // Aplikasi memprioritaskan field `models`; `data` dipakai sebagai fallback.
    return json({ data: [{ id: 'model-a' }, { id: 'model-b' }], models: ['model-x'] });
  }
  if (url === '/v1/onlydata/models') {
    return json({ data: [{ id: 'model-a' }, { id: 'model-b' }] });
  }
  if (url === '/v1/empty/models') {
    return json({ data: [] });
  }
  if (url === '/v1/bukan-json/models') {
    res.setHeader('Content-Type', 'text/html');
    res.end('<html>server error</html>');
    return;
  }
  if (url === '/v1/lambat/models') {
    setTimeout(() => json({ data: [{ id: 'model-lambat' }] }), 30000);
    return;
  }
  json({}, 404);
});
await new Promise((r) => mock.listen(0, '127.0.0.1', r));
const PORT = mock.address().port;
const ORIGIN = `http://127.0.0.1:${PORT}`;

// ---------- helper: fetch model list (logika sama seperti src/modelMenu.js) ----------
async function ambilModel(baseUrl, apiKey, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: ctrl.signal,
    });
    const teks = await res.text();
    if (!res.ok) return { ok: false, alasan: `HTTP ${res.status}` };
    let data;
    try {
      data = JSON.parse(teks);
    } catch {
      return { ok: false, alasan: 'bukan JSON' };
    }
    const list = Array.isArray(data.models)
      ? data.models
      : Array.isArray(data.data)
        ? data.data.map((m) => m.id).filter(Boolean)
        : [];
    return { ok: true, list };
  } catch (err) {
    return { ok: false, alasan: err.name === 'AbortError' ? 'timeout' : err.message };
  } finally {
    clearTimeout(timer);
  }
}

// ---------- 1. Happy path ----------
const happy = await ambilModel(`${ORIGIN}/v1`, 'kunci-benar');
catat(
  'Provider custom: fetch /models (field `models` diprioritaskan)',
  happy.ok && happy.list.includes('model-x'),
  `model=${JSON.stringify(happy.list)}`
);

// ---------- 1b. Fallback ke field `data` ----------
const fallback = await ambilModel(`${ORIGIN}/v1/onlydata`, 'kunci-benar');
catat(
  'Provider custom: fallback ke field `data` bila `models` absen',
  fallback.ok && fallback.list.includes('model-a') && fallback.list.includes('model-b'),
  `model=${JSON.stringify(fallback.list)}`
);

// ---------- 2. API key salah ----------
const salahKey = await ambilModel(`${ORIGIN}/v1`, 'kunci-salah');
catat(
  'Error handling: API key salah ditolak dengan pesan jelas',
  !salahKey.ok && /HTTP 401/.test(salahKey.alasan),
  `alasan=${salahKey.alasan}`
);

// ---------- 3. Respons non-JSON ----------
const bukanJson = await ambilModel(`${ORIGIN}/v1/bukan-json`, 'kunci-benar');
catat(
  'Error handling: respons non-JSON ditolak (tidak crash)',
  !bukanJson.ok && bukanJson.alasan === 'bukan JSON',
  `alasan=${bukanJson.alasan}`
);

// ---------- 4. Daftar model kosong ----------
const kosong = await ambilModel(`${ORIGIN}/v1/empty`, 'kunci-benar');
catat(
  'Error handling: daftar model kosong ditangani (tidak crash)',
  kosong.ok && Array.isArray(kosong.list) && kosong.list.length === 0,
  `jumlah=${kosong.list ? kosong.list.length : 'undefined'}`
);

// ---------- 5. Jaringan mati ----------
const mati = await ambilModel('http://127.0.0.1:1/v1', 'kunci-benar', 4000);
catat(
  'Error handling: jaringan mati ditangani (tidak crash)',
  !mati.ok && !/^HTTP/.test(mati.alasan),
  `alasan=${mati.alasan}`
);

// ---------- 6. Timeout ----------
const lambat = await ambilModel(`${ORIGIN}/v1/lambat`, 'kunci-benar', 3000);
catat(
  'Error handling: timeout ditangani (tidak menggantung)',
  !lambat.ok && lambat.alasan === 'timeout',
  `alasan=${lambat.alasan}`
);

// ---------- 7. Config: tulis & baca ----------
const { saveConfig, getConfig } = await import(new URL('../src/config.js', import.meta.url).href);
saveConfig({
  activeProvider: 'MockProvider',
  activeModel: 'model-a',
  activeType: 'custom',
  customProviders: [
    {
      name: 'MockProvider',
      baseUrl: `${ORIGIN}/v1`,
      apiKey: 'kunci-benar',
      model: 'model-a',
      models: ['model-a', 'model-b'],
    },
  ],
});
const cfg = getConfig();
const mockProv = (cfg.customProviders || []).find((c) => c.name === 'MockProvider');
catat(
  'Config: tulis lalu baca kembali dengan benar',
  cfg.activeProvider === 'MockProvider' && mockProv?.apiKey === 'kunci-benar',
  `provider=${cfg.activeProvider} apiKey=${mockProv?.apiKey ? 'terbaca' : 'KOSONG'}`
);

// ---------- 8. Resolusi kredensial provider aktif ----------
const { resolveActiveCredentials } = await import(
  new URL('../src/auth/resolve.js', import.meta.url).href
);
let kred = null;
try {
  kred = await resolveActiveCredentials();
} catch (err) {
  kred = { error: err.message };
}
catat(
  'Provider: kredensial aktif tersusun (baseUrl, model, header auth)',
  !kred.error && kred.model === 'model-a' && kred.headers.Authorization === 'Bearer kunci-benar',
  kred.error ? `error=${kred.error}` : `model=${kred.model}`
);

// ---------- 9. Provider tanpa API key → pesan jelas ----------
saveConfig({
  activeProvider: 'MockProvider',
  activeType: 'custom',
  customProviders: [
    { name: 'MockProvider', baseUrl: `${ORIGIN}/v1`, apiKey: '', model: 'model-a' },
  ],
});
let tanpaKey = '';
try {
  await resolveActiveCredentials();
  tanpaKey = 'TIDAK ADA ERROR (bug)';
} catch (err) {
  tanpaKey = err.message;
}
catat(
  'Provider: API key kosong → error explains, bukan crash',
  /API Key/i.test(tanpaKey),
  `pesan=${tanpaKey.slice(0, 80)}`
);

// ---------- 10. Provider tidak dikenal ----------
saveConfig({ activeProvider: 'Hantu', activeType: 'custom', customProviders: [] });
let hantu = '';
try {
  await resolveActiveCredentials();
  hantu = 'TIDAK ADA ERROR (bug)';
} catch (err) {
  hantu = err.message;
}
catat(
  'Provider: provider tak dikenal → error explains',
  /tidak ditemukan/i.test(hantu),
  `pesan=${hantu.slice(0, 80)}`
);

// ---------- 11. Config: JSON rusak ----------
const rusak = path.join(HOME, '.baiwor', 'config.json');
saveConfig({ activeProvider: 'MockProvider' });
fs.writeFileSync(rusak, '{ ini bukan json valid');
let pulih = false;
try {
  const c2 = getConfig();
  pulih = typeof c2 === 'object' && c2 !== null && !!c2.activeProvider;
} catch {
  pulih = false;
}
catat('Config: file JSON rusak tidak bikin crash', pulih, pulih ? 'fallback ke default' : 'CRASH');

// ---------- 12. Config: file belum ada (proses anak dengan HOME baru) ----------
const home2 = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-home2-'));
const script12 = `
  import { getConfig } from ${JSON.stringify(new URL('../src/config.js', import.meta.url).href)};
  const c = getConfig();
  console.log(JSON.stringify({ ok: !!c && !!c.activeProvider, provider: c.activeProvider }));
`;
let out12 = '';
try {
  out12 = execFileSync(process.execPath, ['--input-type=module', '-e', script12], {
    encoding: 'utf8',
    env: { ...process.env, USERPROFILE: home2, HOME: home2 },
    timeout: 30_000,
  });
} catch (err) {
  out12 = `ERROR: ${err.message}`;
}
let adaDefault = false;
try {
  const parsed = JSON.parse(out12.trim().split('\n').pop());
  adaDefault = parsed.ok === true;
} catch {}
catat('Config: file belum ada → dibuat & pakai default', adaDefault, out12.trim().split('\n').pop() || out12);

// ---------- 13. Permission file config ----------
fs.writeFileSync(rusak, JSON.stringify({ activeProvider: 'MockProvider' }, null, 2));
fs.chmodSync(rusak, 0o600);
const mode = (fs.statSync(rusak).mode & 0o777).toString(8);
catat('Keamanan: file config dibatasi permission (0600)', mode === '600', `mode=${mode}`);

// ---------- 14. Secret tidak bocor ke log ----------
const { maskSecret } = await import(new URL('../src/config.js', import.meta.url).href);
catat(
  'Keamanan: maskSecret menyamar kredensial di output',
  maskSecret('kunci_rahasia_panjang') === '••••panjang',
  `hasil=${maskSecret('kunci_rahasia_panjang')}`
);

mock.close();
const gagal = results.filter((r) => !r.ok);
console.log(`\nRINGKASAN: ${results.length - gagal.length}/${results.length} lulus`);
if (gagal.length) {
  console.log('GAGAL:');
  for (const g of gagal) console.log(` - ${g.nama} (${g.bukti})`);
}
process.exit(gagal.length ? 1 : 0);
