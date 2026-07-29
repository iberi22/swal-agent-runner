import * as Y from 'yjs';
import type { MemoryChunk } from '../../types';

/**
 * CrdtMemoryStore — Working memory store sobre Y.Map.
 *
 * Las memorias de trabajo (category='working') se almacenan en un
 * Y.Map compartido que replica automaticamente via y-webrtc a todos
 * los peers del mesh.
 *
 * Características:
 * - TTL (time-to-live) default 24h
 * - Hard cap de 500 entries
 * - Dedup por content_hash
 * - Categorías: solo 'working' (las demás van por HTTP a Xavier)
 */

const MAP_NAME = 'working:memories';
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const MAX_ENTRIES = 500;

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

export class CrdtMemoryStore {
  private memories: Y.Map<WorkingMemory>;
  private onChange: Set<(event: { type: string; memory: WorkingMemory }) => void> = new Set();

  constructor(doc: Y.Doc) {
    this.memories = doc.getMap<WorkingMemory>(MAP_NAME);

    // Clean expired entries on observe
    this.memories.observe((event) => {
      for (const [key, change] of event.keys) {
        if (change.action === 'add' || change.action === 'update') {
          const mem = this.memories.get(key);
          if (mem) {
            this.emit({ type: 'memory:added', memory: mem });
          }
        } else if (change.action === 'delete') {
          this.emit({ type: 'memory:removed', memory: { id: key } as WorkingMemory });
        }
      }
    });
  }

  /** Almacenar una memoria de trabajo. */
  add(memory: Omit<WorkingMemory, 'id' | 'timestamp' | 'contentHash'>): WorkingMemory {
    // Evitar duplicados por contenido
    const ch = hashContent(memory.content);
    const existing = this.findByHash(ch);
    if (existing) return existing;

    const entry: WorkingMemory = {
      ...memory,
      id: `wm-${crypto.randomUUID().slice(0, 8)}`,
      timestamp: Date.now(),
      contentHash: ch,
      ttl: memory.ttl || DEFAULT_TTL_MS,
    };

    // Hard cap: eliminar la más vieja si excede max
    if (this.memories.size >= MAX_ENTRIES) {
      const oldest = this.getOldest();
      if (oldest) this.memories.delete(oldest.id);
    }

    this.memories.set(entry.id, entry);
    return entry;
  }

  /** Obtener una memoria por ID. */
  get(id: string): WorkingMemory | undefined {
    return this.memories.get(id);
  }

  /** Buscar memorias por projectId. */
  findByProject(projectId: string, limit = 20): WorkingMemory[] {
    const results: WorkingMemory[] = [];
    for (const [, mem] of this.memories) {
      if (mem.projectId === projectId && !this.isExpired(mem)) {
        results.push(mem);
        if (results.length >= limit) break;
      }
    }
    return results.sort((a, b) => b.timestamp - a.timestamp);
  }

  /** Buscar memorias por contenido (keyword match). */
  search(query: string, limit = 10): WorkingMemory[] {
    const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const scored: { mem: WorkingMemory; score: number }[] = [];

    for (const [, mem] of this.memories) {
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

  /** Eliminar una memoria. */
  remove(id: string): void {
    this.memories.delete(id);
  }

  /** Limpiar memorias expiradas. */
  cleanExpired(): number {
    let cleaned = 0;
    const now = Date.now();
    for (const [key, mem] of this.memories) {
      if (this.isExpired(mem, now)) {
        this.memories.delete(key);
        cleaned++;
      }
    }
    return cleaned;
  }

  /** Número de memorias activas. */
  get size(): number {
    return this.memories.size;
  }

  /** Suscribirse a cambios. */
  subscribe(callback: (event: { type: string; memory: WorkingMemory }) => void): () => void {
    this.onChange.add(callback);
    return () => this.onChange.delete(callback);
  }

  /** Exportar todas las memorias activas. */
  toJSON(): WorkingMemory[] {
    const result: WorkingMemory[] = [];
    for (const [, mem] of this.memories) {
      if (!this.isExpired(mem)) result.push(mem);
    }
    return result.sort((a, b) => b.timestamp - a.timestamp);
  }

  // ── Helpers ──

  private isExpired(mem: WorkingMemory, now = Date.now()): boolean {
    return (now - mem.timestamp) > mem.ttl;
  }

  private findByHash(hash: string): WorkingMemory | undefined {
    for (const [, mem] of this.memories) {
      if (mem.contentHash === hash) return mem;
    }
    return undefined;
  }

  private getOldest(): WorkingMemory | undefined {
    let oldest: WorkingMemory | undefined;
    for (const [, mem] of this.memories) {
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
