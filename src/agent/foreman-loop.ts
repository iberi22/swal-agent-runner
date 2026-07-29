import { CodingTask, TaskStep, AgentToolDeclaration, AgentToolCall } from '../types';
import { LLMProviderManager } from '../services/llm/llm-provider-manager';
import { AgentLoopRunner } from './agent-loop';
import { GitWorkspaceService } from '../services/git/git-service';
import { XavierMemoryNode } from '../services/memory/xavier-memory-node';
import { EdgeMeshSyncService } from '../services/memory/edge-mesh-sync';
import { edgeMeshClient } from '../services/mesh/edge-mesh-client';

// ── Types ──────────────────────────────────────────────────────────

/**
 * Specification for a single sub-agent within a Foreman wave.
 * Mirrors Gestalt's AgentSpec proto shape.
 *
 * @property id - Unique agent identifier
 * @property task - Description of the coding task to execute
 * @property targetBranch - Git branch for this agent's changes
 * @property model - Optional model override for this sub-agent
 * @property dependencies - Optional list of agent IDs that must complete first
 * @property providerType - Optional override provider type for this sub-agent
 */
export interface AgentSpec {
  id: string;
  task: string;
  targetBranch: string;
  model?: string;
  dependencies?: string[];
  /** Optional override provider type for this sub-agent */
  providerType?: string;
}

/**
 * Result produced by a single sub-agent execution.
 *
 * @property agentId - Unique identifier of the sub-agent
 * @property task - The original task description
 * @property success - Whether the agent completed successfully
 * @property summary - Human-readable summary of the agent's work
 * @property branchName - Git branch used by this agent
 * @property commitHash - Optional hash of the final commit
 * @property changedFiles - List of files modified by the agent
 * @property error - Optional error message if the agent failed
 * @property steps - Steps logged by the sub-agent during execution
 */
export interface AgentResult {
  agentId: string;
  task: string;
  success: boolean;
  summary: string;
  branchName: string;
  commitHash?: string;
  changedFiles: string[];
  error?: string;
  /** Steps logged by the sub-agent during execution */
  steps: TaskStep[];
}

/**
 * Aggregate result from a Foreman multi-agent wave.
 *
 * @property success - Whether all sub-agents completed successfully
 * @property summary - Human-readable summary of the entire wave
 * @property agentResults - Individual results from each sub-agent
 * @property branchName - The target branch after merging
 * @property commitHash - Optional hash of the final merge commit
 * @property changedFiles - Union of all files changed by sub-agents
 * @property mergeConflicts - Optional list of merge conflict descriptions
 */
export interface ForemanResult {
  success: boolean;
  summary: string;
  agentResults: AgentResult[];
  branchName: string;
  commitHash?: string;
  changedFiles: string[];
  mergeConflicts?: string[];
}

/**
 * Decomposition output from the LLM.
 */
interface SubTaskDecomposition {
  id: string;
  task: string;
  explanation: string;
}

// ── System Prompt for Task Decomposition ───────────────────────────

const FOREMAN_DECOMPOSE_PROMPT = `You are SWAL Foreman, a multi-agent orchestrator. Your job is to decompose a complex coding task into up to 5 independent sub-tasks that can be executed in parallel by separate AI coding agents.

Rules:
1. Each sub-task must be self-contained with a clear deliverable.
2. Sub-tasks should have MINIMAL dependencies on each other — agents run in parallel.
3. Each sub-task must map to a specific area of the codebase (files, modules, features).
4. A sub-task must be completable in a single agent session (max ~20 tool-call iterations).
5. If the task is simple enough for a single agent, return exactly one sub-task.
6. Return ONLY valid JSON — no preamble, no explanation outside the JSON.

Output format:
[
  {
    "id": "agent-1",
    "task": "Full description of what this sub-agent should implement, including specific files to create/modify",
    "explanation": "Why this decomposition makes sense"
  }
]`;

// ── Helper Constants ─────────────────────────────────────────────

const MAX_SUB_AGENTS = 5;
const MAX_DECOMPOSE_RETRIES = 2;

// ── ForemanAgentLoop ─────────────────────────────────────────────

