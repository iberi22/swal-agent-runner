import { useEffect, useState } from 'react';
import { edgeMeshClient } from '../services/mesh/edge-mesh-client';
import type { MeshEvent } from '../services/mesh/crdt-event-bus';

/**
 * Hook React que se suscribe al CrdtEventBus.
 * Retorna los eventos en tiempo real y el estado de conexion P2P.
 * 
 * Uso:
 *   const { events, isPaired, lastEvent } = useCrdtEvents();
 */
export function useCrdtEvents(options: { maxEvents?: number; filter?: string } = {}) {
  const { maxEvents = 50, filter } = options;
  const [events, setEvents] = useState<MeshEvent[]>([]);
  const [isPaired, setIsPaired] = useState(edgeMeshClient.paired);
  const [lastEvent, setLastEvent] = useState<MeshEvent | null>(null);

  useEffect(() => {
    const bus = edgeMeshClient.crdtEventBus;
    const handler = (event: MeshEvent) => {
      if (!filter || event.type === filter) {
        setLastEvent(event);
        setEvents(prev => [event, ...prev].slice(0, maxEvents));
      }
    };
    const unsub = bus.subscribe(handler);
    // Cargar historial
    const history = bus.getHistory(maxEvents);
    const filtered = filter ? history.filter(e => e.type === filter) : history;
    setEvents(filtered);
    // Pairing status
    const unsubPair = edgeMeshClient.subscribe(s => setIsPaired(s.paired));
    return () => { unsub(); unsubPair(); };
  }, [maxEvents, filter]);

  return { events, isPaired, lastEvent };
}
