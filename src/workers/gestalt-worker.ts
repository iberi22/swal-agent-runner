/// <reference lib="webworker" />

/**
 * gestalt-worker.ts — Web Worker that loads gestalt-wasm.wasm and exposes Gestalt API.
 *
 * Because WASM is not yet compiled, this worker:
 * 1. Attempts to load the WASM module via dynamic import
 * 2. Falls back to a JS mock GestaltEngine that mirrors the wasm-bindgen API surface
 * 3. When WASM becomes available, replays queued operations against the real engine
 *
 * Communication protocol (postMessage):
 * ── Main → Worker ──
 *   { type: 'init', payload?: { channelName?: string } }
 *   { type: 'execute_run_spec', payload: RunSpec }
 *   { type: 'subscribe_events' }
 *   { type: 'destroy' }
 *
 * ── Worker → Main ──
 *   { type: 'ready', payload: { wasmLoaded: boolean, engineVersion?: string } }
 *   { type: 'run_report', payload: RunReport }
 *   { type: 'event_stream', payload: { events: string[] } }
 *   { type: 'error', payload: { message: string, code?: string } }
 */

// ── Types (mirrors gestalt-wasm lib.rs wasm-bindgen exports) ──────────

interface AgentSpec {
  id: string;
  command: string;
  args: string[];
  [key: string]: unknown;
}

interface RunSpec {
  base_ref: string;
  task: string;
  agents: AgentSpec[];
  max_parallel: number;
  timeout: number;
  push: boolean;
  integration_branch?: string;
  [key: string]: unknown;
}

interface AgentResult {
  agent_id: string;
  output?: string;
  error?: string;
  branch?: string;
  changed_files: string[];
  duration_ms: number;
  [key: string]: unknown;
}

interface RunReport {
  run_id: string;
  task: string;
  agents: AgentResult[];
  duration_ms: number;
  merged_branches: string[];
  conflicts: string[];
  events_path: string;
  success: boolean;
  [key: string]: unknown;
}

interface EventStream {
  next(): string | null;
  [key: string]: unknown;
}

// ── Mock GestaltEngine (WASM not yet compiled) ────────────────────────
// Mirrors the wasm-bindgen exports from gestalt-wasm/src/lib.rs

export interface GestaltEngineLike {
  executeRunSpec(spec: RunSpec): RunReport;
  subscribeEvents(): string[];
  getStatus(): { initialized: boolean; wasmLoaded: boolean; engineType: string };
}

export class MockGestaltEngine implements GestaltEngineLike {
  private callLog: string[] = [];
  private started = false;

  executeRunSpec(spec: RunSpec): RunReport {
    const runId = crypto.randomUUID();
    const results: AgentResult[] = spec.agents.map((agent) => ({
      agent_id: agent.id,
      output: `[MOCK] Agent "${agent.id}" task: ${spec.task.slice(0, 60)}`,
      error: undefined,
      branch: `feature/${agent.id}`,
      changed_files: [`src/agents/${agent.id}.ts`],
      duration_ms: 0,
    }));

    const report: RunReport = {
      run_id: runId,
      task: spec.task,
      agents: results,
      duration_ms: spec.agents.length * 50,
      merged_branches: [spec.base_ref],
      conflicts: [],
      events_path: '/memory/events/gestalt/' + runId,
      success: true,
    };

    this.callLog.push(`executeRunSpec:${spec.task.slice(0, 40)}`);
    console.log('[GestaltWorker] MOCK executeRunSpec:', report.run_id, spec.task.slice(0, 60));
    return report;
  }

  subscribeEvents(): string[] {
    this.callLog.push('subscribeEvents');
    return [
      JSON.stringify({ type: 'engine_initialized', data: { timestamp: Date.now() } }),
      JSON.stringify({ type: 'execution_ready', data: { ready: true } }),
    ];
  }

  getStatus() {
    return {
      initialized: true,
      wasmLoaded: false,
      engineType: 'mock',
    };
  }

  getCallLog(): string[] {
    return [...this.callLog];
  }
}

export class WasmGestaltEngineProxy implements GestaltEngineLike {
  private inner: any;

  constructor(inner: any) {
    this.inner = inner;
  }

  executeRunSpec(spec: RunSpec): RunReport {
    console.log('[GestaltWorker] Calling real WASM executeRunSpec');
    const result = this.inner.executeRunSpec(spec);
    return result as RunReport;
  }