/**
 * Multi-agent orchestrator that:
 * 1. Decomposes a large CodingTask into up to 5 AgentSpecs
 * 2. Launches each sub-agent via AgentLoopRunner in parallel
 * 3. Each sub-agent works on its own git branch
 * 4. Merges all branches back upon completion
 * 5. Publishes Foreman lifecycle events via CrdtEventBus
 *
 * Backward compatible: single-agent execution via .runSingleAgent()
 * mirrors the original AgentLoopRunner interface.
 */
export class ForemanAgentLoop {
  /**
   * Run a task through the Foreman orchestrator.
   *
   * If the task is small or decomposition returns a single agent,
   * delegates directly to AgentLoopRunner for backward compatibility.
   * Otherwise runs the full multi-agent wave.
   *
   * @param task - The coding task to decompose and execute
   * @param onTaskUpdate - Callback fired on every state change or step addition
   * @returns The updated CodingTask with Foreman wave results
   * @throws {Error} If the wave encounters an unrecoverable error
   */
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

    const publishEvent = async (type: string, payload: Record<string, unknown> = {}) => {
      try {
        const bus = await edgeMeshClient.crdtEventBus;
        bus.publish({ type, source: 'foreman-loop', payload });
      } catch {
        /* P2P event bus not available */
      }
    };

