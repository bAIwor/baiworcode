import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseAliasValue,
  resolveModelTarget,
  applyModelTarget,
  buildAliasUpsert,
  buildAliasRemoval,
  listAliases,
  activeAliasName,
  validateAliasName,
} from '../src/modelAlias.js';
import { expandEnvSecret, findMissingEnvRefs } from '../src/auth/resolve.js';

/**
 * Config contoh yang meniru ~/.baiwor/config.json pengguna nyata
 * (Agentik + StepFun sebagai custom provider).
 */
function makeConfig(overrides = {}) {
  return {
    activeProvider: 'StepFun',
    activeModel: 'step-5-preview',
    activeType: 'custom',
    customProviders: [
      {
        name: 'Agentik',
        baseUrl: 'https://api.agentik.my.id/v1',
        apiKey: 'kunci-uji-agentik',
        model: 'gemini-3.8-flash-medium',
      },
      {
        name: 'StepFun',
        baseUrl: 'https://api.stepfun.ai/step_plan/v1',
        apiKey: 'kunci-uji-stepfun',
        model: 'step-5-preview',
      },
    ],
    modelAliases: {},
    ...overrides,
  };
}

/* ---------------- parseAliasValue ---------------- */

test('parseAliasValue: short form string', () => {
  assert.deepEqual(parseAliasValue('stepfun/step-5-preview'), {
    provider: 'stepfun',
    model: 'step-5-preview',
  });
});

test('parseAliasValue: objek bentuk panjang', () => {
  assert.deepEqual(
    parseAliasValue({
      model: 'theta-1',
      provider: 'custom',
      baseUrl: 'https://theta.example.com/v1/',
      apiKey: '  kunci-123  ',
    }),
    { provider: 'custom', model: 'theta-1', baseUrl: 'https://theta.example.com/v1', apiKey: 'kunci-123' }
  );
});

test('parseAliasValue: referensi environment variable di-expand', () => {
  process.env.BAIWOR_TEST_ALIAS_KEY = 'nilai-dari-env';
  try {
    // ${VAR} dan $VAR
    assert.equal(
      parseAliasValue({ model: 'm', provider: 'p', apiKey: '${BAIWOR_TEST_ALIAS_KEY}' }).apiKey,
      'nilai-dari-env'
    );
    assert.equal(
      parseAliasValue({ model: 'm', provider: 'p', apiKey: '$BAIWOR_TEST_ALIAS_KEY' }).apiKey,
      'nilai-dari-env'
    );
    // key_env: nama variabel, bukan nilainya
    assert.equal(
      parseAliasValue({ model: 'm', provider: 'p', key_env: 'BAIWOR_TEST_ALIAS_KEY' }).apiKey,
      'nilai-dari-env'
    );
    // Variabel tidak ada → teks asli dibiarkan (kekeliruan config terlihat)
    assert.equal(
      parseAliasValue({ model: 'm', provider: 'p', apiKey: '${TIDAK_ADA_VAR}' }).apiKey,
      '${TIDAK_ADA_VAR}'
    );
  } finally {
    delete process.env.BAIWOR_TEST_ALIAS_KEY;
  }
});

test('alias env: placeholder disimpan, bukan nilai rahasia hasil ekspansi', () => {
  process.env.BAIWOR_TEST_PERSIST_KEY = 'rahasia-env';
  try {
    const target = resolveModelTarget('theta', makeConfig({
      customProviders: [],
      modelAliases: {
        theta: {
          model: 'theta-1',
          provider: 'custom',
          baseUrl: 'https://theta.example.com/v1',
          apiKey: '${BAIWOR_TEST_PERSIST_KEY}',
        },
      },
    }));
    assert.equal(target.apiKeyRef, '${BAIWOR_TEST_PERSIST_KEY}');
    assert.equal(target.apiKey, 'rahasia-env');

    const applied = applyModelTarget(target, makeConfig({ customProviders: [] }));
    assert.equal(applied.ok, true);
    assert.equal(
      applied.patch.customProviders[0].apiKey,
      '${BAIWOR_TEST_PERSIST_KEY}',
      'config tidak boleh menyimpan nilai hasil ekspansi'
    );

    assert.equal(expandEnvSecret('${BAIWOR_TEST_PERSIST_KEY}'), 'rahasia-env');
    assert.deepEqual(findMissingEnvRefs('${TIDAK_DISET_XYZ}'), ['TIDAK_DISET_XYZ']);
  } finally {
    delete process.env.BAIWOR_TEST_PERSIST_KEY;
  }
});

