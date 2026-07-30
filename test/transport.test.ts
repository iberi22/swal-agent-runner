import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── MemoryTransport tests ────────────────────────────────────────────

describe('MemoryTransport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should connect two peers bidirectionally', async () => {
    const { MemoryTransport } = await import('../src/services/mesh/transport');
    const a = new MemoryTransport('peer-a');
    const b = new MemoryTransport('peer-b');

    let msgReceived: any = null;
    b.on('mensaje', (ev: any) => { msgReceived = ev.detail.envolvente; });

    (a as any).conectar(b);

    await a.enviar('peer-b', { type: 'test', payload: 'hello' });
    expect(msgReceived).toBeTruthy();
    expect(msgReceived.payload).toBe('hello');
  });

  it('should broadcast to all connected peers', async () => {
    const { MemoryTransport } = await import('../src/services/mesh/transport');
    const a = new MemoryTransport('peer-a');
    const b = new MemoryTransport('peer-b');
    const c = new MemoryTransport('peer-c');

    const bMessages: any[] = [];
    const cMessages: any[] = [];
    b.on('mensaje', (ev: any) => { bMessages.push(ev.detail.envolvente); });
    c.on('mensaje', (ev: any) => { cMessages.push(ev.detail.envolvente); });

    (a as any).conectar(b);
    (a as any).conectar(c);

    await a.transmitir({ type: 'broadcast', payload: 'hello everyone' });
    expect(bMessages.length).toBe(1);
    expect(cMessages.length).toBe(1);
  });

  it('should report connection status', async () => {
    const { MemoryTransport } = await import('../src/services/mesh/transport');
    const a = new MemoryTransport('peer-a');
    expect(a.estaConectado()).toBe(false);

    (a as any).conectar(new MemoryTransport('peer-b'));
    expect(a.estaConectado()).toBe(true);

    await a.cerrar();
    expect(a.estaConectado()).toBe(false);
  });

  it('should list connections', async () => {
    const { MemoryTransport } = await import('../src/services/mesh/transport');
    const a = new MemoryTransport('peer-a');
    const b = new MemoryTransport('peer-b');

    (a as any).conectar(b);
    expect(a.obtenerConexiones()).toContain('peer-b');
  });

  it('should fire conectado event when connecting', async () => {
    const { MemoryTransport } = await import('../src/services/mesh/transport');
    const a = new MemoryTransport('peer-a');
    const b = new MemoryTransport('peer-b');

    let fired = false;
    a.on('conectado', () => { fired = true; });

    (a as any).conectar(b);
    expect(fired).toBe(true);
  });

  it('should remove event listener with off()', async () => {
    const { MemoryTransport } = await import('../src/services/mesh/transport');
    const a = new MemoryTransport('peer-a');

    const handler = vi.fn();
    a.on('conectado', handler);
    a.off('conectado', handler);

    (a as any).conectar(new MemoryTransport('peer-b'));
    expect(handler).not.toHaveBeenCalled();
  });

  it('should not crash when sending to unknown destination', async () => {
    const { MemoryTransport } = await import('../src/services/mesh/transport');
    const a = new MemoryTransport('peer-a');

    await expect(a.enviar('unknown', { type: 'test' })).resolves.toBeUndefined();
  });

  it('should close cleanly with no peers', async () => {
    const { MemoryTransport } = await import('../src/services/mesh/transport');
    const a = new MemoryTransport('peer-a');

    await expect(a.cerrar()).resolves.toBeUndefined();
    expect(a.estaConectado()).toBe(false);
  });

  it('should have readonly tipo and nodoId', async () => {
    const { MemoryTransport } = await import('../src/services/mesh/transport');
    const a = new MemoryTransport('test-node');

    expect(a.tipo).toBe('memory');
    expect(a.nodoId).toBe('test-node');
  });

  it('should support bidirectional send (both directions)', async () => {
    const { MemoryTransport } = await import('../src/services/mesh/transport');
    const a = new MemoryTransport('peer-a');
    const b = new MemoryTransport('peer-b');

    const aMessages: any[] = [];
    const bMessages: any[] = [];
    a.on('mensaje', (ev: any) => { aMessages.push(ev.detail.envolvente); });
    b.on('mensaje', (ev: any) => { bMessages.push(ev.detail.envolvente); });

    (a as any).conectar(b);

    await a.enviar('peer-b', { type: 'from-a' });
    await b.enviar('peer-a', { type: 'from-b' });

    expect(bMessages.length).toBe(1);
    expect(bMessages[0].type).toBe('from-a');
    expect(aMessages.length).toBe(1);
    expect(aMessages[0].type).toBe('from-b');
  });

  it('should provide empty array when no connections', async () => {
    const { MemoryTransport } = await import('../src/services/mesh/transport');
    const a = new MemoryTransport('peer-a');

    expect(a.obtenerConexiones()).toEqual([]);
  });

  it('should remove peer connections on cerrar', async () => {
    const { MemoryTransport } = await import('../src/services/mesh/transport');
    const a = new MemoryTransport('peer-a');
    const b = new MemoryTransport('peer-b');

    (a as any).conectar(b);
    expect(a.obtenerConexiones().length).toBe(1);

    await a.cerrar();
    expect(a.obtenerConexiones().length).toBe(0);
    expect(a.estaConectado()).toBe(false);
  });

  it('should fire events in correct order on conectar', async () => {
    const { MemoryTransport } = await import('../src/services/mesh/transport');
    const a = new MemoryTransport('peer-a');
    const b = new MemoryTransport('peer-b');

    const events: string[] = [];
    a.on('conectado', (ev: any) => { events.push(`a-conectado:${ev.detail.nodoId}`); });

    (a as any).conectar(b);
    expect(events).toContain('a-conectado:peer-b');
  });
});

