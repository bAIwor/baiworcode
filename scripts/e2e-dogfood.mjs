/**
 * E2E Dogfooding Verification Script for bAIwor Code
 *
 * Runs real-world operational scenarios directly against bAIwor's core engines:
 * 1. Snapshot & Undo Engine
 * 2. Visual Diff Generator
 * 3. Self-Healing Diagnostics Loop
 * 4. Hooks System (Pre & Post execution)
 * 5. Goal & Task Management with dependency resolution
 * 6. Workflows Engine (Multi-stage agent pipeline)
 */

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';

// 1. Snapshot & Undo
import {
  beginTurnSnapshot,
  recordFileBeforeChange,
  commitTurnSnapshot,
  undoLastTurn,
  canUndo,
  clearSnapshots,
  getSnapshotHistory
} from '../src/tools/snapshot.js';
import { generateVisualDiff } from '../src/tools/diffView.js';

// 2. Self-Healing
import { findProjectRoot, runSelfHealingDiagnostics, buildAutoRepairPrompt } from '../src/chat/selfHealing.js';

// 3. Hooks
import { HookManager } from '../src/hooks/hookManager.js';

// 4. Goals
import { GoalManager } from '../src/goals/goalManager.js';

// 5. Workflows
import { WorkflowEngine } from '../src/workflows/workflowEngine.js';

const TEST_DIR = path.resolve(process.cwd(), '.dogfood-sandbox');

async function runScenario(name, fn) {
  process.stdout.write(`\n🚀 [TEST SCENARIO] ${name} ... `);
  const start = Date.now();
  try {
    await fn();
    const duration = Date.now() - start;
    console.log(`✅ LULUS (${duration}ms)`);
    return { name, passed: true, duration };
  } catch (err) {
    const duration = Date.now() - start;
    console.log(`❌ GAGAL (${duration}ms): ${err.message}`);
    return { name, passed: false, error: err.message, duration };
  }
}

