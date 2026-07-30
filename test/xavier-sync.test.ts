import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EdgeMeshSyncService } from '../src/services/memory/edge-mesh-sync';
import { XavierMemoryNode } from '../src/services/memory/xavier-memory-node';
import type { MemoryChunk } from '../src/types';

/**
 * Xavier Sync E2E Integration Tests
 *
 * Tests the complete bidirectional memory sync cycle between the local
 * XavierMemoryNode (IndexedDB-backed storage) and a simulated remote
 * Xavier Core (HTTP endpoints mocked via vi.fn()).
 *
 * Covers:
 *   - Full store → sync → retrieve cycle
 *   - Conflict resolution (same key, different values)
 *   - Offline queue (store while disconnected → sync on reconnect)
 *   - Xavier HTTP format validation
 *   - Empty sync (nothing to push/pull)
 *   - Graceful error handling on push failure
 */

describe('Xavier Sync E2E Integration', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    localStorage.clear();

    // Ensure a clean IndexedDB state between tests by storing and removing
    // a throwaway chunk; this forces the DB open/upgrade path to run
    // before each test so the object store exists reliably.
    try {
      await XavierMemoryNode.getAllChunks();
    } catch {
      // DB may not be ready yet, will be initialised on first real use
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ---------------------------------------------------------------------------
  // Test 1: Full store → sync → retrieve cycle
  // ---------------------------------------------------------------------------
  it('should complete a full store-sync-retrieve E2E cycle', async () => {
    // --- 1. Store local chunks -------------------------------------------------
    const localSemantic = await XavierMemoryNode.storeChunk({
      projectId: 'e2e-proj',
      content: 'E2E semantic memory about architecture',
      category: 'semantic',
      source: 'e2e-test',
    });
    const localEpisodic = await XavierMemoryNode.storeChunk({
      projectId: 'e2e-proj',
      content: 'E2E episodic memory about a past decision',
      category: 'episodic',
      source: 'e2e-test',
    });

    // Verify chunks exist and are unsynced
    let unsynced = await XavierMemoryNode.getUnsyncedChunks();
    expect(unsynced.some(c => c.id === localSemantic.id)).toBe(true);
    expect(unsynced.some(c => c.id === localEpisodic.id)).toBe(true);

    // --- 2. Setup mock Xavier Core -------------------------------------------
    const postedChunks: MemoryChunk[] = [];
    const remoteChunks: Partial<MemoryChunk>[] = [
      {
        id: 'remote-e2e-1',
        projectId: 'e2e-proj',
        content: 'Remote chunk pulled from Xavier Core',
        category: 'procedural',
        source: 'xavier-core',
        timestamp: Date.now(),
      },
      {
        id: 'remote-e2e-2',
        projectId: 'e2e-proj',
        content: 'Another remote procedural chunk',
        category: 'procedural',
        source: 'xavier-core',
        timestamp: Date.now(),
      },
    ];

    fetchMock.mockImplementation((url: string, options?: any) => {
      // Health check
      if (url.endsWith('/health')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'ok' }) });
      }
      // POST push
      if (url.includes('/api/v1/memory/sync') && options?.method === 'POST') {
        const body = JSON.parse(options.body);
        postedChunks.push(...body.chunks);
        return Promise.resolve({ ok: true, text: () => Promise.resolve('ok') });
      }
      // GET pull
      if (url.includes('/api/v1/memory/sync') && options?.method === 'GET') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(remoteChunks) });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    // --- 3. Execute sync ------------------------------------------------------
    const result = await EdgeMeshSyncService.performRealtimeSync();

    // --- 4. Assert results ----------------------------------------------------
    expect(result.error).toBeUndefined();
    expect(result.syncedCount).toBe(2); // Two local chunks pushed
    expect(result.pulledCount).toBe(2); // Two remote chunks pulled

    // Verify local chunks are marked synced (no longer appear in unsynced)
    unsynced = await XavierMemoryNode.getUnsyncedChunks();
    expect(unsynced.some(c => c.id === localSemantic.id)).toBe(false);
    expect(unsynced.some(c => c.id === localEpisodic.id)).toBe(false);

    // Verify remote chunks were stored locally and marked as synced
    const allChunks = await XavierMemoryNode.getAllChunks();
    const storedRemote1 = allChunks.find(c => c.id === 'remote-e2e-1');
    const storedRemote2 = allChunks.find(c => c.id === 'remote-e2e-2');
    expect(storedRemote1).toBeDefined();
    expect(storedRemote1?.content).toBe('Remote chunk pulled from Xavier Core');
    expect(storedRemote1?.syncedToMaster).toBe(true);
    expect(storedRemote2).toBeDefined();
    expect(storedRemote2?.content).toBe('Another remote procedural chunk');
    expect(storedRemote2?.syncedToMaster).toBe(true);

    // Verify the posted data contains the correct local chunks
    expect(postedChunks.length).toBe(2);
    expect(postedChunks.some(c => c.id === localSemantic.id)).toBe(true);
    expect(postedChunks.some(c => c.id === localEpisodic.id)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Test 2: Conflict resolution — same key (ID), different values
  // ---------------------------------------------------------------------------
  it('should handle conflict resolution when remote chunk has same ID', async () => {
    // --- 1. Store a local chunk -----------------------------------------------
    const localChunk = await XavierMemoryNode.storeChunk({
      projectId: 'conflict-proj',
      content: 'Original local content',
      category: 'semantic',
      source: 'local',
    });

    // --- 2. Mock Xavier with a conflicting chunk (same ID, different content) --
    const conflictingRemote: Partial<MemoryChunk> = {
      id: localChunk.id, // Same ID!
      projectId: 'conflict-proj',
      content: 'Remote-modified content (conflict winner)',
      category: 'semantic',
      source: 'xavier-core',
      timestamp: Date.now() + 1000, // Newer timestamp
    };

    fetchMock.mockImplementation((url: string, options?: any) => {
      if (url.endsWith('/health')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'ok' }) });
      }
      if (url.includes('/api/v1/memory/sync') && options?.method === 'POST') {
        return Promise.resolve({ ok: true, text: () => Promise.resolve('ok') });
      }
      if (url.includes('/api/v1/memory/sync') && options?.method === 'GET') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([conflictingRemote]) });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    // --- 3. Execute sync ------------------------------------------------------
    const result = await EdgeMeshSyncService.performRealtimeSync();

    // --- 4. Verify conflict resolution behaviour ------------------------------
    // performRealtimeSync first pushes local, then pulls remote.
    // The remote chunk has the same ID as the local chunk we just pushed.
    // storeRemoteChunks uses db.put() which is an upsert by key, so the
    // remote version overwrites the local one.
    expect(result.error).toBeUndefined();
    expect(result.syncedCount).toBe(1); // Local was pushed
    expect(result.pulledCount).toBe(1); // Remote was pulled (overwrites local)

    // The chunk should now have the remote content and be marked syncedToMaster
    const allChunks = await XavierMemoryNode.getAllChunks();
    const resolved = allChunks.find(c => c.id === localChunk.id);
    expect(resolved).toBeDefined();
    expect(resolved?.content).toBe('Remote-modified content (conflict winner)');
    expect(resolved?.syncedToMaster).toBe(true);

    // Verify the original local content is gone (overwritten)
    expect(resolved?.content).not.toBe('Original local content');
  });

  // ---------------------------------------------------------------------------
  // Test 3: Offline queue — store while disconnected, sync when reconnected
  // ---------------------------------------------------------------------------
  it('should queue chunks offline and sync when reconnected', async () => {
    // --- Phase A: Xavier is offline -------------------------------------------

    // Mock health to FAIL (simulate Xavier being down)
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/health')) {
        return Promise.reject(new Error('Connection refused: Xavier offline'));
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    // Store chunks while Xavier is unreachable
    const offlineChunk1 = await XavierMemoryNode.storeChunk({
      projectId: 'offline-proj',
      content: 'Offline chunk one',
      category: 'semantic',
      source: 'offline-test',
    });
    const offlineChunk2 = await XavierMemoryNode.storeChunk({
      projectId: 'offline-proj',
      content: 'Offline chunk two',
      category: 'episodic',
      source: 'offline-test',
    });

    // Try to sync while offline — should fail gracefully
    const offlineResult = await EdgeMeshSyncService.performRealtimeSync();
    expect(offlineResult.syncedCount).toBe(0);
    expect(offlineResult.error).toBeDefined();
    expect(offlineResult.error).toContain('offline');

    // Verify both chunks remain unsynced
    let unsynced = await XavierMemoryNode.getUnsyncedChunks();
    expect(unsynced.some(c => c.id === offlineChunk1.id)).toBe(true);
    expect(unsynced.some(c => c.id === offlineChunk2.id)).toBe(true);

    // --- Phase B: Xavier comes back online -----------------------------------

    // Re-mock: health succeeds, push succeeds, pull returns chunks
    const postedIds: string[] = [];
    fetchMock.mockImplementation((url: string, options?: any) => {
      if (url.endsWith('/health')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'ok' }) });
      }
      if (url.includes('/api/v1/memory/sync') && options?.method === 'POST') {
        const body = JSON.parse(options.body);
        for (const c of body.chunks) postedIds.push(c.id);
        return Promise.resolve({ ok: true, text: () => Promise.resolve('ok') });
      }
      if (url.includes('/api/v1/memory/sync') && options?.method === 'GET') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    // Now sync — should push the queued offline chunks
    const reconnectedResult = await EdgeMeshSyncService.performRealtimeSync();
    expect(reconnectedResult.error).toBeUndefined();
    expect(reconnectedResult.syncedCount).toBe(2);

    // Verify chunks were posted to Xavier
    expect(postedIds).toContain(offlineChunk1.id);
    expect(postedIds).toContain(offlineChunk2.id);

    // Verify chunks are now marked synced locally
    unsynced = await XavierMemoryNode.getUnsyncedChunks();
    expect(unsynced.some(c => c.id === offlineChunk1.id)).toBe(false);
    expect(unsynced.some(c => c.id === offlineChunk2.id)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Test 4: Xavier format validation
  // ---------------------------------------------------------------------------
  it('should send chunks in correct Xavier format during sync push', async () => {
    // Store a chunk
    const chunk = await XavierMemoryNode.storeChunk({
      projectId: 'format-proj',
      content: 'Format validation content',
      category: 'semantic',
      source: 'format-test',
    });

    let postedBody: any = null;
    fetchMock.mockImplementation((url: string, options?: any) => {
      if (url.endsWith('/health')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'ok' }) });
      }
      if (url.includes('/api/v1/memory/sync') && options?.method === 'POST') {
        postedBody = JSON.parse(options.body);
        return Promise.resolve({ ok: true, text: () => Promise.resolve('ok') });
      }
      if (url.includes('/api/v1/memory/sync') && options?.method === 'GET') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    await EdgeMeshSyncService.performRealtimeSync();

    // Validate Xavier POST body format
    expect(postedBody).not.toBeNull();
    // Must have nodeId
    expect(postedBody).toHaveProperty('nodeId');
    expect(typeof postedBody.nodeId).toBe('string');
    expect(postedBody.nodeId.length).toBeGreaterThan(0);
    // Must have chunks array
    expect(postedBody).toHaveProperty('chunks');
    expect(Array.isArray(postedBody.chunks)).toBe(true);
    expect(postedBody.chunks.length).toBe(1);
    // Each chunk must have required fields
    const postedChunk = postedBody.chunks[0];
    expect(postedChunk).toHaveProperty('id');
    expect(postedChunk).toHaveProperty('projectId');
    expect(postedChunk).toHaveProperty('content');
    expect(postedChunk).toHaveProperty('category');
    expect(postedChunk).toHaveProperty('source');
    expect(postedChunk).toHaveProperty('timestamp');
    expect(postedChunk).toHaveProperty('syncedToMaster');
    // Validate types
    expect(typeof postedChunk.id).toBe('string');
    expect(typeof postedChunk.content).toBe('string');
    expect(typeof postedChunk.timestamp).toBe('number');
    expect(typeof postedChunk.syncedToMaster).toBe('boolean');
    // Category must be valid
    expect(['episodic', 'semantic', 'procedural', 'working']).toContain(postedChunk.category);
    // Verify content matches
    expect(postedChunk.content).toBe('Format validation content');
    expect(postedChunk.projectId).toBe('format-proj');
  });

  // ---------------------------------------------------------------------------
  // Test 5: Empty sync — nothing to push, nothing to pull
  // ---------------------------------------------------------------------------
  it('should handle empty sync with no unsynced chunks and no remote chunks', async () => {
    // Mark any leftover chunks as synced to start clean
    const existingUnsynced = await XavierMemoryNode.getUnsyncedChunks();
    if (existingUnsynced.length > 0) {
      await XavierMemoryNode.markChunksSynced(existingUnsynced.map(c => c.id));
    }

    fetchMock.mockImplementation((url: string, options?: any) => {
      if (url.endsWith('/health')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'ok' }) });
      }
      if (url.includes('/api/v1/memory/sync') && options?.method === 'POST') {
        // Should NOT be called since there are no unsynced chunks
        return Promise.reject(new Error('POST should not have been called'));
      }
      if (url.includes('/api/v1/memory/sync') && options?.method === 'GET') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    const result = await EdgeMeshSyncService.performRealtimeSync();
    expect(result.error).toBeUndefined();
    expect(result.syncedCount).toBe(0);
    expect(result.pulledCount).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Test 6: Graceful error handling — Xavier returns 500 on push
  // ---------------------------------------------------------------------------
  it('should gracefully handle Xavier returning error during push', async () => {
    const chunk = await XavierMemoryNode.storeChunk({
      projectId: 'error-proj',
      content: 'This chunk will fail to sync',
      category: 'semantic',
      source: 'error-test',
    });

    fetchMock.mockImplementation((url: string, options?: any) => {
      if (url.endsWith('/health')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'ok' }) });
      }
      if (url.includes('/api/v1/memory/sync') && options?.method === 'POST') {
        return Promise.resolve({
          ok: false,
          status: 500,
          text: () => Promise.resolve('Internal server error'),
        });
      }
      if (url.includes('/api/v1/memory/sync') && options?.method === 'GET') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    const result = await EdgeMeshSyncService.performRealtimeSync();
    expect(result.syncedCount).toBe(0);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('500');

    // Chunk should NOT be marked synced since push failed
    const unsynced = await XavierMemoryNode.getUnsyncedChunks();
    expect(unsynced.some(c => c.id === chunk.id)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Test 7: Query memory after sync — synced chunks are still searchable
  // ---------------------------------------------------------------------------
  it('should still allow memory queries after sync marks chunks as synced', async () => {
    const chunk = await XavierMemoryNode.storeChunk({
      projectId: 'query-after-sync',
      content: 'Searchable content about Xavier vector sync protocol',
      category: 'semantic',
      source: 'query-test',
    });

    fetchMock.mockImplementation((url: string, options?: any) => {
      if (url.endsWith('/health')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'ok' }) });
      }
      if (url.includes('/api/v1/memory/sync') && options?.method === 'POST') {
        return Promise.resolve({ ok: true, text: () => Promise.resolve('ok') });
      }
      if (url.includes('/api/v1/memory/sync') && options?.method === 'GET') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    await EdgeMeshSyncService.performRealtimeSync();

    // Query should still find this chunk even though it's now syncedToMaster
    const results = await XavierMemoryNode.queryMemory('query-after-sync', 'Xavier vector', 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some(r => r.id === chunk.id)).toBe(true);
    expect(results[0].syncedToMaster).toBe(true);
  });
});
