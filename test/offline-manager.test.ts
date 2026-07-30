import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock syncQueue before importing OfflineManager
const mockProcessAll = vi.fn().mockResolvedValue({ completed: 0, failed: 0 });
const mockSyncQueue = {
  processAll: mockProcessAll,
};

vi.mock('../src/services/offline/sync-queue', () => ({
  syncQueue: mockSyncQueue,
}));

// Track event listeners so we can simulate online/offline events
type EventCallback = (...args: any[]) => void;
const windowEventListeners: Record<string, EventCallback[]> = {};

const originalNavigator = globalThis.navigator;

describe('OfflineManager', () => {
  let mockStorage: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Capture window event listeners for 'online' and 'offline'
    windowEventListeners['online'] = [];
    windowEventListeners['offline'] = [];
    vi.spyOn(window, 'addEventListener').mockImplementation(
      (event: string, handler: EventListenerOrEventListenerObject) => {
        if (event === 'online' || event === 'offline') {
          windowEventListeners[event]!.push(handler as EventCallback);
        }
      },
    );

    mockStorage = {
      persist: vi.fn().mockResolvedValue(true),
      estimate: vi.fn().mockResolvedValue({ usage: 1024, quota: 1048576 }),
    };

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        onLine: true,
        storage: mockStorage,
      },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      configurable: true,
      writable: true,
    });

    // Reset event listeners map
    Object.keys(windowEventListeners).forEach((k) => (windowEventListeners[k] = []));
  });

  it('should report online when navigator.onLine is true', async () => {
    const { OfflineManager } = await import('../src/services/offline/offline-manager');
    const mgr = new OfflineManager();
    expect(mgr.online).toBe(true);
  });

  it('should report offline when navigator.onLine is false', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        onLine: false,
        storage: mockStorage,
      },
      configurable: true,
      writable: true,
    });

    const { OfflineManager } = await import('../src/services/offline/offline-manager');
    const mgr = new OfflineManager();
    expect(mgr.online).toBe(false);
  });

  it('should call syncQueue.processAll on construction when online', async () => {
    // Import fresh to get the fresh mock
    const { OfflineManager } = await import('../src/services/offline/offline-manager');
    mockProcessAll.mockClear();
    new OfflineManager();
    expect(mockProcessAll).toHaveBeenCalledTimes(1);
  });

  it('should not call syncQueue.processAll on construction when offline', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        onLine: false,
        storage: mockStorage,
      },
      configurable: true,
      writable: true,
    });

    const { OfflineManager } = await import('../src/services/offline/offline-manager');
    mockProcessAll.mockClear();
    new OfflineManager();
    expect(mockProcessAll).not.toHaveBeenCalled();
  });

  it('should call syncQueue.processAll when coming back online', async () => {
    // Start offline
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        onLine: false,
        storage: mockStorage,
      },
      configurable: true,
      writable: true,
    });

    const { OfflineManager } = await import('../src/services/offline/offline-manager');
    mockProcessAll.mockClear();
    const mgr = new OfflineManager();

    expect(mgr.online).toBe(false);
    expect(mockProcessAll).not.toHaveBeenCalled();

    // Simulate coming online
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        onLine: true,
        storage: mockStorage,
      },
      configurable: true,
      writable: true,
    });

    mockProcessAll.mockClear();
    // Fire the 'online' event
    for (const handler of windowEventListeners['online'] || []) {
      handler(new Event('online'));
    }

    expect(mgr.online).toBe(true);
    expect(mockProcessAll).toHaveBeenCalledTimes(1);
  });

  it('should update online status when going offline', async () => {
    const { OfflineManager } = await import('../src/services/offline/offline-manager');
    const mgr = new OfflineManager();
    expect(mgr.online).toBe(true);

    // Simulate going offline
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        onLine: false,
        storage: mockStorage,
      },
      configurable: true,
      writable: true,
    });

    for (const handler of windowEventListeners['offline'] || []) {
      handler(new Event('offline'));
    }

    expect(mgr.online).toBe(false);
  });

  it('should notify subscribers on connectivity change', async () => {
    const { OfflineManager } = await import('../src/services/offline/offline-manager');
    const mgr = new OfflineManager();
    const subscriber = vi.fn();

    const unsub = mgr.subscribe(subscriber);

    // Subscriber should be called immediately with current state
    expect(subscriber).toHaveBeenCalledWith(true);
    subscriber.mockClear();

    // Go offline
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        onLine: false,
        storage: mockStorage,
      },
      configurable: true,
      writable: true,
    });

    for (const handler of windowEventListeners['offline'] || []) {
      handler(new Event('offline'));
    }

    expect(subscriber).toHaveBeenCalledWith(false);

    // Unsubscribe
    unsub();
    subscriber.mockClear();

    // Go online again — subscriber should not be called
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        onLine: true,
        storage: mockStorage,
      },
      configurable: true,
      writable: true,
    });

    for (const handler of windowEventListeners['online'] || []) {
      handler(new Event('online'));
    }

    expect(subscriber).not.toHaveBeenCalled();
  });

  it('should request persistence and return true on success', async () => {
    mockStorage.persist.mockResolvedValue(true);

    const { OfflineManager } = await import('../src/services/offline/offline-manager');
    const mgr = new OfflineManager();
    const result = await mgr.requestPersistence();

    expect(result).toBe(true);
    expect(mgr.persisted).toBe(true);
  });

  it('should request persistence and return false on failure', async () => {
    mockStorage.persist.mockRejectedValue(new Error('denied'));

    const { OfflineManager } = await import('../src/services/offline/offline-manager');
    const mgr = new OfflineManager();
    const result = await mgr.requestPersistence();

    expect(result).toBe(false);
    expect(mgr.persisted).toBe(false);
  });

  it('should return false for persistence when navigator.storage is unavailable', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        onLine: true,
        // No storage property
      },
      configurable: true,
      writable: true,
    });

    const { OfflineManager } = await import('../src/services/offline/offline-manager');
    const mgr = new OfflineManager();

    // Clear the initial requestPersistence call from constructor
    const result = await mgr.requestPersistence();
    expect(result).toBe(false);
  });

  it('should estimate storage usage correctly', async () => {
    const { OfflineManager } = await import('../src/services/offline/offline-manager');
    const mgr = new OfflineManager();
    const est = await mgr.estimateStorage();

    expect(est).toEqual({ usage: 1024, quota: 1048576 });
  });

  it('should return null for estimateStorage when navigator.storage.estimate is unavailable', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        onLine: true,
        storage: {}, // No estimate method
      },
      configurable: true,
      writable: true,
    });

    const { OfflineManager } = await import('../src/services/offline/offline-manager');
    const mgr = new OfflineManager();
    const result = await mgr.estimateStorage();
    expect(result).toBeNull();
  });

  it('should handle storage.estimate rejection gracefully', async () => {
    mockStorage.estimate.mockRejectedValue(new Error('storage error'));

    const { OfflineManager } = await import('../src/services/offline/offline-manager');
    const mgr = new OfflineManager();
    const result = await mgr.estimateStorage();
    expect(result).toBeNull();
  });
});
