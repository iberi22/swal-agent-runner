import type { Doc, Map as YMap } from 'yjs';
import type { MemoryChunk } from '../../types';

/**
 * Lazy yjs module loader.
 */
let _YjsModule: Promise<typeof import('yjs')> | null = null;
async function getYjs(): Promise<typeof import('yjs')> {
  if (!_YjsModule) {
    _YjsModule = import('yjs').then((m) =>
      (m as any).default && (m as any).default?.Doc ? (m as any).default : m
    );
  }
  return _YjsModule;
}

/** Name of the Y.Map within the Y.Doc that stores working memories. */
const MAP_NAME = 'working:memories';
/** Default TTL for working memories: 24 hours in milliseconds. */
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
/** Hard cap on the number of working memory entries. */
const MAX_ENTRIES = 500;

/**
 * Working memory entry stored in the CRDT shared Y.Map.
 *
 * @property id - Unique entry identifier
 * @property content - Memory content text
 * @property source - Origin source identifier (e.g. "swal-agent-runner")
 * @property projectId - Associated project ID
 * @property timestamp - Creation timestamp (ms since epoch)
 * @property ttl - Time-to-live in milliseconds from timestamp
 * @property contentHash - Hash of the content for deduplication
 */
export interface WorkingMemory {
  id: string;
  content: string;
  source: string;
  projectId: string;
  timestamp: number;
  ttl: number; // ms from timestamp
  contentHash: string;
}

function hashContent(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString(36);
}

/**
 * CRDT-backed working memory store over a Y.Map.
 *
 * Working memories (category='working') are stored in a shared Y.Map
 * that automatically replicates via y-webrtc to all mesh peers.
 *
 * Features:
 * - Default 24-hour TTL (time-to-live)
 * - Hard cap of 500 entries
 * - Deduplication by content hash
 * - Category filter: only 'working' memories (others go via HTTP to Xavier)
 */
export class CrdtMemoryStore {
  private memories: YMap<WorkingMemory> | null = null;
  private onChange: Set<(event: { type: string; memory: WorkingMemory }) => void> = new Set();
  private _ready: Promise<void>;

  constructor(doc: Doc) {
    this._ready = getYjs().then(() => {
      this.memories = doc.getMap<WorkingMemory>(MAP_NAME);

      // Clean expired entries on observe
      this.memories!.observe((event) => {
        for (const [key, change] of event.keys) {
          if (change.action === 'add' || change.action === 'update') {
            const mem = this.memories!.get(key);
            if (mem) {
              this.emit({ type: 'memory:added', memory: mem });
            }
          } else if (change.action === 'delete') {
            this.emit({ type: 'memory:removed', memory: { id: key } as WorkingMemory });
          }
        }
      });
    });
  }

  /**
   * Wait for yjs module and Y.Map initialization.
   */
  async ready(): Promise<void> {
    await this._ready;
  }

  /**
   * Store a working memory entry.
   *
   * Deduplicates by content hash. Enforces hard cap by evicting the oldest entry
   * when the maximum is exceeded.
   *
   * @param memory - Memory data (id, timestamp, and contentHash are auto-generated)
   * @returns The stored WorkingMemory entry
   */
  async add(memory: Omit<WorkingMemory, 'id' | 'timestamp' | 'contentHash'>): Promise<WorkingMemory> {
    const memories = await this.ensure();
    const ch = hashContent(memory.content);
    const existing = this.findByHash(ch, memories);
    if (existing) return existing;

    const entry: WorkingMemory = {
      ...memory,
      id: `wm-${crypto.randomUUID().slice(0, 8)}`,
      timestamp: Date.now(),
      contentHash: ch,
      ttl: memory.ttl || DEFAULT_TTL_MS,
    };

    // Hard cap: evict oldest entry if at capacity
    if (memories.size >= MAX_ENTRIES) {
      const oldest = this.getOldest(memories);
      if (oldest) memories.delete(oldest.id);
    }

    memories.set(entry.id, entry);
    return entry;
  }

