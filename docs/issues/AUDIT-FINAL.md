# [AUDIT-FINAL] Architectural Audit — Decoupled Storage & P2P Traversal Technical Debt

**Type:** `audit`
**Phase:** 6/Final
**Status:** Open
**Created:** 2026-07-29
**Auditor:** Kimi K3 High / SWAL Hermes Agent
**Label:** `audit`

---

## Overview

The final architectural audit of the `swal-agent-runner` codebase shows high feature completeness and extremely high testing standards (336 tests, 100% passing, 63% mutation coverage). However, three areas of technical debt are identified as open issues for the next iteration (Phase 5/6+ execution).

---

## Issue 1: O(N) Traversal on Graph Edge Cleanup (`crdt-graph.ts`)

### Description
In `src/services/mesh/crdt-graph.ts`, deleting a `MemoryChunk` triggers an edge cleanup cascade. The algorithm iterates over the entire Y.Map of edges sequentially. At scale (more than 10,000 memories or inter-agent communication channels), this O(N) iteration blocks the browser's single thread of execution, leading to UI freezing and frame-drops.

```typescript
// Current implementation snippet:
doc.transact(() => {
  edgesMap.forEach((edge, key) => {
    if (edge.source === chunkId || edge.target === chunkId) {
      edgesMap.delete(key);
    }
  });
});
```

### Recommendation
Introduce a reverse index mapping chunk IDs to their associated edge keys, or maintain localized adjacency lists on each node, making removal complexity O(1).

---

## Issue 2: WebRTC Signaling NAT Traversal Limitations (`edge-mesh-client.ts`)

### Description
`EdgeMeshClient` uses public STUN/TURN servers by default. In highly restrictive NAT topologies (symmetric cellular NAT, corporate intranets, or strict firewalls), direct WebRTC data connections are blocked, leaving the node isolated and paired status stuck at `connecting`.

### Recommendation
Provide settings input elements to define dynamic custom STUN and TURN server arrays in `MeshPanel.tsx` and the user settings panel, and implement fallback WebSocket relay capabilities.

---

## Issue 3: Missing Quota Boundary Check on Pyodide Mounting (`python-runner.ts`)

### Description
The Pyodide WASM runtime mounts project files before running. However, if the virtual storage limit of the device or the browser is reached during complex multi-agent execution runs, Pyodide throws unhandled exceptions during mounting.

### Recommendation
Wrap the file mounting sequence in a quota pre-check using `navigator.storage.estimate()` and handle low-space conditions gracefully.

---