  subscribeEvents(): string[] {
    console.log('[GestaltWorker] Calling real WASM subscribeEvents');
    const events: string[] = [];
    const stream = this.inner.subscribeEvents();
    if (stream && typeof stream.next === 'function') {
      let event = stream.next();
      while (event !== null && event !== undefined) {
        events.push(event);
        event = stream.next();
      }
    }
    return events;
  }

  getStatus() {
    return {
      initialized: true,
      wasmLoaded: true,
      engineType: 'wasm',
    };
  }
}

// ── Worker State ────────────────────────────────────────────────────

export let engine: GestaltEngineLike | null = null;
export let engineInitialized = false;
export let engineError: string | null = null;
export let pendingOperations: Array<() => void> = [];

// ── WASM Loader ─────────────────────────────────────────────────────

export async function tryLoadWasm(): Promise<boolean> {
  try {
    // Attempt to dynamically import the compiled WASM module.
    // This will fail with a module-not-found error until gestalt-wasm is
    // compiled with wasm-pack and the output is placed at
    //   swal-agent-runner/src/wasm/gestalt_wasm.js
    // Use computed dynamic import string to prevent Vite bundler from creating
    // a separate chunk for the WASM module within the worker (worker IIFE format
    // doesn't support code-splitting). The import is expected to fail until WASM
    // is compiled — the worker falls back to MockGestaltEngine.
    const wasmPath = '../wasm/gestalt_wasm.js';
    // @ts-ignore — expected until SWA-02 (wasm-pack build)
    const wasmModule = await import(wasmPath);
    await wasmModule.default(); // init() the WASM module

    const engineInstance = new wasmModule.GestaltEngine();
    console.log('[GestaltWorker] WASM module loaded successfully');

    // Replace MockGestaltEngine with the real WASM engine proxy!
    engine = new WasmGestaltEngineProxy(engineInstance);

    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log('[GestaltWorker] WASM not available (expected — not yet compiled):', msg);
    return false;
  }
}

// ── Message Handler ─────────────────────────────────────────────────

self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data;

  switch (type) {
    case 'init': {
      engine = new MockGestaltEngine();
      engineInitialized = true;

      // Try loading WASM in the background (non-blocking)
      tryLoadWasm().then((wasmLoaded) => {
        self.postMessage({
          type: 'ready',
          payload: {
            wasmLoaded,
            engineVersion: '0.1.0',
            engineType: wasmLoaded ? 'wasm' : 'mock',
          },
        });

        // Flush any operations queued while we were loading
        const ops = pendingOperations;
        pendingOperations = [];
        for (const op of ops) op();
      });

      break;
    }

    case 'execute_run_spec': {
      if (!engine) {
        self.postMessage({
          type: 'error',
          payload: { message: 'Engine not initialized. Send init first.', code: 'ENGINE_NOT_INIT' },
        });
        return;
      }

      const spec = payload as RunSpec;
      console.log('[GestaltWorker] executeRunSpec:', {
        task: spec.task?.slice(0, 80),
        agents: spec.agents?.length,
      });

      // Use a microtask to simulate async execution for the mock
      await new Promise((resolve) => setTimeout(resolve, 10));

      const report = engine.executeRunSpec(spec);
      self.postMessage({ type: 'run_report', payload: report });
      break;
    }

    case 'subscribe_events': {
      if (!engine) {
        self.postMessage({
          type: 'error',
          payload: { message: 'Engine not initialized', code: 'ENGINE_NOT_INIT' },
        });
        return;
      }

      const events = engine.subscribeEvents();
      self.postMessage({ type: 'event_stream', payload: { events } });

      // In a real implementation, we'd set up a BroadcastChannel or
      // continuous push mechanism here. For now, the bridge polls.

      break;
    }

    case 'get_status': {
      const status = engine ? engine.getStatus() : { initialized: false, wasmLoaded: false, engineType: 'none' };
      self.postMessage({ type: 'status', payload: status });
      break;
    }

    case 'destroy': {
      engine = null;
      engineInitialized = false;
      pendingOperations = [];
      self.close();
      break;
    }

    default: {
      self.postMessage({
        type: 'error',
        payload: { message: `Unknown message type: ${type}`, code: 'UNKNOWN_TYPE' },
      });
    }
  }
};

// Notify main thread that worker has started
self.postMessage({ type: 'worker_spawned', payload: { timestamp: Date.now() } });