    try {
      publishEvent('foreman:started', { taskId: task.id, title: task.title });
      publishEvent('foreman:phase', { phase: 'decomposing' });
      logStep('plan', 'Foreman: decomposing task into sub-agent specifications');

      // ── Phase 1: Decompose task ────────────────────────────────
      const agentSpecs = await this.decomposeTask(task);
      publishEvent('foreman:decomposed', {
        taskId: task.id,
        agentCount: agentSpecs.length,
        agents: agentSpecs.map(a => ({ id: a.id, task: a.task, branch: a.targetBranch })),
      });

      // Single-agent shortcut for backward compatibility
      if (agentSpecs.length <= 1) {
        logStep('plan', 'Foreman: task requires only one agent — delegating to AgentLoopRunner');
        publishEvent('foreman:phase', { phase: 'delegating-single' });
        return await AgentLoopRunner.runTask(task, onTaskUpdate);
      }

      logStep('plan', `Foreman: decomposed into ${agentSpecs.length} sub-agents: ${agentSpecs.map(a => a.id).join(', ')}`);
      updated.status = 'executing';
      onTaskUpdate({ ...updated });
      publishEvent('foreman:phase', { phase: 'dispatching', agentCount: agentSpecs.length });

      // ── Phase 2: Dispatch sub-agents in parallel ──────────────
      const agentResults = await this.executeSubAgents(task, agentSpecs, logStep, publishEvent);

      publishEvent('foreman:phase', { phase: 'merging' });
      logStep('git', 'Foreman: merging sub-agent branches back to target branch');

      // ── Phase 3: Merge branches ───────────────────────────────
      const mergeResult = await this.mergeSubAgentBranches(task.projectId, task.targetBranch, agentResults, logStep);

      // ── Phase 4: Store memory and finalize ────────────────────
      const successfulAgents = agentResults.filter(r => r.success);
      const failedAgents = agentResults.filter(r => !r.success);

      const foremanSummaryLines: string[] = [
        `Foreman completed wave with ${successfulAgents.length}/${agentSpecs.length} successful agents`,
      ];
      for (const r of agentResults) {
        foremanSummaryLines.push(`  ${r.agentId}: ${r.success ? '✓' : '✗'} ${r.summary.slice(0, 120)}`);
      }

      const foremanSummary = foremanSummaryLines.join('\n');

      // Store episodic memory chunk
      await XavierMemoryNode.storeChunk({
        projectId: task.projectId,
        category: 'episodic',
        content: `Foreman Wave Completed: ${task.prompt}\nSummary: ${foremanSummary}`,
        source: 'swal-agent-runner',
      });

      // Trigger real-time sync
      EdgeMeshSyncService.performRealtimeSync().then((syncRes) => {
        if (syncRes.syncedCount > 0) {
          logStep('memory', `Foreman: real-time sync transferred ${syncRes.syncedCount} chunks`);
        }
      });

      const allChangedFiles = Array.from(new Set(agentResults.flatMap(r => r.changedFiles)));

      updated.status = 'completed';
      updated.completedAt = Date.now();
      updated.result = {
        success: failedAgents.length === 0,
        summary: foremanSummary,
        diffSummary: mergeResult.diffSummary || 'Multi-agent wave completed.',
        changedFiles: allChangedFiles,
        branchName: task.targetBranch,
        commitHash: mergeResult.commitHash,
      };

      publishEvent('foreman:completed', {
        taskId: task.id,
        success: updated.result.success,
        summary: foremanSummary,
        agentCount: agentSpecs.length,
        successfulCount: successfulAgents.length,
        failedCount: failedAgents.length,
        mergeConflicts: mergeResult.conflicts,
      });

      onTaskUpdate({ ...updated });
      return updated;
    } catch (err: any) {
      updated.status = 'failed';
      updated.error = err.message || String(err);
      logStep('verify', `Foreman: wave failed — ${updated.error}`, 'error');
      publishEvent('foreman:failed', { taskId: task.id, error: updated.error });
      onTaskUpdate({ ...updated });
      return updated;
    }
  }

  /**
   * Single-agent execution — backward compatible alias for AgentLoopRunner.
   * Useful when callers want the Foreman API but don't need multi-agent decomposition.
   *
   * @param task - The coding task to execute
   * @param onTaskUpdate - Callback fired on every state change or step addition
   * @returns The updated CodingTask with agent results
   */
  public static async runSingleAgent(
    task: CodingTask,
    onTaskUpdate: (updatedTask: CodingTask) => void
  ): Promise<CodingTask> {
    return await AgentLoopRunner.runTask(task, onTaskUpdate);
  }

  // ── Private Helpers ────────────────────────────────────────────

  /**
   * Decompose a CodingTask into AgentSpecs via LLM.
   * Falls back to a single AgentSpec if the LLM fails to produce valid output.
   */
  private static async decomposeTask(task: CodingTask): Promise<AgentSpec[]> {
    let lastError: string | null = null;

    for (let attempt = 0; attempt <= MAX_DECOMPOSE_RETRIES; attempt++) {
      try {
        const activeProvider = LLMProviderManager.getActiveProvider();

        const decomposeHistory: { role: 'user' | 'assistant' | 'model'; content: string }[] = [
          {
            role: 'user',
            content: `Project: ${task.projectId}\nTask: ${task.prompt}\n\nDecompose this into sub-tasks that can run in parallel on separate git branches. Return ONLY a JSON array of sub-tasks.`,
          },
        ];

        if (lastError) {
          decomposeHistory.push({
            role: 'assistant',
            content: `Previous attempt failed with JSON parse error: ${lastError}. Please fix the JSON output.`,
          });
        }

        const response = await LLMProviderManager.executeAgentStep(
          FOREMAN_DECOMPOSE_PROMPT,
          decomposeHistory,
          [] // No tools for decomposition — pure LLM
        );

        const jsonText = this.extractJSON(response.text || '[]');
        const subtasks: SubTaskDecomposition[] = JSON.parse(jsonText);

        if (!Array.isArray(subtasks) || subtasks.length === 0) {
          throw new Error('LLM returned empty or invalid decomposition array');
        }

        // Cap at MAX_SUB_AGENTS
        const capped = subtasks.slice(0, MAX_SUB_AGENTS);

        // Convert to AgentSpecs with generated branch names
        return capped.map((st, idx) => ({
          id: st.id || `agent-${idx + 1}`,
          task: st.task,
          targetBranch: `${task.targetBranch}/sub/${st.id || `agent-${idx + 1}`}`,
          model: task.modelName,
        }));
      } catch (err: any) {
        lastError = err.message || String(err);
      }
    }

    // Fallback: single-agent spec
    return [
      {
        id: 'agent-1',
        task: task.prompt,
        targetBranch: task.targetBranch,
        model: task.modelName,
      },
    ];
  }

  /**
   * Execute all sub-agents in parallel via AgentLoopRunner.
   * Each sub-agent gets its own CodingTask with a dedicated branch.
   */
  private static async executeSubAgents(
    parentTask: CodingTask,
    specs: AgentSpec[],
    logStep: (phase: TaskStep['phase'], summary: string, status?: TaskStep['status'], toolUsed?: string, snippet?: string) => void,
    publishEvent: (type: string, payload?: Record<string, unknown>) => void
  ): Promise<AgentResult[]> {
    // Create sub-agent tasks
    const subTasks: { spec: AgentSpec; task: CodingTask }[] = specs.map((spec) => ({
      spec,
      task: {
        id: crypto.randomUUID(),
        projectId: parentTask.projectId,
        title: `[${spec.id}] ${spec.task.slice(0, 80)}`,
        prompt: spec.task,
        targetBranch: spec.targetBranch,
        status: 'pending' as const,
        createdAt: Date.now(),
        providerType: parentTask.providerType,
        modelName: spec.model || parentTask.modelName,
        steps: [],
      } as CodingTask,
    }));

    // Publish dispatch events
    for (const { spec } of subTasks) {
      logStep('plan', `Foreman: dispatching sub-agent ${spec.id} on branch ${spec.targetBranch}`);
      publishEvent('agent:dispatched', {
        taskId: parentTask.id,
        agentId: spec.id,
        task: spec.task,
        branch: spec.targetBranch,
      });
    }

    // Launch all in parallel (Promise.allSettled so one failure doesn't block others)
    const results = await Promise.allSettled(
      subTasks.map(async ({ spec, task }) => {
        // Create branch for this sub-agent
        try {
          await GitWorkspaceService.createBranch(task.projectId, task.targetBranch);
        } catch {
          // Branch may already exist — proceed
        }

        // Run the agent loop
        const result = await AgentLoopRunner.runTask(task, (_updated) => {
          // Forward progress events from the sub-agent
          publishEvent('agent:progress', {
            taskId: parentTask.id,
            agentId: spec.id,
            status: _updated.status,
            stepCount: _updated.steps.length,
          });
        });

        return { spec, result };
      })
    );

    // Collect results
    const agentResults: AgentResult[] = [];

    for (let i = 0; i < results.length; i++) {
      const settled = results[i];
      const { spec } = subTasks[i];

      if (settled.status === 'fulfilled') {
        const { result } = settled.value;
        const success = result.status === 'completed' && result.result?.success !== false;

        agentResults.push({
          agentId: spec.id,
          task: spec.task,
          success,
          summary: result.result?.summary || (success ? 'Completed' : 'Failed'),
          branchName: spec.targetBranch,
          commitHash: result.result?.commitHash,
          changedFiles: result.result?.changedFiles || [],
          error: result.error,
          steps: result.steps,
        });

        publishEvent('agent:completed', {
          taskId: parentTask.id,
          agentId: spec.id,
          success,
          summary: result.result?.summary || '',
          branch: spec.targetBranch,
          commitHash: result.result?.commitHash,
        });

        logStep(
          'verify',
          `Foreman: sub-agent ${spec.id} ${success ? 'completed' : 'failed'}: ${(result.result?.summary || '').slice(0, 100)}`,
          success ? 'success' : 'error',
          undefined,
          success ? undefined : result.error
        );
      } else {
        const errorMsg = settled.reason?.message || String(settled.reason);
        agentResults.push({
          agentId: spec.id,
          task: spec.task,
          success: false,
          summary: `Agent execution threw: ${errorMsg}`,
          branchName: spec.targetBranch,
          changedFiles: [],
          error: errorMsg,
          steps: [],
        });

        publishEvent('agent:completed', {
          taskId: parentTask.id,
          agentId: spec.id,
          success: false,
          error: errorMsg,
          branch: spec.targetBranch,
        });

        logStep('verify', `Foreman: sub-agent ${spec.id} threw — ${errorMsg}`, 'error');
      }
    }

    return agentResults;
  }

  /**
   * Merge all sub-agent branches back into the main target branch.
   * Reports any conflicts without failing the entire wave.
   */
  private static async mergeSubAgentBranches(
    projectId: string,
    targetBranch: string,
    agentResults: AgentResult[],
    logStep: (phase: TaskStep['phase'], summary: string, status?: TaskStep['status'], toolUsed?: string, snippet?: string) => void
  ): Promise<{ commitHash?: string; diffSummary?: string; conflicts?: string[] }> {
    const conflicts: string[] = [];
    let finalCommitHash: string | undefined;
    let totalDiffSummary: string | undefined;

    // Checkout the target branch
    try {
      await GitWorkspaceService.createBranch(projectId, targetBranch);
    } catch {
      // Already exists
    }

    // Merge each sub-agent branch into the target
    for (const agentResult of agentResults) {
      if (!agentResult.success || !agentResult.commitHash) {
        logStep('git', `Foreman: skipping merge for failed agent ${agentResult.agentId}`, 'warning');
        continue;
      }

      try {
        const mergeRes = await GitWorkspaceService.merge(projectId, agentResult.branchName, targetBranch);
        logStep('git', `Foreman: merged ${agentResult.branchName} → ${targetBranch} (${mergeRes.oid?.slice(0, 8) || 'no-ff'})${mergeRes.alreadyMerged ? ' [already up-to-date]' : ''}`);
        finalCommitHash = mergeRes.oid || finalCommitHash;

        // Record diff after each successful merge
        totalDiffSummary = await GitWorkspaceService.getDiff(projectId);
      } catch (err: any) {
        const conflictMsg = `Merge conflict merging ${agentResult.branchName} → ${targetBranch}: ${err.message || err}`;
        conflicts.push(conflictMsg);
        logStep('git', conflictMsg, 'error');
      }
    }

    // Commit the merge result if there are changes
    if (finalCommitHash) {
      logStep('git', `Foreman: final merge commit at ${finalCommitHash.slice(0, 8)}`);
    }

    return {
      commitHash: finalCommitHash,
      diffSummary: totalDiffSummary,
      conflicts: conflicts.length > 0 ? conflicts : undefined,
    };
  }

  /**
   * Extract a JSON array from LLM response text, handling common
   * wrapping like markdown code fences or leading/trailing text.
   */
  private static extractJSON(text: string): string {
    let cleaned = text.trim();

    // Remove markdown code fences
    const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      cleaned = fenceMatch[1].trim();
    }

    // Find first [ and last ]
    const startBracket = cleaned.indexOf('[');
    const endBracket = cleaned.lastIndexOf(']');
    if (startBracket >= 0 && endBracket > startBracket) {
      cleaned = cleaned.slice(startBracket, endBracket + 1);
    }

    return cleaned;
  }
}

