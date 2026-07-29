import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { edgeMeshClient } from '../edge-mesh-client';
import { deviceIdentity } from '../device-identity';

// Setup Mock for crdt-sync
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

vi.mock('../crdt-sync', () => ({
  initCrdtSync: () => Promise.resolve({
    webrtc: mockWebrtcProvider,
    indexeddb: { destroy: () => {} },
    destroy: mockDestroy,
    isOnline: () => isOnlineMock(),
  }),
}));

describe('EdgeMeshClient Reliability & Heartbeats', () => {
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

    // Reset edgeMeshClient state
    await edgeMeshClient.leaveRoom();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

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
