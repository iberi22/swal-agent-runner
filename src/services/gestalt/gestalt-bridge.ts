/**
 * Gestalt Worker Bridge
 * ======================
 *
 * Bridge between the main thread and the Gestalt Web Worker.
 *
 * PROXY PATTERN: gestalt-wasm is NOT compiled to wasm yet. The bridge
 * logs and queues all API calls until the Worker is fully initialized.
 * Once the worker signals 'ready', queued calls are replayed against
 * the real Gestalt engine (currently a mock, eventually WASM).
 *
 * Architecture:
 *   Main Thread            Web Worker
 *   ┌──────────────┐       ┌───────────────────┐
 *   │ GestaltBridge │◄─────►│ gestalt-worker.ts  │
 *   │   ┌──────────┤post   │   ┌─────────────┐  │
 *   │   │callQueue │Message│   │MockGestalt  │  │
 *   │   │(proxied) │       │   │Engine       │  │
 *   │   └──────────┤       │   └─────────────┘  │
 *   │              │       └───────────────────┘
 *   │   ┌──────────┐       ┌───────────────────┐
 *   │   │Broadcast │◄──────┤ BroadcastChannel  │
 *   │   │Channel   │       │ "gestalt-events"  │
 *   │   │Listener  │       │ (future WASM)     │
 *   │   └──────────┘       └───────────────────┘
 *   │              │
 *   │   ┌──────────┐
 *   │   │CrdtEvent │──► Y.Array ──► y-webrtc peers
 *   │   │Bus       │
 *   │   └──────────┘
 *   └──────────────┘
 *
 * Lifecycle:
 *   idle → initializing → ready (or error) → destroyed
 *
 * The bridge listens for 'mesh:room-joined' on EdgeMeshClient.events
 * and automatically calls initGestalt() when a mesh room is joined.
 *
 * @module GestaltBridge
 */

import { edgeMeshClient } from '../mesh/edge-mesh-client';
import type { CrdtEventBus, MeshEvent } from '../mesh/crdt-event-bus';

// ── Types (mirrors gestalt-wasm/lib.rs wasm-bindgen exports) ─────────

export interface AgentSpec {
  id: string;
  command: string;
  args: string[];
  [key: string]: unknown;
}

export interface RunSpec {
  base_ref: string;
  task: string;
  agents: AgentSpec[];
  max_parallel: number;
  timeout: number;
  push: boolean;
  integration_branch?: string;
  [key: string]: unknown;
}

export interface AgentResult {
  agent_id: string;
  output?: string;
  error?: string;
  branch?: string;
  changed_files: string[];
  duration_ms: number;
  [key: string]: unknown;
}

export interface RunReport {
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

export interface GestaltStatus {
  initialized: boolean;
  wasmLoaded: boolean;
  engineType: 'mock' | 'wasm' | 'none';
}

/** Worker message from the Gestalt worker. */
interface WorkerMessage {
  type: string;
  payload?: Record<string, unknown>;
  requestId?: string;
}

/** Internal queued call while engine is initializing. */
interface QueuedCall {
  type: string;
  payload?: unknown;
  requestId: string;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

/** Status of the bridge lifecycle. */
export type BridgeState = 'idle' | 'initializing' | 'ready' | 'error' | 'destroyed';

// ── WsEvent → MeshEvent mapping ────────────────────────────────────
// Maps Gestalt event type tags to MeshEvent.type strings used by CrdtEventBus.
// (From design doc §4.4)

const EVENT_TYPE_MAP: Record<string, string> = {
  state_changed: 'gestalt:state_changed',
  subagent_spawned: 'gestalt:subagent_spawned',
  subagent_progress: 'gestalt:subagent_progress',
  run_started: 'gestalt:run_started',
  run_finished: 'gestalt:run_finished',
  memory_updated: 'gestalt:memory_updated',
  run_phase_changed: 'gestalt:phase_changed',
  engine_initialized: 'gestalt:engine_initialized',
  execution_ready: 'gestalt:execution_ready',
  conflict_detected: 'gestalt:conflict_detected',
  lock_acquired: 'gestalt:lock_acquired',
  lock_released: 'gestalt:lock_released',
};

const GESTALT_EVENT_CHANNEL = 'gestalt-events';

// ── GestaltBridge ───────────────────────────────────────────────────

export class GestaltBridge {
  private _state: BridgeState = 'idle';
  private worker: Worker | null = null;
  private broadcastChannel: BroadcastChannel | null = null;
  private crdtEventBus: CrdtEventBus | null = null;