// ── GestaltForeman ────────────────────────────────────────────────

/**
 * GestaltForeman mirrors the Gestalt WASM Foreman interface in pure JS.
 *
 * This is the JS-side entry point that:
 * - Receives AgentSpec arrays (either from the JS decompose step
 *   or pre-built by the WASM Foreman)
 * - Executes them via AgentLoopRunner in parallel waves
 * - Publishes WsEvent-compatible events to the CrdtEventBus
 * - Returns consolidated ForemanResult
 *
 * This allows the host app to use the Foreman pattern even before
 * the WASM Gestalt module is loaded, and provides a fallback if
 * WASM is unavailable.
 */
export class GestaltForeman {
  /**
   * Execute a wave of agents from pre-built AgentSpecs.
   * This is the entry point called by the WASM RouterHandle bridge.
   *
   * @param projectId - The project to operate on
   * @param targetBranch - The base branch to merge into
   * @param specs - Array of AgentSpecs to execute in parallel
   * @param onEvent - Callback for lifecycle events (WsEvent-compatible)
   * @returns Consolidated ForemanResult with agent results and merge status
   */
  static async runWave(
    projectId: string,
    targetBranch: string,
    specs: AgentSpec[],
    onEvent?: (type: string, payload: Record<string, unknown>) => void
  ): Promise<ForemanResult> {
    const publishEvent = async (type: string, payload: Record<string, unknown> = {}) => {
      // Forward to both CrdtEventBus and optional callback
      try {
        const bus = await edgeMeshClient.crdtEventBus;
        bus.publish({ type, source: 'gestalt-foreman', payload });
      } catch {
        /* bus not available */
      }
      if (onEvent) onEvent(type, payload);
    };

    publishEvent('state_changed', { runId: projectId, state: 'executing' });

    // Create CodingTask stubs for each spec
    const subTasks: { spec: AgentSpec; task: CodingTask }[] = specs.map((spec) => ({
      spec,
      task: {
        id: crypto.randomUUID(),
        projectId,
        title: `[${spec.id}] ${spec.task.slice(0, 80)}`,
        prompt: spec.task,
        targetBranch: spec.targetBranch,
        status: 'pending' as const,
        createdAt: Date.now(),
        providerType: 'gemini-key',
        modelName: spec.model || 'gemini-2.5-flash',
        steps: [],
      } as CodingTask,
    }));

    // Publish subagent_spawned events
    for (const { spec } of subTasks) {
      publishEvent('subagent_spawned', {
        runId: projectId,
        agentId: spec.id,
        parentId: 'foreman',
        model: spec.model || 'gemini-2.5-flash',
        task: spec.task,
      });

      // Create branch
      try {
        await GitWorkspaceService.createBranch(projectId, spec.targetBranch);
      } catch {
        /* may already exist */
      }
    }

    // Execute all in parallel
    const agentResults: AgentResult[] = [];
    const runResults = await Promise.allSettled(
      subTasks.map(({ spec, task }) =>
        AgentLoopRunner.runTask(task, (_updated) => {
          publishEvent('subagent_progress', {
            runId: projectId,
            agentId: spec.id,
            progressPct: Math.min(100, Math.round((_updated.steps.length / 20) * 100)),
            status: _updated.status,
          });
        })
      )
    );

    // Collect results
    for (let i = 0; i < runResults.length; i++) {
      const { spec } = subTasks[i];
      const settled = runResults[i];

      if (settled.status === 'fulfilled') {
        const result = settled.value;
        const success = result.status === 'completed' && result.result?.success !== false;
        agentResults.push({
          agentId: spec.id,
          task: spec.task,
          success,
          summary: result.result?.summary || (success ? 'Completed' : 'Failed'),
          branchName: spec.targetBranch,
          commitHash: result.result?.commitHash,
          changedFiles: result.result?.changedFiles || [],
          error: result.error,
          steps: result.steps,
        });
      } else {
        agentResults.push({
          agentId: spec.id,
          task: spec.task,
          success: false,
          summary: `Agent threw: ${settled.reason?.message || String(settled.reason)}`,
          branchName: spec.targetBranch,
          changedFiles: [],
          error: settled.reason?.message || String(settled.reason),
          steps: [],
        });
      }
    }

    // Merge branches
    const successfulAgents = agentResults.filter(r => r.success);
    const failedAgents = agentResults.filter(r => !r.success);
    const conflicts: string[] = [];
    let finalCommitHash: string | undefined;

    publishEvent('run_phase_changed', { runId: projectId, phase: 'merging' });

    for (const agentResult of agentResults) {
      if (!agentResult.success || !agentResult.commitHash) continue;
      try {
        const mergeRes = await GitWorkspaceService.merge(projectId, agentResult.branchName, targetBranch);
        finalCommitHash = mergeRes.oid || finalCommitHash;
      } catch (err: any) {
        conflicts.push(`Merge conflict ${agentResult.branchName} → ${targetBranch}: ${err.message || err}`);
      }
    }

    // Build final result
    const allChangedFiles = Array.from(new Set(agentResults.flatMap(r => r.changedFiles)));
    const summary = `Wave completed: ${successfulAgents.length}/${specs.length} agents succeeded.${conflicts.length > 0 ? ` ${conflicts.length} merge conflict(s).` : ''}`;

    // Store memory
    await XavierMemoryNode.storeChunk({
      projectId,
      category: 'episodic',
      content: `GestaltForeman Wave: ${summary}`,
      source: 'swal-agent-runner',
    });

    const foremanResult: ForemanResult = {
      success: failedAgents.length === 0,
      summary,
      agentResults,
      branchName: targetBranch,
      commitHash: finalCommitHash,
      changedFiles: allChangedFiles,
      mergeConflicts: conflicts.length > 0 ? conflicts : undefined,
    };

    publishEvent('run_finished', {
      runId: projectId,
      summary,
      success: foremanResult.success,
      agentResultsCount: agentResults.length,
    });

    return foremanResult;
  }
}

// ── Re-export AgentLoopRunner for backward compatibility ──────────

export { AgentLoopRunner } from './agent-loop';
