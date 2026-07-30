import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock Y.Doc with a proper class (not vi.fn, so clearAllMocks is safe) ─
class MockDoc {
  private _listeners: Map<string, Set<(...args: any[]) => void>> = new Map();
  private _maps: Map<string, any> = new Map();
  private _arrays: Map<string, any> = new Map();
  private _texts: Map<string, any> = new Map();
  private _destroyed = false;

  on(event: string, handler: (...args: any[]) => void) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event)!.add(handler);
  }

  off(event: string, handler: (...args: any[]) => void) {
    this._listeners.get(event)?.delete(handler);
  }

  emit(event: string, ...args: any[]) {
    this._listeners.get(event)?.forEach((h) => h(...args));
  }

  getMap<T = unknown>(_name: string) {
    if (!this._maps.has(_name)) this._maps.set(_name, { _name });
    return this._maps.get(_name) as any;
  }

  getArray<T = unknown>(_name: string) {
    if (!this._arrays.has(_name)) this._arrays.set(_name, { _name });
    return this._arrays.get(_name) as any;
  }

  getText(_name: string) {
    if (!this._texts.has(_name)) this._texts.set(_name, { _name });
    return this._texts.get(_name) as any;
  }

  destroy() {
    this._destroyed = true;
    this._listeners.clear();
  }

  get destroyed() { return this._destroyed; }
  get listeners() { return this._listeners; }
}

const mockApplyUpdate = vi.fn();
const mockEncodeStateAsUpdate = vi.fn();
const mockEncodeStateVector = vi.fn();

// Use a function to lazily return MockDoc, avoiding hoisting issues
function getMockDocCtor() { return MockDoc; }

vi.mock('yjs', () => ({
  default: {
    Doc: getMockDocCtor(),
    applyUpdate: mockApplyUpdate,
    encodeStateAsUpdate: mockEncodeStateAsUpdate,
    encodeStateVector: mockEncodeStateVector,
  },
  Doc: getMockDocCtor(),
  applyUpdate: mockApplyUpdate,
  encodeStateAsUpdate: mockEncodeStateAsUpdate,
  encodeStateVector: mockEncodeStateVector,
}));

