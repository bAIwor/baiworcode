import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  repairLegacyAssistantReasoning,
  Conversation,
} from '../src/chat/conversation.js';

describe('reasoningRepair: perbaikan sesi lama tanpa reasoning_content', () => {
  it('mengisi reasoning_content kosong hanya pada pesan asisten yang belum punya', () => {
    const messages = [
      { role: 'system', content: 'Sistem' },
      { role: 'user', content: 'Halo' },
      { role: 'assistant', content: 'Halo juga' }, // sesi lama: tanpa reasoning
      { role: 'assistant', content: 'Lanjut', reasoning_content: 'pikiran asli' },
      { role: 'tool', tool_call_id: 'call_1', content: 'hasil' },
    ];

    const repaired = repairLegacyAssistantReasoning(messages);
    assert.equal(repaired, 1);
    assert.equal(messages[2].reasoning_content, ' ');
    // Reasoning asli TIDAK pernah diganggu
    assert.equal(messages[3].reasoning_content, 'pikiran asli');
    // Role lain tidak tersentuh
    assert.equal(messages[0].reasoning_content, undefined);
    assert.equal(messages[1].reasoning_content, undefined);
    assert.equal(messages[4].reasoning_content, undefined);
  });

  it('mengganti reasoning_content string kosong ("" tidak valid) dengan placeholder non-kosong', () => {
    const messages = [
      { role: 'assistant', content: 'A', reasoning_content: '' },
    ];
    const repaired = repairLegacyAssistantReasoning(messages);
    assert.equal(repaired, 1);
    assert.equal(messages[0].reasoning_content, ' ');
  });

  it('tidak menimpa reasoning asli yang sudah terisi', () => {
    const messages = [
      { role: 'assistant', content: 'A', reasoning_content: 'pikiran asli' },
    ];
    const repaired = repairLegacyAssistantReasoning(messages);
    assert.equal(repaired, 0);
    assert.equal(messages[0].reasoning_content, 'pikiran asli');
  });

  it('idempotent — memanggil ulang tidak mengubah apa pun', () => {
    const messages = [{ role: 'assistant', content: 'A' }];
    assert.equal(repairLegacyAssistantReasoning(messages), 1);
    assert.equal(repairLegacyAssistantReasoning(messages), 0);
  });

  it('aman terhadap input tidak wajar', () => {
    assert.equal(repairLegacyAssistantReasoning(null), 0);
    assert.equal(repairLegacyAssistantReasoning(undefined), 0);
    assert.equal(repairLegacyAssistantReasoning('bukan array'), 0);
    assert.equal(repairLegacyAssistantReasoning([null, 42]), 0);
  });

  it('hasil repair ikut dikirim via getMessages() ke payload API', () => {
    const conv = new Conversation();
    conv.messages.push({ role: 'user', content: 'Cek' });
    conv.messages.push({ role: 'assistant', content: 'Respon lama' }); // sesi lama

    const repaired = repairLegacyAssistantReasoning(conv.messages);
    assert.equal(repaired, 1);

    const payload = conv.getMessages();
    const oldAssistant = payload.find((m) => m.role === 'assistant');
    assert.equal(typeof oldAssistant.reasoning_content, 'string');
    assert.ok(oldAssistant.reasoning_content.length > 0, 'placeholder tidak boleh kosong');
  });
});
