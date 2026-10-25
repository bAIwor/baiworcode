import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSystemPrompt } from '../src/chat/systemPrompt.js';

test('system prompt menandai keluaran tool sebagai data tidak tepercaya', () => {
  const prompt = getSystemPrompt();
  assert.match(prompt, /DATA TIDAK TEPERCAYA/i);
  assert.match(prompt, /prompt injection/i);
});
