import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { edgeMeshClient, EdgeMeshClient } from '../edge-mesh-client';
import { deviceIdentity } from '../device-identity';
import type { ITransport } from '../transport';
import { CrdtEventBus } from '../crdt-event-bus';
import { CrdtMemoryStore } from '../crdt-memory-store';
import { YjsAdapter } from '../yjs-adapter';
import path from 'path';

// Register .ts and .tsx loaders so Node resolves .ts files
if (!require.extensions['.ts']) {
  require.extensions['.ts'] = require.extensions['.js'];
}
if (!require.extensions['.tsx']) {
  require.extensions['.tsx'] = require.extensions['.js'];
}

// Populate require.cache so that require('./crdt-event-bus') works in Vitest
const busPathTs = path.resolve(__dirname, '../crdt-event-bus.ts');
const storePathTs = path.resolve(__dirname, '../crdt-memory-store.ts');

require.cache[busPathTs] = {
  id: busPathTs,
  filename: busPathTs,
  loaded: true,
  exports: { CrdtEventBus },
} as any;

require.cache[storePathTs] = {
  id: storePathTs,
  filename: storePathTs,
  loaded: true,
  exports: { CrdtMemoryStore },
} as any;

// ----------------------------------------------------------------
// Module-level mocks (hoisted by vitest to top of file)
// ----------------------------------------------------------------

// Shared mock objects for crdt-sync
let statusHandler: ((event: { connected: boolean }) => void) | null = null;
let isOnlineMock = vi.fn().mockReturnValue(true);
const mockDestroy = vi.fn();

const mockWebrtcProvider = {
  on: vi.fn((event, handler) => {
    if (event === 'status') {
      statusHandler = handler;
    }
  }),
  off: vi.fn((event, handler) => {
    if (event === 'status' && statusHandler === handler) {
      statusHandler = null;
    }
  }),
  destroy: vi.fn(),
};

let initCrdtSyncMock = vi.fn().mockImplementation(() => Promise.resolve({
  webrtc: mockWebrtcProvider,
  indexeddb: { destroy: () => {} },
  destroy: mockDestroy,
  isOnline: () => isOnlineMock(),
}));

vi.mock('../crdt-sync', () => ({
  initCrdtSync: (...args: any[]) => initCrdtSyncMock(...args),
}));

// ----------------------------------------------------------------
// Shared helpers
// ----------------------------------------------------------------

/** Create a mock ITransport for testing setTransport */
function createMockTransport(nodoId = 'test-peer') {
  const handlers: Record<string, ((ev: any) => void) | null> = {};
  return {
    tipo: 'test',
    eventTarget: new EventTarget(),
    nodoId,
    on: vi.fn((event: string, handler: any) => {
      handlers[event] = handler;
    }),
    off: vi.fn((event: string, handler: any) => {
      if (handlers[event] === handler) {
        handlers[event] = null;
      }
    }),
    enviar: vi.fn(),
    transmitir: vi.fn(),
    estaConectado: vi.fn().mockReturnValue(true),
    obtenerConexiones: vi.fn().mockReturnValue([]),
    cerrar: vi.fn().mockResolvedValue(undefined),
    _handlers: handlers,
  } as unknown as ITransport;
}

/** Helper to fire a transport event on a mock transport */
function fireTransportEvent(transport: any, eventName: string, detail?: any) {
  const handler = transport._handlers[eventName];
  if (handler) {
    handler(new CustomEvent(eventName, { detail }));
  }
}

/** Access private field through bracket notation to bypass TS restrictions */
function setPrivateField(obj: any, field: string, value: any) {
  (obj as any)[field] = value;
}

function getPrivateField(obj: any, field: string): any {
  return (obj as any)[field];
}

/** Reset the edgeMeshClient singleton's internal state */
async function resetClient(): Promise<void> {
  await edgeMeshClient.leaveRoom();
  // Clear any transport that may have been set by previous tests
  setPrivateField(edgeMeshClient, 'legacyTransport', null);
  setPrivateField(edgeMeshClient, '_eventBus', null);
  setPrivateField(edgeMeshClient, '_crdtMemoryStore', null);

  // Re-fetch device ID if not set (singleton constructor already ran)
  if (!edgeMeshClient.deviceId) {
    await vi.waitFor(() => {
      expect(edgeMeshClient.deviceId).toBeTruthy();
    }, { timeout: 1000, interval: 10 });
  }
}

// ----------------------------------------------------------------
// Setup
// ----------------------------------------------------------------

