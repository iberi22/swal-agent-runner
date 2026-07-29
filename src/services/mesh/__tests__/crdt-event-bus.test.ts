import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';

describe('CrdtEventBus', () => {
  it('should create empty event bus from Y.Doc', async () => {
    const { CrdtEventBus } = await import('../crdt-event-bus');
    const doc = new Y.Doc();
    const bus = new CrdtEventBus(doc);
    expect(await bus.getLength()).toBe(0);
  });

  it('should publish and receive events via subscribe', async () => {
    const { CrdtEventBus } = await import('../crdt-event-bus');
    const doc = new Y.Doc();
    const bus = new CrdtEventBus(doc, 100);

    const received: any[] = [];
    bus.subscribe((event) => received.push(event));

    await bus.publish({ type: 'run:started', source: 'test', payload: { taskId: 'abc' } });
    await bus.publish({ type: 'step:progress', source: 'test', payload: { step: 1 } });

    // Wait for Yjs observe to fire
    await new Promise((r) => setTimeout(r, 20));

    expect(received.length).toBe(2);
    expect(received[0].type).toBe('run:started');
    expect(received[0].payload.taskId).toBe('abc');
    expect(received[1].type).toBe('step:progress');
  });

  it('should not deliver events after unsubscribe', async () => {
    const { CrdtEventBus } = await import('../crdt-event-bus');
    const doc = new Y.Doc();
    const bus = new CrdtEventBus(doc);

    const received: any[] = [];
    const unsub = bus.subscribe((event) => received.push(event));
    unsub();

    await bus.publish({ type: 'run:started', source: 'test', payload: {} });
    await new Promise((r) => setTimeout(r, 10));

    expect(received.length).toBe(0);
  });

  it('should return history with getHistory', async () => {
    const { CrdtEventBus } = await import('../crdt-event-bus');
    const doc = new Y.Doc();
    const bus = new CrdtEventBus(doc, 100);

    await bus.publish({ type: 'event-a', source: 'test', payload: { n: 1 } });
    await bus.publish({ type: 'event-b', source: 'test', payload: { n: 2 } });
    await bus.publish({ type: 'event-c', source: 'test', payload: { n: 3 } });

    await new Promise((r) => setTimeout(r, 10));

    const history = await bus.getHistory(10);
    expect(history.length).toBe(3);
    expect(history[0].type).toBe('event-a');
    expect(history[2].type).toBe('event-c');
  });

  it('should filter events by type with getByType', async () => {
    const { CrdtEventBus } = await import('../crdt-event-bus');
    const doc = new Y.Doc();
    const bus = new CrdtEventBus(doc, 100);

    await bus.publish({ type: 'run:started', source: 'test', payload: {} });
    await bus.publish({ type: 'step:progress', source: 'test', payload: { n: 1 } });
    await bus.publish({ type: 'step:progress', source: 'test', payload: { n: 2 } });
    await bus.publish({ type: 'run:completed', source: 'test', payload: {} });

    await new Promise((r) => setTimeout(r, 10));

    const progressEvents = await bus.getByType('step:progress', 5);
    expect(progressEvents.length).toBe(2);
    expect(progressEvents[0].payload.n).toBe(2);
    expect(progressEvents[1].payload.n).toBe(1);
  });

  it('should auto-truncate when exceeding maxEvents', async () => {
    const { CrdtEventBus } = await import('../crdt-event-bus');
    const doc = new Y.Doc();
    const bus = new CrdtEventBus(doc, 5);

    for (let i = 0; i < 10; i++) {
      await bus.publish({ type: 'test', source: 'test', payload: { i } });
    }

    await new Promise((r) => setTimeout(r, 10));

    expect(await bus.getLength()).toBeLessThanOrEqual(5);
  });

  it('should clear all events', async () => {
    const { CrdtEventBus } = await import('../crdt-event-bus');
    const doc = new Y.Doc();
    const bus = new CrdtEventBus(doc);

    await bus.publish({ type: 'test', source: 'test', payload: {} });
    await bus.publish({ type: 'test', source: 'test', payload: {} });
    await new Promise((r) => setTimeout(r, 10));

    expect(await bus.getLength()).toBe(2);

    await bus.clear();
    expect(await bus.getLength()).toBe(0);
  });

  it('should handle handler errors gracefully', async () => {
    const { CrdtEventBus } = await import('../crdt-event-bus');
    const doc = new Y.Doc();
    const bus = new CrdtEventBus(doc);

    bus.subscribe(() => { throw new Error('handler error'); });
    bus.subscribe(() => { /* this one should still run */ });

    await expect(bus.publish({ type: 'test', source: 'test', payload: {} })).resolves.not.toThrow();

    await new Promise((r) => setTimeout(r, 10));
  });
});
