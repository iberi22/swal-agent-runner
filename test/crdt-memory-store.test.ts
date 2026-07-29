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
});
