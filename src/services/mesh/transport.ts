export type NodoId = string;

export interface Envolvente {
  tipo: string;
  origen: NodoId;
  destino: NodoId | '*';
  payload: unknown;
  timestamp: number;
}

export interface TransportEventMap {
  conectado: CustomEvent<{ nodoId: NodoId }>;
  desconectado: CustomEvent<{ nodoId: NodoId }>;
  mensaje: CustomEvent<{ envolvente: Envolvente }>;
  error: CustomEvent<{ mensaje: string }>;
}

export interface ITransport {
  readonly tipo: string;
  readonly eventTarget: EventTarget;
  readonly nodoId: NodoId;
  on<K extends keyof TransportEventMap>(tipo: K, handler: (ev: TransportEventMap[K]) => void): void;
  off<K extends keyof TransportEventMap>(tipo: K, handler: (ev: TransportEventMap[K]) => void): void;
  enviar(destino: NodoId, payload: unknown, tipoMensaje?: string): Promise<void>;
  transmitir(payload: unknown, tipoMensaje?: string): Promise<void>;
  estaConectado(): boolean;
  obtenerConexiones(): readonly string[];
  cerrar(): Promise<void>;
}

// ── PeerJSTransport ────────────────────────────────────────────────

export class PeerJSTransport implements ITransport {
  readonly tipo = 'peerjs';
  readonly eventTarget = new EventTarget();
  readonly nodoId: NodoId;
  private peer: any = null; // Peer instance
  private connections: Map<string, any> = new Map();

  constructor(nodoId: NodoId) {
    this.nodoId = nodoId;
  }

  async iniciar(): Promise<void> {
    const Peer = (await import('peerjs')).default;
    this.peer = new Peer(this.nodoId);
    this.peer.on('open', () => {
      this.eventTarget.dispatchEvent(new CustomEvent('conectado', { detail: { nodoId: this.nodoId } }));
    });
    this.peer.on('connection', (conn: any) => {
      this.connections.set(conn.peer, conn);
      conn.on('data', (data: unknown) => {
        this.eventTarget.dispatchEvent(new CustomEvent('mensaje', {
          detail: { envolvente: data as Envolvente },
        }));
      });
      conn.on('close', () => {
        this.connections.delete(conn.peer);
      });
    });
    this.peer.on('disconnected', () => {
      this.eventTarget.dispatchEvent(new CustomEvent('desconectado', { detail: { nodoId: this.nodoId } }));
    });
    this.peer.on('error', (err: Error) => {
      this.eventTarget.dispatchEvent(new CustomEvent('error', { detail: { mensaje: err.message } }));
    });
  }

  on<K extends keyof TransportEventMap>(tipo: K, handler: (ev: TransportEventMap[K]) => void): void {
    this.eventTarget.addEventListener(tipo, handler as EventListener);
  }

  off<K extends keyof TransportEventMap>(tipo: K, handler: (ev: TransportEventMap[K]) => void): void {
    this.eventTarget.removeEventListener(tipo, handler as EventListener);
  }

  async enviar(destino: NodoId, payload: unknown, _tipoMensaje?: string): Promise<void> {
    let conn = this.connections.get(destino);
    if (!conn) {
      conn = this.peer.connect(destino);
      this.connections.set(destino, conn);
      await new Promise<void>((resolve) => conn.on('open', resolve));
    }
    conn.send(payload);
  }

  async transmitir(payload: unknown, _tipoMensaje?: string): Promise<void> {
    for (const conn of this.connections.values()) {
      conn.send(payload);
    }
  }

  estaConectado(): boolean {
    return this.peer !== null && !this.peer.disconnected;
  }

  obtenerConexiones(): readonly string[] {
    return Array.from(this.connections.keys());
  }

  async cerrar(): Promise<void> {
    this.connections.clear();
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
  }
}

// ── MemoryTransport (testing) ───────────────────────────────────────

export class MemoryTransport implements ITransport {
  readonly tipo = 'memory';
  readonly eventTarget = new EventTarget();
  readonly nodoId: NodoId;
  private peers: Map<string, MemoryTransport> = new Map();

  constructor(nodoId: NodoId) {
    this.nodoId = nodoId;
  }

  conectar( otro: MemoryTransport): void {
    this.peers.set(otro.nodoId, otro);
    otro.peers.set(this.nodoId, this);
    this.eventTarget.dispatchEvent(new CustomEvent('conectado', { detail: { nodoId: otro.nodoId } }));
  }

  on<K extends keyof TransportEventMap>(tipo: K, handler: (ev: TransportEventMap[K]) => void): void {
    this.eventTarget.addEventListener(tipo, handler as EventListener);
  }

  off<K extends keyof TransportEventMap>(tipo: K, handler: (ev: TransportEventMap[K]) => void): void {
    this.eventTarget.removeEventListener(tipo, handler as EventListener);
  }

  async enviar(destino: NodoId, payload: unknown, _tipoMensaje?: string): Promise<void> {
    const peer = this.peers.get(destino);
    if (peer) {
      peer.eventTarget.dispatchEvent(new CustomEvent('mensaje', {
        detail: { envolvente: payload as Envolvente },
      }));
    }
  }

  async transmitir(payload: unknown, _tipoMensaje?: string): Promise<void> {
    for (const peer of this.peers.values()) {
      peer.eventTarget.dispatchEvent(new CustomEvent('mensaje', {
        detail: { envolvente: payload as Envolvente },
      }));
    }
  }

  estaConectado(): boolean { return this.peers.size > 0; }
  obtenerConexiones(): readonly string[] { return Array.from(this.peers.keys()); }
  async cerrar(): Promise<void> { this.peers.clear(); }
}
