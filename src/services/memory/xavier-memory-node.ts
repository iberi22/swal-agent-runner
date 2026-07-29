import { openDB, IDBPDatabase } from 'idb';
import { MemoryChunk } from '../../types';
import { edgeMeshClient } from '../mesh/edge-mesh-client';

const DB_NAME = 'swal_xavier_memory_node';
const DB_VERSION = 1;

/**
 * XavierMemoryNode
 * ================
 * Provides persistent local memory storage and retrieval for the SWAL Agent,
 * backed by IndexedDB. Working memories are also written to the P2P CRDT Memory Store.
 */
export class XavierMemoryNode {
  /**
   * Promise resolving to the opened IndexedDB database instance.
   * @private
   */
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

  /**
   * Stores a new memory chunk in IndexedDB.
   * If the category is 'working', it also attempts a dual-write to the CRDT memory store for P2P synchronization.
   *
   * @param chunk - The partial memory chunk to store (excluding id, timestamp, and syncedToMaster).
   * @returns A promise resolving to the fully constructed MemoryChunk object.
   */
  public static async storeChunk(chunk: Omit<MemoryChunk, 'id' | 'timestamp' | 'syncedToMaster'>): Promise<MemoryChunk> {
    const db = await this.dbPromise;
    const fullChunk: MemoryChunk = {
      ...chunk,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      syncedToMaster: false,
    };
    await db.put('chunks', fullChunk);

    // Dual-write: working memories también van al CrdtMemoryStore para sync P2P
    if (chunk.category === 'working') {
      try {
        const crdtMemStore = (edgeMeshClient as any).crdtMemoryStore;
        if (crdtMemStore) {
          crdtMemStore.add({
            content: chunk.content,
            source: chunk.source,
            projectId: chunk.projectId,
            ttl: 24 * 60 * 60 * 1000,
          });
        }
      } catch {
        // CrdtMemoryStore no disponible — no crítico
      }
    }

    return fullChunk;
  }

  /**
   * Queries stored memory chunks by project ID and ranks them using a keyword-scoring BM25-like search.
   *
   * @param projectId - The ID of the project to search within.
   * @param query - The search query string.
   * @param limit - The maximum number of results to return (defaults to 5).
   * @returns A promise resolving to an array of scored MemoryChunk objects matching the query.
   */
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

  /**
   * Retrieves all memory chunks that have not yet been synchronized to the master node.
   *
   * @returns A promise resolving to an array of unsynced MemoryChunk objects.
   */
  public static async getUnsyncedChunks(): Promise<MemoryChunk[]> {
    const db = await this.dbPromise;
    const all = await db.getAll('chunks');
    return all.filter((c) => !c.syncedToMaster);
  }

  /**
   * Marks specified memory chunks as synchronized to the master node.
   *
   * @param chunkIds - An array of unique chunk IDs to mark as synced.
   * @returns A promise resolving when the update operation is completed.
   */
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

  /**
   * Retrieves all memory chunks stored in IndexedDB.
   *
   * @returns A promise resolving to an array of all MemoryChunk objects.
   */
  public static async getAllChunks(): Promise<MemoryChunk[]> {
    const db = await this.dbPromise;
    return await db.getAll('chunks');
  }
}
