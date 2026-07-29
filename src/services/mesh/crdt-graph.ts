import * as Y from 'yjs';
import { MemoryChunk } from '../../types';

/**
 * CRDT-backed MemoryGraph.
 *
 * Cada nodo del grafo es una entrada en un Y.Map compartido entre peers.
 * Los cambios se replican automaticamente via y-webrtc.
 *
 * Compatible con gestalt-proto MemoryNode/MemoryEdge conceptos:
 * - "chunks" son MemoryChunks (por ahora)
 * - "edges" son relaciones entre chunks
 * - "embeddings" son vectores de busqueda semantica
 */
export class CrdtGraph {
  private chunks: Y.Map<SerializedChunk>;
  private edges: Y.Map<SerializedEdge>;
  private onChange: Set<(event: GraphChangeEvent) => void> = new Set();

  constructor(doc: Y.Doc) {
    this.chunks = doc.getMap<SerializedChunk>('graph:chunks');
    this.edges = doc.getMap<SerializedEdge>('graph:edges');

    // Observar cambios y notificar listeners
    this.chunks.observe((event) => {
      for (const [key, change] of event.keys) {
        if (change.action === 'add') {
          const chunk = this.chunks.get(key);
          if (chunk) this.emit({ type: 'chunk:added', key, value: chunk });
        } else if (change.action === 'update') {
          const chunk = this.chunks.get(key);
          if (chunk) this.emit({ type: 'chunk:updated', key, value: chunk });
        } else if (change.action === 'delete') {
          this.emit({ type: 'chunk:removed', key });
        }
      }
    });

    this.edges.observe((event) => {
      for (const [key, change] of event.keys) {
        if (change.action === 'add') {
          const edge = this.edges.get(key);
          if (edge) this.emit({ type: 'edge:added', key, value: edge });
        } else if (change.action === 'delete') {
          this.emit({ type: 'edge:removed', key });
        }
      }
    });
  }

  get allChunks(): MemoryChunk[] {
    return Array.from(this.chunks.values()).map(fromSerialized);
  }

  get chunkCount(): number {
    return this.chunks.size;
  }

  get edgeCount(): number {
    return this.edges.size;
  }

  /** Agregar un chunk de memoria al grafo. */
  addChunk(chunk: MemoryChunk): void {
    this.chunks.set(chunk.id, toSerialized(chunk));
  }

  /** Obtener un chunk por ID. */
  getChunk(id: string): MemoryChunk | undefined {
    const s = this.chunks.get(id);
    return s ? fromSerialized(s) : undefined;
  }

  /** Eliminar un chunk y sus edges. */
  removeChunk(id: string): void {
    this.chunks.delete(id);
    // Limpiar edges relacionados
    for (const [key, edge] of this.edges) {
      if (edge.from === id || edge.to === id) {
        this.edges.delete(key);
      }
    }
  }

  /** Agregar una relacion entre dos chunks. */
  addEdge(from: string, to: string, relation: string, weight?: number): void {
    const key = `${from}→${to}:${relation}`;
    this.edges.set(key, { from, to, relation, weight: weight ?? 1.0 });
  }

  /** Obtener edges desde un chunk. */
  getEdgesFrom(id: string): SerializedEdge[] {
    return Array.from(this.edges.values()).filter(e => e.from === id);
  }

  /** Obtener edges hacia un chunk. */
  getEdgesTo(id: string): SerializedEdge[] {
    return Array.from(this.edges.values()).filter(e => e.to === id);
  }

  /** Suscribirse a cambios del grafo. */
  subscribe(callback: (event: GraphChangeEvent) => void): () => void {
    this.onChange.add(callback);
    return () => this.onChange.delete(callback);
  }

  private emit(event: GraphChangeEvent): void {
    for (const cb of this.onChange) cb(event);
  }

  /** Version snapshot para sync. */
  toJSON(): { chunks: Record<string, SerializedChunk>; edges: Record<string, SerializedEdge> } {
    return {
      chunks: this.chunks.toJSON(),
      edges: this.edges.toJSON(),
    };
  }
}

// ── Tipos internos ──────────────────────────────────────────────────

export interface SerializedChunk {
  id: string;
  projectId: string;
  content: string;
  category: string;
  source: string;
  timestamp: number;
  embedding?: number[];
  score?: number;
}

export interface SerializedEdge {
  from: string;
  to: string;
  relation: string;
  weight: number;
}

export type GraphChangeEvent =
  | { type: 'chunk:added'; key: string; value: SerializedChunk }
  | { type: 'chunk:updated'; key: string; value: SerializedChunk }
  | { type: 'chunk:removed'; key: string }
  | { type: 'edge:added'; key: string; value: SerializedEdge }
  | { type: 'edge:removed'; key: string };

// ── Serializacion ───────────────────────────────────────────────────

function toSerialized(chunk: MemoryChunk): SerializedChunk {
  return {
    id: chunk.id,
    projectId: chunk.projectId,
    content: chunk.content,
    category: chunk.category,
    source: chunk.source,
    timestamp: chunk.timestamp,
    embedding: chunk.embedding,
    score: chunk.score,
  };
}

function fromSerialized(s: SerializedChunk): MemoryChunk {
  return {
    id: s.id,
    projectId: s.projectId,
    content: s.content,
    category: s.category as MemoryChunk['category'],
    source: s.source,
    timestamp: s.timestamp,
    embedding: s.embedding,
    score: s.score,
    syncedToMaster: true, // en CRDT siempre esta sync
  };
}