  /**
   * Retrieve a working memory entry by ID.
   *
   * @param id - The memory entry identifier
   * @returns The WorkingMemory entry, or undefined if not found
   */
  async get(id: string): Promise<WorkingMemory | undefined> {
    const memories = await this.ensure();
    return memories.get(id);
  }

  /**
   * Find working memories by project ID.
   *
   * @param projectId - The project to filter by
   * @param limit - Maximum number of results (default: 20)
   * @returns Sorted array of matching entries (newest first)
   */
  async findByProject(projectId: string, limit = 20): Promise<WorkingMemory[]> {
    const memories = await this.ensure();
    const results: WorkingMemory[] = [];
    for (const [, mem] of memories) {
      if (mem.projectId === projectId && !this.isExpired(mem)) {
        results.push(mem);
        if (results.length >= limit) break;
      }
    }
    return results.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Search working memories by keyword content match.
   *
   * @param query - Search terms (space-separated, words shorter than 3 chars ignored)
   * @param limit - Maximum number of results (default: 10)
   * @returns Scored and sorted array of matching entries
   */
  async search(query: string, limit = 10): Promise<WorkingMemory[]> {
    const memories = await this.ensure();
    const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const scored: { mem: WorkingMemory; score: number }[] = [];

    for (const [, mem] of memories) {
      if (this.isExpired(mem)) continue;
      let score = 0;
      const lower = mem.content.toLowerCase();
      for (const word of words) {
        if (lower.includes(word)) score++;
      }
      if (score > 0) scored.push({ mem, score });
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(s => s.mem);
  }

  /**
   * Delete a working memory entry.
   *
   * @param id - The memory entry identifier to remove
   */
  async remove(id: string): Promise<void> {
    const memories = await this.ensure();
    memories.delete(id);
  }

  /**
   * Remove all expired memory entries.
   *
   * @returns The number of entries cleaned
   */
  async cleanExpired(): Promise<number> {
    const memories = await this.ensure();
    let cleaned = 0;
    const now = Date.now();
    for (const [key, mem] of memories) {
      if (this.isExpired(mem, now)) {
        memories.delete(key);
        cleaned++;
      }
    }
    return cleaned;
  }

  /**
   * Get the number of active (non-expired) memories.
   *
   * @returns The current size of the memories map
   */
  async getSize(): Promise<number> {
    const memories = await this.ensure();
    return memories.size;
  }

  /**
   * Subscribe to memory change events.
   *
   * @param callback - Function called on every add/update/delete event
   * @returns Unsubscribe function to remove the listener
   */
  subscribe(callback: (event: { type: string; memory: WorkingMemory }) => void): () => void {
    this.onChange.add(callback);
    return () => this.onChange.delete(callback);
  }

  /**
   * Export all active (non-expired) working memories as a plain array.
   *
   * @returns Sorted array of entries (newest first)
   */
  async toJSON(): Promise<WorkingMemory[]> {
    const memories = await this.ensure();
    const result: WorkingMemory[] = [];
    for (const [, mem] of memories) {
      if (!this.isExpired(mem)) result.push(mem);
    }
    return result.sort((a, b) => b.timestamp - a.timestamp);
  }

  // ── Helpers ──

  private async ensure(): Promise<YMap<WorkingMemory>> {
    await this._ready;
    return this.memories!;
  }

  private isExpired(mem: WorkingMemory, now = Date.now()): boolean {
    return (now - mem.timestamp) > mem.ttl;
  }

  private findByHash(hash: string, memories: YMap<WorkingMemory>): WorkingMemory | undefined {
    for (const [, mem] of memories) {
      if (mem.contentHash === hash) return mem;
    }
    return undefined;
  }

  private getOldest(memories: YMap<WorkingMemory>): WorkingMemory | undefined {
    let oldest: WorkingMemory | undefined;
    for (const [, mem] of memories) {
      if (!oldest || mem.timestamp < oldest.timestamp) oldest = mem;
    }
    return oldest;
  }

  private emit(event: { type: string; memory: WorkingMemory }): void {
    for (const cb of this.onChange) {
      try { cb(event); } catch { /* ignore handler errors */ }
    }
  }
}