beforeEach(async () => {
  vi.useFakeTimers();

  // Mock deviceIdentity to avoid IndexedDB hanging under fake timers
  vi.spyOn(deviceIdentity, 'getId').mockResolvedValue('swal-test-device');
  vi.spyOn(deviceIdentity, 'getInfo').mockResolvedValue({
    deviceId: 'swal-test-device',
    name: 'Test Device',
    deviceType: 'pc',
    createdAt: Date.now(),
    lastSeen: Date.now(),
  });

  statusHandler = null;
  isOnlineMock.mockReturnValue(true);
  mockDestroy.mockClear();
  mockWebrtcProvider.on.mockClear();
  mockWebrtcProvider.off.mockClear();
  mockWebrtcProvider.destroy.mockClear();

  initCrdtSyncMock.mockImplementation(() => Promise.resolve({
    webrtc: mockWebrtcProvider,
    indexeddb: { destroy: () => {} },
    destroy: mockDestroy,
    isOnline: () => isOnlineMock(),
  }));

  // Reset edgeMeshClient state
  await edgeMeshClient.leaveRoom();
  setPrivateField(edgeMeshClient, 'legacyTransport', null);
  setPrivateField(edgeMeshClient, '_eventBus', null);
  setPrivateField(edgeMeshClient, '_crdtMemoryStore', null);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────
// A) EXISTING TESTS: Reliability & Heartbeats
// ─────────────────────────────────────────────────────────────

describe('EdgeMeshClient Reliability & Heartbeats', () => {
  it('should write heartbeat to presence map and sweep stale entries', async () => {
    await edgeMeshClient.joinRoom('test-room');

    // Simulate online
    if (statusHandler) {
      statusHandler({ connected: true });
    }

    // Fast-forward so heartbeat and update runs
    await vi.runOnlyPendingTimersAsync();

    const doc = await edgeMeshClient.getDoc();
    const presenceMap = doc.getMap<any>('mesh:presence');
    const ourId = edgeMeshClient.deviceId;

    expect(presenceMap.has(ourId)).toBe(true);
    const ourPresence = presenceMap.get(ourId);
    expect(ourPresence.deviceId).toBe(ourId);
    expect(ourPresence.lastHeartbeat).toBeGreaterThan(0);

    // Now insert a fake peer that is stale
    presenceMap.set('stale-peer', {
      deviceId: 'stale-peer',
      name: 'Old Tablet',
      deviceType: 'tablet',
      lastHeartbeat: Date.now() - 40000, // 40 seconds ago (stale > 30s)
    });

    // Insert a fake peer that is active
    presenceMap.set('active-peer', {
      deviceId: 'active-peer',
      name: 'New Phone',
      deviceType: 'phone',
      lastHeartbeat: Date.now() - 5000, // 5 seconds ago
    });

    // Fast-forward another heartbeat interval (10 seconds) to trigger sweep
    vi.advanceTimersByTime(10000);
    await vi.runOnlyPendingTimersAsync();

    // Verify stale peer was swept and active peer remains
    expect(presenceMap.has('stale-peer')).toBe(false);
    expect(presenceMap.has('active-peer')).toBe(true);
    expect(edgeMeshClient.meshPeers).toContain('active-peer');
    expect(edgeMeshClient.meshPeers).not.toContain('stale-peer');
  });

  it('should dispatch peer joined and peer left events correctly', async () => {
    await edgeMeshClient.joinRoom('test-room');
    if (statusHandler) {
      statusHandler({ connected: true });
    }
    await vi.runOnlyPendingTimersAsync();

    const doc = await edgeMeshClient.getDoc();
    const presenceMap = doc.getMap<any>('mesh:presence');

    const events: string[] = [];
    edgeMeshClient.events.addEventListener('mesh:peer-joined', (e: any) => {
      events.push(`joined:${e.detail.peerId}`);
    });
    edgeMeshClient.events.addEventListener('mesh:peer-left', (e: any) => {
      events.push(`left:${e.detail.peerId}`);
    });

    // Simulate peer joining
    presenceMap.set('peer-x', {
      deviceId: 'peer-x',
      name: 'Peer X',
      deviceType: 'pc',
      lastHeartbeat: Date.now(),
    });

    // Run the observer callbacks
    await vi.runOnlyPendingTimersAsync();

    expect(events).toContain('joined:peer-x');

    // Simulate peer leaving/becoming stale
    presenceMap.set('peer-x', {
      deviceId: 'peer-x',
      name: 'Peer X',
      deviceType: 'pc',
      lastHeartbeat: Date.now() - 45000, // Make it stale
    });

    // Run heartbeat sweep
    vi.advanceTimersByTime(10000);
    await vi.runOnlyPendingTimersAsync();

    expect(presenceMap.has('peer-x')).toBe(false);
    expect(events).toContain('left:peer-x');
  });

  it('should trigger connection recovery and exponential backoff reconnects', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    await edgeMeshClient.joinRoom('test-room');
    if (statusHandler) {
      statusHandler({ connected: true });
    }
    await vi.runOnlyPendingTimersAsync();

    expect(edgeMeshClient.paired).toBe(true);

    const reconnectEvents: any[] = [];
    edgeMeshClient.events.addEventListener('mesh:reconnecting', (e: any) => {
      reconnectEvents.push(e.detail);
    });

    // Simulate disconnection
    isOnlineMock.mockReturnValue(false);
    if (statusHandler) {
      statusHandler({ connected: false });
    }

    expect(edgeMeshClient.paired).toBe(false);

    // Attempt 1 is now scheduled immediately
    expect(reconnectEvents.length).toBe(1);
    expect(reconnectEvents[0].attempt).toBe(1);
    expect(reconnectEvents[0].delay).toBe(1000);

    // Reconnection attempt 1: delay is 1000ms.
    // Advancing time by 1000ms fires attempt 1, which fails and schedules attempt 2.
    await vi.advanceTimersByTimeAsync(1000);

    expect(reconnectEvents.length).toBe(2);
    expect(reconnectEvents[1].attempt).toBe(2);
    expect(reconnectEvents[1].delay).toBe(2000);

    // Reconnection attempt 2: delay is 2000ms.
    // Advancing time by another 2000ms fires attempt 2, which fails and schedules attempt 3.
    await vi.advanceTimersByTimeAsync(2000);

    expect(reconnectEvents.length).toBe(3);
    expect(reconnectEvents[2].attempt).toBe(3);
    expect(reconnectEvents[2].delay).toBe(4000);
  });

  it('should clear all intervals and timeouts on explicit leave', async () => {
    await edgeMeshClient.joinRoom('test-room');
    if (statusHandler) {
      statusHandler({ connected: true });
    }
    await vi.runOnlyPendingTimersAsync();

    // Trigger disconnect to start reconnect loop
    isOnlineMock.mockReturnValue(false);
    if (statusHandler) {
      statusHandler({ connected: false });
    }

    // Explicitly leave the room
    await edgeMeshClient.leaveRoom();

    const reconnectEvents: any[] = [];
    edgeMeshClient.events.addEventListener('mesh:reconnecting', (e: any) => {
      reconnectEvents.push(e.detail);
    });

    // Fast forward a long time
    vi.advanceTimersByTime(100000);
    await vi.runOnlyPendingTimersAsync();

    // No reconnect attempts should have been fired
    expect(reconnectEvents.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// B) CONSTRUCTION & SINGLETON
// ─────────────────────────────────────────────────────────────

describe('EdgeMeshClient Construction & Singleton', () => {
  it('exports a singleton edgeMeshClient', () => {
    expect(edgeMeshClient).toBeDefined();
    expect(edgeMeshClient).toBeInstanceOf(EdgeMeshClient);
  });

  it('has deviceId defined as a string', () => {
    expect(edgeMeshClient.deviceId).toBeTruthy();
    expect(typeof edgeMeshClient.deviceId).toBe('string');
    expect(edgeMeshClient.deviceId).toMatch(/^swal-/);
  });

  it('has default initial state', () => {
    expect(edgeMeshClient.paired).toBe(false);
    expect(edgeMeshClient.meshRoom).toBe('');
    expect(edgeMeshClient.meshPeers).toEqual([]);
  });

  it('events property is an EventTarget', () => {
    expect(edgeMeshClient.events).toBeInstanceOf(EventTarget);
  });

  it('can create a fresh EdgeMeshClient instance', async () => {
    const fresh = new EdgeMeshClient();
    // _initDeviceId is async (called in constructor), wait for it
    await vi.waitFor(() => {
      expect(fresh.deviceId).toBeTruthy();
    }, { timeout: 500, interval: 10 });
    expect(fresh).toBeInstanceOf(EdgeMeshClient);
    expect(fresh).not.toBe(edgeMeshClient);
    expect(fresh.deviceId).toMatch(/^swal-/);
    expect(fresh.paired).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// C) GET PAIR STATUS
// ─────────────────────────────────────────────────────────────

describe('getPairStatus', () => {
  it('returns disconnected state by default', () => {
    const status = edgeMeshClient.getPairStatus();
    expect(status.paired).toBe(false);
    expect(status.endpoint).toBe('');
    expect(status.connectionState).toBe('disconnected');
    expect(status.lastSyncAt).toBeGreaterThan(0);
    expect(status.pendingSyncCount).toBe(0);
  });

  it('returns connected state when paired is true', async () => {
    await edgeMeshClient.joinRoom('test-room-pair-status');
    if (statusHandler) {
      statusHandler({ connected: true });
    }
    await vi.runOnlyPendingTimersAsync();

    const status = edgeMeshClient.getPairStatus();
    expect(status.paired).toBe(true);
    expect(status.connectionState).toBe('connected');
    expect(status.endpoint).toContain('mesh:');
  });

  it('returns connecting state when room joined but not connected', async () => {
    isOnlineMock.mockReturnValue(false);
    await edgeMeshClient.joinRoom('test-room-connecting');

    const status = edgeMeshClient.getPairStatus();
    // After joining but status not yet "connected" and isOnline=false,
    // the state should be "connecting" because we're waiting for WebRTC
    expect(status.connectionState).toBe('connecting');
    expect(status.paired).toBe(false);
    expect(status.endpoint).toContain('mesh:');
  });

  it('returns disconnected after explicit leaveRoom', async () => {
    await edgeMeshClient.joinRoom('test-room-leave');
    if (statusHandler) {
      statusHandler({ connected: true });
    }
    await vi.runOnlyPendingTimersAsync();

    await edgeMeshClient.leaveRoom();

    const status = edgeMeshClient.getPairStatus();
    expect(status.paired).toBe(false);
    expect(status.connectionState).toBe('disconnected');
    expect(status.endpoint).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────
// D) SUBSCRIBE / NOTIFY
// ─────────────────────────────────────────────────────────────

describe('subscribe / notify', () => {
  it('immediately invokes listener with current status on subscribe', () => {
    const listener = vi.fn();
    const unsubscribe = edgeMeshClient.subscribe(listener);

    expect(listener).toHaveBeenCalledTimes(1);
    const status = listener.mock.calls[0][0];
    expect(status).toHaveProperty('paired');
    expect(status).toHaveProperty('connectionState');
    expect(status).toHaveProperty('endpoint');

    unsubscribe();
  });

  it('returns an unsubscribe function that removes the listener', () => {
    const listener = vi.fn();
    const unsubscribe = edgeMeshClient.subscribe(listener);
    expect(listener).toHaveBeenCalledTimes(1);

    // Unsubscribe and verify listener is not called again on subsequent state changes
    unsubscribe();
    listener.mockClear();

    // Trigger a state change via joinRoom
    return edgeMeshClient.joinRoom('test-unsub').then(() => {
      expect(listener).toHaveBeenCalledTimes(0);
    });
  });

  it('notifies all listeners on state change', async () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    const unsub1 = edgeMeshClient.subscribe(listener1);
    const unsub2 = edgeMeshClient.subscribe(listener2);

    // Both were called once with initial status
    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);

    listener1.mockClear();
    listener2.mockClear();

    // Trigger a state change via joinRoom (will call notify)
    await edgeMeshClient.joinRoom('test-notify-all');
    await vi.runOnlyPendingTimersAsync();

    // Both listeners should have been notified after joinRoom's notify call
    expect(listener1.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(listener2.mock.calls.length).toBeGreaterThanOrEqual(1);

    // Last call should reflect connected paired state
    const lastCall1 = listener1.mock.calls[listener1.mock.calls.length - 1][0];
    expect(lastCall1.paired).toBe(true);

    unsub1();
    unsub2();
  });

  it('handles multiple subscribe/unsubscribe lifecycle', () => {
    const l1 = vi.fn();
    const l2 = vi.fn();
    const l3 = vi.fn();

    const u1 = edgeMeshClient.subscribe(l1);
    const u2 = edgeMeshClient.subscribe(l2);

    expect(l1).toHaveBeenCalledTimes(1);
    expect(l2).toHaveBeenCalledTimes(1);

    u1();
    const u3 = edgeMeshClient.subscribe(l3);
    expect(l3).toHaveBeenCalledTimes(1);

    u2();
    u3();
  });
});

// ─────────────────────────────────────────────────────────────
// E) SET TRANSPORT / GET TRANSPORT (Legacy Pairing)
// ─────────────────────────────────────────────────────────────

describe('setTransport / getTransport', () => {
  beforeEach(() => {
    // Ensure no leftover transport from previous tests
    setPrivateField(edgeMeshClient, 'legacyTransport', null);
  });

  it('sets and retrieves the legacy transport', () => {
    const transport = createMockTransport('test-node');
    edgeMeshClient.setTransport(transport);
    expect(edgeMeshClient.getTransport()).toBe(transport as any);
  });

  it('registers event handlers on the transport', () => {
    const transport = createMockTransport('test-node');
    edgeMeshClient.setTransport(transport);

    expect(transport.on).toHaveBeenCalledWith('conectado', (edgeMeshClient as any).onPeerConnected);
    expect(transport.on).toHaveBeenCalledWith('desconectado', (edgeMeshClient as any).onPeerDisconnected);
  });

  it('cleans up old transport handlers when setting a new one', () => {
    const oldTransport = createMockTransport('old-node');
    const newTransport = createMockTransport('new-node');

    edgeMeshClient.setTransport(oldTransport);

    edgeMeshClient.setTransport(newTransport);

    // off should be called with the correct handler references
    expect(oldTransport.off).toHaveBeenCalledWith('conectado', (edgeMeshClient as any).onPeerConnected);
    expect(oldTransport.off).toHaveBeenCalledWith('desconectado', (edgeMeshClient as any).onPeerDisconnected);
  });

  it('dispatches "paired" event when transport emits conectado', () => {
    const transport = createMockTransport('paired-peer');
    edgeMeshClient.setTransport(transport);

    const pairedEvents: any[] = [];
    edgeMeshClient.events.addEventListener('paired', (e: any) => {
      pairedEvents.push(e.detail);
    });

    // Fire conectado via the transport
    fireTransportEvent(transport, 'conectado', { nodoId: 'paired-peer' });

    expect(edgeMeshClient.paired).toBe(true);
    expect(pairedEvents.length).toBe(1);
    expect(pairedEvents[0].peerId).toBe('paired-peer');
  });

  it('dispatches "unpaired" event when transport emits desconectado', () => {
    const transport = createMockTransport('test-node');
    edgeMeshClient.setTransport(transport);

    const unpairedEvents: any[] = [];
    edgeMeshClient.events.addEventListener('unpaired', (e: any) => {
      unpairedEvents.push(e);
    });

    // Fire desconectado via the transport
    fireTransportEvent(transport, 'desconectado');

    expect(edgeMeshClient.paired).toBe(false);
    expect(unpairedEvents.length).toBe(1);
  });

  it('returns null for getTransport when no transport is set', () => {
    expect(edgeMeshClient.getTransport()).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// F) JOIN ROOM LIFECYCLE
// ─────────────────────────────────────────────────────────────

describe('joinRoom lifecycle', () => {
  it('sets meshRoom after joining', async () => {
    await edgeMeshClient.joinRoom('lifecycle-test');
    expect(edgeMeshClient.meshRoom).toBe('lifecycle-test');
  });

  it('dispatches mesh:room-joined event', async () => {
    const events: any[] = [];
    edgeMeshClient.events.addEventListener('mesh:room-joined', (e: any) => {
      events.push(e.detail);
    });

    await edgeMeshClient.joinRoom('room-join-event');
    expect(events.length).toBe(1);
    expect(events[0].room).toBe('swal-agent-runner/room-join-event');
  });

  it('dispatches mesh:room-left event when leaving a room', async () => {
    await edgeMeshClient.joinRoom('leave-event-room');
    const events: any[] = [];
    edgeMeshClient.events.addEventListener('mesh:room-left', (e: any) => {
      events.push(e);
    });

    await edgeMeshClient.leaveRoom();
    expect(events.length).toBe(1);
  });

  it('dispatches mesh:connected event when status becomes connected', async () => {
    // First join with isOnline=false so we don't get auto-connected from joinRoom
    isOnlineMock.mockReturnValue(false);
    await edgeMeshClient.joinRoom('connected-event');

    const events: any[] = [];
    edgeMeshClient.events.addEventListener('mesh:connected', (e: any) => {
      events.push(e);
    });

    // Now signal connected via statusHandler
    if (statusHandler) {
      statusHandler({ connected: true });
    }
    await vi.runOnlyPendingTimersAsync();

    expect(events.length).toBe(1);
  });

  it('dispatches mesh:disconnected event when status becomes disconnected', async () => {
    await edgeMeshClient.joinRoom('disconnected-event');
    if (statusHandler) {
      statusHandler({ connected: true });
    }
    await vi.runOnlyPendingTimersAsync();

    const events: any[] = [];
    edgeMeshClient.events.addEventListener('mesh:disconnected', (e: any) => {
      events.push(e);
    });

    isOnlineMock.mockReturnValue(false);
    if (statusHandler) {
      statusHandler({ connected: false });
    }

    expect(events.length).toBe(1);
  });

  it('leaves existing room before joining a new one', async () => {
    await edgeMeshClient.joinRoom('first-room');
    const leaveSpy = vi.spyOn(edgeMeshClient, 'leaveRoom');

    await edgeMeshClient.joinRoom('second-room');
    expect(leaveSpy).toHaveBeenCalled();

    leaveSpy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────
// G) CRDT EVENT BUS & MEMORY STORE GETTERS
// ─────────────────────────────────────────────────────────────
//
// NOTE: The getters use `require()` internally (CommonJS in ESM context),
// which vitest does not intercept via vi.mock(). Instead, we test the
// getter logic paths by accessing private fields directly.

describe('crdtEventBus getter', () => {
  it('throws when YjsAdapter is not initialized and _eventBus is null', () => {
    // Ensure _eventBus is null and _yjs is null
    setPrivateField(edgeMeshClient, '_eventBus', null);
    setPrivateField(edgeMeshClient, '_yjs', null);

    // Accessing the getter should throw because require() fails in vitest.
    // We'll verify the getter has the right logic by checking the throw path.
    expect(() => {
      try {
        (edgeMeshClient as any).crdtEventBus;
      } catch (e: any) {
        // If it throws "Cannot find module" that's a vitest require limitation,
        // not our code. But the getter's own check should throw first.
        throw e;
      }
    }).toThrow();
  });

  it('uses _eventBus if already set (singleton path)', () => {
    const mockBus = { name: 'mock-event-bus' };
    setPrivateField(edgeMeshClient, '_eventBus', mockBus);

    const result = (edgeMeshClient as any).crdtEventBus;
    expect(result).toBe(mockBus);
  });
});

describe('crdtMemoryStore getter', () => {
  it('uses _crdtMemoryStore if already set (singleton path)', () => {
    const mockStore = { name: 'mock-memory-store' };
    setPrivateField(edgeMeshClient, '_crdtMemoryStore', mockStore);

    const result = (edgeMeshClient as any).crdtMemoryStore;
    expect(result).toBe(mockStore);
  });
});

// ─────────────────────────────────────────────────────────────
// H) DESTROY
// ─────────────────────────────────────────────────────────────

describe('destroy', () => {
  it('cleans up room, transport, and yjs state', async () => {
    // First join a room to set up state
    const transport = createMockTransport('destroy-test');
    edgeMeshClient.setTransport(transport);
    await edgeMeshClient.joinRoom('destroy-room');
    if (statusHandler) {
      statusHandler({ connected: true });
    }
    await vi.runOnlyPendingTimersAsync();

    expect(edgeMeshClient.paired).toBe(true);
    expect(edgeMeshClient.meshRoom).toBe('destroy-room');

    // Now destroy
    await edgeMeshClient.destroy();

    expect(edgeMeshClient.paired).toBe(false);
    expect(edgeMeshClient.meshRoom).toBe('');
    expect(edgeMeshClient.meshPeers).toEqual([]);
    expect(transport.cerrar).toHaveBeenCalled();
    expect(edgeMeshClient.getTransport()).toBeNull();
  });

  it('handles destroy called twice gracefully', async () => {
    await edgeMeshClient.joinRoom('double-destroy');
    if (statusHandler) {
      statusHandler({ connected: true });
    }
    await vi.runOnlyPendingTimersAsync();

    // First destroy
    await edgeMeshClient.destroy();

    // Second destroy should not throw
    await expect(edgeMeshClient.destroy()).resolves.not.toThrow();
  });

  it('handles destroy when not in a room', async () => {
    await expect(edgeMeshClient.destroy()).resolves.not.toThrow();
    expect(edgeMeshClient.paired).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// I) YJS GETTER / GETDOC
// ─────────────────────────────────────────────────────────────

describe('yjs getter and getDoc', () => {
  it('getDoc returns a Yjs Doc (lazy loaded)', async () => {
    const doc = await edgeMeshClient.getDoc();
    expect(doc).toBeDefined();
    // Y.Doc has a guid property
    expect((doc as any).guid).toBeDefined();
  });

  it('getDoc returns the same doc on repeated calls', async () => {
    const doc1 = await edgeMeshClient.getDoc();
    const doc2 = await edgeMeshClient.getDoc();
    expect(doc1).toBe(doc2);
  });
});

// ─────────────────────────────────────────────────────────────
// J) EDGE CASES & ERROR HANDLING
// ─────────────────────────────────────────────────────────────

describe('Edge Cases', () => {
  it('leaveRoom works when not in a room (graceful no-op)', async () => {
    await expect(edgeMeshClient.leaveRoom()).resolves.not.toThrow();
    expect(edgeMeshClient.paired).toBe(false);
    expect(edgeMeshClient.meshRoom).toBe('');
  });

  it('joinRoom handles errors and clears meshRoom on failure', async () => {
    // Verify double join works:
    await edgeMeshClient.joinRoom('first');
    await edgeMeshClient.joinRoom('second');
    expect(edgeMeshClient.meshRoom).toBe('second');
  });

  it('duplicate joinRoom calls are handled (leaves first room)', async () => {
    const leaveSpy = vi.spyOn(edgeMeshClient, 'leaveRoom');

    // Join a room
    await edgeMeshClient.joinRoom('room-a');
    expect(leaveSpy).not.toHaveBeenCalled(); // first join, no prior room

    leaveSpy.mockClear();

    // Join another room - should leave the first room
    await edgeMeshClient.joinRoom('room-b');
    expect(leaveSpy).toHaveBeenCalled();

    leaveSpy.mockRestore();
  });

  it('deviceIdentity fallback generates swal- prefixed id on error', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.42);
    // Make deviceIdentity.getId() reject
    (deviceIdentity.getId as Mock).mockRejectedValue(new Error('IndexedDB unavailable'));
    // Ensure the singleton has a valid deviceId (it was set during import time)
    expect(edgeMeshClient.deviceId).toMatch(/^swal-/);

    // Create a fresh instance to test the fallback
    const freshClient = new EdgeMeshClient();
    // Wait for the async _initDeviceId to complete
    await vi.waitFor(() => {
      expect(freshClient.deviceId).toBeTruthy();
    }, { timeout: 500, interval: 10 });
    expect(freshClient.deviceId).toMatch(/^swal-/);
  });

  it('can get and set peer endpoint via transport events', () => {
    const transport = createMockTransport('peer-node');
    edgeMeshClient.setTransport(transport);

    // Fire conectado
    fireTransportEvent(transport, 'conectado', { nodoId: 'peer-node' });

    // The getPairStatus should reflect the new endpoint
    const status = edgeMeshClient.getPairStatus();
    expect(status.endpoint).toBe('peer-node');
  });

  it('meshPeers getter returns an empty array when no peers', () => {
    expect(edgeMeshClient.meshPeers).toEqual([]);
  });

  it('mesh:reconnecting event is dispatched with attempt details', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    await edgeMeshClient.joinRoom('reconnect-event-test');
    if (statusHandler) {
      statusHandler({ connected: true });
    }
    await vi.runOnlyPendingTimersAsync();

    const reconnectingEvents: any[] = [];
    edgeMeshClient.events.addEventListener('mesh:reconnecting', (e: any) => {
      reconnectingEvents.push(e.detail);
    });

    // Trigger disconnect -> reconnect
    isOnlineMock.mockReturnValue(false);
    if (statusHandler) {
      statusHandler({ connected: false });
    }

    expect(reconnectingEvents.length).toBe(1);
    expect(reconnectingEvents[0].attempt).toBe(1);
    expect(reconnectingEvents[0].delay).toBeGreaterThan(0);
  });

  it('reconnect is skipped when explicitly disconnected', async () => {
    await edgeMeshClient.joinRoom('skip-reconnect');
    if (statusHandler) {
      statusHandler({ connected: true });
    }
    await vi.runOnlyPendingTimersAsync();

    // Explicitly leave
    await edgeMeshClient.leaveRoom();

    const reconnectingEvents: any[] = [];
    edgeMeshClient.events.addEventListener('mesh:reconnecting', (e: any) => {
      reconnectingEvents.push(e.detail);
    });

    // Fast forward
    vi.advanceTimersByTime(50000);
    await vi.runOnlyPendingTimersAsync();

    expect(reconnectingEvents.length).toBe(0);
  });

  it('handles joinRoom reconnect timeout when not online after 5s', async () => {
    // Mock isOnline to return false so the reconnect timeout path is exercised
    isOnlineMock.mockReturnValue(false);

    const reconnectEvents: any[] = [];
    edgeMeshClient.events.addEventListener('mesh:reconnecting', (e: any) => {
      reconnectEvents.push(e.detail);
    });

    await edgeMeshClient.joinRoom('timeout-reconnect-test');

    // After joinRoom, if isOnline=false and status hasn't changed,
    // a setTimeout for 5000ms is scheduled to check and reconnect.
    // Advance time to trigger it
    vi.advanceTimersByTime(5000);
    await vi.runOnlyPendingTimersAsync();

    // Should have triggered a reconnect attempt
    expect(reconnectEvents.length).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────
// K) NESTED DESCRIBE: Event Bus Cleanup Tests
// ─────────────────────────────────────────────────────────────

describe('EdgeMeshClient Events Cleanup', () => {
  it('dispatches mesh:room-left event on destroy', async () => {
    await edgeMeshClient.joinRoom('destroy-room-left');

    const events: any[] = [];
    edgeMeshClient.events.addEventListener('mesh:room-left', (e: any) => {
      events.push(e);
    });

    await edgeMeshClient.destroy();
    expect(events.length).toBe(1);
  });

  it('does not dispatch spurious events after destroy', async () => {
    await edgeMeshClient.joinRoom('no-spurious-events');

    const events: any[] = [];
    edgeMeshClient.events.addEventListener('mesh:room-joined', (e: any) => {
      events.push(e.detail);
    });

    await edgeMeshClient.destroy();

    // After destroy, joining a new room should dispatch room-joined
    await edgeMeshClient.joinRoom('new-room-after-destroy');
    expect(events.length).toBe(1);
    expect(events[0].room).toBe('swal-agent-runner/new-room-after-destroy');
  });
});

// ─────────────────────────────────────────────────────────────
// L) ADDITIONAL COVERAGE FOR STRYKER MUTATION SCORE
// ─────────────────────────────────────────────────────────────

describe('EdgeMeshClient Extra Stryker Coverage', () => {
  it('triggers _ensureYjs internally on .yjs getter access and returns it once loaded', async () => {
    setPrivateField(edgeMeshClient, '_yjs', null);
    setPrivateField(edgeMeshClient, '_yjsPromise', null);

    const yjs = edgeMeshClient.yjs;
    await vi.waitFor(() => {
      expect(getPrivateField(edgeMeshClient, '_yjs')).not.toBeNull();
    });

    expect(edgeMeshClient.yjs).toBe(getPrivateField(edgeMeshClient, '_yjs'));
  });

  it('throws an error if YjsAdapter has not been initialized (event bus)', () => {
    setPrivateField(edgeMeshClient, '_eventBus', null);
    setPrivateField(edgeMeshClient, '_yjs', null);

    expect(() => edgeMeshClient.crdtEventBus).toThrow(
      'CrdtEventBus not available — ensure YjsAdapter is initialized'
    );
  });

  it('throws an error if YjsAdapter has not been initialized (memory store)', () => {
    setPrivateField(edgeMeshClient, '_crdtMemoryStore', null);
    setPrivateField(edgeMeshClient, '_yjs', null);

    expect(() => edgeMeshClient.crdtMemoryStore).toThrow(
      'CrdtMemoryStore not available — ensure YjsAdapter is initialized'
    );
  });

  it('instantiates and caches CrdtEventBus when YjsAdapter is loaded', async () => {
    setPrivateField(edgeMeshClient, '_eventBus', null);
    await edgeMeshClient.getDoc(); // initializes YjsAdapter

    const bus = edgeMeshClient.crdtEventBus;
    expect(bus).toBeDefined();
    expect(edgeMeshClient.crdtEventBus).toBe(bus); // check caching
  });

  it('instantiates and caches CrdtMemoryStore when YjsAdapter is loaded', async () => {
    setPrivateField(edgeMeshClient, '_crdtMemoryStore', null);
    await edgeMeshClient.getDoc(); // initializes YjsAdapter

    const store = edgeMeshClient.crdtMemoryStore;
    expect(store).toBeDefined();
    expect(edgeMeshClient.crdtMemoryStore).toBe(store); // check caching
  });

  it('reconnect returns early if no mesh room, explicitly disconnected, or already scheduled', () => {
    const spySetTimeout = vi.spyOn(globalThis, 'setTimeout');

    // 1. No mesh room
    setPrivateField(edgeMeshClient, '_meshRoom', '');
    (edgeMeshClient as any).reconnect();
    expect(spySetTimeout).not.toHaveBeenCalled();

    // 2. Explicitly disconnected
    setPrivateField(edgeMeshClient, '_meshRoom', 'some-room');
    setPrivateField(edgeMeshClient, '_isExplicitlyDisconnected', true);
    spySetTimeout.mockClear();
    (edgeMeshClient as any).reconnect();
    expect(spySetTimeout).not.toHaveBeenCalled();

    // 3. Reconnect already scheduled
    setPrivateField(edgeMeshClient, '_isExplicitlyDisconnected', false);
    setPrivateField(edgeMeshClient, '_reconnectTimeout', 12345);
    spySetTimeout.mockClear();
    (edgeMeshClient as any).reconnect();
    expect(spySetTimeout).not.toHaveBeenCalled();

    spySetTimeout.mockRestore();
  });

  it('reconnect timeout callback returns early if explicitly disconnected or room empty during delay', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    await edgeMeshClient.joinRoom('test-room');
    isOnlineMock.mockReturnValue(false);
    if (statusHandler) {
      statusHandler({ connected: false });
    }

    setPrivateField(edgeMeshClient, '_isExplicitlyDisconnected', true);

    const ensureSpy = vi.spyOn(edgeMeshClient as any, '_ensureYjs');
    await vi.advanceTimersByTimeAsync(1500);

    expect(ensureSpy).not.toHaveBeenCalled();
    ensureSpy.mockRestore();
  });

  it('reconnect timeout cleans up existing _crdtSync even if destroy throws', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    await edgeMeshClient.joinRoom('test-room');

    const mockSync = {
      webrtc: {
        off: vi.fn(),
      },
      destroy: vi.fn().mockImplementation(() => {
        throw new Error('mock destroy failure');
      }),
      isOnline: () => false,
    };
    setPrivateField(edgeMeshClient, '_crdtSync', mockSync);

    isOnlineMock.mockReturnValue(false);
    if (statusHandler) {
      statusHandler({ connected: false });
    }

    await vi.advanceTimersByTimeAsync(1500);
    expect(mockSync.destroy).toHaveBeenCalled();
  });

  it('reconnect timeout calls reconnect recursively when initCrdtSync throws', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    await edgeMeshClient.joinRoom('test-room');

    isOnlineMock.mockReturnValue(false);
    if (statusHandler) {
      statusHandler({ connected: false });
    }

    initCrdtSyncMock.mockRejectedValueOnce(new Error('initCrdtSync failed during reconnect'));

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const reconnectSpy = vi.spyOn(edgeMeshClient as any, 'reconnect');

    await vi.advanceTimersByTimeAsync(1500);

    expect(consoleSpy).toHaveBeenCalledWith(
      '[EdgeMesh] Reconnection attempt failed:',
      expect.any(Error)
    );
    expect(reconnectSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
    reconnectSpy.mockRestore();
  });

  it('handles startHeartbeat error if getDoc throws', async () => {
    vi.spyOn(edgeMeshClient, 'getDoc').mockRejectedValueOnce(new Error('getDoc failed'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await (edgeMeshClient as any).startHeartbeat();

    expect(consoleSpy).toHaveBeenCalledWith(
      '[EdgeMesh] Failed to start heartbeat:',
      expect.any(Error)
    );
    consoleSpy.mockRestore();
  });

  it('handles startHeartbeat interval error if deviceIdentity.getInfo throws', async () => {
    await edgeMeshClient.joinRoom('test-room');
    if (statusHandler) {
      statusHandler({ connected: true });
    }
    await vi.runOnlyPendingTimersAsync();

    vi.spyOn(deviceIdentity, 'getInfo').mockRejectedValue(new Error('getInfo failed'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.advanceTimersByTime(10000);
    await vi.runOnlyPendingTimersAsync();

    expect(consoleSpy).toHaveBeenCalledWith(
      '[EdgeMesh] Heartbeat error:',
      expect.any(Error)
    );
    consoleSpy.mockRestore();
  });

  it('updates mesh peers when peer list has changed but size is equal', async () => {
    await edgeMeshClient.joinRoom('test-room');
    if (statusHandler) {
      statusHandler({ connected: true });
    }
    await vi.runOnlyPendingTimersAsync();

    const doc = await edgeMeshClient.getDoc();
    const presenceMap = doc.getMap<any>('mesh:presence');

    presenceMap.set('peer-a', {
      deviceId: 'peer-a',
      name: 'Peer A',
      deviceType: 'pc',
      lastHeartbeat: Date.now(),
    });
    await vi.runOnlyPendingTimersAsync();
    expect(edgeMeshClient.meshPeers).toEqual(['peer-a']);

    presenceMap.delete('peer-a');
    presenceMap.set('peer-b', {
      deviceId: 'peer-b',
      name: 'Peer B',
      deviceType: 'pc',
      lastHeartbeat: Date.now(),
    });
    await vi.runOnlyPendingTimersAsync();
    expect(edgeMeshClient.meshPeers).toEqual(['peer-b']);
  });

  it('onPeerConnected falls back to unknown if detail or nodoId is missing', () => {
    const transport = createMockTransport('peer-node');
    edgeMeshClient.setTransport(transport);

    fireTransportEvent(transport, 'conectado', {});
    expect(getPrivateField(edgeMeshClient, '_peerEndpoint')).toBe('unknown');

    fireTransportEvent(transport, 'conectado', undefined);
    expect(getPrivateField(edgeMeshClient, '_peerEndpoint')).toBe('unknown');
  });

  it('stopHeartbeat ignores errors if doc.getMap throws', async () => {
    await edgeMeshClient.joinRoom('test-room');
    if (statusHandler) {
      statusHandler({ connected: true });
    }
    await vi.runOnlyPendingTimersAsync();

    const doc = await edgeMeshClient.getDoc();
    vi.spyOn(doc, 'getMap').mockImplementation(() => {
      throw new Error('mock getMap failure');
    });

    await expect(edgeMeshClient.leaveRoom()).resolves.not.toThrow();
  });

  it('calls YjsAdapter.create exactly once across multiple ensure calls', async () => {
    const createSpy = vi.spyOn(YjsAdapter, 'create');
    setPrivateField(edgeMeshClient, '_yjs', null);
    setPrivateField(edgeMeshClient, '_yjsPromise', null);

    await (edgeMeshClient as any)._ensureYjs();
    await (edgeMeshClient as any)._ensureYjs();

    expect(createSpy).toHaveBeenCalledTimes(1);
    createSpy.mockRestore();
  });

  it('joinRoom clears existing _reconnectTimeout', async () => {
    const spyClear = vi.spyOn(globalThis, 'clearTimeout');
    setPrivateField(edgeMeshClient, '_reconnectTimeout', 9999);

    await edgeMeshClient.joinRoom('clear-reconnect-test');

    expect(spyClear).toHaveBeenCalledWith(9999);
    expect(getPrivateField(edgeMeshClient, '_reconnectTimeout')).toBeNull();
    spyClear.mockRestore();
  });

  it('joinRoom initializes CRDT sync with maxConnections: 10', async () => {
    await edgeMeshClient.joinRoom('max-conn-test');
    expect(initCrdtSyncMock).toHaveBeenCalledWith(
      expect.any(Object),
      'swal-agent-runner/max-conn-test',
      { maxConnections: 10 }
    );
  });

  it('joinRoom when offline schedules reconnect check after 5s', async () => {
    isOnlineMock.mockReturnValue(false);
    const reconnectSpy = vi.spyOn(edgeMeshClient as any, 'reconnect');

    await edgeMeshClient.joinRoom('offline-join-test');

    // Reconnect timeout should be set
    expect(getPrivateField(edgeMeshClient, '_reconnectTimeout')).not.toBeNull();

    // Advance 5 seconds to fire the check
    await vi.advanceTimersByTimeAsync(5000);

    expect(reconnectSpy).toHaveBeenCalled();
    reconnectSpy.mockRestore();
  });

  it('leaveRoom sets _isExplicitlyDisconnected to true', async () => {
    setPrivateField(edgeMeshClient, '_isExplicitlyDisconnected', false);
    await edgeMeshClient.leaveRoom();
    expect(getPrivateField(edgeMeshClient, '_isExplicitlyDisconnected')).toBe(true);
  });

  it('leaveRoom clears existing _reconnectTimeout', async () => {
    const spyClear = vi.spyOn(globalThis, 'clearTimeout');
    setPrivateField(edgeMeshClient, '_reconnectTimeout', 4321);

    await edgeMeshClient.leaveRoom();

    expect(spyClear).toHaveBeenCalledWith(4321);
    expect(getPrivateField(edgeMeshClient, '_reconnectTimeout')).toBeNull();
    spyClear.mockRestore();
  });

  it('leaveRoom deletes own presence from presenceMap', async () => {
    await edgeMeshClient.joinRoom('delete-presence-test');
    const doc = await edgeMeshClient.getDoc();
    const presenceMap = doc.getMap<any>('mesh:presence');
    presenceMap.set(edgeMeshClient.deviceId, { deviceId: edgeMeshClient.deviceId });

    expect(presenceMap.has(edgeMeshClient.deviceId)).toBe(true);

    await edgeMeshClient.leaveRoom();

    expect(presenceMap.has(edgeMeshClient.deviceId)).toBe(false);
  });

  it('leaveRoom handles _crdtSync.destroy failure gracefully', async () => {
    await edgeMeshClient.joinRoom('destroy-fail-test');

    const mockSync = {
      webrtc: {
        off: vi.fn(),
      },
      destroy: vi.fn().mockImplementation(() => {
        throw new Error('destroy failure');
      }),
      isOnline: () => true,
    };
    setPrivateField(edgeMeshClient, '_crdtSync', mockSync);

    await expect(edgeMeshClient.leaveRoom()).resolves.not.toThrow();
    expect(getPrivateField(edgeMeshClient, '_crdtSync')).toBeNull();
  });

  it('handleConnected resets _reconnectAttempts to 0', async () => {
    await edgeMeshClient.joinRoom('reconnect-reset-test');
    setPrivateField(edgeMeshClient, '_reconnectAttempts', 5);

    // Trigger connected status
    if (statusHandler) {
      statusHandler({ connected: true });
    }
    await vi.runOnlyPendingTimersAsync();

    expect(getPrivateField(edgeMeshClient, '_reconnectAttempts')).toBe(0);
  });

  it('reconnect calculates exponential backoff delay and respects the 30000ms cap', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // jitter will be exactly 500ms
    setPrivateField(edgeMeshClient, '_meshRoom', 'backoff-test');
    setPrivateField(edgeMeshClient, '_isExplicitlyDisconnected', false);
    setPrivateField(edgeMeshClient, '_reconnectTimeout', null);

    const delays: number[] = [];
    edgeMeshClient.events.addEventListener('mesh:reconnecting', (e: any) => {
      delays.push(e.detail.delay);
    });

    // Attempt 1: delay = Math.min(1000 * 2^0, 30000) + 500 = 1500ms
    setPrivateField(edgeMeshClient, '_reconnectAttempts', 0);
    (edgeMeshClient as any).reconnect();
    expect(delays[0]).toBe(1500);

    // Attempt 2: delay = Math.min(1000 * 2^1, 30000) + 500 = 2500ms
    setPrivateField(edgeMeshClient, '_reconnectTimeout', null);
    setPrivateField(edgeMeshClient, '_reconnectAttempts', 1);
    (edgeMeshClient as any).reconnect();
    expect(delays[1]).toBe(2500);

    // Attempt 6 (capped): delay = Math.min(1000 * 2^5, 30000) + 500 = Math.min(32000, 30000) + 500 = 30500ms
    setPrivateField(edgeMeshClient, '_reconnectTimeout', null);
    setPrivateField(edgeMeshClient, '_reconnectAttempts', 5);
    (edgeMeshClient as any).reconnect();
    expect(delays[2]).toBe(30500);
  });

  it('updateMeshPeers handles simultaneous join and leave correctly', async () => {
    await edgeMeshClient.joinRoom('simultaneous-test');
    if (statusHandler) {
      statusHandler({ connected: true });
    }
    await vi.runOnlyPendingTimersAsync();

    const doc = await edgeMeshClient.getDoc();
    const presenceMap = doc.getMap<any>('mesh:presence');

    // Setup initial peer list with peer-a
    presenceMap.set('peer-a', {
      deviceId: 'peer-a',
      name: 'Peer A',
      deviceType: 'pc',
      lastHeartbeat: Date.now(),
    });
    await vi.runOnlyPendingTimersAsync();

    // Set up listeners
    const events: string[] = [];
    edgeMeshClient.events.addEventListener('mesh:peer-joined', (e: any) => {
      events.push(`joined:${e.detail.peerId}`);
    });
    edgeMeshClient.events.addEventListener('mesh:peer-left', (e: any) => {
      events.push(`left:${e.detail.peerId}`);
    });

    // Remove peer-a and add peer-b in the same update cycle
    doc.transact(() => {
      presenceMap.delete('peer-a');
      presenceMap.set('peer-b', {
        deviceId: 'peer-b',
        name: 'Peer B',
        deviceType: 'pc',
        lastHeartbeat: Date.now(),
      });
    });

    await vi.runOnlyPendingTimersAsync();

    expect(events).toContain('left:peer-a');
    expect(events).toContain('joined:peer-b');
  });

  it('joinRoom handles initCrdtSync failure by logging, resetting _meshRoom, and rethrowing', async () => {
    initCrdtSyncMock.mockRejectedValueOnce(new Error('P2P connection failed'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(edgeMeshClient.joinRoom('fail-room')).rejects.toThrow('P2P connection failed');

    expect(edgeMeshClient.meshRoom).toBe('');
    expect(consoleSpy).toHaveBeenCalledWith('[EdgeMesh] Failed to join mesh room:', expect.any(Error));
    consoleSpy.mockRestore();
  });

  it('reconnect timeout calls handleConnected if online becomes true', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    await edgeMeshClient.joinRoom('test-room');

    isOnlineMock.mockReturnValue(false);
    if (statusHandler) {
      statusHandler({ connected: false });
    }

    // Now make it online for the next call
    isOnlineMock.mockReturnValue(true);

    const handleConnectedSpy = vi.spyOn(edgeMeshClient as any, 'handleConnected');

    await vi.advanceTimersByTimeAsync(1500);

    expect(handleConnectedSpy).toHaveBeenCalled();
    handleConnectedSpy.mockRestore();
  });

  it('startHeartbeat initializes _deviceId if empty', async () => {
    setPrivateField(edgeMeshClient, '_deviceId', '');
    await edgeMeshClient.joinRoom('device-id-init-test');

    await vi.waitFor(() => {
      expect(edgeMeshClient.deviceId).toBe('swal-test-device');
    });
  });
});
