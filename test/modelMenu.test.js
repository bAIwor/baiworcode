import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { modelsEndpoint } from '../src/modelMenu.js';

describe('Model Menu: Normalisasi Endpoint /models', () => {
  it('menambahkan /models pada base URL biasa', () => {
    assert.equal(
      modelsEndpoint('https://api.example.com/v1'),
      'https://api.example.com/v1/models'
    );
  });

  it('membuang /chat/completions yang ditempel pengguna', () => {
    assert.equal(
      modelsEndpoint('https://api.example.com/v1/chat/completions'),
      'https://api.example.com/v1/models'
    );
  });

  it('tidak menggandakan /models', () => {
    assert.equal(
      modelsEndpoint('https://api.example.com/v1/models'),
      'https://api.example.com/v1/models'
    );
  });

  it('membuang /responses yang ditempel pengguna', () => {
    assert.equal(
      modelsEndpoint('https://api.example.com/v1/responses'),
      'https://api.example.com/v1/models'
    );
  });

  it('menormalkan spasi dan slash berlebih', () => {
    assert.equal(
      modelsEndpoint('  https://api.example.com/v1///  '),
      'https://api.example.com/v1/models'
    );
  });

  it('tetap menghasilkan endpoint yang masuk akal untuk input kosong', () => {
    assert.equal(modelsEndpoint(''), '/models');
    assert.equal(modelsEndpoint(undefined), '/models');
  });
});
