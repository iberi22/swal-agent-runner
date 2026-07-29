import { describe, it, expect, beforeEach } from 'vitest';

describe('CrdtMemoryStore', () => {
  let store: any;
  let doc: any;

  beforeEach(async () => {
    // Dynamic imports for lazy-loaded yjs
    const Y = await import('yjs');
    const { CrdtMemoryStore } = await import('../src/services/mesh/crdt-memory-store');
    doc = new Y.Doc();
    store = new CrdtMemoryStore(doc);
    await store.ready();
  });

  it('should store and retrieve a memory', async () => {
    const mem = await store.add({
      content: 'Test working memory content',
      source: 'test',
      projectId: 'test-project',
    });
    expect(mem.id).toBeTruthy();
    expect(mem.contentHash).toBeTruthy();
    expect(mem.timestamp).toBeGreaterThan(0);
    expect(mem.ttl).toBe(24 * 60 * 60 * 1000);

    const retrieved = await store.get(mem.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.content).toBe('Test working memory content');
  });

  it('should deduplicate by content hash', async () => {
    const mem1 = await store.add({
      content: 'Deduplicated content',
      source: 'test',
      projectId: 'test-project',
    });
    const mem2 = await store.add({
      content: 'Deduplicated content',
      source: 'test',
      projectId: 'test-project',
    });
    expect(mem1.id).toBe(mem2.id);
    expect(await store.getSize()).toBe(1);
  });

  it('should find memories by project', async () => {
    await store.add({ content: 'A', source: 's1', projectId: 'proj-a' });
    await store.add({ content: 'B', source: 's1', projectId: 'proj-a' });
    await store.add({ content: 'C', source: 's2', projectId: 'proj-b' });

    const projA = await store.findByProject('proj-a');
    expect(projA).toHaveLength(2);
    const projB = await store.findByProject('proj-b');
    expect(projB).toHaveLength(1);
  });

  it('should search by keywords', async () => {
    await store.add({ content: 'The quick brown fox', source: 's1', projectId: 'p1' });
    await store.add({ content: 'JavaScript async patterns', source: 's1', projectId: 'p1' });
    await store.add({ content: 'Python async event loop', source: 's1', projectId: 'p1' });

    const results = await store.search('async');
    expect(results.length).toBe(2);
  });

  it('should remove expired entries', async () => {
    await store.add({
      content: 'Expired content',
      source: 'test',
      projectId: 'test',
      ttl: -1000,
    });
    expect(await store.getSize()).toBe(1);
    const cleaned = await store.cleanExpired();
    expect(cleaned).toBe(1);
    expect(await store.getSize()).toBe(0);
  });

  it('should enforce max entries cap', async () => {
    for (let i = 0; i < 502; i++) {
      await store.add({
        content: `Memory entry ${i}`,
        source: 'test',
        projectId: 'test',
      });
    }
    expect(await store.getSize()).toBeLessThanOrEqual(500);
  });

  it('should support subscribe callback', async () => {
    const events: any[] = [];
    const unsub = store.subscribe((e: any) => events.push(e));

    await store.add({ content: 'New memory', source: 'test', projectId: 'p1' });
    expect(events.length).toBeGreaterThanOrEqual(1);

    unsub();
    await store.add({ content: 'After unsub', source: 'test', projectId: 'p1' });
  });

  it('should export to JSON sorted by timestamp', async () => {
    await store.add({ content: 'First', source: 's1', projectId: 'p1' });
    await store.add({ content: 'Second', source: 's1', projectId: 'p1' });
    const json = await store.toJSON();
    expect(json.length).toBe(2);
    expect(json[0].timestamp).toBeGreaterThanOrEqual(json[1].timestamp);
  });

  // ── Wave 8: Conflict Resolution & Merge Strategies ──

  it('should have "lww" as default strategy and allow setting strategy', () => {
    expect(store.getConflictStrategy()).toBe('lww');
    store.setConflictStrategy('combine');
    expect(store.getConflictStrategy()).toBe('combine');
  });

  it('should resolve conflicts using Last-Write-Wins (lww) strategy', async () => {
    const existing = {
      id: 'wm-1',
      content: 'Original content',
      source: 'node-1',
      projectId: 'p1',
      timestamp: 1000,
      ttl: 5000,
      contentHash: 'h1',
    };

    // Case 1: Incoming is newer (higher timestamp)
    const incomingNewer = {
      ...existing,
      content: 'Newer content',
      timestamp: 2000,
      contentHash: 'h2',
    };
    const res1 = store.resolveConflict(existing, incomingNewer, 'lww');
    expect(res1.content).toBe('Newer content');
    expect(res1.timestamp).toBe(2000);

    // Case 2: Existing is newer (higher timestamp)
    const incomingOlder = {
      ...existing,
      content: 'Older content',
      timestamp: 500,
      contentHash: 'h0',
    };
    const res2 = store.resolveConflict(existing, incomingOlder, 'lww');
    expect(res2.content).toBe('Original content');
    expect(res2.timestamp).toBe(1000);

    // Case 3: Identical timestamps (tie-breaker should prefer higher contentHash lexicographically)
    const tie1 = { ...existing, contentHash: 'abc', source: 'node-a', timestamp: 1000 };
    const tie2 = { ...existing, contentHash: 'xyz', source: 'node-b', timestamp: 1000 };
    const res3 = store.resolveConflict(tie1, tie2, 'lww');
    expect(res3.contentHash).toBe('xyz');
  });

  it('should resolve conflicts using "ours" strategy', async () => {
    const existing = {
      id: 'wm-1',
      content: 'Original content',
      source: 'node-1',
      projectId: 'p1',
      timestamp: 1000,
      ttl: 5000,
      contentHash: 'h1',
    };
    const incoming = {
      ...existing,
      content: 'Incoming newer content',
      timestamp: 2000,
      contentHash: 'h2',
    };

    const res = store.resolveConflict(existing, incoming, 'ours');
    expect(res.content).toBe('Original content');
    expect(res.timestamp).toBe(1000);
  });

  it('should resolve conflicts using "theirs" strategy', async () => {
    const existing = {
      id: 'wm-1',
      content: 'Original content',
      source: 'node-1',
      projectId: 'p1',
      timestamp: 1000,
      ttl: 5000,
      contentHash: 'h1',
    };
    const incoming = {
      ...existing,
      content: 'Incoming older content',
      timestamp: 500,
      contentHash: 'h2',
    };

    const res = store.resolveConflict(existing, incoming, 'theirs');
    expect(res.content).toBe('Incoming older content');
    expect(res.timestamp).toBe(500);
  });

  it('should resolve conflicts using "combine" strategy', async () => {
    const existing = {
      id: 'wm-1',
      content: 'Line 1\nLine 2',
      source: 'node-1',
      projectId: 'p1',
      timestamp: 1000,
      ttl: 5000,
      contentHash: 'h1',
    };
    const incoming = {
      ...existing,
      content: 'Line 2\nLine 3',
      source: 'node-2',
      projectId: 'p1',
      timestamp: 2000,
      ttl: 8000,
      contentHash: 'h2',
    };

    const res = store.resolveConflict(existing, incoming, 'combine');
    // Combined should merge unique lines
    expect(res.content).toBe('Line 1\nLine 2\nLine 3');
    // Should combine sources
    expect(res.source).toBe('node-1+node-2');
    // Should choose max of timestamps and ttls
    expect(res.timestamp).toBe(2000);
    expect(res.ttl).toBe(8000);
    expect(res.contentHash).not.toBe('h1');
    expect(res.contentHash).not.toBe('h2');
  });

  it('should support explicit merge method with strategy', async () => {
    const item1 = await store.add({
      content: 'Line A',
      source: 'src-1',
      projectId: 'p1',
    });

    const incoming = {
      ...item1,
      content: 'Line B',
      timestamp: item1.timestamp + 1000,
    };

    // Merge with 'ours' strategy -> should keep Line A
    const mergedOurs = await store.merge(incoming, 'ours');
    expect(mergedOurs.content).toBe('Line A');

    // Merge with 'theirs' strategy -> should overwrite to Line B
    const mergedTheirs = await store.merge(incoming, 'theirs');
    expect(mergedTheirs.content).toBe('Line B');
  });

  it('should support update method with strategy', async () => {
    const item = await store.add({
      content: 'Base line',
      source: 'src-1',
      projectId: 'p1',
    });

    // Update with 'combine' strategy
    const updated = await store.update(
      item.id,
      { content: 'Appended line', source: 'src-2' },
      'combine'
    );

    expect(updated).toBeDefined();
    expect(updated!.content).toBe('Base line\nAppended line');
    expect(updated!.source).toBe('src-1+src-2');
  });

  it('should automatically resolve conflicts on map observe events', async () => {
    const Y = await import('yjs');
    store.setConflictStrategy('lww');

    // Create an entry
    const entry = await store.add({
      content: 'Local version (newer)',
      source: 'local',
      projectId: 'p1',
    });

    // Create a remote doc and apply same initial state
    const remoteDoc = new Y.Doc();
    const remoteStore = new (await import('../src/services/mesh/crdt-memory-store')).CrdtMemoryStore(remoteDoc);
    await remoteStore.ready();

    Y.applyUpdate(remoteDoc, Y.encodeStateAsUpdate(doc));

    // Now, on remoteStore, artificially set the entry with an older timestamp
    const remoteEntry = {
      ...entry,
      content: 'Remote version (older)',
      timestamp: entry.timestamp - 1000,
    };
    remoteDoc.getMap('working:memories').set(entry.id, remoteEntry);

    // Sync remote update back to our main doc
    const remoteUpdate = Y.encodeStateAsUpdate(remoteDoc);
    Y.applyUpdate(doc, remoteUpdate);

    // Since observe executes Promise.resolve().then(...), wait for microtasks to flush
    await new Promise((resolve) => setTimeout(resolve, 30));

    // Check that store has reverted/resolved back to the local (newer) version
    const resolved = await store.get(entry.id);
    expect(resolved!.content).toBe('Local version (newer)');
  });
});