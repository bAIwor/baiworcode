import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  summarizeTodos,
  shouldInjectTodoReminder,
  getTodoReminderInterval,
  buildTodoReminder,
  DEFAULT_TODO_REMINDER_INTERVAL,
  shouldInjectPlanningNudge,
  getPlanNudgeThreshold,
  buildPlanningReminder,
  DEFAULT_PLAN_NUDGE_TOOL_CALLS,
} from '../src/chat/todoReminder.js';
import { todoStore, resetTodoStore } from '../src/tools/todoTool.js';

describe('todoReminder: pengingat penyelesaian tugas (adaptasi mcode)', () => {
  it('summarizeTodos menghitung aktif/selesai/dibatalkan', () => {
    const s = summarizeTodos([
      { status: 'completed' },
      { status: 'pending' },
      { status: 'in_progress' },
      { status: 'cancelled' },
    ]);
    assert.deepEqual(s, { total: 4, completed: 1, cancelled: 1, active: 2 });
    assert.deepEqual(summarizeTodos(null), { total: 0, completed: 0, cancelled: 0, active: 0 });
  });

  it('getTodoReminderInterval membaca env dengan fallback yang aman', () => {
    assert.equal(getTodoReminderInterval({}), DEFAULT_TODO_REMINDER_INTERVAL);
    assert.equal(getTodoReminderInterval({ BAIWOR_TODO_REMINDER_INTERVAL: '3' }), 3);
    assert.equal(
      getTodoReminderInterval({ BAIWOR_TODO_REMINDER_INTERVAL: '0' }),
      DEFAULT_TODO_REMINDER_INTERVAL
    );
    assert.equal(
      getTodoReminderInterval({ BAIWOR_TODO_REMINDER_INTERVAL: 'abc' }),
      DEFAULT_TODO_REMINDER_INTERVAL
    );
  });

  it('shouldInjectTodoReminder menagih tiap kelipatan interval', () => {
    assert.equal(shouldInjectTodoReminder(0, 5), false);
    assert.equal(shouldInjectTodoReminder(1, 5), false);
    assert.equal(shouldInjectTodoReminder(4, 5), false);
    assert.equal(shouldInjectTodoReminder(5, 5), true);
    assert.equal(shouldInjectTodoReminder(10, 5), true);
    // interval tidak valid -> jatuh ke bawaan
    assert.equal(shouldInjectTodoReminder(2, 0), false);
  });

  it('buildTodoReminder memuat tag dan angka yang benar', () => {
    const text = buildTodoReminder({ total: 5, active: 2, completed: 2, cancelled: 1 });
    assert.ok(text.startsWith('<task-completion-reminder>'));
    assert.ok(text.endsWith('</task-completion-reminder>'));
    assert.ok(text.includes('2/5 aktif'));
    assert.ok(text.includes('2 selesai'));
    assert.ok(text.includes('1 dibatalkan'));
    assert.ok(/jangan menyatakan tugas tuntas/i.test(text));
  });
});

describe('Penegakan perencanaan: nudge `todo_list` (adaptasi todowrite mcode)', () => {
  it('getPlanNudgeThreshold membaca env dengan fallback aman', () => {
    assert.equal(getPlanNudgeThreshold({}), DEFAULT_PLAN_NUDGE_TOOL_CALLS);
    assert.equal(getPlanNudgeThreshold({ BAIWOR_PLAN_NUDGE_TOOL_CALLS: '3' }), 3);
    assert.equal(
      getPlanNudgeThreshold({ BAIWOR_PLAN_NUDGE_TOOL_CALLS: '0' }),
      DEFAULT_PLAN_NUDGE_TOOL_CALLS
    );
    assert.equal(
      getPlanNudgeThreshold({ BAIWOR_PLAN_NUDGE_TOOL_CALLS: 'bukan-angka' }),
      DEFAULT_PLAN_NUDGE_TOOL_CALLS
    );
  });

  it('TIDAK menegur pada putaran awal (tool belum menumpuk)', () => {
    assert.equal(shouldInjectPlanningNudge({ toolCalls: 0, lastNudgeAt: 0, threshold: 5 }), false);
    assert.equal(shouldInjectPlanningNudge({ toolCalls: 4, lastNudgeAt: 0, threshold: 5 }), false);
  });

  it('menegur tepat saat ambang terlewati, lalu berulang tiap kelipatan', () => {
    assert.equal(shouldInjectPlanningNudge({ toolCalls: 5, lastNudgeAt: 0, threshold: 5 }), true);
    // Sudah ditegur di 5 → belum menegur lagi sampai 10.
    assert.equal(shouldInjectPlanningNudge({ toolCalls: 7, lastNudgeAt: 5, threshold: 5 }), false);
    assert.equal(shouldInjectPlanningNudge({ toolCalls: 10, lastNudgeAt: 5, threshold: 5 }), true);
  });

  it('buildPlanningReminder memuat tag, jumlah tool, dan perintah wajib', () => {
    const text = buildPlanningReminder({ toolCalls: 7 });
    assert.ok(text.startsWith('<planning-reminder>'));
    assert.ok(text.endsWith('</planning-reminder>'));
    assert.ok(text.includes('7 panggilan tool'));
    assert.ok(text.includes('todo_list'));
    assert.ok(/in_progress/.test(text));
  });
});

describe('TodoStore.clearSettled: auto-bersih daftar yang sudah tuntas', () => {
  beforeEach(() => resetTodoStore());

  it('menghapus daftar bila semua item completed/cancelled', () => {
    todoStore.write([
      { id: '1', content: 'A', status: 'completed' },
      { id: '2', content: 'B', status: 'cancelled' },
    ]);
    assert.equal(todoStore.clearSettled(), true);
    assert.equal(todoStore.read().length, 0);
  });

  it('TIDAK menghapus daftar bila masih ada item aktif', () => {
    todoStore.write([
      { id: '1', content: 'A', status: 'completed' },
      { id: '2', content: 'B', status: 'pending' },
    ]);
    assert.equal(todoStore.clearSettled(), false);
    assert.equal(todoStore.read().length, 2);
  });

  it('tidak melakukan apa-apa pada daftar kosong', () => {
    assert.equal(todoStore.clearSettled(), false);
    assert.equal(todoStore.read().length, 0);
  });
});
