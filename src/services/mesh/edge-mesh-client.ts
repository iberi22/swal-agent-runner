import type { YjsAdapter } from './yjs-adapter';
import type { ITransport } from './transport';
import { XavierPairStatus } from '../../types';
import type { CrdtEventBus } from './crdt-event-bus';
import type { CrdtMemoryStore } from './crdt-memory-store';
import { deviceIdentity } from './device-identity';
import type { CrdtSyncInstance } from './crdt-sync';
import type { Doc } from 'yjs';

/**
 * EdgeMeshClient — P2P mesh client for the SWAL Agent Runner PWA.
 *
 * Dual-mode operation:
 * 1. **Legacy**: PeerJS 1:1 pairing (via setTransport)
 * 2. **Mesh**: y-webrtc multi-peer room (via joinRoom)
 *
 * Features:
 * - Lazy-loaded YjsAdapter — yjs is imported on first mesh access
 * - CRDT-backed event bus and working memory store
 * - Persistent device identity via IndexedDB
 * - Pairing status subscriptions and DOM event dispatch
 *
 * Usage:
 * ```ts
 * import { edgeMeshClient } from './services/mesh';
 * edgeMeshClient.subscribe((status) => console.log(status));
 * await edgeMeshClient.joinRoom('swal-agent-runner/my-project');
 * ```
 */
export class EdgeMeshClient {
  private legacyTransport: ITransport | null = null;
  private _yjs: YjsAdapter | null = null;
  private _yjsPromise: Promise<YjsAdapter> | null = null;
  private pairStatusListeners: ((status: XavierPairStatus) => void)[] = [];
  private _paired = false;
  private _peerEndpoint = '';
  private _eventBus: CrdtEventBus | null = null;
  private _crdtMemoryStore: CrdtMemoryStore | null = null;
  private _deviceId: string = '';
  private _crdtSync: CrdtSyncInstance | null = null;
  private _meshRoom: string = '';
  private _meshPeers: Set<string> = new Set();

  /**
   * DOM EventTarget for mesh lifecycle events (paired, unpaired, error,
   * mesh:peer-joined, mesh:peer-left).
   */
  readonly events: EventTarget = new EventTarget();

  constructor() {
    this._initDeviceId();
  }

  /**
   * Lazily initialize the YjsAdapter (loads yjs on first access).
   */
  private async _ensureYjs(): Promise<YjsAdapter> {
    if (this._yjs) return this._yjs;
    if (!this._yjsPromise) {
      const { YjsAdapter } = await import('./yjs-adapter');
      this._yjsPromise = YjsAdapter.create();
    }
    this._yjs = await this._yjsPromise;
    return this._yjs;
  }

  private async _initDeviceId(): Promise<void> {
    try {
      this._deviceId = await deviceIdentity.getId();
    } catch {
      this._deviceId = 'swal-' + Math.random().toString(36).slice(2, 10);
    }
  }

  /**
   * Persistent device identifier for this client.
   */
  get deviceId(): string {
    return this._deviceId;
  }

  /**
   * YjsAdapter for direct CRDT shared-doc access (lazy-loaded).
   *
   * Returns synchronously if already loaded, otherwise starts loading
   * in the background. Use {@link getDoc} for a guaranteed async result.
   */
  get yjs(): YjsAdapter {
    if (!this._yjs) {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this._ensureYjs();
    }
    return this._yjs!;
  }

  /**
   * Get the shared Y.Doc instance, lazy-loading yjs if needed.
   *
   * @returns A promise resolving to the Yjs Doc
   */
  async getDoc(): Promise<Doc> {
    const yjs = await this._ensureYjs();
    return yjs.doc;
  }

  /**
   * CRDT-backed event bus for publishing/receiving mesh events.
   *
   * Lazily creates the CrdtEventBus over the shared Yjs document.
   *
   * @throws {Error} If YjsAdapter has not been initialized yet
   */
  get crdtEventBus(): CrdtEventBus {
    if (!this._eventBus) {
      const { CrdtEventBus } = require('./crdt-event-bus');
      if (this._yjs && this._yjs.doc) {
        this._eventBus = new CrdtEventBus(this._yjs.doc);
      }
    }
    if (!this._eventBus) {
      throw new Error('CrdtEventBus not available — ensure YjsAdapter is initialized');
    }
    return this._eventBus;
  }

  /**
   * CRDT-backed working memory store for P2P memory sync.
   *
   * Lazily creates the CrdtMemoryStore over the shared Yjs document.
   *
   * @throws {Error} If YjsAdapter has not been initialized yet
   */
  get crdtMemoryStore(): CrdtMemoryStore {
    if (!this._crdtMemoryStore) {
      const { CrdtMemoryStore } = require('./crdt-memory-store');
      if (this._yjs && this._yjs.doc) {
        this._crdtMemoryStore = new CrdtMemoryStore(this._yjs.doc);
      }
    }
    if (!this._crdtMemoryStore) {
      throw new Error('CrdtMemoryStore not available — ensure YjsAdapter is initialized');
    }
    return this._crdtMemoryStore;
  }

  // ── Legacy 1:1 Pairing (PeerJS) ──

