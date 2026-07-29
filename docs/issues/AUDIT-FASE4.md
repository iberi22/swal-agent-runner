# [AUDIT-FASE4] Quality Review — Edge Mesh + PWA Agentic

**Type:** `audit`
**Phase:** 4
**Status:** Open
**Created:** 2026-07-29
**Auditor:** Kimi K3 High

---

## Overview

Phase 4 integrates Edge Mesh (P2P transport via PeerJS) + PWA Agentic (CRDT sync via Yjs, offline-first, agent event bus). The phase adds **14+ files** across 4 domains: mesh P2P, CRDT sync, offline-first persistence, and agent-loop integration.

---

## Scope (14 files audited)

| Domain | Files | Lines |
|--------|-------|-------|
| **Mesh Transport** | `transport.ts`, `yjs-adapter.ts`, `edge-mesh-client.ts`, `index.ts` | 340 |
| **CRDT Graph** | `crdt-graph.ts` | 174 |
| **CRDT EventBus** | `crdt-event-bus.ts` | 109 |
| **CRDT Sync Init** | `crdt-sync.ts`, `y-webrtc.d.ts` | 77 |
| **Offline-First** | `sync-queue.ts`, `offline-manager.ts`, `storage-estimate.ts`, `index.ts` | 188 |
| **Agent Loop Integration** | `agent-loop.ts` (modified) | 202 |
| **React Hooks/UI** | `useCrdtEvents.ts`, `PairingView.tsx` | 200 |
| **PWA Config** | `sw.ts` (modified), `vite.config.ts` (modified), `App.tsx` (modified) | 286 |

---

## 1. Transporte P2P (transport.ts) — ✅ BUENO

| Check | Status | Details |
|-------|--------|---------|
| ITransport interface | ✅ | Clean EventTarget-based dispatch pattern |
| PeerJSTransport dynamic import | ✅ | `(await import('peerjs')).default` in separate `.iniciar()` |
| MemoryTransport | ✅ | Useful for testing — bidirectional peer map |
| Event dispatch | ✅ | `conectado`, `desconectado`, `mensaje`, `error` |
| Error handling | ⚠️ | PeerJS error events dispatched but no reconnection logic |
| Type safety | ⚠️ | Multiple `as never` casts on `on()`/`off()` |

### Issues:
- **Missing reconnection strategy**: PeerJS auto-reconnect not configured — if connection drops, `enviar()` reconnects but with no backoff
- **Type-unsafe casts**: `this.transport.on('conectado', this.onPeerConnected as never)` — suppresses legitimate type errors

---

## 2. CRDT Graph (crdt-graph.ts) — ✅ SÓLIDO

| Check | Status | Details |
|-------|--------|---------|
| Y.Map observe reactivo | ✅ | Correct `event.keys` iteration for add/update/delete |
| Cascade edge cleanup | ✅ | `removeChunk()` iterates all edges and deletes related ones |
| MemoryChunk compatibility | ✅ | `toSerialized`/`fromSerialized` pattern with full field mapping |
| Sync snapshot | ✅ | `toJSON()` for state transfer |
| Subscribe/unsubscribe | ✅ | Set-based listener pattern with returned cleanup fn |

### Issues:
- **O(n) cleanup**: Edge cascade iterates the entire Y.Map — at scale (>10K edges), this could block. Consider Y.Map index or reverse lookup map
- **Type assertion**: `category as MemoryChunk['category']` in `fromSerialized` could hide deserialization bugs from corrupted Yjs state
- **No edge:update event**: chunks emit `chunk:updated` but edges only emit `edge:added`/`edge:removed` — inconsistent

---

## 3. CRDT EventBus (crdt-event-bus.ts) — ⚠️ DEAD CODE WARNING

| Check | Status | Details |
|-------|--------|---------|
| Y.Array observe delta | ✅ | Correctly filters only `delta.insert` |
| Auto-truncate | ✅ | `publish()` trims excess when > maxEvents |
| Error-isolated callbacks | ✅ | `try/catch` per callback — excellent! |
| getHistory / getByType | ✅ | Efficient reverse iteration |
| Clear | ✅ | `delete(0, this.events.length)` |

### 🔴 CRITICAL: CrdtEventBus is completely unused

`CrdtEventBus` has **zero consumers**:

| Consumer | What it actually uses | Problem |
|----------|----------------------|---------|
| `agent-loop.ts` | Inline `publishEvent()` that directly mutates `yjs.getArray('bus:events')` | Duplicates CrdtEventBus logic; no structured event model |
| `useCrdtEvents.ts` | Direct `eventArray.observe()` on the Y.Array | Duplicates CrdtEventBus subscribe pattern |

### What should be done:
1. `agent-loop.ts` should import `CrdtEventBus` from the mesh barrel and call `crdtEventBus.publish()`
2. `useCrdtEvents.ts` should use `crdtEventBus.subscribe()` instead of raw Y.Array observation
3. The inline publish logic (6 event points) should remain but delegate to the bus

---

## 4. Agent-Loop Events (agent-loop.ts:49-67) — ✅ CUBRE LIFECYCLE

