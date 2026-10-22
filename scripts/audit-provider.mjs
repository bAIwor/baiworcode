// Audit skrip: alur provider custom OpenAI-compatible + error handling.
// Dijalankan di dalam sandbox InstaBox.
import http from 'node:http';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
  if (req.url === '/v1/models') {
    if (auth !== 'Bearer kunci-benar') {
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: { message: 'Invalid API key' } }));
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ data: [{ id: 'model-a' }, { id: 'model-b' }], models: ['model-x'] }));
    return;
  }
  if (req.url === '/v1/empty') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ data: [] }));
    return;
  }
  if (req.url === '/v1/bukan-json') {
    res.setHeader('Content-Type', 'text/html');
    res.end('<html>server error</html>');
    return;
  }
  if (req.url === '/v1/lambat') {
    setTimeout(() => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ data: [{ id: 'model-lambat' }] }));
    }, 30000);
    return;
  }
  res.statusCode = 404;
  res.end('{}');
});
await new Promise((r) => mock.listen(0, '127.0.0.1', r));
const PORT = mock.address().port;
const BASE = `http://127.0.0.1:${PORT}/v1`;

// ---------- helper: fetch model list seperti modelMenu ----------
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
const happy = await ambilModel(BASE, 'kunci-benar');
catat(
  'Provider custom: fetch /models dengan API key benar',
  happy.ok && happy.list.includes('model-a') && happy.list.includes('model-x'),
  `model=${JSON.stringify(happy.list)}`
);

// ---------- 2. API key salah ----------
const salahKey = await ambilModel(BASE, 'kunci-salah');
catat(
  'Error handling: API key salah ditolak dengan pesan jelas',
  !salahKey.ok && /HTTP 401/.test(salahKey.alasan),
  `alasan=${salahKey.alasan}`
);

// ---------- 3. Respons non-JSON ----------
const bukanJson = await ambilModel(`${BASE}/bukan-json`, 'kunci-benar');
catat(
  'Error handling: respons non-JSON ditolak (tidak crash)',
  !bukanJson.ok && bukanJson.alasan === 'bukan JSON',
  `alasan=${bukanJson.alasan}`
);

// ---------- 4. Daftar model kosong ----------
const kosong = await ambilModel(`${BASE}/empty`, 'kunci-benar');
catat(
  'Error handling: daftar model kosong ditangani (tidak crash)',
  kosong.ok && Array.isArray(kosong.list) && kosong.list.length === 0,
  `jumlah=${kosong.list?.length}`
);

// ---------- 5. Jaringan mati ----------
const mati = await ambilModel('http://127.0.0.1:1/v1', 'kunci-benar', 4000);
catat(
  'Error handling: jaringan mati ditangani (tidak crash)',
  !mati.ok && mati.alasan !== 'HTTP',
  `alasan=${mati.alasan}`
);

// ---------- 6. Timeout ----------
const lambat = await ambilModel(`${BASE}/lambat`, 'kunci-benar', 3000);
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
      baseUrl: BASE,
      apiKey: 'kunci-benar',
      model: 'model-a',
      models: ['model-a', 'model-b'],
    },
  ],
});
const cfg = getConfig();
catat(
  'Config: tulis lalu baca kembali dengan benar',
  cfg.activeProvider === 'MockProvider' && cfg.customProviders[0].apiKey === 'kunci-benar',
  `provider=${cfg.activeProvider}`
);

// ---------- 8. Config: JSON rusak ----------
const rusak = path.join(HOME, '.baiwor', 'config.json');
fs.writeFileSync(rusak, '{ ini bukan json valid');
let pulih = false;
try {
  const c2 = getConfig();
  pulih = typeof c2 === 'object' && c2 !== null && !!c2.activeProvider;
} catch {
  pulih = false;
}
catat('Config: file JSON rusak tidak bikin crash', pulih, pulih ? 'fallback ke default' : 'CRASH');

// ---------- 9. Config: file belum ada ----------
const home2 = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-home2-'));
process.env.USERPROFILE = home2;
process.env.HOME = home2;
const { getConfig: getConfig2 } = await import(new URL('../src/config.js', import.meta.url).href);
let adaDefault = false;
try {
  const c3 = getConfig2();
  adaDefault = !!c3 && !!c3.activeProvider;
} catch {
  adaDefault = false;
}
catat('Config: file belum ada → pakai default', adaDefault, adaDefault ? 'OK' : 'CRASH');

// ---------- 10. Permission file config ----------
process.env.USERPROFILE = HOME;
process.env.HOME = HOME;
await new Promise((r) => setTimeout(r, 100));
const stat = fs.statSync(rusak);
const mode = (stat.mode & 0o777).toString(8);
catat(
  'Keamanan: file config dibatasi permission (0600)',
  mode === '600',
  `mode=${mode}`
);

mock.close();
const gagal = results.filter((r) => !r.ok);
console.log(`\nRINGKASAN: ${results.length - gagal.length}/${results.length} lulus`);
if (gagal.length) {
  console.log('GAGAL:');
  for (const g of gagal) console.log(` - ${g.nama} (${g.bukti})`);
}
process.exit(gagal.length ? 1 : 0);
