import { vi, describe, it, expect } from 'vitest';

// Set up globals for worker execution in jsdom environment
const mockPostMessage = vi.fn();
const mockClose = vi.fn();

globalThis.self.postMessage = mockPostMessage as any;
globalThis.self.close = mockClose as any;

// Mock the WASM module using its resolved relative path from test/
vi.mock('../src/wasm/gestalt_wasm.js', () => {
  return {
    default: async () => {
      // Mock initialization function
    },
    GestaltEngine: class {
      executeRunSpec(spec: any) {
        return {
          run_id: 'wasm-run-123',
          task: spec.task,
          agents: [],
          duration_ms: 100,
          merged_branches: [],
          conflicts: [],
          events_path: 'wasm-events-path',
          success: true,
        };
      }
      subscribeEvents() {
        let count = 0;
        return {
          next() {
            if (count === 0) {
              count++;
              return JSON.stringify({ type: 'state_changed', data: { run_id: 'wasm-run-123', state: 'executing' } });
            }
            if (count === 1) {
              count++;
              return JSON.stringify({ type: 'run_finished', data: { run_id: 'wasm-run-123', success: true } });
            }
            return null;
          }
        };
      }
    }
  };
});

describe('WASM Integration and Mock Fallback', () => {
  it('should notify that worker spawned on file load', async () => {
    // Dynamic import will trigger the top-level execution of the worker
    await import('../src/workers/gestalt-worker');
    expect(mockPostMessage).toHaveBeenCalledWith({
      type: 'worker_spawned',
      payload: expect.any(Object),
    });
  });

  describe('MockGestaltEngine', () => {
    it('should correctly execute run spec with fallback mock behavior', async () => {
      const { MockGestaltEngine } = await import('../src/workers/gestalt-worker');
      const mockEngine = new MockGestaltEngine();
      const spec = {
        base_ref: 'main',
        task: 'Implement a new feature',
        agents: [{ id: 'agent-1', command: 'test', args: [] }],
        max_parallel: 1,
        timeout: 1000,
        push: false,
      };

      const report = mockEngine.executeRunSpec(spec);
      expect(report.run_id).toBeDefined();
      expect(report.task).toBe(spec.task);
      expect(report.agents).toHaveLength(1);
      expect(report.agents[0].agent_id).toBe('agent-1');
      expect(report.success).toBe(true);

      const events = mockEngine.subscribeEvents();
      expect(events).toHaveLength(2);
      expect(events[0]).toContain('engine_initialized');
      expect(events[1]).toContain('execution_ready');

      const status = mockEngine.getStatus();
      expect(status.initialized).toBe(true);
      expect(status.wasmLoaded).toBe(false);
      expect(status.engineType).toBe('mock');
    });
  });

  describe('WasmGestaltEngineProxy', () => {
    it('should proxy executeRunSpec calls to the real WASM engine', async () => {
      const { WasmGestaltEngineProxy } = await import('../src/workers/gestalt-worker');
      const mockWasmEngine = {
        executeRunSpec: vi.fn().mockReturnValue({
          run_id: 'wasm-id',
          success: true,
        }),
        subscribeEvents: vi.fn(),
      };

      const proxy = new WasmGestaltEngineProxy(mockWasmEngine);
      const report = proxy.executeRunSpec({
        base_ref: 'main',
        task: 'WASM task',
        agents: [],
        max_parallel: 1,
        timeout: 1000,
        push: false,
      });

      expect(mockWasmEngine.executeRunSpec).toHaveBeenCalled();
      expect(report.run_id).toBe('wasm-id');
      expect(report.success).toBe(true);
    });

    it('should proxy subscribeEvents and consume the WASM iterator stream until null/undefined', async () => {
      const { WasmGestaltEngineProxy } = await import('../src/workers/gestalt-worker');
      const mockEvents = [
        'event-1',
        'event-2',
      ];
      let eventIdx = 0;

      const mockWasmEngine = {
        executeRunSpec: vi.fn(),
        subscribeEvents: vi.fn().mockReturnValue({
          next: () => {
            if (eventIdx < mockEvents.length) {
              return mockEvents[eventIdx++];
            }
            return null;
          },
        }),
      };

      const proxy = new WasmGestaltEngineProxy(mockWasmEngine);
      const events = proxy.subscribeEvents();

      expect(mockWasmEngine.subscribeEvents).toHaveBeenCalled();
      expect(events).toEqual(['event-1', 'event-2']);
    });

    it('should return correct WASM status', async () => {
      const { WasmGestaltEngineProxy } = await import('../src/workers/gestalt-worker');
      const proxy = new WasmGestaltEngineProxy({});
      const status = proxy.getStatus();
      expect(status.initialized).toBe(true);
      expect(status.wasmLoaded).toBe(true);
      expect(status.engineType).toBe('wasm');
    });
  });

  describe('WASM Dynamic Loader Integration', () => {
    it('should load real WASM successfully and set engine to WasmGestaltEngineProxy', async () => {
      const { tryLoadWasm } = await import('../src/workers/gestalt-worker');
      const loaded = await tryLoadWasm();
      expect(loaded).toBe(true);

      const { engine: updatedEngine } = await import('../src/workers/gestalt-worker');
      expect(updatedEngine).toBeDefined();
      expect(updatedEngine!.getStatus().engineType).toBe('wasm');

      // Test proxy execute on the loaded engine
      const report = updatedEngine!.executeRunSpec({
        base_ref: 'main',
        task: 'Do integration task',
        agents: [],
        max_parallel: 1,
        timeout: 1000,
        push: false,
      });
      expect(report.run_id).toBe('wasm-run-123');

      // Test proxy subscribe events on the loaded engine
      const events = updatedEngine!.subscribeEvents();
      expect(events).toHaveLength(2);
      expect(events[0]).toContain('state_changed');
    });
  });
});