  /** Queue of calls made before the worker was ready. */
  private callQueue: QueuedCall[] = [];

  /** Map of pending requestId → resolver for in-flight calls. */
  private pendingRequests: Map<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void }> = new Map();

  /** Monotonically increasing request counter for unique IDs. */
  private requestCounter = 0;

  /** Worker 'ready' promise — resolves once the worker sends its ready message. */
  private readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (reason: unknown) => void;

  /** Worker error state. */
  private _error: string | null = null;

  /** Connection to room-joined auto-init (for cleanup). */
  private meshLifecycleBound = false;
  private meshEventHandler: ((e: Event) => void) | null = null;

  // ── Diagnostics ──────────────────────────────────────────────────

  /** Total calls made through the bridge (including queued). */
  private totalCalls = 0;

  /** Event count forwarded to CrdtEventBus. */
  private forwardedEventCount = 0;

  constructor() {
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
  }

  // ── Public Accessors ─────────────────────────────────────────────

  get state(): BridgeState {
    return this._state;
  }

  get error(): string | null {
    return this._error;
  }

  /** Promise that resolves once the Gestalt engine is ready. */
  get ready(): Promise<void> {
    return this.readyPromise;
  }

  /** True if the worker reported a WASM module (vs mock). */
  get wasmLoaded(): boolean {
    return this._state === 'ready' && this._wasmLoaded;
  }

  private _wasmLoaded = false;

  /** Diagnostics snapshot. */
  get diagnostics(): {
    state: BridgeState;
    wasmLoaded: boolean;
    totalCalls: number;
    forwardedEvents: number;
    queuedCalls: number;
    pendingRequests: number;
    engineType: string;
  } {
    return {
      state: this._state,
      wasmLoaded: this._wasmLoaded,
      totalCalls: this.totalCalls,
      forwardedEvents: this.forwardedEventCount,
      queuedCalls: this.callQueue.length,
      pendingRequests: this.pendingRequests.size,
      engineType: this._wasmLoaded ? 'wasm' : 'mock',
    };
  }

  // ── Initialization ───────────────────────────────────────────────

  /**
   * Initialize the Gestalt engine.
   *
   * Spawns the Web Worker and waits for it to signal 'ready'.
   * Calls made before ready are queued and replayed once ready.
   *
   * Safe to call multiple times — subsequent calls while 'initializing'
   * or 'ready' return the existing ready promise. To reinitialize,
   * call destroy() first.
   */
  async initGestalt(): Promise<void> {
    if (this._state === 'initializing' || this._state === 'ready') {
      return this.readyPromise;
    }

    if (this._state === 'destroyed') {
      this._state = 'idle';
      this.readyPromise = new Promise<void>((resolve, reject) => {
        this.resolveReady = resolve;
        this.rejectReady = reject;
      });
    }

    this._state = 'initializing';
    this._error = null;
    this.callQueue = [];

    try {
      // Spawn the Web Worker
      // NOTE: Vite's bundler transforms Worker(new URL(...)) into a separate chunk.
      // This creates a dedicated worker script at build time.
      // In dev mode, Vite serves it as a module worker.
      this.worker = new Worker(
        new URL('../../workers/gestalt-worker.ts', import.meta.url),
        { type: 'module' },
      );

      this.worker.onmessage = this.handleWorkerMessage.bind(this);
      this.worker.onerror = this.handleWorkerError.bind(this);

      // Open BroadcastChannel for future WASM-side event push
      this.broadcastChannel = new BroadcastChannel(GESTALT_EVENT_CHANNEL);
      this.broadcastChannel.onmessage = this.handleBroadcastEvent.bind(this);

      // Send init message to worker
      this.worker.postMessage({ type: 'init' });

      // Wait for ready
      await this.readyPromise;

      // Flush the call queue
      this.flushQueue();

      console.log('[GestaltBridge] Initialized. WASM loaded:', this._wasmLoaded, '| Queued calls flushed:', this.callQueue.length);
    } catch (err) {
      this._state = 'error';
      this._error = err instanceof Error ? err.message : String(err);
      console.error('[GestaltBridge] Initialization failed:', this._error);
      throw err;
    }
  }

  // ── Core API ─────────────────────────────────────────────────────

  /**
   * Execute a RunSpec through the Gestalt Foreman.
   *
   * If the engine isn't ready yet, the call is queued and replayed
   * once initialization completes.
   *
   * @param spec - The RunSpec describing agents, task, and config
   * @returns RunReport with agent results
   */
  executeRunSpec(spec: RunSpec): Promise<RunReport> {
    this.totalCalls++;
    return this.dispatch<RunReport>('execute_run_spec', spec);
  }

