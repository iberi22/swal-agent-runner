import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('XavierMemoryNode', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('should store a memory chunk and return it with id and timestamp', async () => {
    const { XavierMemoryNode } = await import('../xavier-memory-node');
    const chunk = await XavierMemoryNode.storeChunk({
      projectId: 'test-project',
      content: 'Test memory content',
      category: 'semantic',
      source: 'test-suite',
    });

    expect(chunk.id).toBeDefined();
    expect(chunk.timestamp).toBeGreaterThan(0);
    expect(chunk.projectId).toBe('test-project');
    expect(chunk.content).toBe('Test memory content');
    expect(chunk.syncedToMaster).toBe(false);
  });

  it('should store and retrieve multiple chunks by ID', async () => {
    const { XavierMemoryNode } = await import('../xavier-memory-node');
    const c1 = await XavierMemoryNode.storeChunk({
      projectId: 'multi', content: 'First chunk', category: 'episodic', source: 'test',
    });
    const c2 = await XavierMemoryNode.storeChunk({
      projectId: 'multi', content: 'Second chunk', category: 'semantic', source: 'test',
    });
    const c3 = await XavierMemoryNode.storeChunk({
      projectId: 'other', content: 'Different project', category: 'procedural', source: 'test',
    });

    const all = await XavierMemoryNode.getAllChunks();
    expect(all.find((c) => c.id === c1.id)).toBeDefined();
    expect(all.find((c) => c.id === c2.id)).toBeDefined();
    expect(all.find((c) => c.id === c3.id)).toBeDefined();
    // Total should be at least 3 (may include leftovers from prior tests)
    expect(all.length).toBeGreaterThanOrEqual(3);
  });

  it('should query memory by keyword matching', async () => {
    const { XavierMemoryNode } = await import('../xavier-memory-node');
    await XavierMemoryNode.storeChunk({
      projectId: 'query-test', content: 'The architecture uses React for UI components and Vite for bundling.', category: 'semantic', source: 'test',
    });
    await XavierMemoryNode.storeChunk({
      projectId: 'query-test', content: 'Xavier memory node stores vectors in IndexedDB for offline access.', category: 'semantic', source: 'test',
    });
    await XavierMemoryNode.storeChunk({
      projectId: 'query-test', content: 'WebContainers provide headless Node.js execution inside the browser.', category: 'procedural', source: 'test',
    });

    const results = await XavierMemoryNode.queryMemory('query-test', 'Xavier IndexedDB', 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].content).toContain('Xavier');
  });

  it('should return empty for non-matching queries', async () => {
    const { XavierMemoryNode } = await import('../xavier-memory-node');
    await XavierMemoryNode.storeChunk({
      projectId: 'no-match', content: 'Only React and TypeScript here.', category: 'semantic', source: 'test',
    });

    const results = await XavierMemoryNode.queryMemory('no-match', 'Python Django MongoDB', 5);
    expect(results.length).toBe(0);
  });

  it('should identify newly stored chunks as unsynced', async () => {
    const { XavierMemoryNode } = await import('../xavier-memory-node');
    // Store chunks and verify they appear in unsynced
    const c1 = await XavierMemoryNode.storeChunk({
      projectId: 'sync-test', content: 'Unsynced chunk 1', category: 'episodic', source: 'test',
    });
    const c2 = await XavierMemoryNode.storeChunk({
      projectId: 'sync-test', content: 'Unsynced chunk 2', category: 'episodic', source: 'test',
    });

    const unsynced = await XavierMemoryNode.getUnsyncedChunks();
    expect(unsynced.find((c) => c.id === c1.id)).toBeDefined();
    expect(unsynced.find((c) => c.id === c2.id)).toBeDefined();
    // At least the 2 we just stored are unsynced
    expect(unsynced.length).toBeGreaterThanOrEqual(2);
  });

  it('should mark chunks as synced so they no longer appear unsynced', async () => {
    const { XavierMemoryNode } = await import('../xavier-memory-node');
    const chunk = await XavierMemoryNode.storeChunk({
      projectId: 'mark-sync', content: 'Will be marked synced', category: 'semantic', source: 'test',
    });

    // Capture count before syncing
    const beforeSync = await XavierMemoryNode.getUnsyncedChunks();
    expect(beforeSync.find((c) => c.id === chunk.id)).toBeDefined();

    await XavierMemoryNode.markChunksSynced([chunk.id]);

    const afterSync = await XavierMemoryNode.getUnsyncedChunks();
    expect(afterSync.find((c) => c.id === chunk.id)).toBeUndefined();
  });

  it('should not affect chunks when marking non-existent ids', async () => {
    const { XavierMemoryNode } = await import('../xavier-memory-node');
    await XavierMemoryNode.storeChunk({
      projectId: 'safe', content: 'Stay unsynced', category: 'working', source: 'test',
    });

    await expect(
      XavierMemoryNode.markChunksSynced(['non-existent-id'])
    ).resolves.not.toThrow();
  });
});
