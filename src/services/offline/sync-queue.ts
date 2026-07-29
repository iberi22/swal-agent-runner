/**
 * SyncQueue — Background Sync para operaciones offline.
 * Cuando no hay conexion, encola operaciones en IndexedDB.
 * Cuando la conexion regresa, las ejecuta en orden.
 */
import type { IDBPDatabase } from 'idb';

export class SyncQueue {
  private db: IDBPDatabase | null = null;
  private dbReady: Promise<void>;

  constructor(private queueName: string = 'swal-sync-queue') {
    this.dbReady = this.init();
  }

  private async init(): Promise<void> {
    const { openDB } = await import('idb');
    this.db = await openDB(this.queueName, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('operations')) {
          const store = db.createObjectStore('operations', {
            keyPath: 'id',
            autoIncrement: true,
          });
          store.createIndex('status', 'status');
        }
      },
    });
  }

  private async ensureDB(): Promise<IDBPDatabase> {
    await this.dbReady;
    return this.db!;
  }

  async enqueue(operation: {
    type: string;
    url: string;
    body?: unknown;
  }): Promise<void> {
    const db = await this.ensureDB();
    await db.add('operations', {
      ...operation,
      status: 'pending',
      createdAt: Date.now(),
      retries: 0,
    });
  }

  async processAll(): Promise<{ completed: number; failed: number }> {
    const db = await this.ensureDB();
    const tx = db.transaction('operations', 'readwrite');
    const store = tx.objectStore('operations');
    const pending = await store.index('status').getAll('pending');

    let completed = 0;
    let failed = 0;
    for (const op of pending) {
      try {
        await fetch(op.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: op.body ? JSON.stringify(op.body) : undefined,
        });
        await store.delete(op.id);
        completed++;
      } catch {
        op.retries++;
        if (op.retries >= 5) {
          op.status = 'failed';
          await store.put(op);
        }
        failed++;
      }
    }
    return { completed, failed };
  }

  async getPendingCount(): Promise<number> {
    const db = await this.ensureDB();
    return db.countFromIndex('operations', 'status', 'pending');
  }

  /** Clear all completed/failed operations */
  async clean(): Promise<void> {
    const db = await this.ensureDB();
    const tx = db.transaction('operations', 'readwrite');
    const store = tx.objectStore('operations');
    const all = await store.getAll();
    for (const op of all) {
      if (op.status !== 'pending') {
        await store.delete(op.id);
      }
    }
  }
}

export const syncQueue = new SyncQueue();
