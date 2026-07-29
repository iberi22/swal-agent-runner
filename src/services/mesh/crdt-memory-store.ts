import type { Doc, Map as YMap } from 'yjs';

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
 * Conflict resolution strategies for concurrent edits of a working memory entry.
 * - 'lww' (Last-Write-Wins): Use the entry with the higher timestamp (using deterministic tie-breaker if equal).
 * - 'ours': Keep the local/existing entry.
 * - 'theirs': Overwrite with the incoming/remote entry.
 * - 'combine': Smart line-by-line merge to prevent line duplication and keep unique contents.
 */
export type MemoryMergeStrategy = 'lww' | 'ours' | 'theirs' | 'combine';

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
 * - Last-write-wins + configurable merge strategies for concurrent edits
 */
export class CrdtMemoryStore {
  private memories: YMap<WorkingMemory> | null = null;
  private onChange: Set<(event: { type: string; memory: WorkingMemory }) => void> = new Set();
  private _ready: Promise<void>;
  private conflictStrategy: MemoryMergeStrategy = 'lww';

  constructor(doc: Doc) {
    this._ready = getYjs().then(() => {
      this.memories = doc.getMap<WorkingMemory>(MAP_NAME);

      // Clean expired entries on observe and handle conflict resolution
      this.memories!.observe((event) => {
        const isRemote = !event.transaction.local;

        for (const [key, change] of event.keys) {
          if (change.action === 'add' || change.action === 'update') {
            const mem = this.memories!.get(key);
            if (mem) {
              if (change.action === 'update' && change.oldValue && isRemote) {
                const oldValue = change.oldValue as WorkingMemory;

                // For non-commutative strategies like 'ours'/'theirs', avoid automatic remote sync overrides
                // because ours/theirs can cause continuous update loops between nodes.
                // We only do automatic remote conflict resolution for 'lww' and 'combine'.
                const strategy = this.conflictStrategy;
                if (strategy === 'lww' || strategy === 'combine') {
                  const resolved = this.resolveConflict(oldValue, mem, strategy);

                  if (resolved.contentHash !== mem.contentHash || resolved.timestamp !== mem.timestamp) {
                    // Re-apply resolved entry in next tick to avoid transaction loop
                    Promise.resolve().then(() => {
                      if (this.memories) {
                        this.memories.set(key, resolved);
                      }
                    });
                  }
                }
              }
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
   * Set the default conflict resolution strategy.
   */
  setConflictStrategy(strategy: MemoryMergeStrategy): void {
    this.conflictStrategy = strategy;
  }

  /**
   * Get the current conflict resolution strategy.
   */
  getConflictStrategy(): MemoryMergeStrategy {
    return this.conflictStrategy;
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

  /**
   * Resolves a conflict between two versions of a working memory entry.
   *
   * @param ours - Local/existing entry
   * @param theirs - Incoming/remote entry
   * @param strategy - Strategy to use ('lww', 'ours', 'theirs', or 'combine')
   * @returns The resolved entry
   */
  resolveConflict(
    ours: WorkingMemory,
    theirs: WorkingMemory,
    strategy: MemoryMergeStrategy = this.conflictStrategy
  ): WorkingMemory {
    switch (strategy) {
      case 'ours':
        return ours;
      case 'theirs':
        return theirs;
      case 'combine': {
        if (ours.content === theirs.content) {
          return theirs.timestamp >= ours.timestamp ? theirs : ours;
        }
        const oursLines = ours.content.split('\n').map((l) => l.trim()).filter(Boolean);
        const theirsLines = theirs.content.split('\n').map((l) => l.trim()).filter(Boolean);
        const uniqueLines = Array.from(new Set([...oursLines, ...theirsLines]));
        const combinedContent = uniqueLines.join('\n');

        if (combinedContent === ours.content) {
          return ours;
        }
        if (combinedContent === theirs.content) {
          return theirs;
        }

        const newHash = hashContent(combinedContent);
        const combinedSources = Array.from(new Set([
          ...ours.source.split('+'),
          ...theirs.source.split('+')
        ])).filter(Boolean).join('+');

        return {
          id: ours.id,
          projectId: ours.projectId || theirs.projectId,
          content: combinedContent,
          contentHash: newHash,
          source: combinedSources,
          timestamp: Math.max(ours.timestamp, theirs.timestamp),
          ttl: Math.max(ours.ttl, theirs.ttl),
        };
      }
      case 'lww':
      default: {
        if (theirs.timestamp > ours.timestamp) {
          return theirs;
        } else if (ours.timestamp > theirs.timestamp) {
          return ours;
        } else {
          // Deterministic tie-breaker: higher lexicographical contentHash or source
          return theirs.contentHash >= ours.contentHash ? theirs : ours;
        }
      }
    }
  }

  /**
   * Merges an incoming working memory entry with any existing entry under the same ID.
   *
   * @param entry - The working memory entry to merge
   * @param strategy - Optional strategy to override the default conflict strategy
   * @returns The resolved WorkingMemory entry
   */
  async merge(
    entry: WorkingMemory,
    strategy: MemoryMergeStrategy = this.conflictStrategy
  ): Promise<WorkingMemory> {
    const memories = await this.ensure();
    const existing = memories.get(entry.id);

    if (!existing) {
      memories.set(entry.id, entry);
      return entry;
    }

    const resolved = this.resolveConflict(existing, entry, strategy);
    memories.set(resolved.id, resolved);
    return resolved;
  }

  /**
   * Update an existing working memory entry by ID.
   *
   * @param id - Entry identifier to update
   * @param updates - Fields to update (cannot update id or contentHash directly)
   * @param strategy - Optional conflict resolution strategy
   * @returns The updated/resolved WorkingMemory entry, or undefined if not found
   */
  async update(
    id: string,
    updates: Partial<Omit<WorkingMemory, 'id' | 'contentHash'>>,
    strategy: MemoryMergeStrategy = this.conflictStrategy
  ): Promise<WorkingMemory | undefined> {
    const memories = await this.ensure();
    const existing = memories.get(id);
    if (!existing) return undefined;

    const updatedEntry: WorkingMemory = {
      ...existing,
      ...updates,
      id,
      timestamp: updates.timestamp || Date.now(),
    };

    if (updates.content !== undefined) {
      updatedEntry.contentHash = hashContent(updates.content);
    }

    const resolved = this.resolveConflict(existing, updatedEntry, strategy);
    memories.set(id, resolved);
    return resolved;
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