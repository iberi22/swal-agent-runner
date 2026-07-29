import { describe, it, expect } from 'vitest';

describe('SyncQueue', () => {
  it('should enqueue and process operations', async () => {
    const { SyncQueue } = await import('../sync-queue');
    const queue = new SyncQueue('test-queue-' + Date.now());

    // Constructor calls init() internally; processAll awaits ensureDB
    const result = await queue.processAll();
    expect(typeof result.completed).toBe('number');
    expect(typeof result.failed).toBe('number');
  });

  it('should enqueue operations and return count', async () => {
    const { SyncQueue } = await import('../sync-queue');
    const queue = new SyncQueue('test-queue-count-' + Date.now());

    await queue.enqueue({ type: 'POST', url: 'http://localhost:9999/test', body: { test: true } });
    const count = await queue.getPendingCount();
    expect(count).toBe(1);
  });

  it('should batch enqueue and processAll', async () => {
    const { SyncQueue } = await import('../sync-queue');
    const queue = new SyncQueue('test-queue-batch-' + Date.now());

    await queue.enqueue({ type: 'POST', url: 'http://localhost:9999/item1', body: { id: 1 } });
    await queue.enqueue({ type: 'POST', url: 'http://localhost:9999/item2', body: { id: 2 } });

    const pending = await queue.getPendingCount();
    expect(pending).toBe(2);

    // processAll will try to fetch against localhost:9999 — both will fail (no server)
    const result = await queue.processAll();
    expect(result.failed).toBe(2);
    expect(result.completed).toBe(0);
  });

  it('should keep pending status after first failure (retries < 5)', async () => {
    const { SyncQueue } = await import('../sync-queue');
    const queue = new SyncQueue('test-queue-clean-' + Date.now());

    await queue.enqueue({ type: 'POST', url: 'http://localhost:9999/retry-test', body: { clean: true } });

    // processAll will fail (no server) — retries becomes 1, status stays 'pending'
    await queue.processAll();

    // The item is still pending (retries < 5), so clean() won't remove it
    await queue.clean();

    const remaining = await queue.getPendingCount();
    // After 1 failure, retries=1 < 5, so the op remains pending
    expect(remaining).toBe(1);
  });

  it('should handle concurrent enqueues', async () => {
    const { SyncQueue } = await import('../sync-queue');
    const queue = new SyncQueue('test-queue-concurrent-' + Date.now());

    await Promise.all([
      queue.enqueue({ type: 'POST', url: 'http://localhost:9999/concurrent-1', body: { n: 1 } }),
      queue.enqueue({ type: 'POST', url: 'http://localhost:9999/concurrent-2', body: { n: 2 } }),
      queue.enqueue({ type: 'POST', url: 'http://localhost:9999/concurrent-3', body: { n: 3 } }),
    ]);

    expect(await queue.getPendingCount()).toBe(3);
  });
});
