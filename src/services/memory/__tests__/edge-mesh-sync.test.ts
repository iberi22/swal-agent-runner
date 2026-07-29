import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EdgeMeshSyncService } from '../edge-mesh-sync';
import { XavierMemoryNode } from '../xavier-memory-node';
import { MemoryChunk } from '../../../types';

describe('EdgeMeshSyncService - Bi-directional Sync', () => {
  let fetchMock: any;

  beforeEach(() => {
    vi.resetModules();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should successfully perform bi-directional sync (push and pull)', async () => {
    // 1. Prepare local database by storing some chunks
    const localChunk = await XavierMemoryNode.storeChunk({
      projectId: 'proj-1',
      content: 'Local semantic memory chunk',
      category: 'semantic',
      source: 'test-local',
    });

    const workingChunk = await XavierMemoryNode.storeChunk({
      projectId: 'proj-1',
      content: 'Local working memory chunk (should not push)',
      category: 'working',
      source: 'test-local',
    });

    // Verify they are in the database
    const allLocal = await XavierMemoryNode.getAllChunks();
    expect(allLocal.some(c => c.id === localChunk.id)).toBe(true);
    expect(allLocal.some(c => c.id === workingChunk.id)).toBe(true);

    // 2. Setup fetch mock
    fetchMock.mockImplementation((url: string, options?: any) => {
      if (url.endsWith('/health')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: 'ok' }),
        });
      }
      if (url.endsWith('/api/v1/memory/sync') && options?.method === 'POST') {
        const body = JSON.parse(options.body);
        expect(body.chunks.length).toBe(1);
        expect(body.chunks[0].id).toBe(localChunk.id);
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve('ok'),
        });
      }
      if (url.includes('/api/v1/memory/sync') && options?.method === 'GET') {
        const pulledChunks: Partial<MemoryChunk>[] = [
          {
            id: 'remote-chunk-1',
            projectId: 'proj-1',
            content: 'Pulled episodic chunk from master',
            category: 'episodic',
            source: 'xavier-core',
            timestamp: Date.now(),
          },
        ];
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(pulledChunks),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    // 3. Execute Sync
    const result = await EdgeMeshSyncService.performRealtimeSync();

    // 4. Verify results
    expect(result.error).toBeUndefined();
    expect(result.syncedCount).toBe(1);
    expect(result.pulledCount).toBe(1);

    // Verify local chunk is now marked as synced
    const unsynced = await XavierMemoryNode.getUnsyncedChunks();
    expect(unsynced.some(c => c.id === localChunk.id)).toBe(false);

    // Verify remote chunk is stored locally and marked as syncedToMaster
    const allAfter = await XavierMemoryNode.getAllChunks();
    const storedRemote = allAfter.find(c => c.id === 'remote-chunk-1');
    expect(storedRemote).toBeDefined();
    expect(storedRemote?.content).toBe('Pulled episodic chunk from master');
    expect(storedRemote?.syncedToMaster).toBe(true);
  });

  it('should still pull remote chunks even if there are no local unsynced chunks to push', async () => {
    // Ensure no unsynced non-working chunks exist
    const unsyncedBefore = await XavierMemoryNode.getUnsyncedChunks();
    for (const chunk of unsyncedBefore) {
      await XavierMemoryNode.markChunksSynced([chunk.id]);
    }

    // Setup fetch mock
    fetchMock.mockImplementation((url: string, options?: any) => {
      if (url.endsWith('/health')) {
        return Promise.resolve({
          ok: true,
        });
      }
      if (url.includes('/api/v1/memory/sync') && options?.method === 'GET') {
        const pulledChunks = {
          chunks: [
            {
              id: 'remote-chunk-2',
              projectId: 'proj-1',
              content: 'Another pulled chunk',
              category: 'procedural',
              source: 'xavier-core',
              timestamp: Date.now(),
            }
          ]
        };
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(pulledChunks),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    const result = await EdgeMeshSyncService.performRealtimeSync();
    expect(result.error).toBeUndefined();
    expect(result.syncedCount).toBe(0);
    expect(result.pulledCount).toBe(1);

    const allAfter = await XavierMemoryNode.getAllChunks();
    const storedRemote = allAfter.find(c => c.id === 'remote-chunk-2');
    expect(storedRemote).toBeDefined();
    expect(storedRemote?.syncedToMaster).toBe(true);
  });

  it('should fall back to /api/v1/memory/pull if GET /api/v1/memory/sync returns non-ok status', async () => {
    fetchMock.mockImplementation((url: string, options?: any) => {
      if (url.endsWith('/health')) {
        return Promise.resolve({ ok: true });
      }
      if (url.includes('/api/v1/memory/sync') && options?.method === 'GET') {
        return Promise.resolve({ ok: false, status: 404 });
      }
      if (url.includes('/api/v1/memory/pull') && options?.method === 'GET') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([
            {
              id: 'remote-chunk-fallback',
              projectId: 'proj-1',
              content: 'Pulled from fallback endpoint',
              category: 'semantic',
              source: 'xavier-core',
              timestamp: Date.now(),
            }
          ]),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    const result = await EdgeMeshSyncService.performRealtimeSync();
    expect(result.error).toBeUndefined();
    expect(result.syncedCount).toBe(0);
    expect(result.pulledCount).toBe(1);

    const allAfter = await XavierMemoryNode.getAllChunks();
    const storedRemote = allAfter.find(c => c.id === 'remote-chunk-fallback');
    expect(storedRemote).toBeDefined();
    expect(storedRemote?.content).toBe('Pulled from fallback endpoint');
  });
});
