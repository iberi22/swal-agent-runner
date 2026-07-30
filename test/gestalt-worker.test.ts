/**
 * gestalt-worker.test.ts — Unit tests for gestalt-worker.ts
 *
 * Tests the Web Worker's exports: MockGestaltEngine, WasmGestaltEngineProxy,
 * tryLoadWasm, and the self.onmessage message handler.
 *
 * Since the source uses a dynamic import variable for the WASM module path,
 * vi.mock cannot intercept that path — tryLoadWasm always returns false
 * in test (WASM not yet compiled is the expected dev fallback).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Global mocks ─────────────────────────────────────────────────────

const mockPostMessage = vi.fn();
const mockClose = vi.fn();

let onmessageHandler: ((e: MessageEvent) => void) | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});

  // Set up minimal self globals for the worker
  globalThis.self = globalThis as any;
  globalThis.self.postMessage = mockPostMessage as any;
  globalThis.self.close = mockClose as any;

  onmessageHandler = null;

  // Capture the onmessage assignment when the module sets it
  Object.defineProperty(globalThis.self, 'onmessage', {
    get() {
      return onmessageHandler;
    },
    set(fn: ((e: MessageEvent) => void) | null) {
      onmessageHandler = fn;
    },
    configurable: true,
    enumerable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  // Reset onmessage
  Object.defineProperty(globalThis.self, 'onmessage', {
    value: null,
    writable: true,
    configurable: true,
  });
});

// ── Helper: dispatch a message ────────────────────────────────────────

function dispatchMessage(type: string, payload?: any) {
  if (!onmessageHandler) {
    throw new Error(
      'onmessage handler not set. Did you import the module? ' +
        'Handler is: ' + String(onmessageHandler),
    );
  }
  onmessageHandler({ data: { type, payload } } as MessageEvent);
}

async function delay(ms = 30): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Tests: Module Exports ────────────────────────────────────────────

describe('gestalt-worker — module exports', () => {
  it('should export engine, engineInitialized, engineError, pendingOperations', async () => {
    const mod = await import('../src/workers/gestalt-worker');
    expect(mod).toHaveProperty('engine');
    expect(mod).toHaveProperty('engineInitialized');
    expect(mod).toHaveProperty('engineError');
    expect(mod).toHaveProperty('pendingOperations');
    expect(mod.engine).toBeNull();
    expect(mod.engineInitialized).toBe(false);
    expect(mod.engineError).toBeNull();
    expect(Array.isArray(mod.pendingOperations)).toBe(true);
    expect(mod.pendingOperations).toHaveLength(0);
  });
});

describe('gestalt-worker — worker_spawned on import', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('should postMessage worker_spawned when module is loaded', async () => {
    await import('../src/workers/gestalt-worker');
    expect(mockPostMessage).toHaveBeenCalledWith({
      type: 'worker_spawned',
      payload: expect.any(Object),
    });
  });
});

// ── Tests: MockGestaltEngine ──────────────────────────────────────────

describe('gestalt-worker — MockGestaltEngine', () => {
  it('should execute a run spec with multiple agents and return proper report', async () => {
    const { MockGestaltEngine } = await import('../src/workers/gestalt-worker');
    const engine = new MockGestaltEngine();

    const spec = {
      base_ref: 'main',
      task: 'Test task',
      agents: [
        { id: 'agent-1', command: 'build', args: [] },
        { id: 'agent-2', command: 'test', args: ['--verbose'] },
      ],
      max_parallel: 2,
      timeout: 5000,
      push: false,
    };

    const report = engine.executeRunSpec(spec);

    expect(report.run_id).toBeDefined();
    expect(typeof report.run_id).toBe('string');
    expect(report.task).toBe('Test task');
    expect(report.agents).toHaveLength(2);
    expect(report.agents[0].agent_id).toBe('agent-1');
    expect(report.agents[0].output).toContain('[MOCK] Agent "agent-1"');
    expect(report.agents[1].agent_id).toBe('agent-2');
    expect(report.agents[1].branch).toBe('feature/agent-2');
    expect(report.agents[1].changed_files).toEqual(['src/agents/agent-2.ts']);
    expect(report.duration_ms).toBe(100); // spec.agents.length * 50
    expect(report.merged_branches).toEqual(['main']);
    expect(report.conflicts).toEqual([]);
    expect(report.events_path).toContain('/memory/events/gestalt/');
    expect(report.success).toBe(true);
  });

  it('should return empty agents list when spec has no agents', async () => {
    const { MockGestaltEngine } = await import('../src/workers/gestalt-worker');
    const engine = new MockGestaltEngine();

    const report = engine.executeRunSpec({
      base_ref: 'main',
      task: 'Empty run',
      agents: [],
      max_parallel: 1,
      timeout: 1000,
      push: false,
    });

    expect(report.agents).toHaveLength(0);
    expect(report.duration_ms).toBe(0);
    expect(report.success).toBe(true);
  });

  it('should return subscribed events', async () => {
    const { MockGestaltEngine } = await import('../src/workers/gestalt-worker');
    const engine = new MockGestaltEngine();

    const events = engine.subscribeEvents();
    expect(events).toHaveLength(2);
    expect(events[0]).toContain('engine_initialized');
    expect(events[1]).toContain('execution_ready');
  });

  it('should return correct mock status', async () => {
    const { MockGestaltEngine } = await import('../src/workers/gestalt-worker');
    const engine = new MockGestaltEngine();

    const status = engine.getStatus();
    expect(status.initialized).toBe(true);
    expect(status.wasmLoaded).toBe(false);
    expect(status.engineType).toBe('mock');
  });

  it('should record calls in getCallLog', async () => {
    const { MockGestaltEngine } = await import('../src/workers/gestalt-worker');
    const engine = new MockGestaltEngine();

    expect(engine.getCallLog()).toEqual([]);

    engine.executeRunSpec({
      base_ref: 'main',
      task: 'Log call 1',
      agents: [{ id: 'a1', command: 'cmd', args: [] }],
      max_parallel: 1,
      timeout: 1000,
      push: false,
    });
    expect(engine.getCallLog()).toHaveLength(1);
    expect(engine.getCallLog()[0]).toContain('executeRunSpec:Log call 1');

    engine.subscribeEvents();
    expect(engine.getCallLog()).toHaveLength(2);
    expect(engine.getCallLog()[1]).toBe('subscribeEvents');
  });

  it('should truncate long task names in output', async () => {
    const { MockGestaltEngine } = await import('../src/workers/gestalt-worker');
    const engine = new MockGestaltEngine();

    const longTask = 'A'.repeat(100);
    const report = engine.executeRunSpec({
      base_ref: 'main',
      task: longTask,
      agents: [{ id: 'a1', command: 'cmd', args: [] }],
      max_parallel: 1,
      timeout: 1000,
      push: false,
    });

    // Output should be truncated to 60 chars
    expect(report.agents[0].output!.length).toBeLessThan(100);
    expect(report.agents[0].output).toContain('A'.repeat(60));
  });
});

// ── Tests: WasmGestaltEngineProxy ─────────────────────────────────────

describe('gestalt-worker — WasmGestaltEngineProxy', () => {
  it('should proxy executeRunSpec to the inner WASM engine', async () => {
    const { WasmGestaltEngineProxy } = await import('../src/workers/gestalt-worker');
    const innerExecute = vi.fn().mockReturnValue({
      run_id: 'proxy-run-1',
      task: 'proxy task',
      agents: [],
      duration_ms: 50,
      merged_branches: [],
      conflicts: [],
      events_path: '/events/1',
      success: true,
    });

    const proxy = new WasmGestaltEngineProxy({
      executeRunSpec: innerExecute,
    });

    const spec = {
      base_ref: 'main',
      task: 'proxy task',
      agents: [{ id: 'p1', command: 'do', args: [] }],
      max_parallel: 1,
      timeout: 1000,
      push: false,
    };

    const report = proxy.executeRunSpec(spec);
    expect(innerExecute).toHaveBeenCalledWith(spec);
    expect(report.run_id).toBe('proxy-run-1');
    expect(report.success).toBe(true);
  });

  it('should proxy subscribeEvents and consume full event stream', async () => {
    const { WasmGestaltEngineProxy } = await import('../src/workers/gestalt-worker');
    const innerSubscribe = vi.fn().mockReturnValue({
      next: vi
        .fn()
        .mockReturnValueOnce('evt-1')
        .mockReturnValueOnce('evt-2')
        .mockReturnValueOnce('evt-3')
        .mockReturnValue(null),
    });

    const proxy = new WasmGestaltEngineProxy({
      subscribeEvents: innerSubscribe,
    });

    const events = proxy.subscribeEvents();
    expect(innerSubscribe).toHaveBeenCalled();
    expect(events).toEqual(['evt-1', 'evt-2', 'evt-3']);
  });

  it('should handle empty event stream', async () => {
    const { WasmGestaltEngineProxy } = await import('../src/workers/gestalt-worker');
    const innerSubscribe = vi.fn().mockReturnValue({
      next: vi.fn().mockReturnValue(null),
    });

    const proxy = new WasmGestaltEngineProxy({
      subscribeEvents: innerSubscribe,
    });

    const events = proxy.subscribeEvents();
    expect(events).toEqual([]);
  });

  it('should handle undefined return from next as stream end', async () => {
    const { WasmGestaltEngineProxy } = await import('../src/workers/gestalt-worker');
    const innerSubscribe = vi.fn().mockReturnValue({
      next: vi.fn().mockReturnValue(undefined),
    });

    const proxy = new WasmGestaltEngineProxy({
      subscribeEvents: innerSubscribe,
    });

    const events = proxy.subscribeEvents();
    expect(events).toEqual([]);
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

// ── Tests: tryLoadWasm ──────────────────────────────────────────────
// The source uses a non-static dynamic import (const wasmPath = '...'; import(wasmPath))
// so vitest mock resolution cannot intercept it. WASM not yet compiled is the
// expected state — we verify graceful fallback.

describe('gestalt-worker — tryLoadWasm', () => {
  it('should return false when WASM module is not available (expected fallback)', async () => {
    const { tryLoadWasm } = await import('../src/workers/gestalt-worker');
    const result = await tryLoadWasm();

    expect(result).toBe(false);
    // Should have logged the "not available" message
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('[GestaltWorker] WASM not available'),
      expect.any(String),
    );
  });
});

// ── Tests: self.onmessage message handler ────────────────────────────
// For these tests we import the module fresh each time (via vi.resetModules).
// The module's top-level code sets self.onmessage and sends worker_spawned.
// Then we dispatch messages through onmessageHandler and verify postMessage calls.

describe('gestalt-worker — self.onmessage message handler', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('should initialize engine and post ready on init message', async () => {
    const mod = await import('../src/workers/gestalt-worker');

    expect(onmessageHandler).not.toBeNull();

    dispatchMessage('init');

    expect(mod.engine).not.toBeNull();
    expect(mod.engineInitialized).toBe(true);
    expect(mod.engine).toBeInstanceOf(mod.MockGestaltEngine);

    // tryLoadWasm runs async — wait for ready message
    await delay(50);

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ready',
        payload: expect.objectContaining({
          wasmLoaded: false,
          engineVersion: '0.1.0',
          engineType: 'mock',
        }),
      }),
    );
  });

  it('should execute a run spec and post run_report', async () => {
    await import('../src/workers/gestalt-worker');

    // Init first
    dispatchMessage('init');
    await delay(50);
    mockPostMessage.mockClear();

    // Execute a run spec
    dispatchMessage('execute_run_spec', {
      base_ref: 'main',
      task: 'Execute test',
      agents: [{ id: 'a1', command: 'build', args: [] }],
      max_parallel: 1,
      timeout: 1000,
      push: false,
    });

    await delay(30);

    const reportCall = mockPostMessage.mock.calls.find(
      (c: any[]) => c[0]?.type === 'run_report',
    );
    expect(reportCall).toBeDefined();
    expect(reportCall[0].payload.task).toBe('Execute test');
    expect(reportCall[0].payload.success).toBe(true);
    expect(reportCall[0].payload.agents).toHaveLength(1);
    expect(reportCall[0].payload.agents[0].agent_id).toBe('a1');
  });

  it('should return error when execute_run_spec sent before init', async () => {
    await import('../src/workers/gestalt-worker');

    // Reset engine state — since we import fresh, engine should be null
    dispatchMessage('execute_run_spec', {
      base_ref: 'main',
      task: 'no-init',
      agents: [],
      max_parallel: 1,
      timeout: 1000,
      push: false,
    });

    expect(mockPostMessage).toHaveBeenCalledWith({
      type: 'error',
      payload: {
        message: 'Engine not initialized. Send init first.',
        code: 'ENGINE_NOT_INIT',
      },
    });
  });

  it('should subscribe events and post event_stream', async () => {
    await import('../src/workers/gestalt-worker');

    dispatchMessage('init');
    await delay(50);
    mockPostMessage.mockClear();

    dispatchMessage('subscribe_events');

    await delay(10);

    const eventCall = mockPostMessage.mock.calls.find(
      (c: any[]) => c[0]?.type === 'event_stream',
    );
    expect(eventCall).toBeDefined();
    expect(Array.isArray(eventCall[0].payload.events)).toBe(true);
    expect(eventCall[0].payload.events[0]).toContain('engine_initialized');
    expect(eventCall[0].payload.events[1]).toContain('execution_ready');
  });

  it('should return error when subscribe_events sent before init', async () => {
    await import('../src/workers/gestalt-worker');

    dispatchMessage('subscribe_events');

    expect(mockPostMessage).toHaveBeenCalledWith({
      type: 'error',
      payload: {
        message: 'Engine not initialized',
        code: 'ENGINE_NOT_INIT',
      },
    });
  });

  it('should return status via get_status message', async () => {
    await import('../src/workers/gestalt-worker');

    // Without engine
    dispatchMessage('get_status');

    expect(mockPostMessage).toHaveBeenCalledWith({
      type: 'status',
      payload: { initialized: false, wasmLoaded: false, engineType: 'none' },
    });

    mockPostMessage.mockClear();

    // With engine (after init)
    dispatchMessage('init');
    await delay(50);
    mockPostMessage.mockClear();

    dispatchMessage('get_status');

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'status',
        payload: expect.objectContaining({
          initialized: true,
          engineType: 'mock',
        }),
      }),
    );
  });

  it('should reset state and call self.close on destroy message', async () => {
    const mod = await import('../src/workers/gestalt-worker');

    dispatchMessage('init');
    await delay(50);

    expect(mod.engine).not.toBeNull();
    expect(mod.engineInitialized).toBe(true);

    mockPostMessage.mockClear();

    dispatchMessage('destroy');

    expect(mod.engine).toBeNull();
    expect(mod.engineInitialized).toBe(false);
    expect(mod.pendingOperations).toEqual([]);
    expect(mockClose).toHaveBeenCalled();
  });

  it('should return error for unknown message types', async () => {
    await import('../src/workers/gestalt-worker');

    dispatchMessage('unknown_type');

    expect(mockPostMessage).toHaveBeenCalledWith({
      type: 'error',
      payload: {
        message: 'Unknown message type: unknown_type',
        code: 'UNKNOWN_TYPE',
      },
    });
  });
});
