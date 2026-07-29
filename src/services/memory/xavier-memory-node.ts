import { openDB, IDBPDatabase } from 'idb';
import { MemoryChunk } from '../../types';
import { CrdtMemoryStore } from '../mesh/crdt-memory-store';

const DB_NAME = 'swal_xavier_memory_node';
const DB_VERSION = 1;

export class XavierMemoryNode {
  private static dbPromise: Promise<IDBPDatabase> = openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('chunks')) {
        const store = db.createObjectStore('chunks', { keyPath: 'id' });
        store.createIndex('projectId', 'projectId', { unique: false });
        store.createIndex('category', 'category', { unique: false });
        store.createIndex('syncedToMaster', 'syncedToMaster', { unique: false });
      }
    },
  });

  public static async storeChunk(chunk: Omit<MemoryChunk, 'id' | 'timestamp' | 'syncedToMaster'>): Promise<MemoryChunk> {
    const db = await this.dbPromise;
    const isWorking = chunk.category === 'working';
    const fullChunk: MemoryChunk = {
      ...chunk,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      syncedToMaster: isWorking, // Keep Xavier HTTP sync only for non-working memories
    };
    await db.put('chunks', fullChunk);

    if (isWorking) {
      try {
        const crdtStore = CrdtMemoryStore.getInstance();
        crdtStore.add({
          id: fullChunk.id,
          projectId: fullChunk.projectId,
          content: fullChunk.content,
          source: fullChunk.source,
          embedding: fullChunk.embedding,
        });
      } catch (err) {
        console.error('[XavierMemoryNode] Dual-write to CrdtMemoryStore failed:', err);
      }
    }

    return fullChunk;
  }

  public static async queryMemory(projectId: string, query: string, limit = 5): Promise<MemoryChunk[]> {
    const db = await this.dbPromise;
    const all = await db.getAllFromIndex('chunks', 'projectId', projectId);
    
    // Keyword BM25-like search scoring
    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    
    const scored = all.map(chunk => {
      let score = 0;
      const contentLower = chunk.content.toLowerCase();
      for (const word of queryWords) {
        if (contentLower.includes(word)) {
          score += 1;
        }
      }
      return { ...chunk, score };
    });

    return scored
      .filter(c => (c.score || 0) > 0)
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, limit);
  }

  public static async getUnsyncedChunks(): Promise<MemoryChunk[]> {
    const db = await this.dbPromise;
    const all = await db.getAll('chunks');
    return all.filter((c) => !c.syncedToMaster);
  }

  public static async markChunksSynced(chunkIds: string[]): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction('chunks', 'readwrite');
    for (const id of chunkIds) {
      const item = await tx.store.get(id);
      if (item) {
        item.syncedToMaster = true;
        await tx.store.put(item);
      }
    }
    await tx.done;
  }

  public static async getAllChunks(): Promise<MemoryChunk[]> {
    const db = await this.dbPromise;
    return await db.getAll('chunks');
  }
}
