# Gestalt-WASM Integration Design for swal-agent-runner PWA

> **Status:** Design Document (Draft v1.0)  
> **Date:** 2026-07-29  
> **Author:** Hermes Agent (subagent)  
> **Scope:** gestalt-wasm crate ↔ swal-agent-runner PWA

---

## Table of Contents

1. [Current State Summary](#1-current-state-summary)
2. [What Needs to Be Built in gestalt-wasm](#2-what-needs-to-be-built-in-gestalt-wasm)
3. [Compilation & Web Worker Loading Strategy](#3-compilation--web-worker-loading-strategy)
4. [EventBus Bridge: Gestalt → CrdtEventBus](#4-eventbus-bridge-gestalt--crdteventbus)
5. [Foreman Integration: Replacing agent-loop.ts](#5-foreman-integration-replacing-agent-loopts)
6. [File Island Mapping](#6-file-island-mapping)
7. [Risk Assessment & Effort Estimation](#7-risk-assessment--effort-estimation)
8. [Phased Rollout Plan](#8-phased-rollout-plan)

---

## 1. Current State Summary

### 1.1 gestalt-wasm (Rust)

| Feature | Native (default) | WASM (target_arch = "wasm32") |
|---------|-----------------|-------------------------------|
| **StateBackend** trait + impl | `NativeStateBackend` (SQLite/rusqlite) ✅ | `IndexedDbBackend` **NOT IMPLEMENTED** ❌ |
| **GitPort** trait + impl | `NativeGitPort` (git2) ✅ | `IsomorphicGitBridge` **NOT IMPLEMENTED** ❌ |
| **EventBus** trait + impl | Delegates to `gestalt-ws` WsEventBus | `BroadcastChannelBus` (web-sys) ✅ |

**Key exports from `lib.rs`:** `bus`, `git`, `state` modules; re-exports `EventBus`, `GraphOps`, `MemoryNode`, `MemoryEdge`, `MemorySync` from `gestalt-proto`.

### 1.2 gestalt-core Foreman

- `RouterHandle` trait — abstracts `execute(RunSpec) → RunReport` + `event_bus()` accessor
- `Foreman` struct — wraps `Box<dyn RouterHandle>` + optional `Arc<dyn EventBus>`
- Methods: `run_task()`, `run_wave()`, `event_bus()`
- Circular dependency enforced: `gestalt_core` cannot depend on `gestalt-router` directly. Wiring happens at binary level (e.g., `gestalt_cli`).

### 1.3 gestalt-proto Shared Types

- **Rust source:** `gestalt-proto/src/{event,agent,run,memory,sync}.rs`
- **TypeScript types:** `gestalt-proto/typescript/src/` — already generated (AgentSpec, RunSpec, MemoryNode, MemoryEdge, WsEvent, etc.)
- **`WsEvent` enum** (tagged JSON): StateChanged, LockAcquired, LockReleased, RunStarted, RunFinished, ConflictDetected, SubagentSpawned, SubagentProgress, MemoryUpdated, RunPhaseChanged
- **EventBus trait:** `publish(&self, event: &WsEvent) -> Result<(), String>`

### 1.4 swal-agent-runner (TypeScript PWA)

| Component | File | Tech |
|-----------|------|------|
| Agent Loop | `src/agent/agent-loop.ts` | ReAct loop (single agent, max 20 iter) |
| Agent Tools | `src/agent/agent-tools.ts` | read_file, write_file, run_command, etc. |
| P2P Mesh Client | `src/services/mesh/edge-mesh-client.ts` | Singleton wrapping YjsAdapter |
| CRDT Event Bus | `src/services/mesh/crdt-event-bus.ts` | Y.Array-based generic event bus |
| CRDT Graph | `src/services/mesh/crdt-graph.ts` | Y.Map-based memory graph |
| CRDT Sync | `src/services/mesh/crdt-sync.ts` | y-webrtc + y-indexeddb providers |
| Transport | `src/services/mesh/transport.ts` | PeerJSTransport (WebRTC) + MemoryTransport |
| Git Service | `src/services/git/git-service.ts` | isomorphic-git + LightningFS |
| Xavier Memory Node | `src/services/memory/xavier-memory-node.ts` | IndexedDB via `idb` library |
| UI Components | `src/components/*.tsx` | React with Tailwind |

**Current limitations for multi-agent:**
- `AgentLoopRunner.runTask()` handles one agent at a time
- No routing, no parallel agent orchestration, no conflict detection
- `MeshEvent` is a generic `{type, source, payload}` — not typed to `WsEvent` variants
- Git operations are direct isogit calls, not through `GitPort` trait

---

## 2. What Needs to Be Built in gestalt-wasm

### 2.1 IndexedDB StateBackend (HIGH priority)

**File:** `gestalt-wasm/src/state.rs` — add `#[cfg(target_arch = "wasm32")] pub mod wasm`

**Approach A (Recommended):** `rexie` crate
- `rexie` is an async IndexedDB wrapper for WASM, similar to `idb` on JS side
- Direct Rust ↔ IndexedDB, no JS bridge required
- Supports object stores, indexes, cursor scans

```rust
// Pseudocode
#[cfg(target_arch = "wasm32")]
pub mod wasm {
    use super::StateBackend;
    use rexie::Rexie;

    pub struct IndexedDbBackend {
        db: Rexie,
    }

    impl IndexedDbBackend {
        pub async fn new(db_name: &str, store_name: &str) -> Result<Self, String> {
            let db = Rexie::builder(db_name)
                .add_object_store(rexie::ObjectStore::new(store_name)
                    .key_path("key"))
                .build()
                .await
                .map_err(|e| format!("Rexie open: {e}"))?;
            Ok(Self { db })
        }
    }

    #[async_trait(?Send)]  // WASM is single-threaded
    impl StateBackend for IndexedDbBackend {
        async fn put(&self, key: &str, value: &str) -> Result<(), String> { ... }
        async fn get(&self, key: &str) -> Result<Option<String>, String> { ... }
        async fn delete(&self, key: &str) -> Result<(), String> { ... }
        async fn list(&self, prefix: &str) -> Result<Vec<String>, String> { ... }
    }
}
```

**Approach B (Fallback):** JS bridge via `wasm-bindgen`
- Call JavaScript `idb` directly through `#[wasm_bindgen]` extern functions
- Higher latency (JSON serialization boundary), but reuses existing `idb` dependency

**Recommendation:** Approach A — cleaner, no bi-directional serialization overhead.

**Required Cargo additions:**
```toml
# in gestalt-wasm/Cargo.toml
[target.'cfg(target_arch = "wasm32")'.dependencies]
rexie = "0.6"  # async IndexedDB wrapper
```

**Breaking change:** `StateBackend` trait must become async to support IndexedDB's async API. This means changing the trait signature:

```rust
#[async_trait(?Send)]
pub trait StateBackend {
    async fn put(&self, key: &str, value: &str) -> Result<(), String>;
    async fn get(&self, key: &str) -> Result<Option<String>, String>;
    async fn delete(&self, key: &str) -> Result<(), String>;
    async fn list(&self, prefix: &str) -> Result<Vec<String>, String>;
}
```

This requires updating `NativeStateBackend` (wrap in tokio::task::spawn_blocking) and adding `async-trait` dependency.

### 2.2 Isomorphic-Git Bridge for GitPort (MEDIUM priority)

**File:** `gestalt-wasm/src/git.rs` — add `#[cfg(target_arch = "wasm32")] pub mod wasm`

Instead of reimplementing git in Rust for WASM, bridge to the existing JS `isomorphic-git` + `LightningFS` already in swal-agent-runner.

**Architecture:**
```rust
#[cfg(target_arch = "wasm32")]
pub mod wasm {
    use super::GitPort;
    use wasm_bindgen::prelude::*;

    #[wasm_bindgen]
    extern "C" {
        #[wasm_bindgen(js_namespace = isogit)]
        async fn clone(options: &JsValue) -> Result<JsValue, JsValue>;
        // ... more bindings
    }

    pub struct IsomorphicGitBridge {
        fs_ref: JsValue,  // reference to LightningFS instance
    }

    impl IsomorphicGitBridge {
        pub fn new(fs: JsValue) -> Self {
            Self { fs_ref: fs }
        }
    }

    #[async_trait(?Send)]
    impl GitPort for IsomorphicGitBridge {
        async fn clone_repo(&self, url: &str, path: &str) -> Result<(), String> { ... }
        // ...
    }
}
```

**Design consideration:** This creates a tight coupling between Rust and the JS `isomorphic-git` library. An alternative is to keep the `GitPort` calls on the JS side and only have Rust call through a thin JS bridge. However, the tight-coupling approach above is simpler for Rust code that needs to use `GitPort` generically.

**Alternative (simpler):** Don't implement `IsomorphicGitBridge` in Rust at all. Instead, keep the `GitWorkspaceService` in JS/TS and have the Foreman call it via wasm-bindgen imports. The Rust code only needs `GitPort` if the Router/Merge pipeline runs inside WASM. If the Router stays native (or runs as a separate service), the GitPort trait is only needed for the native backend.

**Recommendation:** Implement `IsomorphicGitBridge` as a thin wasm-bindgen FFI bridge to the existing JS `isomorphic-git` library. This makes `GitPort` usable from Rust code compiled to WASM. Ship the bridging code.

### 2.3 WASM EventBus Enhancements (LOW priority — mostly done)

`BroadcastChannelBus` is already implemented in `bus.rs`. Needed additions:

1. **Add `EventSubscriber` support** — currently `BroadcastChannelBus` only publishes. For the Foreman to *receive* events (e.g., `SubagentProgress`), we need a listener:
   - Add `SubscriberChannelBus` that wraps `BroadcastChannel::onmessage`
   - Implement `EventSubscriber` trait
   - Return `WsEvent` parsed from JSON

2. **Expose to JS via `#[wasm_bindgen]`** — generate TypeScript bindings:
   ```rust
   #[wasm_bindgen]
   impl BroadcastChannelBus {
       #[wasm_bindgen(constructor)]
       pub fn new_js(name: &str) -> Result<BroadcastChannelBus, JsValue> { ... }
       
       pub fn publish_js(&self, json: &str) -> Result<(), JsValue> { ... }
   }
   ```

### 2.4 WASM-exposed Foreman (HIGH priority)

The `Foreman` struct in `gestalt_core` needs WASM bindings so it can be called from JS.

**Approach:** Add a WASM adapter struct in `gestalt-wasm/src/lib.rs` (or a new `foreman.rs`):

```rust
#[cfg(target_arch = "wasm32")]
pub mod foreman_wasm {
    use wasm_bindgen::prelude::*;
    use gestalt_core::application::foreman::Foreman;
    use gestalt_proto::run::RunSpec;

    #[wasm_bindgen]
    pub struct WasmForeman {
        inner: Foreman,
    }

    #[wasm_bindgen]
    impl WasmForeman {
        #[wasm_bindgen(constructor)]
        pub fn new(event_bus: Option<BroadcastChannelBus>) -> Result<WasmForeman, JsValue> { ... }
        
        pub async fn run_task(&self, task: &str, agent_id: &str, command: &str) -> Result<JsValue, JsValue> { ... }
        
        pub async fn run_wave(&self, task: &str, agents: JsValue) -> Result<JsValue, JsValue> { ... }
    }
}
```

**Critical issue:** `Foreman` needs a `RouterHandle` impl. In WASM, there's no native subprocess spawning. Two options:

1. **Lightweight WASM Router**: Implement `RouterHandle` for a WASM-native router that calls the LLM via wasm-bindgen HTTP and manages worktrees in LightningFS. This is a significant build but keeps everything in-WASM.

2. **Remote Router**: The WASM `RouterHandle` delegates to a remote Router service (HTTP/WS to a native Gestalt server). The PWA sends `RunSpec` to a native gestalt-daemon and receives `RunReport`. This is simpler but requires network connectivity.

3. **Hybrid**: Simple tasks run in-WASM (WebContainer + JS LLM calls), complex multi-agent waves delegate to remote Router.

**Recommendation:** Option 1 (Lightweight WASM Router) for the first iteration — it maximizes offline capability and aligns with the PWA ethos. The WASM Router calls the JS LLM Provider (via wasm-bindgen) and uses `LightningFS` for worktrees.

### 2.5 Cargo.toml Changes Summary

```toml
# gestalt-wasm/Cargo.toml additions

# Async trait support (needed for StateBackend, GitPort)
async-trait = "0.1"

# WASM-only additions
[target.'cfg(target_arch = "wasm32")'.dependencies]
# IndexedDB access from Rust
rexie = "0.6"
# For JS interop beyond basic wasm-bindgen
wasm-bindgen-futures = "0.4"
# already present

# gestalt_core as dependency for Foreman (wasm feature)
[target.'cfg(target_arch = "wasm32")'.dependencies]
gestalt_core = { path = "../gestalt_core", features = ["wasm"] }
```

Add a `wasm` feature to `gestalt_core/Cargo.toml` to gate native-only deps (git2, surrealdb, etc.):

```toml
# gestalt_core/Cargo.toml
[features]
wasm = []
# Native-only deps gated behind not(wasm)
```

---

## 3. Compilation & Web Worker Loading Strategy

### 3.1 Build Pipeline

```
gestalt-wasm/  ──── wasm-pack build ────►  pkg/
  └── target/wasm32-unknown-unknown/          ├── gestalt_wasm_bg.wasm
       └── release/                           ├── gestalt_wasm.js  (JS glue)
                                              ├── gestalt_wasm.d.ts
                                              └── package.json
```

**Script in gestalt-wasm/package.json (or build script):**
```bash
wasm-pack build --target web -- --features wasm
```

### 3.2 PWA Integration

**Copy to swal-agent-runner:**
```
cp -r gestalt-wasm/pkg/ swal-agent-runner/src/wasm/
```

Or better: use a workspace-level build script that outputs directly to the PWA's expected path.

### 3.3 Web Worker Architecture

Gestalt WASM should NOT run on the main thread (blocking animation, UI jank). Use a **dedicated Web Worker**:

```
┌─────────────────────────────────────────────────┐
│  Main Thread (React UI)                         │
│  - App.tsx, components/*                        │
│  - edgeMeshClient (Yjs + CrdtEventBus)         │
│  - useCrdtEvents hook                           │
│  - GestaltWorker.postMessage()                  │
├─────────────────────────────────────────────────┤
│  Web Worker: gestalt-worker.ts                  │
│  - Loads gestalt_wasm.js + gestalt_wasm_bg.wasm │
│  - Initializes WasmForeman                       │
│  - Manages StateBackend (IndexedDB via rexie)   │
│  - Manages BroadcastChannelBus                   │
│  - Handles LLM calls via wasm-bindgen fetch     │
│  - PostMessage back to main thread              │
├─────────────────────────────────────────────────┤
│  BroadcastChannel("gestalt-events")              │
│  - Gestalt WASM → BroadcastChannelBus            │
│  - Tab A ↔ Tab B (same origin)                  │
│  - Main thread can also listen                  │
├─────────────────────────────────────────────────┤
│  y-webrtc (P2P)                                  │
│  - Main thread only (Yjs doc)                   │
│  - CrdtEventBus bridge to BroadcastChannel      │
└─────────────────────────────────────────────────┘
```

**gestalt-worker.ts pseudocode:**
```typescript
/// <reference lib="webworker" />
import init, { WasmForeman } from './wasm/gestalt_wasm.js';

let foreman: WasmForeman | null = null;

self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data;
  
  switch (type) {
    case 'init':
      await init();  // init WASM
      foreman = new WasmForeman();
      self.postMessage({ type: 'ready' });
      break;
      
    case 'run_task':
      const report = await foreman!.run_task(payload.task, payload.agentId, payload.command);
      self.postMessage({ type: 'task_complete', payload: report });
      break;
      
    case 'run_wave':
      const waveResult = await foreman!.run_wave(payload.task, payload.agents);
      self.postMessage({ type: 'wave_complete', payload: waveResult });
      break;
  }
};
```

### 3.4 Vite WASM Configuration

Vite has native WASM support via `?init` imports. Add to `vite.config.ts`:

```typescript
// Ensure WASM files are served with correct MIME type
// Vite handles this automatically for .wasm imports
```

The Web Worker script itself needs to be a separate entry or use Vite's `new Worker(new URL(...))` syntax:

```typescript
// In main.ts or App.tsx
const worker = new Worker(
  new URL('./services/gestalt/gestalt-worker.ts', import.meta.url),
  { type: 'module' }
);
```

### 3.5 Initialization Flow

```
1. PWA loads, React renders UI
2. Main thread initializes EdgeMeshClient (Yjs + y-webrtc)
3. Main thread spawns GestaltWorker
4. Worker loads WASM module (init())
5. Worker creates WasmForeman + BroadcastChannelBus
6. Worker posts 'ready' message
7. Main thread creates CrdtEventBus ↔ BroadcastChannel bridge
8. System is ready for task execution
```

---

## 4. EventBus Bridge: Gestalt → CrdtEventBus

### 4.1 The Challenge

- **Gestalt's EventBus** publishes typed `WsEvent` enum variants (JSON-tagged)
- **CrdtEventBus** (PWA) stores generic `MeshEvent {type, source, payload}` in Y.Array
- **y-webrtc** replicates Y.Array across peers (phone ↔ PC)
- **BroadcastChannelBus** (WASM) broadcasts to same-origin tabs

### 4.2 Bridge Architecture

```
Gestalt Rust (WASM)                    JS Main Thread
┌────────────────────┐                ┌──────────────────────────┐
│ Foreman            │                │ EdgeMeshClient            │
│   └─ EventBus ─────┼── Broadcast──► │   └─ Yjs Doc              │
│      (Broadcast-   │   Channel      │      └─ Y.Array('bus:    │
│       ChannelBus)  │   "gestalt-    │         events')          │
│                    │   events"      │  CrdtEventBus.bridge()    │
│                    │  ◄── listen ───┤  Reads from BroadcastCh.  │
└────────────────────┘                │  + pushes to Y.Array      │
                                      │                            │
                                      │  y-webrtc syncs Y.Array   │
                                      │  to paired peer (phone/PC) │
                                      └──────────────────────────┘
```

### 4.3 Bridge Implementation

```typescript
// src/services/gestalt/gestalt-bridge.ts

import { edgeMeshClient } from '../mesh/edge-mesh-client';

export class GestaltBridge {
  private broadcastChannel: BroadcastChannel;
  
  constructor(channelName = 'gestalt-events') {
    this.broadcastChannel = new BroadcastChannel(channelName);
  }

  /**
   * Listen for events from Gestalt WASM (BroadcastChannelBus)
   * and forward them to the CrdtEventBus (Y.Array → y-webrtc).
   */
  start() {
    this.broadcastChannel.onmessage = (event) => {
      try {
        // Parse WsEvent JSON from Gestalt
        const wsEvent = JSON.parse(event.data);
        
        // Map to MeshEvent shape and push to CrdtEventBus
        edgeMeshClient.crdtEventBus.publish({
          type: wsEvent.type,
          source: 'gestalt-wasm',
          payload: {
            ...wsEvent.data,
            runId: wsEvent.data?.run_id,
            timestamp: Date.now(),
          },
        });
      } catch (err) {
        console.warn('[GestaltBridge] Failed to parse event:', err);
      }
    };
  }

  /**
   * Send a command from the UI back to Gestalt WASM.
   * Uses postMessage to the GestaltWorker.
   */
  sendCommand(type: string, payload: unknown) {
    // This would be a postMessage to the Web Worker
    // that hosts the WasmForeman
  }

  stop() {
    this.broadcastChannel.close();
  }
}
```

### 4.4 WsEvent → MeshEvent Mapping

| WsEvent type (tag) | MeshEvent.type | Payload Fields |
|-------------------|----------------|----------------|
| `state_changed` | `gestalt:state_changed` | `{runId, agentId, state}` |
| `subagent_spawned` | `gestalt:subagent_spawned` | `{runId, agentId, parentId, model, task}` |
| `subagent_progress` | `gestalt:subagent_progress` | `{runId, agentId, progressPct, status, currentFile}` |
| `run_started` | `gestalt:run_started` | `{runId, task, agents}` |
| `run_finished` | `gestalt:run_finished` | `{runId, summary}` |
| `memory_updated` | `gestalt:memory_updated` | `{runId, source, nodeId, edgeFrom, edgeTo, action}` |
| `run_phase_changed` | `gestalt:phase_changed` | `{runId, phase}` |

### 4.5 Bidirectional Considerations

- **Gestalt → UI:** Events flow through BroadcastChannel → bridge → Y.Array → y-webrtc (works OOB)
- **UI → Gestalt:** Commands flow through postMessage(Worker) → Rust wasm-bindgen call
- **Cross-tab:** BroadcastChannel already handles same-origin tab-to-tab. For cross-device, y-webrtc handles it

---

## 5. Foreman Integration: Replacing agent-loop.ts

### 5.1 Architecture Before vs After

**Before (current):**
```
AgentLoopRunner.runTask(task)
  ├── AgentToolExecutor (read/write/run/diff)
  ├── GitWorkspaceService (clone/commit/push)
  ├── LLMProviderManager (LLM calls)
  ├── XavierMemoryNode (memory store)
  └── edgeMeshClient.crdtEventBus (notifications)
      Single agent, sequential, max 20 iterations
```

**After (with Gestalt Foreman):**
```
Foreman.run_wave(task, agents)
  ├── RouterHandle (lightweight WASM router)
  │   ├── AgentRunner (calls JS LLM via wasm-bindgen)
  │   ├── VirtualFS (LightningFS via wasm-bindgen)
  │   ├── StateBackend (IndexedDB via rexie)
  │   └── GitPort (isomorphic-git bridge)
  ├── EventBus (BroadcastChannelBus)
  │   └── → GestaltBridge → CrdtEventBus → y-webrtc
  └── MemorySync (IndexedDB → Xavier sync)
      Multiple agents, parallel waves, conflict detection
```

### 5.2 Migration Strategy: Don't Rewrite, Bridge

Instead of rewriting `agent-loop.ts` in Rust, keep it as the **AgentRunner** implementation that the WASM Router calls into:

```
┌─────────────────────────────────────────────────┐
│  WASM (gestalt-wasm)                              │
│                                                    │
│  Foreman.run_wave()                                │
│    └─ RouterHandle.execute(RunSpec)                │
│         └─ For each AgentSpec:                     │
│              wasm-bindgen call → JS AgentRunner     │
│                                    │               │
│              ◄── RunReport ────────│               │
│                                                    │
│  EventBus.publish(WsEvent)                         │
│    └─ BroadcastChannelBus.postMessage()            │
│                                                    │
└──────────┬──────────┬──────────────────────────────┘
           │          │
           │          └── LLM calls → wasm-bindgen fetch
           │
    [BroadcastChannel "gestalt-events"]
           │
┌──────────▼────────────────────────────────────────┐
│  JS Main Thread                                     │
│                                                      │
│  GestaltBridge (listens to BroadcastChannel)         │
│    └─ edgeMeshClient.crdtEventBus.publish()         │
│                                                    │
│  JS AgentRunner (bridged from Rust)                 │
│    ├─ LLMProviderManager.executeAgentStep()         │
│    ├─ AgentToolExecutor (read/write/run commands)   │
│    └─ GitWorkspaceService (clone/commit/push)       │
│                                                      │
│  UI: TaskProgressView, MemorySyncPanel, etc.        │
└────────────────────────────────────────────────────┘
```

### 5.3 WASM RouterHandle Implementation

```rust
// gestalt-wasm/src/router_wasm.rs

#[cfg(target_arch = "wasm32")]
pub mod wasm {
    use async_trait::async_trait;
    use gestalt_core::application::foreman::RouterHandle;
    use gestalt_proto::run::{RunReport, RunSpec};

    pub struct WasmRouter {
        // Holds JS function references for agent execution
        agent_runner: js_sys::Function,
        // LightningFS or equivalent
        fs: js_sys::Object,
    }

    #[async_trait(?Send)]
    impl RouterHandle for WasmRouter {
        async fn execute(&self, spec: RunSpec) -> Result<RunReport, Box<dyn std::error::Error>> {
            // For each agent in spec.agents:
            //   1. Call JS agent_runner(spec, agent_spec) → returns AgentResult
            //   2. Collect results
            // 3. Return consolidated RunReport
            todo!()
        }
        
        fn event_bus(&self) -> Option<&std::sync::Arc<dyn EventBus>> {
            // Return reference to BroadcastChannelBus
            todo!()
        }
    }
}
```

### 5.4 JS-side AgentRunner Wrapper

```typescript
// src/agent/gestalt-agent-runner.ts
// Called from Rust WASM via wasm-bindgen

import { LLMProviderManager } from '../services/llm/llm-provider-manager';
import { AGENT_TOOLS, AgentToolExecutor } from './agent-tools';
import { GitWorkspaceService } from '../services/git/git-service';
import { edgeMeshClient } from '../services/mesh/edge-mesh-client';

/**
 * Execute a single agent task. Called from WASM Foreman via wasm-bindgen.
 * This is the bridge between Rust's AgentSpec and the existing JS agent loop.
 */
export async function executeAgent(
  agentId: string,
  command: string,
  task: string,
  projectDir: string
): Promise<{ state: string; output: string; changedFiles: string[] }> {
  // Bridge to JS AgentLoopRunner logic
  // Returns result that Rust maps into AgentResult
  // ...
}
```

### 5.5 What agent-loop.ts Becomes

The existing `AgentLoopRunner` class is **re-purposed** as the single-agent execution backend. The Foreman orchestrates multiple instances. The file:

- Keeps its ReAct loop logic (system prompt, iteration management, tool selection)
- Loses its "top-level orchestrator" role (moves to Foreman)
- Gets a new `executeAgent()` export that the WASM Router calls
- Still publishes progress events (now via both BroadcastChannel *and* CrdtEventBus)

---

## 6. File Island Mapping

### 6.1 Files to CREATE in gestalt

| File | Purpose | Priority |
|------|---------|----------|
| `gestalt-wasm/src/state/wasm.rs` | `IndexedDbBackend` (rexie) | HIGH |
| `gestalt-wasm/src/git/wasm.rs` | `IsomorphicGitBridge` (wasm-bindgen FFI) | MEDIUM |
| `gestalt-wasm/src/router_wasm.rs` | `WasmRouter` — RouterHandle for WASM | HIGH |
| `gestalt-wasm/src/foreman_wasm.rs` | `WasmForeman` — #[wasm_bindgen] exports | HIGH |
| `gestalt-wasm/src/lib.rs` | Add modules + wasm-bindgen entry point | HIGH |

### 6.2 Files to MODIFY in gestalt

| File | Change | Priority |
|------|--------|----------|
| `gestalt-wasm/Cargo.toml` | Add `rexie`, `async-trait`, `js-sys`; gate `gestalt_core` behind wasm | HIGH |
| `gestalt-wasm/src/state.rs` | Make `StateBackend` async (add `async-trait`), add wasm module | HIGH |
| `gestalt-wasm/src/git.rs` | Add wasm module for IsomorphicGitBridge | MEDIUM |
| `gestalt-wasm/src/bus.rs` | Add `EventSubscriber` impl + `#[wasm_bindgen]` exports | LOW |
| `gestalt_core/Cargo.toml` | Add `wasm` feature to gate native-only deps | HIGH |
| `gestalt_core/src/application/foreman.rs` | Optionally add `#[cfg(not(target_arch = "wasm32"))]` on native-only types | LOW |
| `gestalt-proto/Cargo.toml` | No changes needed (already minimal) | — |

### 6.3 Files to CREATE in swal-agent-runner

| File | Purpose | Priority |
|------|---------|----------|
| `src/services/gestalt/gestalt-worker.ts` | Web Worker loading WASM | HIGH |
| `src/services/gestalt/gestalt-bridge.ts` | BroadcastChannel → CrdtEventBus bridge | HIGH |
| `src/services/gestalt/index.ts` | Module barrel | MEDIUM |
| `src/services/gestalt/__tests__/gestalt-bridge.test.ts` | Bridge unit tests | MEDIUM |
| `src/wasm/` (directory) | Copied wasm-pack output (gitignored) | HIGH |

### 6.4 Files to MODIFY in swal-agent-runner

| File | Change | Priority |
|------|--------|----------|
| `src/agent/agent-loop.ts` | Refactor: extract `executeAgent()` for WASM bridge; keep ReAct loop | HIGH |
| `src/agent/agent-tools.ts` | No major changes needed (already clean) | — |
| `src/App.tsx` | Initialize GestaltWorker + GestaltBridge on mount | HIGH |
| `src/main.tsx` | Optionally: init Gestalt before React render | MEDIUM |
| `src/services/mesh/index.ts` | Export `CrdtEventBus` type if not already | LOW |
| `vite.config.ts` | Add WASM support for Worker, ensure COEP/COOP | HIGH |
| `package.json` | Add build step for wasm-pack, or add as workspace build | HIGH |
| `tsconfig.json` | Add `WebWorker` lib reference for worker file | MEDIUM |

### 6.5 Files Unchanged

| File | Reason |
|------|--------|
| `src/services/git/git-service.ts` | Bridged via IsomorphicGitBridge, no changes needed |
| `src/services/llm/llm-provider-manager.ts` | Bridged via wasm-bindgen, called from Rust |
| `src/services/mesh/crdt-event-bus.ts` | Receives bridged events, no changes needed |
| `src/services/mesh/crdt-graph.ts` | Unchanged — memory graph for UI consumption |
| `src/services/mesh/crdt-sync.ts` | Unchanged — y-webrtc provider |
| `src/services/mesh/edge-mesh-client.ts` | Unchanged — singleton accessed by bridge |
| `src/services/mesh/transport.ts` | Unchanged — P2P transport |
| `src/services/memory/xavier-memory-node.ts` | Unchanged — local IndexedDB memory |
| `src/services/memory/edge-mesh-sync.ts` | Unchanged — Xavier sync |
| `src/hooks/useCrdtEvents.ts` | Unchanged — listens to CrdtEventBus |
| All `src/components/*.tsx` | Unchanged — UI components are consumers |
| `gestalt-router/` | Unchanged — stays native-only (for now) |
| `gestalt-merge/` | Unchanged — stays native-only |
| `gestalt-state/` | Unchanged — native dependency |
| `gestalt-ws/` | Unchanged — native WebSocket server |

---

## 7. Risk Assessment & Effort Estimation

### 7.1 Risk Matrix

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| `rexie` crate unmaintained or incompatible with latest wasm-bindgen | HIGH | MEDIUM | Fall back to raw web-sys IDB API or JS bridge approach |
| WASM binary too large (>5MB) for PWA first-load experience | MEDIUM | MEDIUM | Optimize with `--opt-level=s`, code splitting, lazy load Worker |
| SharedArrayBuffer not available on all mobile browsers | HIGH | LOW | COEP/COOP already set in vite.config. Detect and fallback gracefully |
| Async trait in WASM (`?Send`) causes subtle bugs | MEDIUM | LOW | Extensive testing with wasm-pack test + browser tests |
| Circular dependency when adding `gestalt_core` dep to `gestalt-wasm` | HIGH | LOW | gestalt-wasm already depends on gestalt-proto; gestalt_core also depends on gestalt-proto. Adding gestalt_core to gestalt-wasm is linear, not circular. |
| `BroadcastChannel` messages lost when Worker is busy | MEDIUM | MEDIUM | Use SharedArrayBuffer ring buffer or channel message port |
| JS ↔ Rust serialization overhead for large agent results | LOW | MEDIUM | Use `serde_wasm_bindgen` for zero-copy where possible |

### 7.2 Effort Estimation

| Phase | Components | Estimated Effort | Dependencies |
|-------|-----------|-----------------|--------------|
| **Phase 1:** WASM Backends | IndexedDbBackend, BroadcaseChannelBus subscriber, Cargo.toml changes | **3-4 days** | None (within gestalt-wasm) |
| **Phase 2:** WASM Foreman | WasmRouter, WasmForeman, wasm-bindgen exports | **4-5 days** | Phase 1 |
| **Phase 3:** Worker & Bridge | gestalt-worker.ts, gestalt-bridge.ts, Vite config | **2-3 days** | Phase 2 |
| **Phase 4:** JS Agent Refactor | Extract executeAgent(), wire wasm-bindgen calls | **2-3 days** | Phase 3 |
| **Phase 5:** Testing & Polish | wasm-pack tests, integration tests, perf tuning | **3-4 days** | Phase 4 |
| **Total** | | **14-19 days** | |

### 7.3 Key Dependencies

- `rexie` (or replacement) for IndexedDB from Rust
- `wasm-bindgen` 0.2.x (already in use)
- `async-trait` 0.1.x (lightweight, no native deps)
- `js-sys` 0.3.x (already in use)
- Vite's built-in WASM support (no extra plugin needed)
- `y-webrtc` + `y-indexeddb` (already in use)

---

## 8. Phased Rollout Plan

| Phase | Delivers | Verification |
|-------|----------|-------------|
| **Phase 1** | `cargo build --target wasm32-unknown-unknown --features wasm` succeeds; `IndexedDbBackend` passes `wasm-pack test` | `wasm-pack test --chrome` |
| **Phase 2** | `WasmForeman` initialized in PWA; single `run_task()` executes end-to-end via JS bridge | Browser console log of RunReport |
| **Phase 3** | GestaltWorker loads WASM; events flow BroadcastChannel → CrdtEventBus → y-webrtc | Two browser tabs show same events |
| **Phase 4** | `run_wave()` orchestrates 2+ parallel agents; conflict detection works | UI shows parallel progress |
| **Phase 5** | Full integration test suite; loading optimized; memory sync works | CI passes; Lighthouse audit |

### Critical Path to MVP (Phases 1-3)

```
Week 1: Phase 1 + 2  →  WasmForeman runs single task in PWA
Week 2: Phase 3      →  Events bridge to CrdtEventBus working
Week 3: Phase 4      →  Multi-agent waves operational
Week 4: Phase 5      →  Production hardening
```

---

## Appendix A: Key Architecture Decisions

1. **`StateBackend` becomes async** — Breaking change, but necessary for IndexedDB. Native impl wraps rusqlite in `spawn_blocking`.
2. **WASM Router is lightweight** — Does not implement full gestalt-router logic (no git worktrees, no merge). It delegates execution to JS and reports back.
3. **No `gestalt-router` in WASM** — Too many native deps (git2, tokio process). Router stays native-only.
4. **Yjs remains in main thread** — y-webrtc and BroadcastChannel are DOM APIs unavailable in Workers. Bridge via BroadcastChannel.
5. **Existing JS agent code is reused, not rewritten** — The Rust Foreman calls into JS AgentRunner via wasm-bindgen, keeping all the existing LLM provider logic, tool execution, and git operations.

## Appendix B: Reference Commands

```bash
# Build WASM package
cd ~/proyectosSWAL/gestalt
wasm-pack build gestalt-wasm --target web -- --features wasm

# Copy to PWA
cp -r gestalt-wasm/pkg/ ~/proyectosSWAL/swal-agent-runner/src/wasm/

# Run WASM tests
wasm-pack test gestalt-wasm --chrome

# Native tests
cargo test -p gestalt-wasm

# Dev server (swal-agent-runner)
cd ~/proyectosSWAL/swal-agent-runner
npm run dev
```