describe('YjsAdapter', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    // Re-establish default mock behaviors
    mockApplyUpdate.mockImplementation((_doc: any, _update: Uint8Array, _origin: unknown) => {});
    mockEncodeStateAsUpdate.mockReturnValue(new Uint8Array([1, 2, 3, 4]));
    mockEncodeStateVector.mockReturnValue(new Uint8Array([5, 6, 7]));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should create a YjsAdapter with a new Doc', async () => {
    const { YjsAdapter } = await import('../src/services/mesh/yjs-adapter');
    const adapter = await YjsAdapter.create();

    expect(adapter).toBeInstanceOf(YjsAdapter);
    expect(adapter.doc).toBeDefined();
    expect(adapter.doc.on).toBeDefined();
    expect(typeof adapter.doc.on).toBe('function');
  });

  it('should use provided Doc when creating adapter', async () => {
    const { YjsAdapter } = await import('../src/services/mesh/yjs-adapter');
    const customDoc = new MockDoc();
    const adapter = await YjsAdapter.create(customDoc as any);

    expect(adapter.doc).toBe(customDoc);
  });

  it('should register update listener via onUpdate', async () => {
    const { YjsAdapter } = await import('../src/services/mesh/yjs-adapter');
    const adapter = await YjsAdapter.create();

    const handler = vi.fn();
    const unsub = adapter.onUpdate(handler);

    const update = new Uint8Array([1, 2]);
    const origin = 'test';
    (adapter.doc as unknown as MockDoc).emit('update', update, origin);

    expect(handler).toHaveBeenCalledWith(update, origin);
    expect(typeof unsub).toBe('function');
  });

  it('should remove update listener when unsub is called', async () => {
    const { YjsAdapter } = await import('../src/services/mesh/yjs-adapter');
    const adapter = await YjsAdapter.create();

    const handler = vi.fn();
    const unsub = adapter.onUpdate(handler);

    unsub();

    (adapter.doc as unknown as MockDoc).emit('update', new Uint8Array([3]), 'test');

    expect(handler).not.toHaveBeenCalled();
  });

  it('should apply update via applyUpdate', async () => {
    const { YjsAdapter } = await import('../src/services/mesh/yjs-adapter');
    const adapter = await YjsAdapter.create();

    const update = new Uint8Array([10, 20, 30]);
    await adapter.applyUpdate(update);

    expect(mockApplyUpdate).toHaveBeenCalledWith(adapter.doc, update, null);
  });

  it('should apply update with custom origin', async () => {
    const { YjsAdapter } = await import('../src/services/mesh/yjs-adapter');
    const adapter = await YjsAdapter.create();

    const update = new Uint8Array([10, 20]);
    const origin = 'remote-peer';
    await adapter.applyUpdate(update, origin);

    expect(mockApplyUpdate).toHaveBeenCalledWith(adapter.doc, update, origin);
  });

  it('should get full state via getState', async () => {
    const { YjsAdapter } = await import('../src/services/mesh/yjs-adapter');
    const adapter = await YjsAdapter.create();

    mockEncodeStateAsUpdate.mockReturnValue(new Uint8Array([1, 2, 3, 4]));

    const state = await adapter.getState();

    expect(mockEncodeStateAsUpdate).toHaveBeenCalledWith(adapter.doc);
    expect(state).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('should get state vector via getStateVector', async () => {
    const { YjsAdapter } = await import('../src/services/mesh/yjs-adapter');
    const adapter = await YjsAdapter.create();

    mockEncodeStateVector.mockReturnValue(new Uint8Array([5, 6, 7]));

    const sv = await adapter.getStateVector();

    expect(mockEncodeStateVector).toHaveBeenCalledWith(adapter.doc);
    expect(sv).toEqual(new Uint8Array([5, 6, 7]));
  });

  it('should get/create shared map via getMap', async () => {
    const { YjsAdapter } = await import('../src/services/mesh/yjs-adapter');
    const adapter = await YjsAdapter.create();

    const map = adapter.getMap('test-map');
    expect(map).toBeDefined();
    expect((map as any)._name).toBe('test-map');

    // Getting same name returns same instance
    const map2 = adapter.getMap('test-map');
    expect(map2).toBe(map);
  });

  it('should get/create shared array via getArray', async () => {
    const { YjsAdapter } = await import('../src/services/mesh/yjs-adapter');
    const adapter = await YjsAdapter.create();

    const arr = adapter.getArray('test-array');
    expect(arr).toBeDefined();
    expect((arr as any)._name).toBe('test-array');
  });

  it('should get/create shared text via getText', async () => {
    const { YjsAdapter } = await import('../src/services/mesh/yjs-adapter');
    const adapter = await YjsAdapter.create();

    const text = adapter.getText('test-text');
    expect(text).toBeDefined();
    expect((text as any)._name).toBe('test-text');
  });

  it('should destroy the adapter and doc', async () => {
    const { YjsAdapter } = await import('../src/services/mesh/yjs-adapter');
    const adapter = await YjsAdapter.create();

    const handler = vi.fn();
    adapter.onUpdate(handler);

    const doc = adapter.doc as unknown as MockDoc;
    const docDestroySpy = vi.spyOn(doc, 'destroy');
    const docOffSpy = vi.spyOn(doc, 'off');

    adapter.destroy();

    expect(docOffSpy).toHaveBeenCalledWith('update', handler);
    expect(docDestroySpy).toHaveBeenCalled();
    expect(doc.listeners.get('update')?.size ?? 0).toBe(0);
  });

  it('should cleanup all listeners on destroy', async () => {
    const { YjsAdapter } = await import('../src/services/mesh/yjs-adapter');
    const adapter = await YjsAdapter.create();

    const handler1 = vi.fn();
    const handler2 = vi.fn();
    adapter.onUpdate(handler1);
    adapter.onUpdate(handler2);

    const doc = adapter.doc as unknown as MockDoc;
    const docOffSpy = vi.spyOn(doc, 'off');

    adapter.destroy();

    expect(docOffSpy).toHaveBeenCalledWith('update', handler1);
    expect(docOffSpy).toHaveBeenCalledWith('update', handler2);
    expect(docOffSpy).toHaveBeenCalledTimes(2);

    // After destroy, emit does nothing
    (adapter.doc as unknown as MockDoc).emit('update', new Uint8Array([99]), 'test');
    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).not.toHaveBeenCalled();
  });

  it('should support multiple concurrent update listeners', async () => {
    const { YjsAdapter } = await import('../src/services/mesh/yjs-adapter');
    const adapter = await YjsAdapter.create();

    const handler1 = vi.fn();
    const handler2 = vi.fn();
    adapter.onUpdate(handler1);
    adapter.onUpdate(handler2);

    const update = new Uint8Array([1, 2, 3]);
    const origin = 'sync';
    (adapter.doc as unknown as MockDoc).emit('update', update, origin);

    expect(handler1).toHaveBeenCalledWith(update, origin);
    expect(handler2).toHaveBeenCalledWith(update, origin);
  });

  it('should handle empty update in applyUpdate', async () => {
    const { YjsAdapter } = await import('../src/services/mesh/yjs-adapter');
    const adapter = await YjsAdapter.create();

    const emptyUpdate = new Uint8Array([]);
    await adapter.applyUpdate(emptyUpdate);

    expect(mockApplyUpdate).toHaveBeenCalledWith(adapter.doc, emptyUpdate, null);
  });

  it('should work with getState and getStateVector returning different data', async () => {
    const { YjsAdapter } = await import('../src/services/mesh/yjs-adapter');
    const adapter = await YjsAdapter.create();

    mockEncodeStateAsUpdate.mockReturnValue(new Uint8Array([10, 20]));
    mockEncodeStateVector.mockReturnValue(new Uint8Array([30, 40, 50]));

    const state = await adapter.getState();
    const sv = await adapter.getStateVector();

    expect(state).toEqual(new Uint8Array([10, 20]));
    expect(sv).toEqual(new Uint8Array([30, 40, 50]));
  });

  it('should create YjsAdapter asynchronously via static create', async () => {
    const { YjsAdapter } = await import('../src/services/mesh/yjs-adapter');
    const adapter = await YjsAdapter.create();

    expect(adapter).toBeDefined();
    expect(adapter.doc).toBeDefined();
    expect(adapter.getState).toBeDefined();
    expect(adapter.applyUpdate).toBeDefined();
  });

  // ── yjs dynamic import and caching ─────────────────────────────────

  describe('yjs dynamic import and caching', () => {
    it('should cache the yjs module promise', async () => {
      let defaultAccessCount = 0;
      vi.doMock('yjs', () => {
        const mockModule = {
          get default() {
            defaultAccessCount++;
            return {
              Doc: MockDoc,
              encodeStateAsUpdate: mockEncodeStateAsUpdate,
              encodeStateVector: mockEncodeStateVector,
            };
          },
          Doc: MockDoc,
          encodeStateAsUpdate: mockEncodeStateAsUpdate,
          encodeStateVector: mockEncodeStateVector,
        };
        return mockModule;
      });

      const { YjsAdapter } = await import('../src/services/mesh/yjs-adapter');
      const adapter = await YjsAdapter.create();

      // Reset access count after initial load
      defaultAccessCount = 0;

      // Trigger subsequent methods that call getYjs()
      await adapter.getState();
      await adapter.getStateVector();

      expect(defaultAccessCount).toBe(0);
    });

    it('should handle ESM shape with default.Doc', async () => {
      vi.doMock('yjs', () => ({
        default: {
          Doc: MockDoc,
          applyUpdate: mockApplyUpdate,
        },
        Doc: MockDoc,
      }));

      const { YjsAdapter } = await import('../src/services/mesh/yjs-adapter');
      const adapter = await YjsAdapter.create();
      await adapter.applyUpdate(new Uint8Array([1]));
      expect(mockApplyUpdate).toHaveBeenCalled();
    });

    it('should handle CJS/fallback shape without default.Doc', async () => {
      const mockApplyUpdateCjs = vi.fn();
      vi.doMock('yjs', () => ({
        __esModule: true,
        default: undefined,
        Doc: MockDoc,
        applyUpdate: mockApplyUpdateCjs,
      }));

      const { YjsAdapter } = await import('../src/services/mesh/yjs-adapter');
      const adapter = await YjsAdapter.create();
      await adapter.applyUpdate(new Uint8Array([2]));
      expect(mockApplyUpdateCjs).toHaveBeenCalled();
    });

    it('should handle shape with default but no default.Doc', async () => {
      const mockApplyUpdateNoDoc = vi.fn();
      vi.doMock('yjs', () => ({
        default: {
          // no Doc here
          applyUpdate: mockApplyUpdateNoDoc,
        },
        Doc: MockDoc,
        applyUpdate: mockApplyUpdateNoDoc,
      }));

      const { YjsAdapter } = await import('../src/services/mesh/yjs-adapter');
      const adapter = await YjsAdapter.create();
      await adapter.applyUpdate(new Uint8Array([3]));
      expect(mockApplyUpdateNoDoc).toHaveBeenCalled();
    });
  });
});