test('parseAliasValue: nilai tidak valid', () => {
  assert.equal(parseAliasValue('tanpa-slash'), null);
  assert.equal(parseAliasValue('/model'), null);
  assert.equal(parseAliasValue('provider/'), null);
  assert.equal(parseAliasValue({ provider: 'x' }), null);
  assert.equal(parseAliasValue(42), null);
  assert.equal(parseAliasValue(null), null);
});

/* ---------------- resolveModelTarget ---------------- */

test('resolveModelTarget: short form ke custom provider (case-insensitive)', () => {
  const target = resolveModelTarget('stepfun/step-5-preview', makeConfig());
  assert.equal(target.provider, 'StepFun');
  assert.equal(target.model, 'step-5-preview');
  assert.equal(target.type, 'custom');
  assert.equal(target.baseUrl, 'https://api.stepfun.ai/step_plan/v1');
  assert.equal(target.source, 'shortform');
});

test('resolveModelTarget: alias pengguna (short form & objek)', () => {
  const config = makeConfig({
    modelAliases: {
      step: 'stepfun/step-5-preview',
      theta: {
        model: 'theta-1',
        provider: 'custom',
        baseUrl: 'https://theta.example.com/v1',
        apiKey: 'kunci-teta',
      },
    },
  });

  const step = resolveModelTarget('step', config);
  assert.equal(step.provider, 'StepFun');
  assert.equal(step.model, 'step-5-preview');
  assert.equal(step.source, 'alias');
  assert.equal(step.alias, 'step');

  // Bentuk panjang dengan provider 'custom': nama alias jadi identitas provider
  const theta = resolveModelTarget('theta', config);
  assert.equal(theta.provider, 'theta');
  assert.equal(theta.type, 'custom');
  assert.equal(theta.baseUrl, 'https://theta.example.com/v1');
});

test('resolveModelTarget: alias pengguna menutupi alias bawaan agentik', () => {
  const config = makeConfig({
    modelAliases: { agentik: 'stepfun/step-5-preview' },
  });
  const target = resolveModelTarget('agentik', config);
  assert.equal(target.provider, 'StepFun');
  assert.equal(target.source, 'alias');
});

test('resolveModelTarget: alias bawaan agentik', () => {
  const agentik = resolveModelTarget('agentik', makeConfig());
  assert.equal(agentik.provider, 'Agentik');
  assert.equal(agentik.model, 'gemini-3.8-flash-medium');
  assert.equal(agentik.source, 'builtin');
});

test('resolveModelTarget: yang tidak dikenali mengembalikan null', () => {
  const config = makeConfig();
  assert.equal(resolveModelTarget('tidak-ada', config), null);
  assert.equal(resolveModelTarget('unknownprovider/model-x', config), null);
  assert.equal(resolveModelTarget('', config), null);
  assert.equal(resolveModelTarget(null, config), null);
  // Alias rusak (nilai tidak bisa di-parse) → null, bukan error
  const broken = makeConfig({ modelAliases: { rusak: 'tanpa-slash' } });
  assert.equal(resolveModelTarget('rusak', broken), null);
});

/* ---------------- applyModelTarget ---------------- */

test('applyModelTarget: aktifkan custom provider tersimpan', () => {
  const res = applyModelTarget(
    { provider: 'Agentik', model: 'claude-sonnet-5-5', type: 'custom' },
    makeConfig()
  );
  assert.equal(res.ok, true);
  assert.equal(res.patch.activeProvider, 'Agentik');
  assert.equal(res.patch.activeModel, 'claude-sonnet-5-5');
  assert.equal(res.patch.activeType, 'custom');
  // customProviders tidak ikut di-patch bila tidak ada perubahan
  assert.equal(res.patch.customProviders, undefined);
});

