import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';

export interface WorkingMemoryNode {
  id: string;
  projectId: string;
  content: string;
  contentHash: string;
  category: 'working';
  source: string;
  timestamp: number;
  ttlMs: number;
  expiresAt: number;
  embedding?: number[];
  metadata?: Record<string, unknown>;
  promotedTo?: 'episodic' | 'semantic' | 'procedural';
}

export type WorkingMemoryEvent =
  | { type: 'add'; memory: WorkingMemoryNode }
  | { type: 'update'; id: string; patch: Partial<WorkingMemoryNode> }
  | { type: 'remove'; id: string }
  | { type: 'expired'; id: string };

export class CrdtMemoryStore {
  private static instance: CrdtMemoryStore | null = null;

  private doc: Y.Doc;
  private memories: Y.Map<any>;
  private provider: any = null;
  private sweepInterval: any = null;
  private subscribers: Set<(event: WorkingMemoryEvent) => void> = new Set();
  private defaultTtlMs: number;
  private maxItems = 500;

  constructor(doc: Y.Doc, options?: { defaultTtlMs?: number; onExpire?: (id: string) => void }) {
    this.doc = doc;
    this.memories = this.doc.getMap('working:memories');
    this.defaultTtlMs = options?.defaultTtlMs ?? 24 * 60 * 60 * 1000; // 24h

    // Set up y-webrtc provider
    try {
      this.provider = new WebrtcProvider('swal-working-memories', this.doc, {
        signaling: ['wss://signaling.yjs.dev'],
      });
    } catch (err) {
      console.warn('[CrdtMemoryStore] Failed to initialize y-webrtc provider:', err);
    }

    // Set up Y.Map observer to notify subscribers
    this.memories.observe((event) => {
      event.keysChanged.forEach((key) => {
        const change = event.changes.keys.get(key);
        if (change) {
          if (change.action === 'add') {
            const val = this.memories.get(key);
            if (val) {
              this.notify({ type: 'add', memory: val });
            }
          } else if (change.action === 'update') {
            const val = this.memories.get(key);
            if (val) {
              this.notify({ type: 'update', id: key, patch: val });
            }
          } else if (change.action === 'delete') {
            this.notify({ type: 'remove', id: key });
          }
        }
      });
    });

    if (options?.onExpire) {
      this.subscribe((ev) => {
        if (ev.type === 'expired') {
          options.onExpire!(ev.id);
        }
      });
    }

    // Start expiry sweep
    this.startExpirySweep();
  }

  public static getInstance(): CrdtMemoryStore {
    if (!this.instance) {
      const doc = new Y.Doc();
      this.instance = new CrdtMemoryStore(doc);
    }
    return this.instance;
  }

  // Write methods
  public add(memory: Omit<WorkingMemoryNode, 'id' | 'timestamp' | 'expiresAt' | 'contentHash' | 'category'> & { id?: string }): WorkingMemoryNode {
    const id = memory.id || crypto.randomUUID();
    const timestamp = Date.now();
    const ttlMs = memory.ttlMs !== undefined ? memory.ttlMs : this.defaultTtlMs;
    const expiresAt = timestamp + ttlMs;
    const contentHash = CrdtMemoryStore.contentHash(memory.content);

    // Dedup check based on content hash
    const all = this.getAll();
    const existing = all.find((m) => m.contentHash === contentHash);
    if (existing) {
      // Extend TTL instead of duplicate
      const updated = {
        ...existing,
        expiresAt: Date.now() + ttlMs,
      };
      this.memories.set(existing.id, updated);
      return updated;
    }

    // Enforce 500 item cap limit before adding
    if (this.memories.size >= this.maxItems) {
      this.evictOldest();
    }

    const node: WorkingMemoryNode = {
      ...memory,
      id,
      category: 'working',
      contentHash,
      timestamp,
      ttlMs,
      expiresAt,
    };

    this.memories.set(id, node);
    return node;
  }

  public update(id: string, patch: Partial<WorkingMemoryNode>): void {
    const existing = this.memories.get(id);
    if (existing) {
      const updated = { ...existing, ...patch };
      this.memories.set(id, updated);
    }
  }

  public remove(id: string): void {
    if (this.memories.has(id)) {
      this.memories.delete(id);
    }
  }

  public expire(id: string): void {
    this.remove(id);
    this.notify({ type: 'expired', id });
  }

  // Read methods
  public get(id: string): WorkingMemoryNode | undefined {
    return this.memories.get(id);
  }

  public getByProject(projectId: string): WorkingMemoryNode[] {
    return this.getAll().filter((m) => m.projectId === projectId);
  }

  public getBySource(source: string): WorkingMemoryNode[] {
    return this.getAll().filter((m) => m.source === source);
  }

  public getAll(): WorkingMemoryNode[] {
    const list: WorkingMemoryNode[] = [];
    this.memories.forEach((val) => {
      list.push(val);
    });
    return list;
  }

  public query(projectId: string, search: string, limit = 5): WorkingMemoryNode[] {
    const all = this.getByProject(projectId);
    const queryWords = search.toLowerCase().split(/\s+/).filter((w) => w.length > 2);

    const scored = all.map((chunk) => {
      let score = 0;
      const contentLower = chunk.content.toLowerCase();
      for (const word of queryWords) {
        if (contentLower.includes(word)) {
          score += 1;
        }
      }
      return { chunk, score };
    });

    return scored
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((c) => c.chunk)
      .slice(0, limit);
  }

  // Eviction & lifecycle helper
  private evictOldest(): void {
    const all = this.getAll();
    if (all.length === 0) return;

    // Sort by expiresAt ascending (oldest/soonest to expire first)
    all.sort((a, b) => a.expiresAt - b.expiresAt);
    const oldest = all[0];
    this.remove(oldest.id);
  }

  public startExpirySweep(intervalMs = 60000): void {
    if (this.sweepInterval) return;

    this.sweepInterval = setInterval(() => {
      const now = Date.now();
      this.getAll().forEach((m) => {
        if (m.expiresAt <= now) {
          this.expire(m.id);
        }
      });
    }, intervalMs);
  }

  public stopExpirySweep(): void {
    if (this.sweepInterval) {
      clearInterval(this.sweepInterval);
      this.sweepInterval = null;
    }
  }

  // PubSub
  public subscribe(callback: (event: WorkingMemoryEvent) => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  private notify(event: WorkingMemoryEvent): void {
    this.subscribers.forEach((cb) => {
      try {
        cb(event);
      } catch (err) {
        console.error('[CrdtMemoryStore] Subscriber callback error:', err);
      }
    });
  }

  public toJSON(): Record<string, WorkingMemoryNode> {
    const obj: Record<string, WorkingMemoryNode> = {};
    this.memories.forEach((val, key) => {
      obj[key] = val;
    });
    return obj;
  }

  // SipHash-like or simple robust string hash hex helper
  public static contentHash(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0; // Convert to 32bit integer
    }
    return hash.toString(16);
  }

  // For testing / cleanup
  public destroy(): void {
    this.stopExpirySweep();
    if (this.provider) {
      try {
        this.provider.destroy();
      } catch {}
    }
  }
}
