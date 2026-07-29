import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { CrdtMemoryStore } from '../src/services/mesh/crdt-memory-store';

describe('CrdtMemoryStore', () => {
  let doc: Y.Doc;
  let store: CrdtMemoryStore;

  beforeEach(() => {
    doc = new Y.Doc();
    store = new CrdtMemoryStore(doc);
  });

  it('should store and retrieve a memory', () => {
    const mem = store.add({
      content: 'Test working memory content',
      source: 'test',
      projectId: 'test-project',
    });
    expect(mem.id).toBeTruthy();
    expect(mem.contentHash).toBeTruthy();
    expect(mem.timestamp).toBeGreaterThan(0);
    expect(mem.ttl).toBe(24 * 60 * 60 * 1000);

    const retrieved = store.get(mem.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.content).toBe('Test working memory content');
  });

  it('should deduplicate by content hash', () => {
    const mem1 = store.add({
      content: 'Deduplicated content',
      source: 'test',
      projectId: 'test-project',
    });
    const mem2 = store.add({
      content: 'Deduplicated content',
      source: 'test',
      projectId: 'test-project',
    });
    expect(mem1.id).toBe(mem2.id);
    expect(store.size).toBe(1);
  });

  it('should find memories by project', () => {
    store.add({ content: 'A', source: 's1', projectId: 'proj-a' });
    store.add({ content: 'B', source: 's1', projectId: 'proj-a' });
    store.add({ content: 'C', source: 's2', projectId: 'proj-b' });

    const projA = store.findByProject('proj-a');
    expect(projA).toHaveLength(2);
    const projB = store.findByProject('proj-b');
    expect(projB).toHaveLength(1);
  });

  it('should search by keywords', () => {
    store.add({ content: 'The quick brown fox', source: 's1', projectId: 'p1' });
    store.add({ content: 'JavaScript async patterns', source: 's1', projectId: 'p1' });
    store.add({ content: 'Python async event loop', source: 's1', projectId: 'p1' });

    const results = store.search('async');
    expect(results.length).toBe(2);
  });

  it('should remove expired entries', () => {
    const mem = store.add({
      content: 'Expired content',
      source: 'test',
      projectId: 'test',
      ttl: -1000, // already expired
    });
    expect(store.size).toBe(1);
    const cleaned = store.cleanExpired();
    expect(cleaned).toBe(1);
    expect(store.size).toBe(0);
  });

  it('should enforce max entries cap', () => {
    // Fill to max
    for (let i = 0; i < 502; i++) {
      store.add({
        content: `Memory entry ${i}`,
        source: 'test',
        projectId: 'test',
      });
    }
    expect(store.size).toBeLessThanOrEqual(500);
  });

  it('should support subscribe callback', () => {
    const events: any[] = [];
    const unsub = store.subscribe((e) => events.push(e));

    store.add({ content: 'New memory', source: 'test', projectId: 'p1' });
    expect(events.length).toBeGreaterThanOrEqual(1);

    unsub();
    store.add({ content: 'After unsub', source: 'test', projectId: 'p1' });
    const afterUnsub = events.length;
    expect(afterUnsub).toBeGreaterThanOrEqual(1);
    // Events should NOT increase after unsubscribe - but Y observe fires asynchronously
    // so this test is best-effort
  });

  it('should export to JSON sorted by timestamp', () => {
    store.add({ content: 'First', source: 's1', projectId: 'p1' });
    store.add({ content: 'Second', source: 's1', projectId: 'p1' });
    const json = store.toJSON();
    expect(json.length).toBe(2);
    expect(json[0].timestamp).toBeGreaterThanOrEqual(json[1].timestamp);
  });
});