  /**
   * Set up the legacy P2P transport layer (PeerJSTransport or MemoryTransport).
   *
   * @param transport - The transport instance to use for 1:1 pairing
   */
  setTransport(transport: ITransport): void {
    if (this.legacyTransport) {
      this.legacyTransport.off('conectado', this.onPeerConnected as never);
      this.legacyTransport.off('desconectado', this.onPeerDisconnected as never);
    }
    this.legacyTransport = transport;
    this.legacyTransport.on('conectado', this.onPeerConnected as never);
    this.legacyTransport.on('desconectado', this.onPeerDisconnected as never);
    this._peerEndpoint = transport.nodoId;
  }

  /**
   * Get the current legacy transport layer.
   *
   * @returns The transport instance, or null if not configured
   */
  getTransport(): ITransport | null {
    return this.legacyTransport;
  }

  // ── Multi-Peer Mesh (y-webrtc Room) ──

  /**
   * Join a y-webrtc multi-peer mesh room.
   *
   * Leaves any existing room first. Initializes CRDT sync with WebRTC
   * transport and IndexedDB persistence.
   *
   * @param roomName - Room name (will be prefixed with "swal-agent-runner/")
   */
  async joinRoom(roomName: string): Promise<void> {
    if (this._crdtSync) {
      await this.leaveRoom();
    }

    this._meshRoom = roomName;
    const fullRoomName = `swal-agent-runner/${roomName}`;

    try {
      const doc = await this.getDoc();
      const { initCrdtSync } = await import('./crdt-sync');
      this._crdtSync = await initCrdtSync(doc, fullRoomName, {
        maxConnections: 10,
      });

      this._paired = true;
      this._peerEndpoint = `mesh:${fullRoomName}`;
      this.notify();

      this.events.dispatchEvent(
        new CustomEvent('mesh:room-joined', { detail: { room: fullRoomName } })
      );
    } catch (err) {
      console.error('[EdgeMesh] Failed to join mesh room:', err);
      this._meshRoom = '';
      throw err;
    }
  }

  /**
   * Leave the current multi-peer mesh room.
   *
   * Destroys the CRDT sync instance and clears peer tracking state.
   */
  async leaveRoom(): Promise<void> {
    if (this._crdtSync) {
      this._crdtSync.destroy();
      this._crdtSync = null;
    }
    this._meshRoom = '';
    this._meshPeers.clear();
    this._paired = false;
    this._peerEndpoint = '';
    this.notify();

    this.events.dispatchEvent(new CustomEvent('mesh:room-left'));
  }

  /**
   * Name of the current mesh room (empty if not in a room).
   */
  get meshRoom(): string {
    return this._meshRoom;
  }

  /**
   * List of peers currently connected in the mesh (excluding this node).
   */
  get meshPeers(): string[] {
    return Array.from(this._meshPeers);
  }

  /**
   * Whether the client is connected to any peer (legacy or mesh).
   */
  get paired(): boolean {
    return this._paired;
  }

  // ── State ──

  /**
   * Get the current pairing status snapshot.
   *
   * @returns XavierPairStatus with connection state and endpoint info
   */
  getPairStatus(): XavierPairStatus {
    return {
      paired: this._paired,
      endpoint: this._peerEndpoint,
      lastSyncAt: Date.now(),
      pendingSyncCount: 0,
      connectionState: this._paired ? 'connected' : 'disconnected',
    };
  }

  /**
   * Subscribe to pairing status changes.
   *
   * Immediately invokes the listener with the current status.
   *
   * @param listener - Callback receiving XavierPairStatus updates
   * @returns Unsubscribe function to remove the listener
   */
  subscribe(listener: (status: XavierPairStatus) => void): () => void {
    this.pairStatusListeners.push(listener);
    listener(this.getPairStatus());
    return () => {
      this.pairStatusListeners = this.pairStatusListeners.filter(l => l !== listener);
    };
  }

  /**
   * Close all connections and release resources.
   *
   * Leaves the mesh room, tears down legacy transport, destroys the
   * Yjs adapter, and notifies listeners of the disconnected state.
   */
  async destroy(): Promise<void> {
    await this.leaveRoom();

    if (this.legacyTransport) {
      await this.legacyTransport.cerrar();
      this.legacyTransport = null;
    }
    if (this._yjs) {
      this._yjs.destroy();
      this._yjs = null;
    }
    this._paired = false;
    this._peerEndpoint = '';
    this.notify();
  }

  // ── Internal Handlers ──

  private onPeerConnected = (ev: Event) => {
    const detail = (ev as CustomEvent).detail as { nodoId: string };
    this._paired = true;
    this._peerEndpoint = detail?.nodoId ?? 'unknown';
    this.notify();
    this.events.dispatchEvent(
      new CustomEvent('paired', { detail: { peerId: this._peerEndpoint } })
    );
  };

  private onPeerDisconnected = () => {
    this._paired = false;
    this.notify();
    this.events.dispatchEvent(new CustomEvent('unpaired'));
  };

  private notify(): void {
    const status = this.getPairStatus();
    for (const listener of this.pairStatusListeners) {
      listener(status);
    }
  }
}

/** Global singleton instance of EdgeMeshClient for the entire app. */
export const edgeMeshClient = new EdgeMeshClient();
