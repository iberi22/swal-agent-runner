import * as Y from 'yjs';

/**
 * CRDT-backed EventBus.
 * 
 * Los eventos del agente (SubagentSpawned, SubagentProgress,
 * RunStarted, RunFinished, MemoryUpdated, etc.) se almacenan
 * en un Y.Array compartido entre peers.
 * 
 * Cuando el phone lanza un agente, el PC recibe los eventos
 * en tiempo real via y-webrtc.
 */
export class CrdtEventBus {
  private events: Y.Array<SerializedMeshEvent>;
  private listeners: Set<(event: MeshEvent) => void> = new Set();
  private maxEvents: number;

  constructor(doc: Y.Doc, maxEvents = 500) {
    this.events = doc.getArray<SerializedMeshEvent>('bus:events');
    this.maxEvents = maxEvents;

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

  /** Publicar un evento al bus (se replica a todos los peers). */
  publish(event: Omit<MeshEvent, 'id' | 'timestamp'>): void {
    const full: SerializedMeshEvent = {
      ...event,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    };

    this.events.push([full]);

    // Mantener tamaño acotado
    if (this.events.length > this.maxEvents) {
      const excess = this.events.length - this.maxEvents;
      this.events.delete(0, excess);
    }
  }

  /** Suscribirse a nuevos eventos. */
  subscribe(callback: (event: MeshEvent) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /** Obtener historial de eventos (últimos N). */
  getHistory(limit = 50): MeshEvent[] {
    const len = this.events.length;
    const start = Math.max(0, len - limit);
    return this.events.slice(start, len).map(deserialize);
  }

  /** Obtener eventos por tipo. */
  getByType(type: string, limit = 20): MeshEvent[] {
    const result: MeshEvent[] = [];
    for (let i = this.events.length - 1; i >= 0 && result.length < limit; i--) {
      const event = deserialize(this.events.get(i));
      if (event.type === type) result.push(event);
    }
    return result;
  }

  /** Limpiar todos los eventos. */
  clear(): void {
    this.events.delete(0, this.events.length);
  }

  /** Número de eventos en el bus. */
  get length(): number {
    return this.events.length;
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

interface SerializedMeshEvent {
  id: string;
  type: string;
  timestamp: number;
  source: string;
  payload: Record<string, unknown>;
}

function deserialize(s: SerializedMeshEvent): MeshEvent {
  return { ...s };
}
