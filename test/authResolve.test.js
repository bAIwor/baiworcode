import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolveActiveCredentials, hasActiveCredentials } from '../src/auth/resolve.js';

function makeConfig(overrides = {}) {
  return {
    activeType: 'custom',
    activeProvider: 'Agentik',
    activeModel: 'gemini-3.8-flash-high',
    customProviders: [
      {
        name: 'Agentik',
        baseUrl: 'https://api.agentik.my.id/v1',
        apiKey: 'sk-uji-agentik',
        model: 'gemini-3.8-flash-high',
      },
    ],
    ...overrides,
  };
}

describe('resolveActiveCredentials — provider custom', () => {
  afterEach(() => {
    delete process.env.BAIWOR_TEST_PROVIDER_KEY;
  });

  it('mengembalikan kredensial provider custom yang aktif', async () => {
    const creds = await resolveActiveCredentials(makeConfig());

    assert.equal(creds.provider, 'Agentik');
    assert.equal(creds.type, 'custom');
    assert.equal(creds.baseUrl, 'https://api.agentik.my.id/v1');
    assert.equal(creds.model, 'gemini-3.8-flash-high');
    assert.equal(creds.headers.Authorization, 'Bearer sk-uji-agentik');
  });

  it('menolak provider yang tidak ada di config', async () => {
    await assert.rejects(
      () => resolveActiveCredentials(makeConfig({ activeProvider: 'TidakAda' })),
      /tidak ditemukan/i
    );
  });

  it('menolak baseUrl kosong atau bukan string', async () => {
    for (const baseUrl of ['', '   ', null, 42]) {
      await assert.rejects(
        () =>
          resolveActiveCredentials(
            makeConfig({
              customProviders: [
                { name: 'Agentik', baseUrl, apiKey: 'sk-uji', model: 'm' },
              ],
            })
          ),
        /Base URL/i
      );
    }
  });

  it('menolak API key kosong atau bukan string', async () => {
    for (const apiKey of ['', '   ', null, 42]) {
      await assert.rejects(
        () =>
          resolveActiveCredentials(
            makeConfig({
              customProviders: [
                { name: 'Agentik', baseUrl: 'https://api.example/v1', apiKey, model: 'm' },
              ],
            })
          ),
        /API Key/i
      );
    }
  });

  it('menolak API key yang memakai env var belum diset', async () => {
    await assert.rejects(
      () =>
        resolveActiveCredentials(
          makeConfig({
            customProviders: [
              {
                name: 'Agentik',
                baseUrl: 'https://api.example/v1',
                apiKey: '${BAIWOR_TEST_MISSING_KEY}',
                model: 'm',
              },
            ],
          })
        ),
      /BAIWOR_TEST_MISSING_KEY/
    );
  });

  it('mengekspansi env var pada API key dan custom headers', async () => {
    process.env.BAIWOR_TEST_PROVIDER_KEY = 'rahasia-env';
    const creds = await resolveActiveCredentials(
      makeConfig({
        customProviders: [
          {
            name: 'Agentik',
            baseUrl: 'https://api.example/v1',
            apiKey: '${BAIWOR_TEST_PROVIDER_KEY}',
            headers: { 'X-Custom': '${BAIWOR_TEST_PROVIDER_KEY}' },
            model: 'm',
          },
        ],
      })
    );

    assert.equal(creds.headers.Authorization, 'Bearer rahasia-env');
    assert.equal(creds.headers['X-Custom'], 'rahasia-env');
  });

  it('memakai model provider bila activeModel belum dikonfigurasi', async () => {
    const creds = await resolveActiveCredentials(
      makeConfig({
        activeModel: 'Not configured',
        customProviders: [
          { name: 'Agentik', baseUrl: 'https://api.example/v1', apiKey: 'sk', model: 'model-cadangan' },
        ],
      })
    );

    assert.equal(creds.model, 'model-cadangan');
  });

  it('tidak crash pada entri customProviders yang rusak', async () => {
    const creds = await resolveActiveCredentials(
      makeConfig({
        customProviders: [
          null,
          { name: 'Agentik', baseUrl: 'https://api.example/v1', apiKey: 'sk', model: 'm' },
        ],
      })
    );

    assert.equal(creds.provider, 'Agentik');
  });

  it('menolak config non-custom (OAuth/agy lama) tanpa fallback diam-diam', async () => {
    for (const activeType of ['oauth', 'agy', 'none']) {
      await assert.rejects(
        () => resolveActiveCredentials(makeConfig({ activeType })),
        /Belum ada model/i
      );
    }
  });
});

describe('hasActiveCredentials — custom-only', () => {
  it('true bila provider aktif punya API key siap pakai', () => {
    assert.equal(hasActiveCredentials(makeConfig()), true);
  });

  it('false bila API key kosong atau env ref belum diset', () => {
    assert.equal(
      hasActiveCredentials(
        makeConfig({
          customProviders: [{ name: 'Agentik', baseUrl: 'https://x', apiKey: '', model: 'm' }],
        })
      ),
      false
    );
    assert.equal(
      hasActiveCredentials(
        makeConfig({
          customProviders: [
            { name: 'Agentik', baseUrl: 'https://x', apiKey: '${TIDAK_DISET}', model: 'm' },
          ],
        })
      ),
      false
    );
  });

  it('false untuk tipe provider lama (oauth/agy)', () => {
    assert.equal(hasActiveCredentials(makeConfig({ activeType: 'oauth' })), false);
    assert.equal(hasActiveCredentials(makeConfig({ activeType: 'agy' })), false);
  });
});