| Check | Status | Details |
|-------|--------|---------|
| run:started | ✅ | Published at beginning of execution |
| run:phase | ✅ | Published for initial, planning, executing, verifying |
| step:progress | ✅ | Published per tool invocation |
| run:completed | ✅ | On successful completion |
| run:failed | ✅ | In catch block with error details |
| Fire-and-forget | ✅ | `catch {}` prevents event emission from crashing agent loop |
| Auto-truncate | ⚠️ | `while (events.length > 500) events.delete(0, 1)` is O(n) and race-prone with concurrent peers |

### Issues:
- **O(n) truncation**: Replace with bulk `delete(0, excess)` like CrdtEventBus does
- **Race condition**: Concurrent peer pushes could interleave with the delete loop
- **Redundant code**: `publishEvent()` should delegate to `CrdtEventBus.publish()` instead of reimplementing Y.Array mutation

---

## 5. useCrdtEvents (useCrdtEvents.ts) — ✅ CORRECTO

| Check | Status | Details |
|-------|--------|---------|
| Cleanup de observer | ✅ | `try { unobserve } catch {}` in effect return |
| Filter por tipo | ✅ | Both initial load and delta events filtered |
| Pairing status subscription | ✅ | Via edgeMeshClient.subscribe() |
| Memory safety | ✅ | Uses functional `setEvents(prev => ...)` |
| Initial load | ✅ | Reverses array for newest-first |

### Issues:
- **Should use CrdtEventBus**: See point 3 — the hook reimplements what CrdtEventBus.subscribe() provides
- **Unnecessary closure captures**: `setEvents(prev => [meshEvent, ...prev].slice(0, maxEvents))` creates a new array on every event — fine but could batch via `useReducer` for high-frequency events

---

## 6. Offline-First — ✅ FUNCIONAL CON GAPS

| Check | Status | Details |
|-------|--------|---------|
| SyncQueue retry 5x | ✅ | `op.retries >= 5` marks as failed |
| Storage persist | ✅ | `navigator.storage.persist()` in OfflineManager |
| Storage estimate | ✅ | `getStorageInfo()` helper for UI |
| Online/offline detection | ✅ | `window.addEventListener('online'/'offline')` |
| Subscribe pattern | ✅ | OfflineManager.subscribe() for reactive UI |

### 🔴 ISSUES:
- **SyncQueue is orphaned**: `syncQueue` singleton exported but never imported by any module. `OfflineManager` doesn't call `syncQueue.processAll()` on `'online'` events
- **No Background Sync API**: The queue uses manual polling (`processAll()`), not `navigator.serviceWorker.sync.register()`. This means queued operations only replay when the user triggers something that calls `processAll()` — not automatically on reconnect
- **processAll() is sequential**: Each pending operation is fetched sequentially — could batch parallel requests for independent operations
- **No exponential backoff**: Failed retries retry immediately in sequence — should implement `retryDelay = min(base * 2^retries, 2h)` wait

---

## 7. Service Worker (sw.ts) — ⚠️ DUPLICATE ROUTE WARNING

| Check | Status | Details |
|-------|--------|---------|
| Precache entries | ✅ | 6 assets: index.html, JS, CSS, manifest, registerSW.js |
| Runtime caching strategies | ✅ | StaleWhileRevalidate (static), NetworkFirst (Brave API), NetworkOnly (Xavier), CacheFirst (CDN) |
| Navigation fallback | ✅ | NetworkFirst for navigate requests |
| SKIP_WAITING | ✅ | Handles incoming SW updates |
| `cleanupOutdatedCaches` | ✅ | Present in build output |

### 🔴 ISSUE: injectManifest mode with duplicate runtime routes

The `vite.config.ts` uses `VitePWA()` with an **injectManifest** strategy (because we provide a custom `src/sw.ts`), BUT also configures `workbox.runtimeCaching[]` in the plugin options.

This creates a **dual-route conflict**:
- Routes defined in `sw.ts` (handled by workbox libraries directly)
- Routes generated by `vite-plugin-pwa` from `workbox.runtimeCaching` config

The build output in `dist/sw.js` confirms this — it contains both the custom sw.ts code AND the generated runtime routes. This will cause the same URL pattern to be handled twice, with unpredictable results.

**Fix**: Remove `workbox.runtimeCaching` from `vite.config.ts` since the routes are defined in `sw.ts`. Or remove `src/sw.ts` and use `generateSW` mode with only the plugin config.

---

## 8. Build Output — ✅ BUILD GENERATED

| Check | Status | Details |
|-------|--------|---------|
| Service worker generated | ✅ | `dist/sw.js` with precache + routes |
| Precache entries | ✅ | 6 entries injected |
| Runtime caching | ✅ | 3 route handlers in build output |
| Manifest | ✅ | `manifest.json` with name, icons, display, theme |
| Workbox bundle | ✅ | `dist/workbox-*.js` |

### Observations:
- No TypeScript compilation errors detected during build
- Build produces correct PWA structure with `registerSW.js` for client-side registration

---

## Summary Scorecard

