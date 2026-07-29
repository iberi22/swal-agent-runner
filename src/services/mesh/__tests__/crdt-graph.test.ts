import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';

describe('CrdtGraph', () => {
  it('should create graph from Y.Doc', async () => {
    const { CrdtGraph } = await import('../crdt-graph');
    const doc = new Y.Doc();
    const graph = new CrdtGraph(doc);
    expect(graph.chunkCount).toBe(0);
    expect(graph.edgeCount).toBe(0);
  });

  it('should add and retrieve chunks', async () => {
    const { CrdtGraph } = await import('../crdt-graph');
    const doc = new Y.Doc();
    const graph = new CrdtGraph(doc);

    graph.addChunk({
      id: 'test-1',
      content: 'test content',
      category: 'semantic',
      source: 'test',
      timestamp: Date.now(),
      projectId: 'test',
      syncedToMaster: false,
    });

    expect(graph.chunkCount).toBe(1);
    const chunk = graph.getChunk('test-1');
    expect(chunk).toBeTruthy();
    expect(chunk?.content).toBe('test content');
  });

  it('should add edges between chunks', async () => {
    const { CrdtGraph } = await import('../crdt-graph');
    const doc = new Y.Doc();
    const graph = new CrdtGraph(doc);

    graph.addChunk({ id: 'a', content: 'chunk a', category: 'semantic', source: 'test', timestamp: 1, projectId: 'test', syncedToMaster: false });
    graph.addChunk({ id: 'b', content: 'chunk b', category: 'semantic', source: 'test', timestamp: 2, projectId: 'test', syncedToMaster: false });

    graph.addEdge('a', 'b', 'references');
    expect(graph.edgeCount).toBe(1);

    const edges = graph.getEdgesFrom('a');
    expect(edges.length).toBe(1);
    expect(edges[0].relation).toBe('references');
  });

  it('should remove chunks and clean edges', async () => {
    const { CrdtGraph } = await import('../crdt-graph');
    const doc = new Y.Doc();
    const graph = new CrdtGraph(doc);

    graph.addChunk({ id: 'x', content: 'to remove', category: 'episodic', source: 'test', timestamp: 3, projectId: 'test', syncedToMaster: false });
    graph.addChunk({ id: 'y', content: 'other', category: 'episodic', source: 'test', timestamp: 4, projectId: 'test', syncedToMaster: false });

    graph.addEdge('x', 'y', 'related');
    expect(graph.edgeCount).toBe(1);

    graph.removeChunk('x');
    expect(graph.chunkCount).toBe(1);
    // Edge from x should also be removed
    expect(graph.edgeCount).toBe(0);
  });

  it('should subscribe to chunk changes', async () => {
    const { CrdtGraph } = await import('../crdt-graph');
    const doc = new Y.Doc();
    const graph = new CrdtGraph(doc);

    const events: any[] = [];
    const unsub = graph.subscribe((event) => { events.push(event); });

    graph.addChunk({ id: 'sub-1', content: 'test', category: 'semantic', source: 'test', timestamp: 5, projectId: 'test', syncedToMaster: false });

    // Yjs observe is async within the same microtask — give it a tick
    await new Promise(r => setTimeout(r, 10));

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].type).toBe('chunk:added');

    unsub();
  });

  it('should serialize to JSON', async () => {
    const { CrdtGraph } = await import('../crdt-graph');
    const doc = new Y.Doc();
    const graph = new CrdtGraph(doc);

    graph.addChunk({ id: 'json-1', content: 'json test', category: 'semantic', source: 'test', timestamp: 6, projectId: 'test', syncedToMaster: false });
    graph.addEdge('json-1', 'json-2', 'links');

    const json = graph.toJSON();
    expect(json.chunks).toBeDefined();
    expect(json.edges).toBeDefined();
  });
});
