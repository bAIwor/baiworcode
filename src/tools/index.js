import { TOOL_DEFINITIONS } from './definitions.js';
import {
  handleReadFile,
  handleWriteFile,
  handleEditFile,
  handleListDirectory,
  handleRunCommand,
} from './handlers.js';
import { handleSearchFiles } from './searchTool.js';
import { handleTodoList } from './todoTool.js';
import {
  registerTool,
  getDefinitions,
  dispatchTool,
  capToolOutput,
  MAX_TOOL_OUTPUT_CHARS,
  listToolsets,
  clearRegistry,
} from './registry.js';

// Inisialisasi registrasi tools bawaan ke dalam registry
const handlersMap = {
  read_file: { handler: handleReadFile, toolset: 'file', emoji: '📖' },
  write_file: { handler: handleWriteFile, toolset: 'file', emoji: '✏️' },
  edit_file: { handler: handleEditFile, toolset: 'file', emoji: '✂️' },
  list_directory: { handler: handleListDirectory, toolset: 'file', emoji: '📁' },
  run_command: { handler: handleRunCommand, toolset: 'terminal', emoji: '⚡' },
  search_files: { handler: handleSearchFiles, toolset: 'file', emoji: '🔎' },
  todo_list: { handler: handleTodoList, toolset: 'todo', emoji: '📋' },
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
 * @returns {Promise<{ success: boolean, output: string }>}
 */
export async function executeTool(toolName, rawArgs) {
  return await dispatchTool(toolName, rawArgs);
}

export {
  TOOL_DEFINITIONS,
  registerTool,
  getDefinitions,
  dispatchTool,
  capToolOutput,
  MAX_TOOL_OUTPUT_CHARS,
  listToolsets,
  clearRegistry,
  handleSearchFiles,
  handleTodoList,
};