test('applyModelTarget: provider custom baru dari alias berbasis objek', () => {
  const res = applyModelTarget(
    {
      provider: 'Theta',
      model: 'theta-1',
      type: 'custom',
      baseUrl: 'https://theta.example.com/v1',
      apiKey: 'kunci-teta',
    },
    makeConfig()
  );
  assert.equal(res.ok, true);
  assert.equal(res.patch.activeProvider, 'Theta');
  assert.equal(res.patch.activeType, 'custom');
  assert.equal(res.patch.customProviders.length, 3);
  const theta = res.patch.customProviders.at(-1);
  assert.equal(theta.name, 'Theta');
  assert.equal(theta.model, 'theta-1');
});

test('applyModelTarget: provider baru tanpa kredensial ditolak', () => {
  const res = applyModelTarget({ provider: 'Nvidia', model: 'x', type: 'custom' }, makeConfig());
  assert.equal(res.ok, false);
  assert.match(res.error, /belum tersimpan/);
});

test('applyModelTarget: alias boleh membawa API key baru untuk provider tersimpan', () => {
  const res = applyModelTarget(
    { provider: 'stepfun', model: 'step-5-preview', type: 'custom', apiKey: 'kunci-baru' },
    makeConfig()
  );
  assert.equal(res.ok, true);
  const sf = res.patch.customProviders.find((c) => c.name === 'StepFun');
  assert.equal(sf.apiKey, 'kunci-baru');
});

/* ---------------- kelola alias ---------------- */

test('validateAliasName', () => {
  assert.equal(validateAliasName('step'), null);
  assert.equal(validateAliasName('my-alias_2'), null);
  assert.notEqual(validateAliasName('ada spasi'), null);
  assert.notEqual(validateAliasName('ada/slash'), null);
  assert.notEqual(validateAliasName(''), null);
});

test('buildAliasUpsert: simpan & merge tanpa menghapus alias lain', () => {
  const config = makeConfig({ modelAliases: { lama: 'stepfun/step-5-preview' } });
  const res = buildAliasUpsert(config, 'baru', 'agentik/gemini-3.5-flash');
  assert.equal(res.ok, true);
  assert.deepEqual(res.patch.modelAliases, {
    lama: 'stepfun/step-5-preview',
    baru: 'agentik/gemini-3.5-flash',
  });
});

test('buildAliasUpsert: nama/nilai tidak valid ditolak', () => {
  const config = makeConfig();
  assert.equal(buildAliasUpsert(config, 'nama salah', 'stepfun/x').ok, false);
  assert.equal(buildAliasUpsert(config, 'ok', 'tanpa-slash').ok, false);
});

test('buildAliasRemoval', () => {
  const config = makeConfig({ modelAliases: { step: 'stepfun/step-5-preview' } });
  const ok = buildAliasRemoval(config, 'step');
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.patch.modelAliases, {});
  assert.equal(buildAliasRemoval(config, 'hantu').ok, false);
});

/* ---------------- tampilan ---------------- */

test('listAliases: menormalisasi short form & objek', () => {
  const config = makeConfig({
    modelAliases: {
      step: 'stepfun/step-5-preview',
      theta: { model: 'theta-1', provider: 'custom', baseUrl: 'https://theta.example.com/v1' },
    },
  });
  const list = listAliases(config);
  assert.equal(list.length, 2);
  assert.deepEqual(list[0], {
    name: 'step',
    provider: 'stepfun',
    model: 'step-5-preview',
    baseUrl: null,
  });
  assert.equal(list[1].baseUrl, 'https://theta.example.com/v1');
});

test('activeAliasName: mendeteksi alias yang sedang aktif', () => {
  const config = makeConfig({
    modelAliases: {
      step: 'stepfun/step-5-preview',
      flash: 'agentik/gemini-3.8-flash-medium',
    },
  });
  // Config aktif: StepFun / step-5-preview
  assert.equal(activeAliasName(config), 'step');

  const other = makeConfig({
    activeProvider: 'Agentik',
    activeModel: 'gemini-3.8-flash-medium',
    modelAliases: { flash: 'agentik/gemini-3.8-flash-medium' },
  });
  assert.equal(activeAliasName(other), 'flash');
  assert.equal(activeAliasName(makeConfig()), null);
});
