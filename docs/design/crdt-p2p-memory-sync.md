# CRDT-Based P2P Working Memory Sync — Design Document

> **Date:** 2026-07-29
> **Status:** Draft for Review
> **Codebase:** `swal-agent-runner` PWA
> **Gestalt Protocol:** v1 (gestalt-proto)
> **CRDT Engine:** Yjs 13.6.31 + y-webrtc 10.3.0

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current Architecture Analysis](#2-current-architecture-analysis)
3. [Design Goals & Non-Goals](#3-design-goals--non-goals)
4. [Memory Category Routing Strategy](#4-memory-category-routing-strategy)
5. [CrdtMemoryStore — New Abstraction](#5-crdtmemorystore--new-abstraction)
6. [Conflict Resolution Strategy](#6-conflict-resolution-strategy)
7. [Coexistence: XavierMemoryNode ↔ CrdtGraph ↔ CrdtMemoryStore](#7-coexistence-xaviermemorynode--crdtgraph--crdtmemorystore)
8. [Dual-Write Protocol for Working Memories](#8-dual-write-protocol-for-working-memories)
9. [Migration Path for Existing Chunks](#9-migration-path-for-existing-chunks)
10. [File Island Map & Risk Assessment](#10-file-island-map--risk-assessment)
11. [Implementation Plan](#11-implementation-plan)
12. [Architecture Diagram](#12-architecture-diagram)

---

## 1. Executive Summary

The current architecture stores *all* memory categories (episodic, semantic, procedural, working) in a local IndexedDB via `XavierMemoryNode`, then HTTP-syncs them to the Xavier master node. There is **no peer-to-peer memory sync** — two edge devices (phone ↔ tablet) cannot share working memories without going through Xavier.

**What this design proposes:**

1. Create a `CrdtMemoryStore` that stores **working memories** (category = `'working'`) in a dedicated Y.Map shared across P2P peers via y-webrtc.
2. Route **episodic / semantic / procedural** memories through the existing HTTP path to Xavier (permanent, durable).
3. Keep `XavierMemoryNode` as the local IndexedDB persistence layer for all categories; add dual-write for working memories into both IndexedDB *and* the CRDT Y.Map.
4. Extend `CrdtGraph` lightly or create a new `CrdtMemoryStore` that understands working memory semantics (TTL, project-scoped queries, category filtering).
5. Provide a clean migration path for existing chunks and a phased rollout.

---

## 2. Current Architecture Analysis

### 2.1 Component Map

```
┌────────────────────────────────────────────────────────────────┐
│  swal-agent-runner PWA                                         │
│                                                                │
│  ┌──────────────┐   ┌────────────────┐   ┌──────────────────┐  │
│  │XavierMemoryNode│  │ EdgeMeshSync   │   │ CrdtGraph        │  │
│  │(IndexedDB)    │──│ Service (HTTP) │   │ (Y.Map chunks/   │  │
│  │               │  │                │   │       edges)     │  │
│  │ chunks[]      │  │ POST /api/v1/  │   │ replicates via   │  │
│  │               │  │   memory/sync  │   │ y-webrtc         │  │
│  └──────┬───────┘   └────────────────┘   └────────┬─────────┘  │
│         │                                         │            │
│         │ stores all categories                   │ stores all │
│         │ (episodic, semantic,                    │ categories │
│         │  procedural, working)                   │ (same data) │
│         │                                         │            │
│  ┌──────┴───────┐   ┌────────────────┐           │            │
│  │EdgeMeshClient  │   │ CrdtEventBus  │           │            │
│  │(PeerJS + Yjs)  │   │ (Y.Array)     │           │            │
│  │                │   │ agent events  │           │            │
│  └────────────────┘   └────────────────┘           │            │
│                                                     │            │
│  ┌──────────────────────────────────────────────────┘            │
│  │ Y.Doc (shared Yjs document)                                  │
│  │   ├── graph:chunks  (Y.Map)  ← CrdtGraph                     │
│  │   ├── graph:edges   (Y.Map)  ← CrdtGraph                     │
│  │   └── bus:events    (Y.Array) ← CrdtEventBus                 │
│  │                                                               │
│  │ y-webrtc ↔ y-indexeddb ↔ Y.Doc                               │
│  └───────────────────────────────────────────────────────────────┘
```

### 2.2 Key Observations

| Observation | Implication |
|---|---|
| `CrdtGraph` stores *all* chunk categories in Y.Map, but `XavierMemoryNode` is the actual storage used by agent tools (`memory_search`, `storeChunk`) | CrdtGraph is populated but never read by agent logic — dead write path |
| `EdgeMeshSyncService` syncs ALL unsynced chunks to Xavier via HTTP | Working memories (which may be large, frequent, or temporary) get pushed to Xavier unnecessarily |
| `fromSerialized()` hardcodes `syncedToMaster: true` for CRDT chunks | Assumes CRDT implies master sync — wrong for working memories that should P2P but NOT go to Xavier |
| `syncedToMaster` flag is the only bidi communication with Xavier | No concept of "synced via P2P" vs "synced to Xavier" |
| `CrdtGraph` lacks TTL, category filtering, expiration | Working memories need automatic cleanup |

### 2.3 Data Flow Today

```
Agent creates memory
    │
    ▼
XavierMemoryNode.storeChunk({ category: 'working', ... })
    │
    ├── stored in IndexedDB (chunks store)
    │
    └── optionally added to CrdtGraph (if agent-loop calls addChunk — currently NOT done)
            │
            └── replicated P2P via y-webrtc
                    │
                    └── BUT: no peer reads from CrdtGraph, so sync is pointless

Later: EdgeMeshSyncService.performRealtimeSync()
    │
    └── HTTP POST all unsynced chunks → Xavier master
            │
            └── working memories included (undesired)
```

---

## 3. Design Goals & Non-Goals

### Goals

1. **P2P working memory sync** — phone creates a working memory, tablet sees it within seconds (no Xavier required).
2. **Category-based routing** — `working` memories flow through CRDT P2P; `episodic`, `semantic`, `procedural` flow through HTTP to Xavier.
3. **Automatic expiration** — working memories have TTL (configurable, default 24h) to prevent unbounded Y.Map growth.
4. **Backward compatibility** — existing IndexedDB data survives; migration is zero-downtime.
5. **Gestalt-proto alignment** — adopt `content_hash`, `decay`, `degree` from `gestalt-proto::MemoryNode` for future compatibility.
6. **Dual-write consistency** — working memories are written to both IndexedDB (for local query) and Y.Map (for P2P replication).

### Non-Goals

- P2P sync for non-working categories (episodic/semantic/procedural remain HTTP to Xavier).
- Full CRDT-based graph query engine (Xavier still handles semantic search).
- Gestalt full protocol integration (adopt types only; orchestration is future work).
- Cryptographic peer identity or access control (deferred to future pairing model).
- gzip/binary chunk compression (can be layered later).

---

## 4. Memory Category Routing Strategy

### 4.1 Routing Matrix

| Category | Primary Store | Sync Mechanism | TTL | Graduates to Xavier? |
|---|---|---|---|---|
| `working` | Y.Map (CRDT) + IndexedDB | y-webrtc P2P | 24h default | Optional (promoted to episodic on completion) |
| `episodic` | IndexedDB | HTTP POST to Xavier | None | Always |
| `semantic` | IndexedDB | HTTP POST to Xavier | None | Always |
| `procedural` | IndexedDB | HTTP POST to Xavier | None | Always |

### 4.2 Rationale

- **Working memories** are transient, high-frequency, and device-local — perfect for CRDT. Two peers should see the same "in progress" state without a central server. TTL prevents unbounded growth.
- **Episodic memories** are task completion records — must be durable and searchable in Xavier. HTTP is appropriate.
- **Semantic memories** are architectural knowledge — permanent, needs Xavier's semantic search.
- **Procedural memories** are skill/recipe knowledge — durable, needs Xavier.

### 4.3 Working Memory → Xavier Promotion

When the agent completes a task, any working memories that informed the outcome should be *promoted* to episodic/semantic and pushed to Xavier:

```
Working memory "Found bug in parse_input()"
    │
    └── Agent completes task
            │
            ├── Promoted copy stored as episodic in IndexedDB
            ├── Original working memory marked for deletion from Y.Map
            └── Episodic copy HTTP-syncs to Xavier normally
```

This is implemented as an optional `promoteTo` field on `storeChunk`:

```typescript
XavierMemoryNode.storeChunk({
  projectId: 'synapse-trading',
  category: 'working',
  content: 'Found bug in parse_input()...',
  source: 'agent-loop',
  promoteTo: 'episodic',       // optional: creates promoted copy on completion
  ttlMs: 24 * 60 * 60 * 1000, // 24h
});
```

---

## 5. CrdtMemoryStore — New Abstraction

### 5.1 Design Decision: New class vs extend CrdtGraph

**Decision: Create `CrdtMemoryStore` as a higher-level abstraction that wraps CrdtGraph.**

Rationale:
- `CrdtGraph` is a general-purpose graph CRDT — it stores *all* categories with no filtering.
- `CrdtMemoryStore` adds working-memory-specific semantics: TTL, promotion, category-aware queries, `content_hash` dedup, decay management.
- Keeps `CrdtGraph` clean and testable — it remains a generic graph CRDT.
- `CrdtMemoryStore` is the *only* consumer of the working-memory Y.Map; `CrdtGraph` is still used for non-working graph operations.

### 5.2 Y.Map Layout

```
Y.Doc
├── graph:chunks          (Y.Map<SerializedChunk>)   — CrdtGraph (all categories)
├── graph:edges           (Y.Map<SerializedEdge>)    — CrdtGraph (all edges)
├── working:memories      (Y.Map<WorkingMemoryNode>) — CrdtMemoryStore (working only)
├── bus:events            (Y.Array<SerializedMeshEvent>) — CrdtEventBus
└── working:metadata      (Y.Map<WorkingMemoryMeta>)  — CrdtMemoryStore (TTLs, origins)
```

`working:memories` is a **separate Y.Map** from `graph:chunks` to:
1. Allow independent observer subscriptions (working memories change frequently).
2. Keep working memory schema distinct from general chunk schema.
3. Enable selective y-indexeddb persistence (working memories may use a different persistence window).

### 5.3 WorkingMemoryNode Type

```typescript
// Aligned with gestalt-proto::MemoryNode but simplified for working memory
interface WorkingMemoryNode {
  id: string;                    // UUID v4
  projectId: string;
  content: string;
  contentHash: string;           // SipHash of content for dedup (gestalt-proto compatible)
  category: 'working';           // Always 'working'
  source: string;                // Peer/source identifier
  timestamp: number;             // Created at (ms epoch)
  ttlMs: number;                 // Time-to-live in ms (default 86400000 = 24h)
  expiresAt: number;             // timestamp + ttlMs
  embedding?: number[];
  metadata?: Record<string, unknown>;  // For future extension (gestalt-proto compatible)
  promotedTo?: 'episodic' | 'semantic' | 'procedural'; // If promoted
}
```

### 5.4 CrdtMemoryStore API

```typescript
class CrdtMemoryStore {
  constructor(doc: Y.Doc, options?: { defaultTtlMs?: number; onExpire?: (id: string) => void });

  // Write
  add(memory: Omit<WorkingMemoryNode, 'id' | 'timestamp' | 'expiresAt' | 'contentHash'>): WorkingMemoryNode;
  update(id: string, patch: Partial<WorkingMemoryNode>): void;
  remove(id: string): void;
  expire(id: string): void;                  // Manually expire (TTL-based)

  // Read
  get(id: string): WorkingMemoryNode | undefined;
  getByProject(projectId: string): WorkingMemoryNode[];
  getBySource(source: string): WorkingMemoryNode[];
  getAll(): WorkingMemoryNode[];
  query(projectId: string, search: string, limit?: number): WorkingMemoryNode[];

  // Lifecycle
  startExpirySweep(intervalMs?: number): void;  // Periodic cleanup
  stopExpirySweep(): void;

  // Events
  subscribe(callback: (event: WorkingMemoryEvent) => void): () => void;

  // Serialization
  toJSON(): Record<string, WorkingMemoryNode>;

  // Internal helpers
  static contentHash(content: string): string;  // SipHash hex
}
```

### 5.5 Key Methods Detail

**`add()`** — Generates UUID, computes `contentHash`, sets `timestamp`/`expiresAt`, deduplicates by `contentHash`:

```typescript
add(memory): WorkingMemoryNode {
  const existing = this.findByContentHash(this.contentHash(memory.content));
  if (existing) {
    // Update timestamp/extend TTL instead of duplicate
    this.extend(existing.id, memory.ttlMs);
    return existing;
  }
  const node = { ...memory, id: crypto.randomUUID(), contentHash, timestamp, expiresAt };
  this.memories.set(node.id, node);
  this.dualWriteToIndexedDB(node);   // Also persist locally
  return node;
}
```

**`startExpirySweep()`** — Runs on a timer, iterates `working:memories`, removes expired entries. Emits `'expired'` events for cleanup hooks.

**`query()`** — Simple keyword filter + BM25-like scoring (same pattern as `XavierMemoryNode.queryMemory`). Works on the locally-replicated Y.Map (no network calls).

---

## 6. Conflict Resolution Strategy

### 6.1 Yjs Built-in Guarantees

Yjs provides **eventual consistency** with **no central coordinator**. All peers converge to the same state:

| Operation | Yjs Behavior |
|---|---|
| **Same key, concurrent set** | Last-writer-wins (LWW) by clock — the last `set()` call wins at merge time |
| **Same key, one delete + one set** | Delete wins (tombstone) |
| **Different keys** | No conflict — merged deterministically |
| **Array operations** | Insert/delete at positions resolved by Yjs internal IDs |

### 6.2 Working Memory Strategy: LWW + content_hash Dedup

For `CrdtMemoryStore`, conflicts are resolved with:

1. **Content-hash dedup (pre-conflict):** Before writing, compute `contentHash` of the new content. If a node with the same `contentHash` exists in the Y.Map, *extend its TTL* instead of creating a duplicate. This prevents peers from creating near-identical entries.

2. **Last-writer-wins (post-conflict):** If two peers write to the same key (same UUID, which shouldn't happen if contentHash dedup works), Yjs's Y.Map LWW ensures one final value.

3. **TTL = soft delete:** Expired entries are removed locally on `expirySweep`. If a peer is offline during expiry, it catches up on reconnect (replicated deletions via Yjs tombstone delta).

### 6.3 Edge Case: Offline Peer with Stale Working Memory

```
Scenario:
1. Peer A creates working memory W1
2. Peer B goes offline
3. W1 expires on Peer A (removed from Y.Map)
4. Peer B comes back online
5. Yjs sync removes W1 from Peer B's Y.Map too (tombstone apply)
```

This is correct behavior. If W1 was promoted to Xavier before expiry, it survives permanently.

### 6.4 Edge Case: Same Content, Different Peers

```
1. Peer A creates "Found bug in parse_input()"
2. Peer B creates "Found bug in parse_input()" (identical content)
3. contentHash is same → both see the single node with extended TTL
```

---

## 7. Coexistence: XavierMemoryNode ↔ CrdtGraph ↔ CrdtMemoryStore

### 7.1 Responsibility Split

| Component | Role | Backing Store |
|---|---|---|
| **XavierMemoryNode** | Canonical local IndexedDB storage for ALL categories. Source of truth for HTTP sync to Xavier master. | IndexedDB (`swal_xavier_memory_node.chunks`) |
| **CrdtGraph** | General-purpose CRDT graph. Stores chunk graph structure (nodes + edges) for non-working categories. Future use for graph queries. | Y.Map (`graph:chunks`, `graph:edges`) |
| **CrdtMemoryStore** | Working-memory CRDT store. P2P-replicated working memories with TTL. | Y.Map (`working:memories`, `working:metadata`) |

### 7.2 Write Flow (after change)

```
Agent creates memory
    │
    ├── category = 'working'?
    │   YES:
    │   ├── 1. XavierMemoryNode.storeChunk() → IndexedDB (for local persistence)
    │   └── 2. CrdtMemoryStore.add() → Y.Map → y-webrtc → peers
    │
    └── category = 'episodic' | 'semantic' | 'procedural'?
        ├── 1. XavierMemoryNode.storeChunk() → IndexedDB
        └── 2. EdgeMeshSyncService HTTP sync → Xavier master (later)
```

### 7.3 Read Flow

```
memory_search() or queryMemory()
    │
    ├── category filter includes 'working'?
    │   ├── YES: query XavierMemoryNode (IndexedDB) + CrdtMemoryStore (Y.Map)
    │   │        Merge results, dedup by id
    │   │        (Y.Map has latest P2P data, IndexedDB has local fallback)
    │   │
    │   └── NO: query XavierMemoryNode only
    │
    └── return merged results
```

### 7.4 Sync Flow

```
EdgeMeshSyncService.performRealtimeSync()
    │
    ├── gets unsynced chunks from XavierMemoryNode
    │
    ├── FILTERS OUT category='working'
    │   (working memories already synced P2P — no HTTP needed)
    │
    └── HTTP POST remaining chunks → Xavier master
```

### 7.5 Coexistence Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    swal-agent-runner PWA                         │
│                                                                  │
│  ┌──────────────────────┐        ┌─────────────────────────┐     │
│  │ XavierMemoryNode     │        │ CrdtMemoryStore         │     │
│  │ (IndexedDB)          │        │ (Y.Map working:memories)│     │
│  │                      │        │                         │     │
│  │ All categories       │        │ Working only + TTL      │     │
│  │ HTTP sync to Xavier  │        │ y-webrtc P2P sync       │     │
│  └────────┬─────────────┘        └───────────┬─────────────┘     │
│           │                                  │                   │
│           │ stores all                       │ stores working    │
│           ▼                                  ▼                   │
│  ┌────────────────┐                ┌────────────────┐            │
│  │EdgeMeshSync    │                │ EdgeMeshClient │            │
│  │Service (HTTP)  │                │ (PeerJS + Yjs) │            │
│  │                │                │                │            │
│  │ POST to Xavier │                │ y-webrtc P2P   │            │
│  │ (episodic,     │                │ (working)       │            │
│  │  semantic,     │                │                │            │
│  │  procedural)   │                │                │            │
│  └────────────────┘                └────────────────┘            │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ Y.Doc                                                    │    │
│  │  ├── graph:chunks          (CrdtGraph)                   │    │
│  │  ├── graph:edges           (CrdtGraph)                   │    │
│  │  ├── working:memories      (CrdtMemoryStore)  ★ NEW     │    │
│  │  ├── working:metadata      (CrdtMemoryStore)  ★ NEW     │    │
│  │  └── bus:events            (CrdtEventBus)                │    │
│  │                                                          │    │
│  │ y-webrtc ↔ y-indexeddb ↔ Y.Doc                          │    │
│  └──────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 8. Dual-Write Protocol for Working Memories

### 8.1 Why Dual-Write?

Working memories need to exist in **both** places:
- **IndexedDB (XavierMemoryNode):** Provides local query/fallback when P2P is unavailable. Also needed for background sync queue, offline resilience, and consistent `getAllChunks()`.
- **Y.Map (CrdtMemoryStore):** Provides P2P replication so phone↔tablet see the same working set.

### 8.2 Protocol

```typescript
// In agent-loop.ts (or wherever storeChunk is called)
async function storeMemory(chunk: MemoryChunkInput): Promise<MemoryChunk> {
  // 1. Always store in XavierMemoryNode (IndexedDB)
  const stored = await XavierMemoryNode.storeChunk(chunk);

  // 2. If working category, also add to P2P CRDT
  if (chunk.category === 'working') {
    try {
      edgeMeshClient.crdtMemoryStore?.add({
        projectId: stored.projectId,
        content: stored.content,
        source: stored.source,
        ttlMs: chunk.ttlMs ?? DEFAULT_WORKING_TTL,
        embedding: stored.embedding,
      });
    } catch (err) {
      // P2P unavailable — IndexedDB copy exists, will replicate on reconnect
      console.warn('[CrdtMemoryStore] P2P write failed, queued for retry:', err);
    }
  }

  return stored;
}
```

### 8.3 Recovery on Reconnect

When a P2P peer reconnects after offline period:

1. `y-webrtc` automatically syncs the Y.Map — any working memories added while offline appear on the peer.
2. If the peer was the *originator*, their IndexedDB has the working memories; upon Yjs sync, a local reconciliation loop scans IndexedDB working chunks not in Y.Map and adds them.
3. This ensures no working memory is lost during offline periods.

### 8.4 Reconciliation Loop

```typescript
// Called after y-webrtc 'synced' event
async function reconcileWorkingMemories(): Promise<void> {
  const localWorking = await XavierMemoryNode.getChunksByCategory('working');
  const p2pWorking = edgeMeshClient.crdtMemoryStore.getAll();

  const p2pIds = new Set(p2pWorking.map(m => m.id));
  const p2pContentHashes = new Set(p2pWorking.map(m => m.contentHash));

  for (const local of localWorking) {
    const localHash = CrdtMemoryStore.contentHash(local.content);
    if (!p2pContentHashes.has(localHash) && !p2pIds.has(local.id)) {
      // This local working memory hasn't reached P2P — push it
      edgeMeshClient.crdtMemoryStore.addFromExisting(local);
    }
  }
}
```

---

## 9. Migration Path for Existing Chunks

### 9.1 Migration Strategy: Zero-Downtime, Phased

All existing chunks remain in IndexedDB. No schema change to IndexedDB. No data loss.

### 9.2 Phase 1: Add CrdtMemoryStore (no behavioral change)

1. Create `CrdtMemoryStore` class, initialize alongside `CrdtGraph` from the same Y.Doc.
2. Add `edgeMeshClient.crdtMemoryStore` getter (similarly to `crdtEventBus`).
3. No agent code writes to `CrdtMemoryStore` yet.

**Risk:** None — new code, unused.

### 9.3 Phase 2: Dual-Write Working Memories

1. Modify `XavierMemoryNode.storeChunk` (or the caller in `agent-loop.ts`) to write working memories to `CrdtMemoryStore` in addition to IndexedDB.
2. Modify `EdgeMeshSyncService.performRealtimeSync` to skip working categories.
3. Working memories now flow P2P; existing IndexedDB chunks remain untouched.

**Risk:** Low — working memories are transient by nature; a duplicate write is harmless.

### 9.4 Phase 3: Reconciliation + Backfill

1. On app boot, scan existing IndexedDB working chunks and add to `CrdtMemoryStore` if not already present.
2. One-time backfill — adds P2P visibility to pre-existing working memories.

**Migration SQL (pseudocode):**

```typescript
async function backfillExistingWorkingMemories(): Promise<void> {
  const existing = await XavierMemoryNode.getChunksByCategory('working');
  for (const chunk of existing) {
    edgeMeshClient.crdtMemoryStore.addFromExisting({
      id: chunk.id,
      projectId: chunk.projectId,
      content: chunk.content,
      source: chunk.source,
      timestamp: chunk.timestamp,
      embedding: chunk.embedding,
      ttlMs: DEFAULT_WORKING_TTL,
    });
  }
}
```

Call once on app upgrade.

### 9.5 Phase 4: Promote-to-Xavier for Completed Working Memories

1. On task completion, scan project's working memories and create promoted episodic/semantic copies in IndexedDB.
2. Working memories with `promotedTo` set are candidates for HTTP sync.
3. Original working memory in Y.Map gets `promotedTo` flag or is removed on TTL expiry.

### 9.6 Rollback

Reverting is a no-op: stop writing to `CrdtMemoryStore`, and `EdgeMeshSyncService` goes back to syncing all categories. Existing Y.Map data has no structural impact.

---

## 10. File Island Map & Risk Assessment

### 10.1 Files to Create

| File | Purpose | Dependencies |
|---|---|---|
| `src/services/memory/crdt-memory-store.ts` | CrdtMemoryStore class | yjs, types/index.ts |
| `src/services/memory/__tests__/crdt-memory-store.test.ts` | Unit tests | vitest, yjs, fake-indexeddb |
| `src/services/memory/memory-router.ts` | Category routing logic (dual-write coordinator) | XavierMemoryNode, CrdtMemoryStore |

### 10.2 Files to Modify

| File | Change | Risk |
|---|---|---|
| `src/services/memory/edge-mesh-sync.ts` | Filter out `category='working'` in `performRealtimeSync` | Low — query change only |
| `src/services/memory/xavier-memory-node.ts` | Add `getChunksByCategory()` method | Low — new query method |
| `src/services/mesh/edge-mesh-client.ts` | Add `crdtMemoryStore` getter (lazy init) | Low — follows `crdtEventBus` pattern |
| `src/agent/agent-loop.ts` | Replace direct `XavierMemoryNode.storeChunk` with `memoryRouter.storeMemory` | Medium — core data path change |
| `src/agent/agent-tools.ts` | No change (uses `XavierMemoryNode.queryMemory` which stays the same) | None |
| `src/types/index.ts` | No change (MemoryChunk type stays backward-compatible) | None |
| `src/components/MemorySyncPanel.tsx` | Add P2P working memory indicator | Low — UI only |
| `src/services/mesh/index.ts` | Export CrdtMemoryStore type | Low |

### 10.3 Risk Assessment

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Y.Map size grows unbounded with working memories | Medium | Memory pressure, slow sync | TTL sweep + max limit (500 working nodes) |
| Dual-write fails silently (IndexedDB OK, Y.Map fails) | Low | Working memory not P2P-replicated | Retry on reconnect, IndexedDB is fallback |
| y-webrtc signaling server unavailable | Medium | No P2P sync until reconnect | Local-only mode; IndexedDB always works |
| Working memory content_hash collision | Very low | Dedup false positive (different content, same hash) | SipHash 64-bit collision probability ~2^-64 |
| Existing chunks in IndexedDB orphaned | Very low | Unused data | No data deleted; migration is additive only |
| Race: same content written near-simultaneously by 2 peers | Low | One wins, both see same node | Content_hash dedup resolves; acceptable for working memory |

### 10.4 Y.Map Size Bounds

Assume worst case: 500 working memory nodes × 2 KB avg = ~1 MB Y.Map. Plus metadata ≈ negligible. This is well within y-webrtc transport limits (messages are chunked). A hard cap of 500 working nodes per room is enforced in `CrdtMemoryStore`:

```typescript
add(memory): WorkingMemoryNode {
  if (this.size >= MAX_WORKING_MEMORIES) {
    this.evictLRU(); // Remove oldest by expiresAt
  }
  // ... proceed with add
}
```

---

## 11. Implementation Plan

### 11.1 Phase 1: Foundation (1-2 days)

1. **Create `crdt-memory-store.ts`** with `WorkingMemoryNode` type, `add`, `get`, `remove`, `query`, `getByProject`, `subscribe`, TTL sweep, content_hash dedup.
2. **Write tests** — unit tests with isolated Y.Doc, test dedup, test TTL expiry, test concurrent writes.
3. **Add `crdtMemoryStore` to `EdgeMeshClient`** — lazy init with `get crdtMemoryStore()`.
4. **Wire into app** — ensure `CrdtMemoryStore` is initialized when Y.Doc is ready.

### 11.2 Phase 2: Dual-Write (1-2 days)

1. **Create `memory-router.ts`** — single `storeMemory()` function that:
   - Writes all categories to IndexedDB (existing)
   - Writes `working` category to `CrdtMemoryStore` (new)
   - Emits event for tracking (optional)
2. **Patch `agent-loop.ts`** — replace direct `XavierMemoryNode.storeChunk()` calls with `memoryRouter.storeMemory()`.
3. **Patch `EdgeMeshSyncService.performRealtimeSync()`** — filter out working category.
4. **Add `XavierMemoryNode.getChunksByCategory()`** helper.

### 11.3 Phase 3: Backfill + Reconciliation (1 day)

1. **Boot-time backfill** — scan existing IndexedDB working chunks, push to `CrdtMemoryStore`.
2. **Reconnect reconciliation loop** — attached to `y-webrtc` `'synced'` event.
3. **Manual sync button** — add "Push working memories" to `MemorySyncPanel`.

### 11.4 Phase 4: Promotion + UI (1 day)

1. **Promotion hook** — on task completion, promote relevant working memories.
2. **Working memory indicator in MemorySyncPanel** — show working count, P2P status.
3. **Optional: Working memory viewer** — expandable list of P2P-synced working memories.

---

## 12. Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          PEER A (Phone)                                  │
│                                                                          │
│  ┌───────────────────────────────────────────────────────────────┐      │
│  │ Agent Loop                                                     │      │
│  │  ┌──────────────────┐   ┌──────────────────────────────────┐   │      │
│  │  │ memoryRouter      │   │  CrdtMemoryStore.add()          │   │      │
│  │  │ .storeMemory(     │──▶│  ┌─────────────────────────┐   │   │      │
│  │  │   category:'work',│   │  │ Y.Map 'working:memories'  │   │   │      │
│  │  │   content:'...'   │   │  └─────────────────────────┘   │   │      │
│  │  │ )                 │   │  ┌─────────────────────────┐   │   │      │
│  │  └────────┬─────────┘   │  │ Y.Map 'working:metadata'  │   │   │      │
│  │           │             │  └─────────────────────────┘   │   │      │
│  │           ▼             └──────────────────────────────────┘   │      │
│  │  ┌──────────────────┐                                         │      │
│  │  │ XavierMemoryNode  │  IndexedDB ← all categories            │      │
│  │  │ .storeChunk()     │                                         │      │
│  │  └──────────────────┘                                         │      │
│  └───────────────────────────────────────────────────────────────┘      │
│                                                                          │
│  ┌───────────────────────────────────────────────────────────────┐      │
│  │ y-webrtc Provider                                              │      │
│  │ ┌─────────┐   ┌──────────────────┐   ┌────────────────────┐   │      │
│  │ │ Y.Doc   │──▶│ y-webrtc         │──▶│ Signaling Server    │   │      │
│  │ │         │   │ (WebRTC)         │   │ (or relay)         │   │      │
│  │ │working: │   └──────────────────┘   └─────────┬──────────┘   │      │
│  │ │memories │                                    │              │      │
│  │ │         │   ┌──────────────────┐              │              │      │
│  │ │graph:   │──▶│ y-indexeddb      │              │              │      │
│  │ │chunks   │   │ (persistence)    │              │              │      │
│  │ └─────────┘   └──────────────────┘              │              │      │
│  └──────────────────────────────────────────────────┼────────────┘      │
│                                                      │                  │
└──────────────────────────────────────────────────────┼──────────────────┘
                                                       │  WebRTC DataChannel
┌──────────────────────────────────────────────────────┼──────────────────┐
│                          PEER B (Tablet)             │                  │
│                                                      ▼                  │
│  ┌───────────────────────────────────────────────────────────────┐      │
│  │ y-webrtc Provider (mirror)                                     │      │
│  │ ┌─────────┐   ┌──────────────────┐                            │      │
│  │ │ Y.Doc   │──▶│ y-webrtc (sync)   │                            │      │
│  │ │         │   │ connect/recv      │                            │      │
│  │ │working: │   └──────────────────┘                            │      │
│  │ │memories │                                                   │      │
│  │ └────┬────┘                                                   │      │
│  │      │                                                         │      │
│  │      ▼                                                         │      │
│  │ ┌──────────────────────────────────┐                          │      │
│  │ │ CrdtMemoryStore (on 'synced')    │                          │      │
│  │ │ → update local state             │                          │      │
│  │ │ → trigger UI re-render           │                          │      │
│  │ → working memories now visible     │                          │      │
│  │ └──────────────────────────────────┘                          │      │
│  └───────────────────────────────────────────────────────────────┘      │
│                                                                          │
│  ┌───────────────────────────────────────────────────────────────┐      │
│  │ Agent Loop on Peer B can read working memories that            │      │
│  │ Peer A created — without Xavier!                              │      │
│  └───────────────────────────────────────────────────────────────┘      │
└──────────────────────────────────────────────────────────────────────────┘

                         XAVIER MASTER NODE (PC)
┌──────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│  HTTP REST API (:8006)                                                   │
│  POST /api/v1/memory/sync  ← receives episodic/semantic/procedural       │
│                              (working memories NOT pushed here —         │
│                               they stay P2P)                             │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Appendix A: Key Type Mappings

```
gestalt-proto::MemoryNode          swal-agent-runner types
─────────────────────────          ──────────────────────
id: String                        → id: string
content: String                   → content: string
embedding: Vec<f32>               → embedding?: number[]
degree: f32                       → (not used for working)
layer: HiragLayer                 → (not used for working)
content_hash: String              → contentHash: string (via CrdtMemoryStore)
decay: ForgettingCurve            → (TTL replaces this for working)
created_at: String (RFC3339)      → timestamp: number (epoch ms)
accessed_at: Option<String>       → (not used; TTL handles expiry)
metadata: serde_json::Value       → metadata?: Record<string, unknown>

CrdtMemoryStore adds:
  - projectId (swal-agent-runner specific)
  - source (peer identifier)
  - ttlMs / expiresAt (working memory lifecycle)
  - promotedTo (optional promotion target)
```

## Appendix B: Dependency Graph

```
y-webrtc 10.3.0 ──┬── yjs 13.6.31 ──┬── y-indexeddb 9.0.12
                   │                 └── CrdtMemoryStore (new)
                   │                 └── CrdtGraph (existing)
                   │                 └── CrdtEventBus (existing)
                   │
                   └── peerjs 1.5.5 ──── EdgeMeshClient (existing)
```

## Appendix C: Glossary

| Term | Definition |
|---|---|
| **CRDT** | Conflict-free Replicated Data Type — data structure that converges across peers without coordination |
| **Yjs** | CRDT library used in swal-agent-runner |
| **y-webrtc** | WebRTC transport for Yjs — syncs Y.Doc between browser peers |
| **Y.Map** | Yjs shared map type — key-value store with LWW conflict resolution |
| **y-indexeddb** | Yjs persistence adapter — saves Y.Doc to IndexedDB |
| **content_hash** | SipHash of memory content for dedup (gestalt-proto compatible) |
| **TTL** | Time-to-live — working memory expires after this duration |
| **Promotion** | Converting a working memory to episodic/semantic format and syncing to Xavier |
| **HiRAG** | Hierarchical Retrieval-Augmented Graph (gestalt graph architecture) |

---

*End of Design Document*
