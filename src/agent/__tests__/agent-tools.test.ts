import { describe, it, expect } from 'vitest';

describe('AGENT_TOOLS', () => {
  it('should export 7 tool declarations', async () => {
    const { AGENT_TOOLS } = await import('../agent-tools');
    expect(AGENT_TOOLS.length).toBe(7);
  });

  it('should include read_file tool with proper schema', async () => {
    const { AGENT_TOOLS } = await import('../agent-tools');
    const readFile = AGENT_TOOLS.find((t: any) => t.name === 'read_file');
    expect(readFile).toBeDefined();
    expect(readFile!.parameters.required).toContain('path');
    expect(readFile!.parameters.properties.path.type).toBe('string');
  });

  it('should include write_file tool with required path and content', async () => {
    const { AGENT_TOOLS } = await import('../agent-tools');
    const writeFile = AGENT_TOOLS.find((t: any) => t.name === 'write_file');
    expect(writeFile).toBeDefined();
    expect(writeFile!.parameters.required).toEqual(['path', 'content']);
  });

  it('should include all seven tools with correct names', async () => {
    const { AGENT_TOOLS } = await import('../agent-tools');
    const names = AGENT_TOOLS.map((t: any) => t.name).sort();
    expect(names).toEqual([
      'complete',
      'git_diff',
      'list_directory',
      'memory_search',
      'read_file',
      'run_command',
      'write_file',
    ]);
  });

  it('should include complete tool with summary and commitMessage', async () => {
    const { AGENT_TOOLS } = await import('../agent-tools');
    const complete = AGENT_TOOLS.find((t: any) => t.name === 'complete');
    expect(complete).toBeDefined();
    expect(complete!.parameters.required).toEqual(['summary', 'commitMessage']);
  });

  it('should have parameter objects for all tools', async () => {
    const { AGENT_TOOLS } = await import('../agent-tools');
    for (const tool of AGENT_TOOLS) {
      expect((tool as any).parameters.type).toBe('object');
      expect((tool as any).parameters.properties).toBeDefined();
    }
  });
});

describe('AgentToolExecutor', () => {
  it('should return error for unknown tool', async () => {
    const { AgentToolExecutor } = await import('../agent-tools');
    const result = await AgentToolExecutor.executeTool('test-project', 'nonexistent_tool', {});
    expect(result.output).toContain('Unknown tool');
  });

  it('should return complete response for complete tool', async () => {
    const { AgentToolExecutor } = await import('../agent-tools');
    const result = await AgentToolExecutor.executeTool('test-project', 'complete', {
      summary: 'Task done successfully',
      commitMessage: 'feat: implement feature',
    });
    expect(result.isComplete).toBe(true);
    expect(result.summary).toBe('Task done successfully');
    expect(result.commitMessage).toBe('feat: implement feature');
    expect(result.output).toBe('Task done successfully');
  });

  it('should call onLog callback for read_file errors', async () => {
    const { AgentToolExecutor } = await import('../agent-tools');
    const logs: string[] = [];
    const result = await AgentToolExecutor.executeTool('nonexistent-project', 'read_file', { path: 'test.ts' }, (msg: string) => logs.push(msg));
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0]).toContain('Reading file');
  });

  it('should call onLog callback for git_diff', async () => {
    const { AgentToolExecutor } = await import('../agent-tools');
    const logs: string[] = [];
    const result = await AgentToolExecutor.executeTool('test-project', 'git_diff', {}, (msg: string) => logs.push(msg));
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0]).toContain('Calculating Git diff');
  });

  it('should call onLog callback for memory_search', async () => {
    const { AgentToolExecutor } = await import('../agent-tools');
    const logs: string[] = [];
    const result = await AgentToolExecutor.executeTool('test-project', 'memory_search', { query: 'test query' }, (msg: string) => logs.push(msg));
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0]).toContain('Searching Xavier Memory');
  });

  it('should handle read_file on non-existent project gracefully', async () => {
    const { AgentToolExecutor } = await import('../agent-tools');
    const result = await AgentToolExecutor.executeTool('ghost-project', 'read_file', { path: 'src/main.ts' });
    expect(result.output).toContain('Error');
  });
});