// ── PeerJSTransport tests ────────────────────────────────────────────
// Using vi.doMock (non-hoisted) per test to avoid cross-test interference

describe('PeerJSTransport', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should create with a nodoId and default state', async () => {
    await vi.doMock('peerjs', () => ({
      default: vi.fn().mockImplementation(() => ({
        on: vi.fn(),
        connect: vi.fn(),
        destroy: vi.fn(),
        disconnected: false,
      })),
    }));
    const { PeerJSTransport } = await import('../src/services/mesh/transport');
    const transport = new PeerJSTransport('test-node');

    expect(transport.nodoId).toBe('test-node');
    expect(transport.tipo).toBe('peerjs');
    expect(transport.estaConectado()).toBe(false);
  });

  it('should initialize peer connection and fire conectado on open', async () => {
    const peerOn = vi.fn();
    await vi.doMock('peerjs', () => ({
      default: vi.fn().mockImplementation(() => ({
        on: peerOn,
        connect: vi.fn(),
        destroy: vi.fn(),
        disconnected: false,
      })),
    }));

    const { PeerJSTransport } = await import('../src/services/mesh/transport');
    const transport = new PeerJSTransport('test-node');

    let openHandler: (() => void) | null = null;
    peerOn.mockImplementation((event: string, handler: any) => {
      if (event === 'open') openHandler = handler;
    });

    const connectedPromise = new Promise<void>((resolve) => {
      transport.on('conectado', () => resolve());
    });

    await transport.iniciar();

    expect(openHandler).not.toBeNull();
    openHandler!();

    await connectedPromise;
  });

  it('should fire desconectado event on peer disconnect', async () => {
    const peerOn = vi.fn();
    await vi.doMock('peerjs', () => ({
      default: vi.fn().mockImplementation(() => ({
        on: peerOn,
        connect: vi.fn(),
        destroy: vi.fn(),
        disconnected: false,
      })),
    }));

    const { PeerJSTransport } = await import('../src/services/mesh/transport');
    const transport = new PeerJSTransport('test-node');

    let disconnectHandler: (() => void) | null = null;
    peerOn.mockImplementation((event: string, handler: any) => {
      if (event === 'disconnected') disconnectHandler = handler;
    });

    const disconnectedPromise = new Promise<void>((resolve) => {
      transport.on('desconectado', () => resolve());
    });

    await transport.iniciar();

    expect(disconnectHandler).not.toBeNull();
    disconnectHandler!();

    await disconnectedPromise;
  });

  it('should fire error event on peer error', async () => {
    const peerOn = vi.fn();
    await vi.doMock('peerjs', () => ({
      default: vi.fn().mockImplementation(() => ({
        on: peerOn,
        connect: vi.fn(),
        destroy: vi.fn(),
        disconnected: false,
      })),
    }));

    const { PeerJSTransport } = await import('../src/services/mesh/transport');
    const transport = new PeerJSTransport('test-node');

    let errorHandler: ((err: Error) => void) | null = null;
    peerOn.mockImplementation((event: string, handler: any) => {
      if (event === 'error') errorHandler = handler;
    });

    const errorPromise = new Promise<void>((resolve) => {
      transport.on('error', (ev: any) => {
        expect(ev.detail.mensaje).toBe('connection failed');
        resolve();
      });
    });

    await transport.iniciar();

    expect(errorHandler).not.toBeNull();
    errorHandler!(new Error('connection failed'));

    await errorPromise;
  });

  it('should set up connection handler for incoming connections', async () => {
    const peerOn = vi.fn();
    const connDataHandler = vi.fn();
    await vi.doMock('peerjs', () => ({
      default: vi.fn().mockImplementation(() => ({
        on: peerOn,
        connect: vi.fn(),
        destroy: vi.fn(),
        disconnected: false,
      })),
    }));

    const { PeerJSTransport } = await import('../src/services/mesh/transport');
    const transport = new PeerJSTransport('test-node');

    let connectionHandler: ((conn: any) => void) | null = null;
    peerOn.mockImplementation((event: string, handler: any) => {
      if (event === 'connection') connectionHandler = handler;
    });

    await transport.iniciar();

    const incomingData = vi.fn();
    transport.on('mensaje', (ev: any) => {
      incomingData(ev.detail.envolvente);
    });

    expect(connectionHandler).not.toBeNull();

    const mockIncomingConn = {
      peer: 'incoming-peer',
      on: connDataHandler,
      send: vi.fn(),
    };

    let dataHandler: ((data: unknown) => void) | null = null;
    let closeHandler: (() => void) | null = null;
    connDataHandler.mockImplementation((event: string, handler: any) => {
      if (event === 'data') dataHandler = handler;
      if (event === 'close') closeHandler = handler;
    });

    connectionHandler!(mockIncomingConn);

    expect(dataHandler).not.toBeNull();
    dataHandler!({ type: 'test', payload: 'incoming' });
    expect(incomingData).toHaveBeenCalledWith({ type: 'test', payload: 'incoming' });

    expect(closeHandler).not.toBeNull();
    closeHandler!();
  });

  it('should connect to remote peer and send data via enviar', async () => {
    const peerOn = vi.fn();
    const mockConnSend = vi.fn();
    const mockConn = {
      peer: 'remote-peer',
      on: vi.fn((event: string, handler: any) => {
        if (event === 'open') setTimeout(() => handler(), 0);
      }),
      send: mockConnSend,
    };

    await vi.doMock('peerjs', () => ({
      default: vi.fn().mockImplementation(() => ({
        on: peerOn,
        connect: vi.fn().mockReturnValue(mockConn),
        destroy: vi.fn(),
        disconnected: false,
      })),
    }));

    const { PeerJSTransport } = await import('../src/services/mesh/transport');
    const transport = new PeerJSTransport('test-node');

    peerOn.mockImplementation((_event: string, _handler: any) => {});
    await transport.iniciar();

    await transport.enviar('remote-peer', { type: 'hello' });

    expect(mockConn.send).toHaveBeenCalledWith({ type: 'hello' });
  });

  it('should reuse existing connection on enviar', async () => {
    const peerOn = vi.fn();
    const peerConnect = vi.fn();
    await vi.doMock('peerjs', () => ({
      default: vi.fn().mockImplementation(() => ({
        on: peerOn,
        connect: peerConnect,
        destroy: vi.fn(),
        disconnected: false,
      })),
    }));

    const { PeerJSTransport } = await import('../src/services/mesh/transport');
    const transport = new PeerJSTransport('test-node');

    let connectionHandler: ((conn: any) => void) | null = null;
    peerOn.mockImplementation((event: string, handler: any) => {
      if (event === 'connection') connectionHandler = handler;
    });
    await transport.iniciar();

    const existingConn = {
      peer: 'existing-peer',
      on: vi.fn(),
      send: vi.fn(),
    };
    connectionHandler!(existingConn);

    await transport.enviar('existing-peer', { type: 'test' });
    expect(existingConn.send).toHaveBeenCalledWith({ type: 'test' });
    expect(peerConnect).not.toHaveBeenCalled();
  });

  it('should broadcast to all connections via transmitir', async () => {
    const peerOn = vi.fn();
    await vi.doMock('peerjs', () => ({
      default: vi.fn().mockImplementation(() => ({
        on: peerOn,
        connect: vi.fn(),
        destroy: vi.fn(),
        disconnected: false,
      })),
    }));

    const { PeerJSTransport } = await import('../src/services/mesh/transport');
    const transport = new PeerJSTransport('test-node');

    let connectionHandler: ((conn: any) => void) | null = null;
    peerOn.mockImplementation((event: string, handler: any) => {
      if (event === 'connection') connectionHandler = handler;
    });
    await transport.iniciar();

    const conn1 = { peer: 'peer-1', on: vi.fn(), send: vi.fn() };
    const conn2 = { peer: 'peer-2', on: vi.fn(), send: vi.fn() };
    connectionHandler!(conn1);
    connectionHandler!(conn2);

    await transport.transmitir({ type: 'broadcast' });

    expect(conn1.send).toHaveBeenCalledWith({ type: 'broadcast' });
    expect(conn2.send).toHaveBeenCalledWith({ type: 'broadcast' });
  });

  it('should destroy peer and clear connections on cerrar', async () => {
    const peerOn = vi.fn();
    const peerDestroy = vi.fn();
    await vi.doMock('peerjs', () => ({
      default: vi.fn().mockImplementation(() => ({
        on: peerOn,
        connect: vi.fn(),
        destroy: peerDestroy,
        disconnected: false,
      })),
    }));

    const { PeerJSTransport } = await import('../src/services/mesh/transport');
    const transport = new PeerJSTransport('test-node');

    peerOn.mockImplementation((_event: string, _handler: any) => {});
    await transport.iniciar();

    await transport.cerrar();

    expect(peerDestroy).toHaveBeenCalled();
  });

  it('should handle cerrar when peer is null', async () => {
    await vi.doMock('peerjs', () => ({
      default: vi.fn().mockImplementation(() => ({
        on: vi.fn(),
        connect: vi.fn(),
        destroy: vi.fn(),
        disconnected: false,
      })),
    }));
    const { PeerJSTransport } = await import('../src/services/mesh/transport');
    const transport = new PeerJSTransport('test-node');

    await expect(transport.cerrar()).resolves.toBeUndefined();
  });

  it('should have readonly properties', async () => {
    await vi.doMock('peerjs', () => ({
      default: vi.fn().mockImplementation(() => ({
        on: vi.fn(),
        connect: vi.fn(),
        destroy: vi.fn(),
        disconnected: false,
      })),
    }));
    const { PeerJSTransport } = await import('../src/services/mesh/transport');
    const transport = new PeerJSTransport('my-node');

    expect(transport.tipo).toBe('peerjs');
    expect(transport.nodoId).toBe('my-node');
    expect(transport.eventTarget).toBeInstanceOf(EventTarget);
  });

  it('should check estaConectado returns true when peer is connected', async () => {
    const peerOn = vi.fn();
    await vi.doMock('peerjs', () => ({
      default: vi.fn().mockImplementation(() => ({
        on: peerOn,
        connect: vi.fn(),
        destroy: vi.fn(),
        disconnected: false,
      })),
    }));
    const { PeerJSTransport } = await import('../src/services/mesh/transport');
    const transport = new PeerJSTransport('test-node');

    peerOn.mockImplementation((_event: string, _handler: any) => {});
    await transport.iniciar();

    // Peer is connected (not null, disconnected=false)
    (transport as any).peer = { disconnected: false };
    expect(transport.estaConectado()).toBe(true);
  });

  it('should check estaConectado returns false when peer is disconnected', async () => {
    const peerOn = vi.fn();
    await vi.doMock('peerjs', () => ({
      default: vi.fn().mockImplementation(() => ({
        on: peerOn,
        connect: vi.fn(),
        destroy: vi.fn(),
        disconnected: false,
      })),
    }));

    const { PeerJSTransport } = await import('../src/services/mesh/transport');
    const transport = new PeerJSTransport('test-node');

    peerOn.mockImplementation((_event: string, _handler: any) => {});
    await transport.iniciar();

    (transport as any).peer = { disconnected: true };
    expect(transport.estaConectado()).toBe(false);
  });

  it('should return empty connection list when no connections exist', async () => {
    await vi.doMock('peerjs', () => ({
      default: vi.fn().mockImplementation(() => ({
        on: vi.fn(),
        connect: vi.fn(),
        destroy: vi.fn(),
        disconnected: false,
      })),
    }));
    const { PeerJSTransport } = await import('../src/services/mesh/transport');
    const transport = new PeerJSTransport('test-node');

    expect(transport.obtenerConexiones()).toEqual([]);
  });

  it('should allow event listener removal with off()', async () => {
    await vi.doMock('peerjs', () => ({
      default: vi.fn().mockImplementation(() => ({
        on: vi.fn(),
        connect: vi.fn(),
        destroy: vi.fn(),
        disconnected: false,
      })),
    }));
    const { PeerJSTransport } = await import('../src/services/mesh/transport');
    const transport = new PeerJSTransport('test-node');

    const handler = vi.fn();
    transport.on('conectado', handler);
    transport.off('conectado', handler);

    expect(() => {
      transport.off('conectado', handler);
    }).not.toThrow();
  });
});
