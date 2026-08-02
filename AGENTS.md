# AGENTS.md — SWAL Agent Runner (`swal-agent-runner`)

> **Protocol Version:** 3.9.0  
> **Node Role:** SWAL Development & Memory Edge Node (Browser PWA + WebContainer + Xavier P2P)

## Context & Read Order

Agents working on this codebase MUST read files in the following strict order:
1. `AGENTS.md` (this file)
2. `SRC.md` (complete source code reference & architecture map)
3. `.gitcore/ARCHITECTURE.md` (core architectural invariants)
4. `docs/SRS/index.md` & `docs/SRS/REQUIREMENTS.md` (software requirements & feature mapping)
5. `.gitcore/features.json` & `.gitcore/planning/tasks.json` (active tasks)

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
npm install

# Start local dev server with COEP/COOP headers
npm run dev

# Build production bundle & PWA service worker
npm run build

# Run unit & integration tests
npm run test
```

---
*SWAL GitCore Protocol v3.9.0*
