import { TOOL_DEFINITIONS } from './definitions.js';
import {
  handleReadFile,
  handleWriteFile,
  handleEditFile,
  handleListDirectory,
  handleRunCommand,
} from './handlers.js';

export { TOOL_DEFINITIONS };

/**
 * Dispatcher untuk mengeksekusi tool berdasarkan nama dan argumen
 *
 * @param {string} toolName
 * @param {string|Object} rawArgs
 * @returns {Promise<{ success: boolean, output: string }>}
 */
export async function executeTool(toolName, rawArgs) {
  let args = rawArgs;

  if (typeof rawArgs === 'string') {
    try {
      args = JSON.parse(rawArgs);
    } catch {
      return {
        success: false,
        output: `Error: Format argumen JSON untuk ${toolName} tidak valid: ${rawArgs}`,
      };
    }
  }

  args = args || {};

  switch (toolName) {
    case 'read_file':
      return await handleReadFile(args);
    case 'write_file':
      return await handleWriteFile(args);
    case 'edit_file':
      return await handleEditFile(args);
    case 'list_directory':
      return await handleListDirectory(args);
    case 'run_command':
      return await handleRunCommand(args);
    default:
      return {
        success: false,
        output: `Error: Tool '${toolName}' tidak dikenal dalam sistem bAIwor Code.`,
      };
  }
}
