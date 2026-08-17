# AGENTS.md — SWAL Agent Runner (`swal-agent-runner`)

> **Protocol Version:** 3.9.0  
> **Node Role:** SWAL Development & Memory Edge Node (Browser PWA + WebContainer + Xavier P2P)

## SWAL Ecosystem & Component Map

### GOAL
`swal-agent-runner` is the sovereign PWA developer edge node in the Southwest AI Labs (SWAL) ecosystem. It provides an autonomous coding workspace and distributed memory peer that executes ReAct and Foreman agent loops directly inside modern web browsers (desktop PCs and mobile devices) with zero native desktop dependencies.

### PROJECT_MAP
- `src/agent/`: Autonomous agent loops (`agent-loop.ts`, `agent-tools.ts`, `foreman-loop.ts`).
- `src/services/llm/`: Multi-provider LLM manager and OAuth2 PKCE clients (`llm-provider-manager.ts`, `gemini-oauth.ts`).
- `src/services/git/`: In-browser Git operations via `isomorphic-git` (`git-service.ts`, `git-sync-service.ts`).
- `src/services/memory/`: Embedded Xavier local memory node (`xavier-memory-node.ts`, `edge-mesh-sync.ts`).
- `src/services/mesh/`: WebRTC / PeerJS / Yjs P2P CRDT mesh network (`edge-mesh-client.ts`, `crdt-sync.ts`, `crdt-event-bus.ts`, `crdt-memory-store.ts`).
- `src/services/runtime/`: Sandboxed execution environments (`webcontainer-runner.ts`, `python-runner.ts`).
- `src/components/`: React 19 UI dashboard views (`ProjectsView`, `NewTaskView`, `TaskProgressView`, `TaskResultView`, `MeshPanel`).
- `.gitcore/`: SWAL GitCore protocol state (`ARCHITECTURE.md`, `features.json`, `docs/SWAL_GOAL.md`).
- `docs/`: SRS requirements, design documents, and architecture specifications.

### Xavier Namespace & Integration
- Embedded Xavier memory core (`src/services/memory/xavier-memory-node.ts`).
- Real-time HTTP & WebRTC P2P sync with primary workstation Xavier core (`apps/xavier` at `http://localhost:8006`).
- Automatic offline fallback to local IndexedDB (`isar_agent_memory` compatible schema).

### Edge Mesh Network
- PeerJS 1:1 and `y-webrtc` multi-peer room mesh (`src/services/mesh/`).
- Real-time CRDT event bus and working memory state replication over Yjs shared types.

### GitCore Governance
- Strictly tracks feature implementation status in `.gitcore/features.json` schema v2.
- Maintains 100% alignment between SRS requirements (`docs/SRS/REQUIREMENTS.md`) and code implementations.

---

## Context & Read Order

Agents working on this codebase MUST read files in the following strict order:
1. `AGENTS.md` (this file)
2. `SRC.md` (complete source code reference & architecture map)
3. `.gitcore/ARCHITECTURE.md` (core architectural invariants)
4. `.gitcore/docs/SWAL_GOAL.md` (local copy of canonical SWAL GOAL)
5. `docs/SRS/index.md` & `docs/SRS/REQUIREMENTS.md` (software requirements & feature mapping)
6. `.gitcore/features.json` & `.gitcore/planning/tasks.json` (active tasks)

---

## Agent Operational Rules

1. **Protocol Compliance**:
   - Maintain 100% synchronization between `docs/SRS/REQUIREMENTS.md` and codebase implementations.
   - All code edits must preserve PWA cross-platform parity (PC Desktop & Android Chrome standalone PWA).
   - Never rely on Desktop-only APIs (`showDirectoryPicker`). Use `isomorphic-git` + `LightningFS` (IndexedDB) for repository management.

2. **Xavier Memory Node Integration**:
   - The embedded Xavier memory core (`src/services/memory/xavier-memory-node.ts`) plus HTTP/P2P sync (`src/services/memory/edge-mesh-sync.ts`) act as the local memory node.
   - Syncs in real time with the primary workstation Xavier node (`http://localhost:8006` or via `edge-mesh` WebRTC P2P) when paired.
   - Fallbacks gracefully to local IndexedDB (`isar_agent_memory` compatible schema) when offline.

3. **Multi-LLM Provider Governance**:
   - Support OpenRouter (`openrouter.ai/api/v1`), OpenCodeGo / custom OpenAI-compatible endpoints, Anthropic, and Google Gemini.
   - Support Google AI Pro / Gemini OAuth2 (PKCE flow) alongside direct API Key configuration.
   - Protect user tokens in encrypted local storage (`localStorage`/`IndexedDB` with user session keying).

4. **Headless Execution**:
   - WebContainers run in headless mode without terminal/editor clutter.
   - Agent operates via ReAct loop: `Plan → Read → Edit → Command Exec → Verify → Commit`.

---

## Core Commands

```bash
# Install dependencies
pnpm install

# Start local dev server with COEP/COOP headers
pnpm run dev

# Build production bundle & PWA service worker
pnpm run build

# Run unit & integration tests
pnpm run test
```

---
*SWAL GitCore Protocol v3.9.0*