  /**
   * Subscribe to the Gestalt event stream.
   *
   * Polls the worker for events and forwards them to the CrdtEventBus
   * on the EdgeMeshClient. In the future WASM implementation, events
   * will also arrive via BroadcastChannel.
   *
   * @param bus - Optional CrdtEventBus instance (defaults to edgeMeshClient.crdtEventBus)
   */
  async subscribeEvents(bus?: CrdtEventBus): Promise<void> {
    const targetBus = bus ?? (edgeMeshClient.crdtEventBus as unknown as CrdtEventBus);
    this.crdtEventBus = targetBus;

    try {
      const result = await this.dispatch<{ events: string[] }>('subscribe_events');
      if (result?.events) {
        for (const eventJson of result.events) {
          this.forwardEventToCrdt(eventJson, targetBus);
        }
      }
    } catch (err) {
      console.warn('[GestaltBridge] subscribeEvents failed (expected if not ready):', err);
    }

    // Start a polling loop for event stream (until we have real BroadcastChannel push)
    this.startEventPolling(targetBus);
  }

  /**
   * Get current engine status from the worker.
   */
  async getStatus(): Promise<GestaltStatus> {
    const result = await this.dispatch<GestaltStatus>('get_status');
    return result ?? { initialized: false, wasmLoaded: false, engineType: 'none' };
  }

  /**
   * Terminate the Gestalt engine.
   *
   * Kills the worker, closes the BroadcastChannel, resets state.
   * After calling this, initGestalt() can be called again to restart.
   */
  destroy(): void {
    this._state = 'destroyed';

    // Terminate worker
    if (this.worker) {
      try {
        this.worker.postMessage({ type: 'destroy' });
      } catch { /* worker may already be terminated */ }
      this.worker.terminate();
      this.worker = null;
    }

    // Close BroadcastChannel
    if (this.broadcastChannel) {
      this.broadcastChannel.close();
      this.broadcastChannel = null;
    }

    // Reject all pending requests
    for (const [, { reject }] of this.pendingRequests) {
      reject(new Error('GestaltBridge destroyed'));
    }
    this.pendingRequests.clear();

    // Reject all queued calls
    for (const call of this.callQueue) {
      call.reject(new Error('GestaltBridge destroyed'));
    }
    this.callQueue = [];
    this.crdtEventBus = null;

    // Unbind from mesh lifecycle
    this.unbindMeshLifecycle();

    console.log('[GestaltBridge] Destroyed');
  }

  // ── Mesh Lifecycle Wiring ────────────────────────────────────────

  /**
   * Wire into EdgeMeshClient lifecycle: auto-init on mesh:room-joined.
   *
   * Call once during app startup. The bridge will:
   * 1. Listen for 'mesh:room-joined' on edgeMeshClient.events
   * 2. When a room is joined, call initGestalt() automatically
   * 3. When a room is left, call destroy() automatically
   *
   * Safe to call multiple times — only binds once.
   */
  bindMeshLifecycle(): void {
    if (this.meshLifecycleBound) return;
    this.meshLifecycleBound = true;

    this.meshEventHandler = (event: Event) => {
      const detail = (event as CustomEvent).detail as { room: string } | undefined;
      console.log('[GestaltBridge] Mesh room joined:', detail?.room ?? 'unknown');

      // Auto-init Gestalt engine when mesh room is joined
      this.initGestalt().catch((err) => {
        console.warn('[GestaltBridge] Auto-init on room-joined failed:', err);
      });
    };

    edgeMeshClient.events.addEventListener('mesh:room-joined', this.meshEventHandler);

    // Also auto-init if already in a room
    if (edgeMeshClient.meshRoom) {
      this.initGestalt().catch((err) => {
        console.warn('[GestaltBridge] Auto-init (already in room) failed:', err);
      });
    }

    // Listen for room leave to auto-destroy
    const leaveHandler = () => {
      if (this._state === 'ready' || this._state === 'initializing') {
        this.destroy();
      }
    };
    edgeMeshClient.events.addEventListener('mesh:room-left', leaveHandler);

    // Store leave handler for cleanup (alongside meshEventHandler)
    const origUnbind = this.unbindMeshLifecycle.bind(this);
    this.unbindMeshLifecycle = () => {
      if (this.meshEventHandler) {
        edgeMeshClient.events.removeEventListener('mesh:room-joined', this.meshEventHandler!);
        edgeMeshClient.events.removeEventListener('mesh:room-left', leaveHandler);
        this.meshEventHandler = null;
      }
      this.meshLifecycleBound = false;
      origUnbind();
    };

    console.log('[GestaltBridge] Mesh lifecycle bound');
  }

