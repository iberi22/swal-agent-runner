import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('MemoryTransport', () => {
  it('should connect two peers', async () => {
    const { MemoryTransport } = await import('../transport');
    const a = new MemoryTransport('peer-a');
    const b = new MemoryTransport('peer-b');

    let msgReceived: any = null;
    b.on('mensaje', (ev: any) => { msgReceived = ev.detail.envolvente; });

    // @ts-ignore -- conectar es metodo interno de MemoryTransport
    a.conectar(b);

    await a.enviar('peer-b', { type: 'test', payload: 'hello' });
    expect(msgReceived).toBeTruthy();
  });

  it('should broadcast to all peers', async () => {
    const { MemoryTransport } = await import('../transport');
    const a = new MemoryTransport('peer-a');
    const b = new MemoryTransport('peer-b');
    const c = new MemoryTransport('peer-c');

    const bMessages: any[] = [];
    const cMessages: any[] = [];
    b.on('mensaje', (ev: any) => { bMessages.push(ev.detail.envolvente); });
    c.on('mensaje', (ev: any) => { cMessages.push(ev.detail.envolvente); });

    // @ts-ignore
    a.conectar(b);
    // @ts-ignore
    a.conectar(c);

    await a.transmitir({ type: 'broadcast', payload: 'hello everyone' });
    expect(bMessages.length).toBe(1);
    expect(cMessages.length).toBe(1);
  });

  it('should report connection status', async () => {
    const { MemoryTransport } = await import('../transport');
    const a = new MemoryTransport('peer-a');
    expect(a.estaConectado()).toBe(false);

    // @ts-ignore
    a.conectar(new MemoryTransport('peer-b'));
    expect(a.estaConectado()).toBe(true);

    await a.cerrar();
    expect(a.estaConectado()).toBe(false);
  });

  it('should list connections', async () => {
    const { MemoryTransport } = await import('../transport');
    const a = new MemoryTransport('peer-a');
    const b = new MemoryTransport('peer-b');

    // @ts-ignore
    a.conectar(b);
    expect(a.obtenerConexiones()).toContain('peer-b');
  });

  it('should fire conectado event', async () => {
    const { MemoryTransport } = await import('../transport');
    const a = new MemoryTransport('peer-a');
    const b = new MemoryTransport('peer-b');

    let fired = false;
    a.on('conectado', () => { fired = true; });

    // @ts-ignore
    a.conectar(b);
    expect(fired).toBe(true);
  });
});
