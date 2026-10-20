import { TOOL_DEFINITIONS } from './definitions.js';
import {
  handleReadFile,
  handleWriteFile,
  handleEditFile,
  handlePatchFile,
  handleListDirectory,
  handleRunCommand,
  getBackgroundTask,
  stopBackgroundTask,
  listBackgroundTasks,
  clearBackgroundTasks,
  resolveCommandTimeout,
} from './handlers.js';
import { handleSearchFiles, isHomeDirectory } from './searchTool.js';
import { handleTodoList } from './todoTool.js';
import { handleWebFetch, handleWebSearch, handleWebAutomate } from './webTool.js';
import { handleDiagnostics } from './diagnosticsTool.js';
import { handleDelegateTask, SUBAGENT_ROLES } from './subagentTool.js';
import {
  handleAskUser,
  setQuestionnaireHandler,
  resetQuestionnaireHandler,
} from './questionnaireTool.js';
import {
  requestCommandApproval,
  requestFileChangeApproval,
  setApprovalHandler,
  setFileApprovalHandler,
  resetApprovalHandler,
  resetFileApprovalHandler,
} from './approval.js';
import {
  handleInstaboxExec,
  getInstaboxStatus,
  controlInstabox,
} from './instaboxTool.js';
import { generateVisualDiff } from './diffView.js';
import {
  beginTurnSnapshot,
  commitTurnSnapshot,
  recordFileBeforeChange,
  undoLastTurn,
  redoLastTurn,
  canUndo,
  canRedo,
  clearSnapshots,
  getSnapshotHistory,
} from './snapshot.js';
import {
  registerTool,
  unregisterTool,
  getDefinitions,
  dispatchTool,
  capToolOutput,
  MAX_TOOL_OUTPUT_CHARS,
  defaultReportsDir,
  listToolsets,
  clearRegistry,
} from './registry.js';

// Inisialisasi registrasi tools bawaan ke dalam registry
const handlersMap = {
  read_file: { handler: handleReadFile, toolset: 'file', emoji: '📖' },
  write_file: { handler: handleWriteFile, toolset: 'file', emoji: '✏️' },
  edit_file: { handler: handleEditFile, toolset: 'file', emoji: '✂️' },
  patch_file: { handler: handlePatchFile, toolset: 'file', emoji: '🩹' },
  list_directory: { handler: handleListDirectory, toolset: 'file', emoji: '📁' },
  run_command: { handler: handleRunCommand, toolset: 'terminal', emoji: '⚡' },
  search_files: { handler: handleSearchFiles, toolset: 'file', emoji: '🔎' },
  todo_list: { handler: handleTodoList, toolset: 'todo', emoji: '📋' },
  webfetch: { handler: handleWebFetch, toolset: 'web', emoji: '🌐' },
  websearch: { handler: handleWebSearch, toolset: 'web', emoji: '🔍' },
  webautomate: { handler: handleWebAutomate, toolset: 'web', emoji: '🧭' },
  diagnostics: { handler: handleDiagnostics, toolset: 'quality', emoji: '🩺' },
  delegate_task: { handler: handleDelegateTask, toolset: 'agent', emoji: '🎭' },
  ask_user: { handler: handleAskUser, toolset: 'interactive', emoji: '❓' },
  instabox_exec: { handler: handleInstaboxExec, toolset: 'sandbox', emoji: '☁️' },
};

for (const def of TOOL_DEFINITIONS) {
  const fn = def.function;
  const meta = handlersMap[fn.name] || {};
  registerTool({
    name: fn.name,
    toolset: meta.toolset || 'core',
    emoji: meta.emoji || '⚡',
    schema: {
      description: fn.description,
      parameters: fn.parameters,
    },
    handler: meta.handler,
  });
}

/**
 * Dispatcher untuk mengeksekusi tool berdasarkan nama dan argumen.
 * Menggunakan Tool Registry bAIwor Code.
 *
 * @param {string} toolName
 * @param {string|Object} rawArgs
 * @param {Object} [options] - Opsi runtime (mis. { signal } untuk pembatalan)
 * @returns {Promise<{ success: boolean, output: string }>}
 */
export async function executeTool(toolName, rawArgs, options = {}) {
  return await dispatchTool(toolName, rawArgs, options);
}

export {
  TOOL_DEFINITIONS,
  registerTool,
  unregisterTool,
  getDefinitions,
  dispatchTool,
  capToolOutput,
  MAX_TOOL_OUTPUT_CHARS,
  defaultReportsDir,
  listToolsets,
  clearRegistry,
  handleSearchFiles,
  isHomeDirectory,
  resolveCommandTimeout,
  handleTodoList,
  handleWebFetch,
  handleWebSearch,
  handleWebAutomate,
  handleDiagnostics,
  handleDelegateTask,
  SUBAGENT_ROLES,
  handleAskUser,
  setQuestionnaireHandler,
  resetQuestionnaireHandler,
  getBackgroundTask,
  stopBackgroundTask,
  listBackgroundTasks,
  clearBackgroundTasks,
  handleInstaboxExec,
  getInstaboxStatus,
  controlInstabox,
  generateVisualDiff,
  beginTurnSnapshot,
  commitTurnSnapshot,
  recordFileBeforeChange,
  undoLastTurn,
  redoLastTurn,
  canUndo,
  canRedo,
  clearSnapshots,
  getSnapshotHistory,
  requestCommandApproval,
  requestFileChangeApproval,
  setApprovalHandler,
  setFileApprovalHandler,
  resetApprovalHandler,
  resetFileApprovalHandler,
};
