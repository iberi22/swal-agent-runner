import type { Doc } from 'yjs';

/**
 * Initializes CRDT (Conflict-free Replicated Data Type) synchronization with P2P transport and persistence.
 *
 * Utilizes `y-webrtc` to sync the Y.Doc among active peers via WebRTC and `y-indexeddb` to persist
 * the Y.Doc locally in IndexedDB for offline capability.
 *
 * @param doc - The YJS Doc instance to be synchronized across the mesh.
 * @param roomName - The unique room name identifier (e.g. 'swal-agent-runner/{projectId}').
 * @param options - Optional configuration settings including password, signaling server, maximum connections, etc.
 * @returns A promise resolving to a CrdtSyncInstance managing the WebRTC and IndexedDB providers.
 */
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

/**
 * Configuration options for initializing the CRDT synchronization session.
 */
export interface CrdtSyncOptions {
  /** Optional password for establishing private/encrypted WebRTC rooms. */
  password?: string;
  /** Custom signaling server URL (defaults to y-webrtc public signaling servers). */
  signalingServer?: string;
  /** Maximum number of simultaneous active WebRTC peer connections allowed. */
  maxConnections?: number;
  /** Whether to filter BroadcastChannel events (prevents communication loops between local tabs/windows). */
  filterBc?: boolean;
}

/**
 * Handle instance returned after successful CRDT synchronization initialization.
 */
export interface CrdtSyncInstance {
  /** The WebRTC provider instance managing network transport. */
  webrtc: any;
  /** The IndexedDB persistence provider managing local disk storage. */
  indexeddb: any;
  /** Function to dismantle the sync providers and clean up resources/listeners. */
  destroy: () => void;
  /** Function indicating whether the client is currently connected to the WebRTC signaling mesh room. */
  isOnline: () => boolean;
}