| Domain | Score | Priority Actions |
|--------|-------|-----------------|
| Transport P2P | 🟢 90% | Add reconnection strategy, fix `as never` casts |
| CRDT Graph | 🟢 85% | Optimize edge cascade at scale, add edge:update events |
| CRDT EventBus | 🔴 **DEAD CODE** | Connect to agent-loop.ts and useCrdtEvents.ts, then delete inline implementations |
| Agent Loop Events | 🟢 85% | Replace O(n) truncation with bulk delete |
| useCrdtEvents Hook | 🟢 80% | Refactor to use CrdtEventBus |
| Offline-First | 🟡 65% | Wire SyncQueue into OfflineManager, add Background Sync, exponential backoff |
| Service Worker | 🟡 60% | Resolve injectManifest ↔ workbox.runtimeCaching conflict |
| Build | 🟢 100% | Generated successfully |
| **Tests** | 🔴 **0%** | **Zero tests exist for any Phase 4 module** |

**Overall Phase 4 Quality Score: 70%** — Solid architecture with 3 blocking issues (dead CrdtEventBus, duplicate SW routes, orphaned SyncQueue) and 1 systemic gap (zero tests).

---

## Issues Breakdown (by severity)

### 🔴 Blocker (must fix before Phase 5)
1. **CrdtEventBus dead code** — 2 consumers (agent-loop, useCrdtEvents) bypass the class entirely → refactor to use it
2. **SW route duplication** — injectManifest + runtimeCaching dual config → choose one mode
3. **SyncQueue orphaned** — never wired into OfflineManager → no auto-process on reconnect

### 🟡 Major (fix during Phase 5)
4. **Zero test coverage** — No unit/integration tests for any Phase 4 module
5. **QR code placeholder** — PairingView QR area shows icon but no scannable QR code
6. **O(n) truncation race** — agent-loop's while-loop event trim is inefficient with concurrent peers

### ⚪ Minor (tech debt)
7. `as never` type casts on EventTarget listeners
8. Edge cascade O(n) could be optimized with index
9. No user-facing error feedback in PairingView on connection failure
10. `sync-queue.ts`'s `processAll()` lacks parallel execution and exponential backoff

---

## Recommendations for Next Steps

### Immediate (Phase 4.1 hotfix — 2-3 days)

1. **Fix CrdtEventBus adoption**:
   - Create a singleton `crdtEventBus` instance alongside `edgeMeshClient`
   - Refactor `agent-loop.ts` to use `crdtEventBus.publish()` instead of inline Y.Array mutation
   - Refactor `useCrdtEvents.ts` to use `crdtEventBus.subscribe()` and `getHistory()`
   - Delete the inline `publishEvent()` function from agent-loop.ts

2. **Fix SW route conflict**:
   - Either: Remove `workbox.runtimeCaching` from `vite.config.ts` (keep custom `sw.ts`)
   - Or: Remove `src/sw.ts` and use `generateSW` mode with full plugin config
   - Recommend keeping custom `sw.ts` (injectManifest) and purging plugin runtimeCaching — more control

3. **Wire SyncQueue into OfflineManager**:
   - Call `syncQueue.processAll()` when `'online'` event fires
   - Add exponential backoff (30s, 2min, 5min, 15min, 1h, 2h cap)
   - Add optional Background Sync registration for Chrome

### Phase 5 priorities (recommended)

| Priority | Area | Rationale |
|----------|------|-----------|
| 🥇 | **Agente Autónomo UI (PairingView QR real)** | QR generation needed for production pairing flow |
| 🥇 | **Test Suite** | Phase 4 has 0 tests — blocking quality gate |
| 🥈 | **Edge Mesh hardening** | Reconnection, backpressure, max connections |
| 🥈 | **CrdtGraph edge indexing** | Performance optimization for large graphs |
| 🥉 | **Offline Background Sync** | Service Worker sync event handling |
| 🥉 | **Memory merge resolution** | CRDT LWW semantics for memory chunks |

### Phase 5+ ideas (from architecture docs)

- **F8: Multi-Memory Namespaces** — workspace isolation per app/instance
- **F9: Mesh Privado (Xavier Nodo)** — Xavier as edge-mesh peer with family groups
- **F10: Subscription Layer** — cloud backup + billing integration
- **F11: WASM Target** — Xavier core compiled to wasm32 for in-browser memory

---

## Files Referenced

```
src/services/mesh/transport.ts
src/services/mesh/yjs-adapter.ts
src/services/mesh/edge-mesh-client.ts
src/services/mesh/crdt-graph.ts
src/services/mesh/crdt-event-bus.ts
src/services/mesh/crdt-sync.ts
src/services/mesh/index.ts
src/types/y-webrtc.d.ts
src/components/PairingView.tsx
src/hooks/useCrdtEvents.ts
src/services/offline/sync-queue.ts
src/services/offline/offline-manager.ts
src/services/offline/storage-estimate.ts
src/services/offline/index.ts
src/agent/agent-loop.ts
src/sw.ts
vite.config.ts
src/App.tsx
```

---

*Audited by Kimi K3 High • 2026-07-29 • Hermes Agent*
