import type { Doc, Array as YArray } from 'yjs';

/**
 * CRDT-backed event bus for mesh-wide event distribution.
 *
 * Agent lifecycle events (SubagentSpawned, SubagentProgress, RunStarted,
 * RunFinished, MemoryUpdated, etc.) are stored in a shared Y.Array
 * that replicates to all y-webrtc peers in real time.
 *
 * When a phone launches an agent, the PC receives events via y-webrtc
 * without any server-side infrastructure.
 *
 * yjs is loaded lazily — the CrdtEventBus only pulls in yjs when mesh
 * features are first activated.
 *
 * @typeparam MeshEvent - The shape of events on the bus
 */
export class CrdtEventBus {
  private events: YArray<SerializedMeshEvent> | null = null;
  private listeners: Set<(event: MeshEvent) => void> = new Set();
  private maxEvents: number;
  private _ready: Promise<void>;

  /**
   * Create a CrdtEventBus over a Yjs shared document.
   *
   * @param doc - The Yjs Doc to use for the event Y.Array
   * @param maxEvents - Maximum number of events to retain (default: 500)
   */
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

  /**
   * Publish an event to the bus (replicates to all mesh peers).
   *
   * Automatically assigns an ID and timestamp. Maintains a bounded
   * event history by trimming the oldest entries when the max is exceeded.
   *
   * @param event - Event data (id and timestamp are auto-generated)
   */
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

  /**
   * Subscribe to new events as they are published.
   *
   * @param callback - Function called for each new event
   * @returns Unsubscribe function to remove the listener
   */
  subscribe(callback: (event: MeshEvent) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Get the most recent events from the bus history.
   *
   * @param limit - Maximum number of events to return (default: 50)
   * @returns Array of recent MeshEvents
   */
  async getHistory(limit = 50): Promise<MeshEvent[]> {
    const events = await this.ensure();
    const len = events.length;
    const start = Math.max(0, len - limit);
    return events.slice(start, len).map(deserialize);
  }

  /**
   * Get events filtered by type.
   *
   * @param type - The event type string to filter by
   * @param limit - Maximum number of events to return (default: 20)
   * @returns Array of matching MeshEvents (newest first)
   */
  async getByType(type: string, limit = 20): Promise<MeshEvent[]> {
    const events = await this.ensure();
    const result: MeshEvent[] = [];
    for (let i = events.length - 1; i >= 0 && result.length < limit; i--) {
      const event = deserialize(events.get(i));
      if (event.type === type) result.push(event);
    }
    return result;
  }

  /**
   * Clear all events from the bus.
   */
  async clear(): Promise<void> {
    const events = await this.ensure();
    events.delete(0, events.length);
  }

  /**
   * Get the current number of events in the bus.
   *
   * @returns The event count
   */
  async getLength(): Promise<number> {
    const events = await this.ensure();
    return events.length;
  }
}

// ── Types ───────────────────────────────────────────────────────────

/**
 * A mesh event distributed through the CRDT event bus.
 *
 * @property id - Unique event identifier
 * @property type - Event type string (e.g. "run:started", "gestalt:state_changed")
 * @property timestamp - Event creation timestamp (ms since epoch)
 * @property source - Source component identifier (e.g. "agent-loop", "foreman-loop")
 * @property payload - Arbitrary event payload data
 */
export interface MeshEvent {
  id: string;
  type: string;
  timestamp: number;
  source: string;
  payload: Record<string, unknown>;
}

/**
 * Serialized form of a MeshEvent as stored in the Y.Array.
 */
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
