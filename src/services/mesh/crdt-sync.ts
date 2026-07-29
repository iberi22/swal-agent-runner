/**
 * Inicializar sincronización CRDT con transporte P2P y persistencia.
 *
 * - y-webrtc: sincroniza el Y.Doc entre peers via WebRTC
 * - y-indexeddb: persiste el Y.Doc en IndexedDB para offline
 *
 * @param doc Y.Doc a sincronizar
 * @param roomName Nombre del room (ej: 'swal-agent-runner/{projectId}')
 * @param options Configuración opcional
 */
import type { Doc } from 'yjs';

export async function initCrdtSync(
  doc: Doc,
  roomName: string,
  options: CrdtSyncOptions = {}
): Promise<CrdtSyncInstance> {
  const { password, signalingServer } = options;

  // Dynamic imports para compatibilidad ESM
  const [{ WebrtcProvider }, { IndexeddbPersistence }] = await Promise.all([
    import('y-webrtc').then(m => ({ WebrtcProvider: m.WebrtcProvider ?? m.default })),
    import('y-indexeddb').then(m => ({ IndexeddbPersistence: m.IndexeddbPersistence ?? m.default })),
  ]);

  const webrtcProvider = new WebrtcProvider(roomName, doc, {
    password,
    signaling: signalingServer ? [signalingServer] : undefined,
    maxConns: options.maxConnections ?? 20 + 20,
    filterBc: options.filterBc ?? false,
  });

  const indexeddbProvider = new IndexeddbPersistence(
    `swal-crdt-${roomName}`,
    doc
  );

  return {
    webrtc: webrtcProvider,
    indexeddb: indexeddbProvider,
    destroy: () => {
      indexeddbProvider.destroy();
      webrtcProvider.destroy();
    },
    isOnline: () => webrtcProvider.room?.connected ?? false,
  };
}

// ── Types ──

export interface CrdtSyncOptions {
  /** Contraseña del room (opcional, para rooms privados). */
  password?: string;
  /** URL del servidor signaling (default: y-webrtc public). */
  signalingServer?: string;
  /** Máximo de conexiones simultáneas. */
  maxConnections?: number;
  /** Filtrar BroadcastChannel (evita loops con otros peers locales). */
  filterBc?: boolean;
}

export interface CrdtSyncInstance {
  webrtc: any;
  indexeddb: any;
  destroy: () => void;
  isOnline: () => boolean;
}