  /** Stub that gets replaced in bindMeshLifecycle. */
  private unbindMeshLifecycle(): void {
    this.meshLifecycleBound = false;
    this.meshEventHandler = null;
  }

  // ── Internal: Message Dispatch ───────────────────────────────────

  /**
   * Dispatch a message to the worker.
   *
   * Returns a promise that resolves when the worker responds with the
   * matching requestId. If the engine isn't ready yet, the call is
   * queued and replayed once ready.
   */
  private async dispatch<T>(type: string, payload?: unknown): Promise<T> {
    const requestId = `req_${++this.requestCounter}_${Date.now()}`;

    // If the worker hasn't initialized yet, queue the call
    if (this._state !== 'ready' || !this.worker) {
      return new Promise<T>((resolve, reject) => {
        this.callQueue.push({
          type,
          payload,
          requestId,
          resolve: resolve as (v: unknown) => void,
          reject,
        });
        console.log(`[GestaltBridge] Queued call "${type}" (id=${requestId}) — engine not ready`);
      });
    }

    return this.sendToWorker<T>(type, payload, requestId);
  }

  /**
   * Send a message to the worker and wait for the response.
   */
  private sendToWorker<T>(type: string, payload?: unknown, requestId?: string): Promise<T> {
    const rid = requestId ?? `req_${++this.requestCounter}_${Date.now()}`;

    return new Promise<T>((resolve, reject) => {
      this.pendingRequests.set(rid, { resolve: resolve as (v: unknown) => void, reject });

      // Timeout after 30 seconds
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(rid);
        reject(new Error(`GestaltWorker timeout: ${type} (req=${rid})`));
      }, 30_000);

      // Wrap the resolve to clear the timeout
      const origResolve = this.pendingRequests.get(rid)!.resolve;
      this.pendingRequests.set(rid, {
        resolve: (v: unknown) => {
          clearTimeout(timeout);
          origResolve(v);
        },
        reject: (e: unknown) => {
          clearTimeout(timeout);
          reject(e);
        },
      });

      try {
        this.worker!.postMessage({ type, payload, requestId: rid });
        console.log(`[GestaltBridge] Sent "${type}" (req=${rid})`);
      } catch (err) {
        clearTimeout(timeout);
        this.pendingRequests.delete(rid);
        reject(err);
      }
    });
  }

  /**
   * Flush the call queue — replay all queued calls against the real worker.
   */
  private flushQueue(): void {
    const queue = this.callQueue;
    this.callQueue = [];

    for (const call of queue) {
      this.sendToWorker(call.type, call.payload, call.requestId)
        .then((result) => call.resolve(result))
        .catch((err) => call.reject(err));
    }
  }

  // ── Internal: Message Handling ───────────────────────────────────

  private handleWorkerMessage(e: MessageEvent<WorkerMessage>): void {
    const { type, payload, requestId } = e.data;

    switch (type) {
      case 'worker_spawned': {
        // Worker started, waiting for 'ready'
        break;
      }

      case 'ready': {
        const p = payload as { wasmLoaded?: boolean; engineVersion?: string; engineType?: string } | undefined;
        this._wasmLoaded = p?.wasmLoaded ?? false;
        this._state = 'ready';
        this.resolveReady();
        console.log(`[GestaltBridge] Worker ready (WASM: ${this._wasmLoaded}, type: ${p?.engineType ?? 'unknown'})`);
        break;
      }

      case 'run_report': {
        if (requestId) {
          const resolver = this.pendingRequests.get(requestId);
          if (resolver) {
            resolver.resolve(payload);
            this.pendingRequests.delete(requestId);
          }
        }
        break;
      }

      case 'event_stream': {
        const p = payload as { events?: string[] } | undefined;
        if (p?.events && this.crdtEventBus) {
          for (const eventJson of p.events) {
            this.forwardEventToCrdt(eventJson, this.crdtEventBus);
          }
        }
        break;
      }

      case 'error': {
        const errPayload = payload as { message?: string; code?: string } | undefined;
        const errMsg = errPayload?.message ?? 'Unknown worker error';
        console.error(`[GestaltBridge] Worker error [${errPayload?.code ?? 'N/A'}]: ${errMsg}`);

        if (requestId) {
          const resolver = this.pendingRequests.get(requestId);
          if (resolver) {
            resolver.reject(new Error(errMsg));
            this.pendingRequests.delete(requestId);
          }
        }
        break;
      }

      case 'status': {
        if (requestId) {
          const resolver = this.pendingRequests.get(requestId);
          if (resolver) {
            resolver.resolve(payload);
            this.pendingRequests.delete(requestId);
          }
        }
        break;
      }

      default: {
        // Try to resolve as a requestId response
        if (requestId) {
          const resolver = this.pendingRequests.get(requestId);
          if (resolver) {
            resolver.resolve(payload);
            this.pendingRequests.delete(requestId);
          }
        } else {
          console.warn(`[GestaltBridge] Unhandled worker message type: ${type}`);
        }
      }
    }
  }

  private handleWorkerError(err: ErrorEvent): void {
    const msg = err.message || 'Unknown Worker error';
    console.error('[GestaltBridge] Worker error event:', msg);
    this._error = msg;

    // If we're still initializing, reject the ready promise
    if (this._state === 'initializing') {
      this._state = 'error';
      this.rejectReady(new Error(msg));
    }
  }

  // ── Event Forwarding ─────────────────────────────────────────────

  /**
   * Forward a Gestalt event (JSON string) to the CrdtEventBus.
   *
   * Parses the JSON, maps the event type to MeshEvent.type,
   * and publishes to the CRDT event bus (replicated to y-webrtc peers).
   */
  private forwardEventToCrdt(eventJson: string, bus: CrdtEventBus): void {
    try {
      const parsed = JSON.parse(eventJson);
      const rawType: string = parsed.type ?? 'unknown';
      const mappedType = EVENT_TYPE_MAP[rawType] ?? `gestalt:${rawType}`;

      const meshEvent: Omit<MeshEvent, 'id' | 'timestamp'> = {
        type: mappedType,
        source: 'gestalt-wasm',
        payload: {
          ...(parsed.data ?? {}),
          runId: parsed.data?.run_id,
          timestamp: Date.now(),
        },
      };

      bus.publish(meshEvent);
      this.forwardedEventCount++;
    } catch (err) {
      console.warn('[GestaltBridge] Failed to forward event to CrdtEventBus:', err);
    }
  }

  /**
   * Handle events arriving via BroadcastChannel (from WASM-side BroadcastChannelBus).
   *
   * When the real WASM module is running in the worker, it publishes events
   * through a BroadcastChannelBus. The main thread picks them up here
   * and forwards them to the CrdtEventBus.
   */
  private handleBroadcastEvent(event: MessageEvent): void {
    if (!this.crdtEventBus) return;
    this.forwardEventToCrdt(event.data, this.crdtEventBus);
  }

  // ── Event Polling ────────────────────────────────────────────────

  /**
   * Start polling the worker for event stream updates.
   *
   * This is a fallback until the WASM BroadcastChannel push is implemented.
   * Polls every 2 seconds and forwards new events to CrdtEventBus.
   */
  private startEventPolling(bus: CrdtEventBus): void {
    let destroyed = false;
    let lastEventCount = 0;

    const poll = async () => {
      if (destroyed || this._state === 'destroyed') return;

      try {
        if (this._state !== 'ready' || !this.worker) {
          setTimeout(poll, 2000);
          return;
        }

        const result = await this.dispatch<{ events: string[] }>('subscribe_events');
        const events = result?.events ?? [];

        // Only forward new events since last poll
        if (events.length > lastEventCount) {
          for (let i = lastEventCount; i < events.length; i++) {
            this.forwardEventToCrdt(events[i], bus);
          }
          lastEventCount = events.length;
        }
      } catch { /* worker may not be ready yet */ }

      // Schedule next poll
      if (!destroyed) {
        setTimeout(poll, 2000);
      }
    };

    // Override destroy to stop polling
    const origDestroy = this.destroy.bind(this);
    this.destroy = () => {
      destroyed = true;
      origDestroy();
    };

    // Start first poll after a short delay
    setTimeout(poll, 500);

    console.log('[GestaltBridge] Event polling started (2s interval)');
  }
}

// ── Singleton ───────────────────────────────────────────────────────

/**
 * Singleton GestaltBridge instance for the entire app.
 *
 * Import this and call gestaltBridge.bindMeshLifecycle() once during
 * app startup to enable automatic Gestalt engine initialization when
 * a mesh room is joined.
 *
 * Usage:
 *   import { gestaltBridge } from './services/gestalt/gestalt-bridge';
 *   gestaltBridge.bindMeshLifecycle();
 */
export const gestaltBridge = new GestaltBridge();
