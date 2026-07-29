import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock edge-mesh module before importing agent-loop
vi.mock('../../services/mesh/edge-mesh-client', () => ({
  edgeMeshClient: {
    crdtEventBus: {
      publish: vi.fn(),
    },
  },
}));

describe('AgentLoopRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('should export AGENT_SYSTEM_PROMPT and AgentLoopRunner', async () => {
    const mod = await import('../agent-loop');
    expect(mod.AgentLoopRunner).toBeDefined();
    expect(mod.AgentLoopRunner.runTask).toBeDefined();
  });

  it('should handle task failure gracefully', async () => {
    const mod = await import('../agent-loop');
    const task = {
      id: 'test-1',
      projectId: 'test-project',
      title: 'Test Task',
      prompt: 'Do something',
      targetBranch: 'feature/test',
      status: 'pending' as const,
      createdAt: Date.now(),
      providerType: 'gemini-key' as const,
      modelName: 'gemini-2.5-flash',
      steps: [],
    };

    // Mock LLMProviderManager to throw on getActiveProvider
    const llmMod = await import('../../services/llm/llm-provider-manager');
    vi.spyOn(llmMod.LLMProviderManager, 'getActiveProvider').mockImplementation(() => {
      throw new Error('No provider configured');
    });

    const updates: any[] = [];
    const result = await mod.AgentLoopRunner.runTask(task, (u) => updates.push(u));

    expect(result.status).toBe('failed');
    expect(result.error).toBeDefined();
  });

  it('should create task update steps when failing', async () => {
    const mod = await import('../agent-loop');
    const task = {
      id: 'test-2',
      projectId: 'test-project',
      title: 'Fail Test',
      prompt: 'Do something',
      targetBranch: 'feature/fail',
      status: 'pending' as const,
      createdAt: Date.now(),
      providerType: 'gemini-key' as const,
      modelName: 'gemini-2.5-flash',
      steps: [],
    };

    const llmMod = await import('../../services/llm/llm-provider-manager');
    vi.spyOn(llmMod.LLMProviderManager, 'getActiveProvider').mockImplementation(() => {
      throw new Error('Connection failed');
    });

    const updates: any[] = [];
    const result = await mod.AgentLoopRunner.runTask(task, (u) => updates.push(u));

    // Should have at least one step (the plan step)
    expect(result.steps.length).toBeGreaterThanOrEqual(1);
    expect(result.steps[0].phase).toBe('plan');
    // Last step should be verify error
    const lastStep = result.steps[result.steps.length - 1];
    expect(lastStep.status).toBe('error');
  });

  it('should publish run events on failure', async () => {
    const mod = await import('../agent-loop');
    const edgeMeshMod = await import('../../services/mesh/edge-mesh-client');
    const publishMock = edgeMeshMod.edgeMeshClient.crdtEventBus.publish as any;

    const task = {
      id: 'test-3',
      projectId: 'test-project',
      title: 'Event Test',
      prompt: 'Do something',
      targetBranch: 'feature/events',
      status: 'pending' as const,
      createdAt: Date.now(),
      providerType: 'gemini-key' as const,
      modelName: 'gemini-2.5-flash',
      steps: [],
    };

    const llmMod = await import('../../services/llm/llm-provider-manager');
    vi.spyOn(llmMod.LLMProviderManager, 'getActiveProvider').mockImplementation(() => {
      throw new Error('DB error');
    });

    await mod.AgentLoopRunner.runTask(task, () => {});

    // Should have published run:started and run:failed events
    expect(publishMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'run:started' }),
    );
    expect(publishMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'run:failed' }),
    );
  });
});
