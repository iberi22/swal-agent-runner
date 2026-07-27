import { CodingTask, TaskStep } from '../types';
import { LLMProviderManager } from '../services/llm/llm-provider-manager';
import { AGENT_TOOLS, AgentToolExecutor } from './agent-tools';
import { GitWorkspaceService } from '../services/git/git-service';
import { XavierMemoryNode } from '../services/memory/xavier-memory-node';
import { EdgeMeshSyncService } from '../services/memory/edge-mesh-sync';

const AGENT_SYSTEM_PROMPT = `You are SWAL Headless Agent Runner, an autonomous coding agent operating inside a browser PWA WebContainer.
Your goal is to complete the assigned coding task independently without requiring interactive user terminal/editor input.

Rules:
1. Always inspect relevant project files first using read_file or list_directory.
2. Edit or create files using write_file.
3. Test your code changes using run_command (e.g. command: "npm", args: "test").
4. When all requirements are met and tests pass, call the complete tool with a full summary and commit message.
5. Keep your actions precise, effective, and clean. Do not leave temporary broken files.`;

export class AgentLoopRunner {
  public static async runTask(
    task: CodingTask,
    onTaskUpdate: (updatedTask: CodingTask) => void
  ): Promise<CodingTask> {
    const updated: CodingTask = { ...task, status: 'planning', steps: [...task.steps] };
    onTaskUpdate(updated);

    const logStep = (
      phase: TaskStep['phase'],
      summary: string,
      status: TaskStep['status'] = 'success',
      toolUsed?: string,
      snippet?: string
    ) => {
      const step: TaskStep = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        phase,
        actionSummary: summary,
        status,
        toolUsed,
        outputSnippet: snippet,
      };
      updated.steps.push(step);
      onTaskUpdate({ ...updated });
    };

    try {
      logStep('plan', `Initializing autonomous agent loop for project "${task.projectId}"`);

      // Load initial memory context
      const memoryContext = await XavierMemoryNode.queryMemory(task.projectId, task.prompt, 3);
      let memorySummary = '';
      if (memoryContext.length > 0) {
        memorySummary = `\nRelevant Xavier Memory Context:\n${memoryContext.map(m => `- ${m.content}`).join('\n')}\n`;
        logStep('memory', `Loaded ${memoryContext.length} contextual memory chunks from Xavier Node`);
      }

      // Check if git branch needs to be created
      try {
        await GitWorkspaceService.createBranch(task.projectId, task.targetBranch);
        logStep('git', `Checked out target branch: ${task.targetBranch}`);
      } catch {
        // Branch might already exist
      }

      const conversationHistory: { role: 'user' | 'assistant' | 'model'; content: string }[] = [
        {
          role: 'user',
          content: `Task: ${task.prompt}\nTarget Branch: ${task.targetBranch}${memorySummary}`,
        },
      ];

      const activeProvider = LLMProviderManager.getActiveProvider();
      updated.status = 'executing';
      onTaskUpdate({ ...updated });

      let iteration = 0;
      const MAX_ITERATIONS = 20;

      while (iteration < MAX_ITERATIONS) {
        iteration++;

        logStep('plan', `Iteration ${iteration}/${MAX_ITERATIONS}: Querying LLM provider (${activeProvider.name})`);

        const response = await LLMProviderManager.executeAgentStep(
          AGENT_SYSTEM_PROMPT,
          conversationHistory,
          AGENT_TOOLS,
          activeProvider
        );

        if (response.text) {
          conversationHistory.push({ role: 'assistant', content: response.text });
        }

        if (response.toolCalls.length === 0) {
          // If model returned text without tool calls, remind it to use tools or complete
          conversationHistory.push({
            role: 'user',
            content: 'Please proceed with reading/writing files or executing tests via tool calls, or call complete when finished.',
          });
          continue;
        }

        for (const toolCall of response.toolCalls) {
          logStep('exec', `Invoking tool: ${toolCall.name}`, 'success', toolCall.name);

          const result = await AgentToolExecutor.executeTool(
            task.projectId,
            toolCall.name,
            toolCall.arguments,
            (logMsg) => {
              logStep('exec', logMsg, 'success', toolCall.name);
            }
          );

          conversationHistory.push({
            role: 'user',
            content: `Tool Result [${toolCall.name}]:\n${result.output}`,
          });

          if (result.isComplete) {
            logStep('verify', `Agent marked task as complete: ${result.summary}`);

            // Commit changes to Git
            const commitMessage = result.commitMessage || `feat: ${task.prompt.slice(0, 50)}`;
            const sha = await GitWorkspaceService.commitChanges(task.projectId, commitMessage);
            logStep('git', `Committed changes with SHA: ${sha.slice(0, 8)}`);

            // Store completion memory chunk in Xavier Node
            const memoryChunk = await XavierMemoryNode.storeChunk({
              projectId: task.projectId,
              category: 'episodic',
              content: `Task Completed: ${task.prompt}\nSummary: ${result.summary}\nCommit SHA: ${sha}`,
              source: 'swal-agent-runner',
            });
            logStep('memory', `Saved episodic task memory chunk (${memoryChunk.id.slice(0, 8)}) to Xavier Node`);

            // Trigger real-time sync with master PC node if online
            EdgeMeshSyncService.performRealtimeSync().then((syncRes) => {
              if (syncRes.syncedCount > 0) {
                logStep('memory', `Real-time paired sync: Transferred ${syncRes.syncedCount} chunks to primary PC Xavier node`);
              }
            });

            const finalDiff = await GitWorkspaceService.getDiff(task.projectId);

            updated.status = 'completed';
            updated.completedAt = Date.now();
            updated.result = {
              success: true,
              summary: result.summary || 'Task completed successfully.',
              diffSummary: finalDiff,
              changedFiles: [],
              branchName: task.targetBranch,
              commitHash: sha,
            };

            onTaskUpdate({ ...updated });
            return updated;
          }
        }
      }

      throw new Error(`Agent exceeded maximum iteration limit (${MAX_ITERATIONS}).`);
    } catch (err: any) {
      updated.status = 'failed';
      updated.error = err.message || String(err);
      logStep('verify', `Agent task failed: ${updated.error}`, 'error');
      onTaskUpdate({ ...updated });
      return updated;
    }
  }
}
