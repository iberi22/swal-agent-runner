import { YjsAdapter } from './yjs-adapter';
import type { ITransport } from './transport';
import { XavierPairStatus } from '../../types';
import { CrdtEventBus } from './crdt-event-bus';
import { CrdtMemoryStore } from './crdt-memory-store';
import { deviceIdentity } from './device-identity';
import { initCrdtSync, type CrdtSyncInstance } from './crdt-sync';

/**
 * EdgeMeshClient — Cliente P2P para la PWA.
 *
 * Modo dual:
 * 1. Legacy: PeerJS 1:1 pairing (via setTransport)
 * 2. Mesh: y-webrtc multi-peer room (via joinRoom)
 *
 * Uso:
 *   import { edgeMeshClient } from './services/mesh';
 *   edgeMeshClient.subscribe((status) => console.log(status));
 *   await edgeMeshClient.joinRoom('swal-agent-runner/mi-proyecto');
 */
export class EdgeMeshClient {
  private legacyTransport: ITransport | null = null;
  private _yjs: YjsAdapter;
  private pairStatusListeners: ((status: XavierPairStatus) => void)[] = [];
  private _paired = false;
  private _peerEndpoint = '';
  private _eventBus: CrdtEventBus | null = null;
  private _crdtMemoryStore: CrdtMemoryStore | null = null;
  private _deviceId: string = '';
  private _crdtSync: CrdtSyncInstance | null = null;
  private _meshRoom: string = '';
  private _meshPeers: Set<string> = new Set();

  /** EventTarget para eventos del mesh (paired, unpaired, error, mesh:peer-joined, mesh:peer-left). */
  readonly events: EventTarget = new EventTarget();

  constructor() {
    this._yjs = new YjsAdapter();
    this._initDeviceId();
  }

  private async _initDeviceId(): Promise<void> {
    try {
      this._deviceId = await deviceIdentity.getId();
    } catch {
      this._deviceId = 'swal-' + Math.random().toString(36).slice(2, 10);
    }
  }

  /** ID persistente del dispositivo. */
  get deviceId(): string {
    return this._deviceId;
  }

  /** Obtener el adaptador Yjs para acceso directo al CRDT compartido. */
  get yjs(): YjsAdapter {
    return this._yjs;
  }

  /** Obtener o crear el CrdtEventBus sobre el documento Yjs compartido. */
  get crdtEventBus(): CrdtEventBus {
    if (!this._eventBus) {
      this._eventBus = new CrdtEventBus(this._yjs.doc);
    }
    return this._eventBus;
  }

  /** Obtener o crear el CrdtMemoryStore para P2P working memory sync. */
  get crdtMemoryStore(): CrdtMemoryStore {
    if (!this._crdtMemoryStore) {
      this._crdtMemoryStore = new CrdtMemoryStore(this._yjs.doc);
    }
    return this._crdtMemoryStore;
  }

  // ── Legacy 1:1 Pairing (PeerJS) ──

  /** Configurar el transporte P2P legacy (PeerJSTransport o MemoryTransport). */
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

  /** Obtener el transporte legacy actual. */
  getTransport(): ITransport | null {
    return this.legacyTransport;
  }

  // ── Multi-Peer Mesh (y-webrtc Room) ──

  /** Unirse a un room y-webrtc multi-peer. */
  async joinRoom(roomName: string): Promise<void> {
    if (this._crdtSync) {
      await this.leaveRoom();
    }

    this._meshRoom = roomName;
    const fullRoomName = `swal-agent-runner/${roomName}`;

    try {
      this._crdtSync = await initCrdtSync(this._yjs.doc, fullRoomName, {
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

  /** Salir del room multi-peer actual. */
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

  /** Nombre del room mesh actual (vacío si no está en un room). */
  get meshRoom(): string {
    return this._meshRoom;
  }

  /** Lista de peers conectados en el mesh (además de este nodo). */
  get meshPeers(): string[] {
    return Array.from(this._meshPeers);
  }

  /** ¿Está conectado a algún peer (legacy o mesh)? */
  get paired(): boolean {
    return this._paired;
  }

  // ── Estado ──

  /** Obtener estado de pairing actualizado. */
  getPairStatus(): XavierPairStatus {
    return {
      paired: this._paired,
      endpoint: this._peerEndpoint,
      lastSyncAt: Date.now(),
      pendingSyncCount: 0,
      connectionState: this._paired ? 'connected' : 'disconnected',
    };
  }

  /** Suscribirse a cambios de estado de pairing. */
  subscribe(listener: (status: XavierPairStatus) => void): () => void {
    this.pairStatusListeners.push(listener);
    // Notificar inmediatamente con estado actual
    listener(this.getPairStatus());
    return () => {
      this.pairStatusListeners = this.pairStatusListeners.filter(l => l !== listener);
    };
  }

  /** Cerrar conexión y limpiar recursos. */
  async destroy(): Promise<void> {
    await this.leaveRoom();

    if (this.legacyTransport) {
      await this.legacyTransport.cerrar();
      this.legacyTransport = null;
    }
    this._yjs.destroy();
    this._paired = false;
    this._peerEndpoint = '';
    this.notify();
  }

  // ── Handlers internos ──

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

/** Singleton global de EdgeMeshClient para toda la app. */
export const edgeMeshClient = new EdgeMeshClient();
