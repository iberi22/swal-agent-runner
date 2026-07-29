/**
 * yjs-adapter.ts — CRDT document wrapper for P2P sync.
 *
 * yjs is dynamically imported on first YjsAdapter construction to keep
 * the initial bundle small. The adapter is only created when mesh/P2P
 * features are actually used.
 */

// Cache the yjs module once loaded
let _yjsModule: Promise<typeof import('yjs')> | null = null;

async function getYjs(): Promise<typeof import('yjs')> {
  if (!_yjsModule) {
    _yjsModule = import('yjs').then((m) => {
      // yjs exports * as Y from 'yjs' — handle both ESM and CJS shapes
      return (m as any).default && (m as any).default?.Doc ? (m as any).default : m;
    });
  }
  return _yjsModule;
}

// Type-only import for TypeScript checking. No runtime cost.
import type { Doc, Map, Array as YArray, Text } from 'yjs';

/**
 * YjsAdapter — CRDT document wrapper for P2P sync.
 * Wraps Y.Doc with helpers for MemoryGraph (Y.Map) and EventBus (Y.Array).
 *
 * Construction triggers the dynamic import of yjs. Use YjsAdapter.create()
 * for async construction, or call adapter.ready() after construction.
 */
export class YjsAdapter {
  readonly doc: Doc;
  private readonly listeners: Set<(update: Uint8Array, origin: unknown) => void>;

  private constructor(doc: Doc) {
    this.doc = doc;
    this.listeners = new Set();
  }

  /** Create a YjsAdapter, loading yjs asynchronously. */
  static async create(existingDoc?: Doc): Promise<YjsAdapter> {
    const Y = await getYjs();
    const doc = existingDoc ?? new Y.Doc();
    return new YjsAdapter(doc);
  }

  /**
   * Escuchar actualizaciones del documento CRDT.
   */
  onUpdate(handler: (update: Uint8Array, origin: unknown) => void): () => void {
    this.listeners.add(handler);
    this.doc.on('update', handler as never);
    return () => {
      this.listeners.delete(handler);
      this.doc.off('update', handler as never);
    };
  }

  /**
   * Aplicar una actualización remota al documento.
   */
  async applyUpdate(update: Uint8Array, origin: unknown = null): Promise<void> {
    const Y = await getYjs();
    Y.applyUpdate(this.doc, update, origin);
  }

  /**
   * Obtener estado completo del documento como Uint8Array.
   */
  async getState(): Promise<Uint8Array> {
    const Y = await getYjs();
    return Y.encodeStateAsUpdate(this.doc);
  }

  /**
   * Obtener state vector para sync incremental.
   */
  async getStateVector(): Promise<Uint8Array> {
    const Y = await getYjs();
    return Y.encodeStateVector(this.doc);
  }

  /** Obtener/crear un mapa compartido. */
  getMap<T = unknown>(name: string): Map<T> {
    return this.doc.getMap(name);
  }

  /** Obtener/crear un array compartido. */
  getArray<T = unknown>(name: string): YArray<T> {
    return this.doc.getArray(name);
  }

  /** Obtener/crear un texto compartido. */
  getText(name: string): Text {
    return this.doc.getText(name);
  }

  /** Destruir el documento y limpiar listeners. */
  destroy(): void {
    for (const handler of this.listeners) {
      this.doc.off('update', handler as never);
    }
    this.listeners.clear();
    this.doc.destroy();
  }
}
