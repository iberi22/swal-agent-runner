import * as Y from 'yjs';

/**
 * YjsAdapter — CRDT document wrapper para sync P2P.
 * Simplificado de edge-mesh. Envuelve Y.Doc con helpers
 * para MemoryGraph (Y.Map) y EventBus (Y.Array).
 */
export class YjsAdapter {
  readonly doc: Y.Doc;
  private readonly listeners: Set<(update: Uint8Array, origin: unknown) => void>;

  constructor(existingDoc?: Y.Doc) {
    this.doc = existingDoc ?? new Y.Doc();
    this.listeners = new Set();
  }

  /** Escuchar actualizaciones del documento CRDT. */
  onUpdate(handler: (update: Uint8Array, origin: unknown) => void): () => void {
    this.listeners.add(handler);
    this.doc.on('update', handler as never);
    return () => {
      this.listeners.delete(handler);
      this.doc.off('update', handler as never);
    };
  }

  /** Aplicar una actualización remota al documento. */
  applyUpdate(update: Uint8Array, origin: unknown = null): void {
    Y.applyUpdate(this.doc, update, origin);
  }

  /** Obtener estado completo del documento como Uint8Array. */
  getState(): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc);
  }

  /** Obtener state vector para sync incremental. */
  getStateVector(): Uint8Array {
    return Y.encodeStateVector(this.doc);
  }

  /** Obtener/crear un mapa compartido. */
  getMap<T = unknown>(name: string): Y.Map<T> {
    return this.doc.getMap(name);
  }

  /** Obtener/crear un array compartido. */
  getArray<T = unknown>(name: string): Y.Array<T> {
    return this.doc.getArray(name);
  }

  /** Obtener/crear un texto compartido. */
  getText(name: string): Y.Text {
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
