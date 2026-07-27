import { AgentToolDeclaration } from '../types';
import { GitWorkspaceService } from '../services/git/git-service';
import { WebContainerRunnerService } from '../services/runtime/webcontainer-runner';
import { XavierMemoryNode } from '../services/memory/xavier-memory-node';

export const AGENT_TOOLS: AgentToolDeclaration[] = [
  {
    name: 'read_file',
    description: 'Read the contents of a specific source file in the project workspace.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path of the file to read, e.g. src/index.ts' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a file with updated or new source code.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path of the file to write' },
        content: { type: 'string', description: 'Complete source code content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'run_command',
    description: 'Execute a shell command (such as npm test, npm install, or node script) inside the headless WebContainer.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command binary, e.g. npm, node, npx' },
        args: { type: 'string', description: 'Space-separated arguments string, e.g. "test --passWithNoTests"' },
      },
      required: ['command'],
    },
  },
  {
    name: 'list_directory',
    description: 'List the files and subdirectories within a project directory.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path of directory to list, leave empty for root' },
      },
    },
  },
  {
    name: 'git_diff',
    description: 'Inspect current uncommitted file modifications and changes in the repository.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'memory_search',
    description: 'Search past agent memory chunks, ADRs, and context from Xavier Memory.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term or architectural query' },
      },
      required: ['query'],
    },
  },
  {
    name: 'complete',
    description: 'Mark the assigned coding task as successfully completed.',
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Comprehensive multi-line summary of code changes and test verification' },
        commitMessage: { type: 'string', description: 'Conventional Git commit message for the changes' },
      },
      required: ['summary', 'commitMessage'],
    },
  },
];

export class AgentToolExecutor {
  public static async executeTool(
    projectName: string,
    toolName: string,
    args: Record<string, any>,
    onLog?: (msg: string) => void
  ): Promise<{ output: string; isComplete?: boolean; summary?: string; commitMessage?: string }> {
    switch (toolName) {
      case 'read_file': {
        const path = args.path as string;
        if (onLog) onLog(`Reading file: ${path}`);
        try {
          const content = await GitWorkspaceService.readFile(projectName, path);
          return { output: content };
        } catch (err: any) {
          return { output: `Error reading file ${path}: ${err.message || err}` };
        }
      }

      case 'write_file': {
        const path = args.path as string;
        const content = args.content as string;
        if (onLog) onLog(`Writing file: ${path}`);
        try {
          await GitWorkspaceService.writeFile(projectName, path, content);
          return { output: `Successfully wrote ${content.length} characters to ${path}` };
        } catch (err: any) {
          return { output: `Error writing file ${path}: ${err.message || err}` };
        }
      }

      case 'run_command': {
        const command = args.command as string;
        const argsStr = (args.args as string) || '';
        const argList = argsStr.split(/\s+/).filter(Boolean);

        if (onLog) onLog(`Executing command: ${command} ${argsStr}`);

        try {
          await WebContainerRunnerService.mountProjectFiles(projectName);
          const res = await WebContainerRunnerService.runCommand(command, argList, (chunk) => {
            if (onLog) onLog(`[stdout] ${chunk.trim()}`);
          });
          return { output: `Exit Code ${res.exitCode}:\n${res.output}` };
        } catch (err: any) {
          return { output: `Command execution error: ${err.message || err}` };
        }
      }

      case 'list_directory': {
        const path = (args.path as string) || '';
        if (onLog) onLog(`Listing directory: ${path || '/'}`);
        const files = await GitWorkspaceService.listDirectory(projectName, path);
        return { output: JSON.stringify(files, null, 2) };
      }

      case 'git_diff': {
        if (onLog) onLog('Calculating Git diff...');
        const diff = await GitWorkspaceService.getDiff(projectName);
        return { output: diff };
      }

      case 'memory_search': {
        const query = args.query as string;
        if (onLog) onLog(`Searching Xavier Memory for: "${query}"`);
        const chunks = await XavierMemoryNode.queryMemory(projectName, query);
        if (chunks.length === 0) {
          return { output: 'No matching memory chunks found in Xavier Node.' };
        }
        return {
          output: chunks.map((c) => `[${c.category.toUpperCase()}] ${c.content}`).join('\n---\n'),
        };
      }

      case 'complete': {
        const summary = args.summary as string;
        const commitMessage = args.commitMessage as string;
        if (onLog) onLog(`Task Completed! ${summary}`);
        return {
          output: summary,
          isComplete: true,
          summary,
          commitMessage,
        };
      }

      default:
        return { output: `Unknown tool: ${toolName}` };
    }
  }
}
