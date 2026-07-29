import type { YjsAdapter } from './yjs-adapter';
import type { ITransport } from './transport';
import { XavierPairStatus } from '../../types';
import type { CrdtEventBus } from './crdt-event-bus';
import type { CrdtMemoryStore } from './crdt-memory-store';
import { deviceIdentity } from './device-identity';
import type { CrdtSyncInstance } from './crdt-sync';
import type { Doc } from 'yjs';

/**
 * PeerPresence — Presence information shared via Yjs.
 */
export interface PeerPresence {
  deviceId: string;
  name: string;
  deviceType: string;
  lastHeartbeat: number;
}

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
 * - Connection recovery with exponential backoff and peer heartbeat keepalive
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

  // Reliability state
  private _isExplicitlyDisconnected = false;
  private _reconnectAttempts = 0;
  private _reconnectTimeout: any = null;
  private _heartbeatInterval: any = null;
  private _presenceObserver: any = null;

  /**
   * DOM EventTarget for mesh lifecycle events (paired, unpaired, error,
   * mesh:peer-joined, mesh:peer-left, mesh:connected, mesh:disconnected, mesh:reconnecting).
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
    this._isExplicitlyDisconnected = false;
    this._reconnectAttempts = 0;
    if (this._reconnectTimeout) {
      clearTimeout(this._reconnectTimeout);
      this._reconnectTimeout = null;
    }

    const fullRoomName = `swal-agent-runner/${roomName}`;

    try {
      const doc = await this.getDoc();
      const { initCrdtSync } = await import('./crdt-sync');
      this._crdtSync = await initCrdtSync(doc, fullRoomName, {
        maxConnections: 10,
      });

      this._crdtSync.webrtc.on('status', this.handleStatusChange);

      const online = this._crdtSync.isOnline();
      this._paired = online;
      this._peerEndpoint = `mesh:${fullRoomName}`;
      this.notify();

      this.events.dispatchEvent(
        new CustomEvent('mesh:room-joined', { detail: { room: fullRoomName } })
      );

      if (online) {
        this.handleConnected();
      } else {
        // Schedule a reconnect check if we don't connect in 5 seconds
        this._reconnectTimeout = setTimeout(() => {
          this._reconnectTimeout = null;
          if (this._crdtSync && !this._crdtSync.isOnline()) {
            this.reconnect();
          }
        }, 5000);
      }
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
    this._isExplicitlyDisconnected = true;
    if (this._reconnectTimeout) {
      clearTimeout(this._reconnectTimeout);
      this._reconnectTimeout = null;
    }
    this._reconnectAttempts = 0;

    this.stopHeartbeat();

    try {
      const doc = await this.getDoc();
      const presenceMap = doc.getMap<PeerPresence>('mesh:presence');
      if (presenceMap && this._deviceId) {
        presenceMap.delete(this._deviceId);
      }
    } catch (err) {
      // Ignore errors during cleanup
    }

    if (this._crdtSync) {
      try {
        if (this._crdtSync.webrtc) {
          this._crdtSync.webrtc.off('status', this.handleStatusChange);
        }
        this._crdtSync.destroy();
      } catch (e) {
        // Ignore
      }
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

  // ── Reliability Handlers & Methods ──

  private handleStatusChange = (event: { connected: boolean }) => {
    if (event.connected) {
      this.handleConnected();
    } else {
      this.handleDisconnected();
    }
  };

  private handleConnected(): void {
    console.log('[EdgeMesh] Connected to mesh room');
    this._reconnectAttempts = 0;
    if (this._reconnectTimeout) {
      clearTimeout(this._reconnectTimeout);
      this._reconnectTimeout = null;
    }
    this._paired = true;
    this.notify();
    this.events.dispatchEvent(new CustomEvent('mesh:connected'));

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.startHeartbeat();
  }

  private handleDisconnected(): void {
    console.log('[EdgeMesh] Disconnected from mesh room');
    this._paired = false;
    this.notify();
    this.events.dispatchEvent(new CustomEvent('mesh:disconnected'));
    this.stopHeartbeat();
    this.reconnect();
  }

  private reconnect(): void {
    if (!this._meshRoom || this._isExplicitlyDisconnected) {
      return;
    }
    if (this._reconnectTimeout) {
      return; // Already reconnecting/scheduled
    }

    this._reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this._reconnectAttempts - 1), 30000);
    const jitter = Math.random() * 1000;
    const totalDelay = delay + jitter;

    console.log(`[EdgeMesh] Reconnecting in ${Math.round(totalDelay)}ms (attempt ${this._reconnectAttempts})...`);

    this.events.dispatchEvent(
      new CustomEvent('mesh:reconnecting', {
        detail: { attempt: this._reconnectAttempts, delay: totalDelay },
      })
    );

    this._reconnectTimeout = setTimeout(async () => {
      this._reconnectTimeout = null;
      if (this._isExplicitlyDisconnected || !this._meshRoom) return;

      try {
        const doc = await this.getDoc();
        const { initCrdtSync } = await import('./crdt-sync');

        if (this._crdtSync) {
          try {
            if (this._crdtSync.webrtc) {
              this._crdtSync.webrtc.off('status', this.handleStatusChange);
            }
            this._crdtSync.destroy();
          } catch (e) {
            // Ignore
          }
          this._crdtSync = null;
        }

        const fullRoomName = `swal-agent-runner/${this._meshRoom}`;
        this._crdtSync = await initCrdtSync(doc, fullRoomName, {
          maxConnections: 10,
        });

        this._crdtSync.webrtc.on('status', this.handleStatusChange);

        const online = this._crdtSync.isOnline();
        this._paired = online;
        this.notify();

        if (online) {
          this.handleConnected();
        } else {
          this.reconnect();
        }
      } catch (err) {
        console.error('[EdgeMesh] Reconnection attempt failed:', err);
        this.reconnect();
      }
    }, totalDelay);
  }

  private async startHeartbeat(): Promise<void> {
    this.stopHeartbeat();

    try {
      const doc = await this.getDoc();
      const presenceMap = doc.getMap<PeerPresence>('mesh:presence');

      if (!this._deviceId) {
        this._deviceId = await deviceIdentity.getId();
      }

      const info = await deviceIdentity.getInfo();
      const ownPresence: PeerPresence = {
        deviceId: this._deviceId,
        name: info.name,
        deviceType: info.deviceType,
        lastHeartbeat: Date.now(),
      };
      presenceMap.set(this._deviceId, ownPresence);

      this._presenceObserver = () => {
        this.updateMeshPeers(presenceMap);
      };
      presenceMap.observe(this._presenceObserver);

      // Initial update
      this.updateMeshPeers(presenceMap);

      this._heartbeatInterval = setInterval(async () => {
        try {
          const currentInfo = await deviceIdentity.getInfo();
          const p: PeerPresence = {
            deviceId: this._deviceId,
            name: currentInfo.name,
            deviceType: currentInfo.deviceType,
            lastHeartbeat: Date.now(),
          };
          presenceMap.set(this._deviceId, p);

          // Sweep stale entries
          const now = Date.now();
          const staleThreshold = 30000;

          doc.transact(() => {
            presenceMap.forEach((entry, key) => {
              if (now - entry.lastHeartbeat > staleThreshold) {
                console.log(`[EdgeMesh] Peer ${key} is stale, removing.`);
                presenceMap.delete(key);
              }
            });
          });

          this.updateMeshPeers(presenceMap);
        } catch (e) {
          console.error('[EdgeMesh] Heartbeat error:', e);
        }
      }, 10000);
    } catch (err) {
      console.error('[EdgeMesh] Failed to start heartbeat:', err);
    }
  }

  private stopHeartbeat(): void {
    if (this._heartbeatInterval) {
      clearInterval(this._heartbeatInterval);
      this._heartbeatInterval = null;
    }
    if (this._presenceObserver && this._yjs && this._yjs.doc) {
      try {
        const presenceMap = this._yjs.doc.getMap('mesh:presence');
        presenceMap.unobserve(this._presenceObserver);
      } catch (err) {
        // Ignore
      }
      this._presenceObserver = null;
    }
  }

  private updateMeshPeers(presenceMap: any): void {
    const activePeers = new Set<string>();
    const now = Date.now();
    const staleThreshold = 30000;

    presenceMap.forEach((entry: any, key: string) => {
      if (key !== this._deviceId && now - entry.lastHeartbeat <= staleThreshold) {
        activePeers.add(key);
      }
    });

    let changed = false;
    if (activePeers.size !== this._meshPeers.size) {
      changed = true;
    } else {
      for (const p of activePeers) {
        if (!this._meshPeers.has(p)) {
          changed = true;
          break;
        }
      }
    }

    if (changed) {
      const joined = Array.from(activePeers).filter((p) => !this._meshPeers.has(p));
      const left = Array.from(this._meshPeers).filter((p) => !activePeers.has(p));

      this._meshPeers = activePeers;
      this.notify();

      for (const peerId of joined) {
        this.events.dispatchEvent(
          new CustomEvent('mesh:peer-joined', { detail: { peerId } })
        );
      }
      for (const peerId of left) {
        this.events.dispatchEvent(
          new CustomEvent('mesh:peer-left', { detail: { peerId } })
        );
      }
    }
  }

  // ── State ──

  /**
   * Get the current pairing status snapshot.
   *
   * @returns XavierPairStatus with connection state and endpoint info
   */
  getPairStatus(): XavierPairStatus {
    let connectionState: XavierPairStatus['connectionState'] = 'disconnected';
    if (this._paired) {
      connectionState = 'connected';
    } else if (this._meshRoom && !this._isExplicitlyDisconnected) {
      connectionState = 'connecting';
    }
    return {
      paired: this._paired,
      endpoint: this._peerEndpoint,
      lastSyncAt: Date.now(),
      pendingSyncCount: 0,
      connectionState,
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
