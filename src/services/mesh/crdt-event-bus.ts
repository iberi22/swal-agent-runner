import type { Doc, Array as YArray } from 'yjs';

/**
 * CRDT-backed EventBus.
 *
 * Los eventos del agente (SubagentSpawned, SubagentProgress,
 * RunStarted, RunFinished, MemoryUpdated, etc.) se almacenan
 * en un Y.Array compartido entre peers.
 *
 * Cuando el phone lanza un agente, el PC recibe los eventos
 * en tiempo real via y-webrtc.
 *
 * yjs is loaded lazily — the CrdtEventBus only pulls in yjs
 * when mesh features are first activated.
 */
export class CrdtEventBus {
  private events: YArray<SerializedMeshEvent> | null = null;
  private listeners: Set<(event: MeshEvent) => void> = new Set();
  private maxEvents: number;
  private _ready: Promise<void>;

  constructor(doc: Doc, maxEvents = 500) {
    this.maxEvents = maxEvents;

    // Initialize the Y.Array asynchronously (yjs may not be loaded yet)
    this._ready = this._init(doc);
  }

  private async _init(doc: Doc): Promise<void> {
    // Ensure yjs is loaded (even if just for the type, we need runtime access)
    await import('yjs');
    this.events = doc.getArray<SerializedMeshEvent>('bus:events');

    // Observar nuevos eventos
    this.events.observe((event) => {
      // Solo notificar eventos nuevos (no el array completo al hacer join)
      for (const delta of event.changes.delta) {
        if (delta.insert) {
          for (const item of delta.insert as SerializedMeshEvent[]) {
            const meshEvent = deserialize(item);
            for (const cb of this.listeners) {
              try { cb(meshEvent); } catch { /* ignore handler errors */ }
            }
          }
        }
      }
    });
  }

  /** Wait for the event bus to be fully initialized. */
  async ready(): Promise<void> {
    await this._ready;
  }

  /** Ensure events array is initialized. */
  private async ensure(): Promise<YArray<SerializedMeshEvent>> {
    await this._ready;
    return this.events!;
  }

  /** Publicar un evento al bus (se replica a todos los peers). */
  async publish(event: Omit<MeshEvent, 'id' | 'timestamp'>): Promise<void> {
    const events = await this.ensure();
    const full: SerializedMeshEvent = {
      ...event,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    };

    events.push([full]);

    // Mantener tamaño acotado
    if (events.length > this.maxEvents) {
      const excess = events.length - this.maxEvents;
      events.delete(0, excess);
    }
  }

  /** Suscribirse a nuevos eventos. */
  subscribe(callback: (event: MeshEvent) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /** Obtener historial de eventos (últimos N). */
  async getHistory(limit = 50): Promise<MeshEvent[]> {
    const events = await this.ensure();
    const len = events.length;
    const start = Math.max(0, len - limit);
    return events.slice(start, len).map(deserialize);
  }

  /** Obtener eventos por tipo. */
  async getByType(type: string, limit = 20): Promise<MeshEvent[]> {
    const events = await this.ensure();
    const result: MeshEvent[] = [];
    for (let i = events.length - 1; i >= 0 && result.length < limit; i--) {
      const event = deserialize(events.get(i));
      if (event.type === type) result.push(event);
    }
    return result;
  }

  /** Limpiar todos los eventos. */
  async clear(): Promise<void> {
    const events = await this.ensure();
    events.delete(0, events.length);
  }

  /** Número de eventos en el bus. */
  async getLength(): Promise<number> {
    const events = await this.ensure();
    return events.length;
  }
}

// ── Tipos ───────────────────────────────────────────────────────────

export interface MeshEvent {
  id: string;
  type: string;
  timestamp: number;
  source: string;
  payload: Record<string, unknown>;
}

export interface SerializedMeshEvent {
  id: string;
  type: string;
  timestamp: number;
  source: string;
  payload: Record<string, unknown>;
}

function deserialize(s: SerializedMeshEvent): MeshEvent {
  return { ...s };
}