async function main() {
  console.log('='.repeat(65));
  console.log('  🎭 bAIwor Code — Dogfooding End-to-End Suite');
  console.log('='.repeat(65));

  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_DIR, { recursive: true });

  const results = [];

  // SCENARIO 1: Snapshot & Instant Rollback (/undo)
  results.push(await runScenario('1. Snapshot & Instant Undo Engine', async () => {
    clearSnapshots();
    const testFile = path.join(TEST_DIR, 'app.js');
    fs.writeFileSync(testFile, 'console.log("Versi 1: Awal");\n');

    // Turn 1: Ubah berkas app.js
    beginTurnSnapshot(1);
    recordFileBeforeChange(testFile);
    fs.writeFileSync(testFile, 'console.log("Versi 2: Diedit");\n');
    commitTurnSnapshot();

    assert.strictEqual(fs.readFileSync(testFile, 'utf8'), 'console.log("Versi 2: Diedit");\n');
    assert.strictEqual(canUndo(), true);

    // Turn 2: Buat berkas baru extra.js
    const newFile = path.join(TEST_DIR, 'extra.js');
    beginTurnSnapshot(2);
    recordFileBeforeChange(newFile);
    fs.writeFileSync(newFile, 'export const extra = true;\n');
    commitTurnSnapshot();

    assert.strictEqual(fs.existsSync(newFile), true);

    // Rollback Turn 2 (extra.js harus terhapus)
    const undo2 = undoLastTurn();
    assert.strictEqual(undo2.success, true);
    assert.strictEqual(fs.existsSync(newFile), false, 'File baru harus di-unlink saat rollback');

    // Rollback Turn 1 (app.js harus kembali ke Versi 1)
    const undo1 = undoLastTurn();
    assert.strictEqual(undo1.success, true);
    assert.strictEqual(fs.readFileSync(testFile, 'utf8'), 'console.log("Versi 1: Awal");\n');
  }));

  // SCENARIO 2: Visual Diff Review & ANSI Stats
  results.push(await runScenario('2. Visual ANSI Diff Generator', async () => {
    const oldCode = 'function hitung() {\n  return 10;\n}\n';
    const newCode = 'function hitung() {\n  return 20;\n}\n';

    const diffResult = generateVisualDiff(oldCode, newCode, { filePath: 'math.js', useColor: false });
    assert.ok(diffResult.diffText.includes('return 10;'), 'Harus menandai baris yang dihapus');
    assert.ok(diffResult.diffText.includes('return 20;'), 'Harus menandai baris yang ditambahkan');
    assert.strictEqual(diffResult.additions, 1);
    assert.strictEqual(diffResult.deletions, 1);
    assert.strictEqual(diffResult.hasChanges, true);
  }));

  // SCENARIO 3: Self-Healing Diagnostics Loop
  results.push(await runScenario('3. Self-Healing Diagnostics Loop', async () => {
    const projDir = path.join(TEST_DIR, 'proj-self-healing');
    fs.mkdirSync(projDir, { recursive: true });

    // Buat package.json dengan script check tiruan
    fs.writeFileSync(path.join(projDir, 'package.json'), JSON.stringify({
      name: 'test-heal',
      scripts: {
        check: 'node -e "if(require(\'fs\').readFileSync(\'bad.js\',\'utf8\').includes(\'ERROR\')) process.exit(1)"'
      }
    }, null, 2));

    const badFile = path.join(projDir, 'bad.js');
    fs.writeFileSync(badFile, '// ERROR syntax\n');

    // Uji deteksi root
    const root = findProjectRoot([badFile]);
    assert.strictEqual(path.resolve(root), path.resolve(projDir));

    // Jalankan diagnostik - harus gagal karena ada ERROR
    const diagFail = await runSelfHealingDiagnostics([badFile]);
    assert.strictEqual(diagFail.passed, false, 'Diagnostik harus gagal saat ada error');

    // Bangun auto repair prompt: buildAutoRepairPrompt(retryCount, diagnosticOutput, errors, maxRetries)
    const repairPrompt = buildAutoRepairPrompt(0, diagFail.output, diagFail.errors, 2);
    assert.ok(repairPrompt.includes('retry 1/2'), 'Harus memuat info retry 1/2');

    // Perbaiki berkas
    fs.writeFileSync(badFile, '// KODE BERSIH\n');
    const diagPass = await runSelfHealingDiagnostics([badFile]);
    assert.strictEqual(diagPass.passed, true, 'Diagnostik harus lulus setelah diperbaiki');
  }));

  // SCENARIO 4: Hooks System (Pre & Post execution)
  results.push(await runScenario('4. Event-Driven Hooks System', async () => {
    const hookConfigPath = path.join(TEST_DIR, 'test-hooks.json');
    const hookManager = new HookManager({ configPath: hookConfigPath });

    // Tambah pre-hook yang memblokir jika toolName === 'rm_forbidden'
    hookManager.addHook({
      event: 'pre-tool-execute',
      command: 'node -e "process.exit(1)"',
      condition: "toolName === 'rm_forbidden'",
      description: 'Blokir tool terlarang'
    });

    // Uji blokir
    const preBlocked = await hookManager.triggerPreToolExecute('rm_forbidden', {});
    assert.strictEqual(preBlocked.allowed, false, 'Pre-hook harus memblokir rm_forbidden');

    // Uji izin untuk tool lain
    const preAllowed = await hookManager.triggerPreToolExecute('read_file', {});
    assert.strictEqual(preAllowed.allowed, true, 'Pre-hook harus meloloskan read_file');

    // Tambah post-hook
    const logFile = path.join(TEST_DIR, 'post-hook.log');
    hookManager.addHook({
      event: 'post-tool-execute',
      command: `node -e "require('fs').writeFileSync('${logFile.replace(/\\/g, '/')}', 'POST_HOOK_FIRED')"`,
      description: 'Catat post tool'
    });

    await hookManager.triggerPostToolExecute('read_file', {}, { success: true, output: 'ok' });
    assert.ok(fs.existsSync(logFile), 'Post-hook harus menulis berkas log');
    assert.strictEqual(fs.readFileSync(logFile, 'utf8'), 'POST_HOOK_FIRED');
  }));

  // SCENARIO 5: Goal & Task Management with Dependencies
  results.push(await runScenario('5. Goal & Task Dependency Resolution', async () => {
    const goalStorage = path.join(TEST_DIR, 'goals.json');
    const gm = new GoalManager({ storagePath: goalStorage });

    const goal = gm.createGoal('Refactor Database Layer', { maxTurns: 10 });
    assert.strictEqual(goal.objective, 'Refactor Database Layer');
    assert.strictEqual(goal.maxTurns, 10);

    const task1 = gm.createTask('Setup Schema Migrations', 'Buat schema migration files', { goalId: goal.id });
    const task2 = gm.createTask('Run Migrations on Sandbox', 'Terapkan migrasi di db sandbox', { goalId: goal.id });
    const task3 = gm.createTask('Verify Connection Pool', 'Cek performa pooling', { goalId: goal.id });

    // Task 1 blocks Task 2, Task 2 blocks Task 3
    gm.addDependency(task1.id, task2.id);
    gm.addDependency(task2.id, task3.id);

    // Saat awal, hanya Task 1 yang available
    let available = gm.getAvailableTasks();
    assert.strictEqual(available.length, 1);
    assert.strictEqual(available[0].id, task1.id);

    // Selesaikan Task 1
    gm.completeTask(task1.id);

    // Sekarang Task 2 harus unblock dan available
    available = gm.getAvailableTasks();
    assert.strictEqual(available.length, 1);
    assert.strictEqual(available[0].id, task2.id);

    // Selesaikan Task 2
    gm.completeTask(task2.id);

    // Sekarang Task 3 harus unblock
    available = gm.getAvailableTasks();
    assert.strictEqual(available.length, 1);
    assert.strictEqual(available[0].id, task3.id);

    // Selesaikan Task 3
    gm.completeTask(task3.id);

    // Update goal
    gm.updateGoalStatus(goal.id, 'completed');
    const updatedGoal = gm.getGoal(goal.id);
    assert.strictEqual(updatedGoal.status, 'completed');
  }));

  // SCENARIO 6: Workflows Engine Multi-Stage Pipeline
  results.push(await runScenario('6. Workflows Engine Multi-Stage Pipeline', async () => {
    const wfDir = path.join(TEST_DIR, 'workflows');
    fs.mkdirSync(wfDir, { recursive: true });
    const engine = new WorkflowEngine({ workflowsDir: wfDir });

    const code = `
export const meta = { name: 'sample-pipeline', description: 'Testing pipeline execution' };
export default async function({ pipeline, phase }) {
  const step1 = await phase('Persiapan', async () => 'DATA_MENTAH');
  const step2 = await pipeline(
    [step1],
    async (item) => item.toLowerCase()
  );
  return { status: 'DONE', processed: step2 };
}
`;
    fs.writeFileSync(path.join(wfDir, 'sample-pipeline.js'), code);
    await engine.loadWorkflows();

    const result = await engine.run('sample-pipeline');
    assert.strictEqual(result.success, true, result.output);
    assert.strictEqual(result.output.status, 'DONE');
    assert.deepStrictEqual(result.output.processed, ['data_mentah']);
    assert.strictEqual(result.log.length >= 2, true);
  }));

  // Bersihkan folder sandbox
  fs.rmSync(TEST_DIR, { recursive: true, force: true });

  console.log('\n' + '='.repeat(65));
  const allPassed = results.every(r => r.passed);
  console.log(`  🎉 HASIL DOGFOODING: ${results.filter(r => r.passed).length}/${results.length} Skenario LULUS`);
  console.log('='.repeat(65));

  if (!allPassed) process.exit(1);
}

main().catch((err) => {
  console.error('\nDogfooding Runner Crash:', err);
  process.exit(1);
});
