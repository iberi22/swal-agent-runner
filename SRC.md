# SRC.md — Source Code Reference

> **Repository:** SWAL Agent Runner (`swal-agent-runner`)  
> **Protocol Version:** 3.9.0  
> **Status:** Mandatory Complete (100%)

---

## 1. Overview & Purpose

`swal-agent-runner` is an autonomous coding agent execution node and distributed memory peer built for Southwest AI Labs (SWAL). Designed as a zero-desktop-dependency PWA, it runs on both desktop PCs and Android mobile devices with 100% feature parity.

It features:
- A headless **ReAct Agent Execution Engine** operating over Node.js WebContainers.
- In-browser **Git repository management** using `isomorphic-git` and `@isomorphic-git/lightning-fs` stored in IndexedDB.
- A **Multi-LLM Provider Engine** supporting:
  - **Google AI Pro / One Ultra** (OAuth2 PKCE authorization flow & Gemini 2.5/3 Pro models)
  - **Google Gemini API** (Direct API keys)
  - **OpenRouter** (Claude, DeepSeek, Llama, Qwen)
  - **OpenCodeGo** & custom OpenAI-compatible API endpoints
- An embedded **Xavier Local Memory Node** with real-time `edge-mesh` P2P memory pairing to the main workstation Xavier instance.

---

## 2. Directory Tree

```
swal-agent-runner/
├── .git-core-protocol-version
├── .gitcore/
│   ├── ARCHITECTURE.md
│   ├── features.json
│   └── planning/
│       └── tasks.json
├── docs/
│   ├── SRS/
│   │   ├── ARCHITECTURE.md
│   │   ├── REQUIREMENTS.md
│   │   └── index.md
│   └── design/
│       ├── MULTI-NODE-GIT-SYNC.md
│       ├── MULTI-PEER-MESH.md
│       ├── DESIGN-pyodide-integration.md
│       ├── crdt-p2p-memory-sync.md
│       └── gestalt-wasm-integration-design.md
├── public/
│   ├── icon-192.png
│   ├── icon-512.png
│   └── manifest.json
├── src/
│   ├── agent/
│   │   ├── agent-loop.ts
│   │   ├── agent-tools.ts
│   │   └── foreman-loop.ts
│   ├── components/
│   │   ├── AuthSettingsModal.tsx
│   │   ├── MemorySyncPanel.tsx
│   │   ├── MeshPanel.tsx
│   │   ├── Navbar.tsx
│   │   ├── NewTaskView.tsx
│   │   ├── PairingView.tsx
│   │   ├── ProjectsView.tsx
│   │   ├── TaskProgressView.tsx
│   │   └── TaskResultView.tsx
│   ├── hooks/
│   │   └── useCrdtEvents.ts
│   ├── lib/
│   │   └── qrcode.ts
│   ├── services/
│   │   ├── gestalt/
│   │   │   ├── gestalt-bridge.ts
│   │   │   └── index.ts
│   │   ├── git/
│   │   │   ├── git-service.ts
│   │   │   └── git-sync-service.ts
│   │   ├── llm/
│   │   │   ├── llm-provider-manager.ts
│   │   │   └── providers/
│   │   │       ├── gemini-oauth.ts
│   │   │       ├── gemini-provider.ts
│   │   │       ├── opencode-provider.ts
│   │   │       └── openrouter-provider.ts
│   │   ├── memory/
│   │   │   ├── edge-mesh-sync.ts
│   │   │   └── xavier-memory-node.ts
│   │   ├── mesh/
│   │   │   ├── crdt-event-bus.ts
│   │   │   ├── crdt-graph.ts
│   │   │   ├── crdt-memory-store.ts
│   │   │   ├── crdt-sync.ts
│   │   │   ├── device-identity.ts
│   │   │   ├── edge-mesh-client.ts
│   │   │   ├── index.ts
│   │   │   ├── transport.ts
│   │   │   ├── yjs-adapter.ts
│   │   │   └── __tests__/
│   │   │       ├── crdt-graph.test.ts
│   │   │       └── transport.test.ts
│   │   ├── offline/
│   │   │   ├── index.ts
│   │   │   ├── offline-manager.ts
│   │   │   ├── storage-estimate.ts
│   │   │   ├── sync-queue.ts
│   │   │   └── __tests__/
│   │   │       └── sync-queue.test.ts
│   │   └── runtime/
│   │       ├── python-runner.ts
│   │       ├── python-runner.test.ts
│   │       ├── webcontainer-runner.ts
│   │       └── index.ts
│   ├── types/
│   │   ├── index.ts
│   │   └── y-webrtc.d.ts
│   ├── wasm/
│   │   └── gestalt-wasm.d.ts
│   ├── workers/
│   │   └── gestalt-worker.ts
│   ├── App.tsx
│   ├── index.css
│   ├── main.tsx
│   ├── test-setup.ts
│   └── vite-env.d.ts
├── test/
│   ├── a11y/
│   │   └── a11y.test.ts
│   ├── visual/
│   │   └── screenshots.test.ts
│   ├── crdt-memory-store.test.ts
│   ├── git-sync-edge.test.ts
│   └── wasm-state.test.ts
├── AGENTS.md
├── CHANGELOG.md
├── INDEX.html
├── PROJECT_README.md
├── README.md
├── SRC.md
├── lighthouserc.json
├── package.json
├── stryker.conf.json
├── tsconfig.json
└── vite.config.ts
```

---

## 3. Core Components Table

| Component | Path | Purpose |
|---|---|---|
| **Agent Planner & Loop** | `src/agent/agent-loop.ts` | ReAct decision loop (Plan → Act → Observe → Report) |
| **Foreman Orchestrator** | `src/agent/foreman-loop.ts` | Multi-agent orchestration: task decomposition, parallel dispatch, branch merging |
| **Agent Tools** | `src/agent/agent-tools.ts` | Headless execution primitives (read, write, run, diff, memory, python) |
| **Gestalt Bridge** | `src/services/gestalt/gestalt-bridge.ts` | Gestalt WASM worker bridge with Proxy pattern, event forwarding |
| **LLM Provider Manager** | `src/services/llm/llm-provider-manager.ts` | Multi-LLM provider abstraction & key/token management |
| **Gemini OAuth2 PKCE** | `src/services/llm/providers/gemini-oauth.ts` | Google AI Pro OAuth2 PKCE authentication flow handler |
| **OpenRouter Provider** | `src/services/llm/providers/openrouter-provider.ts` | OpenRouter unified LLM API client |
| **OpenCodeGo Provider** | `src/services/llm/providers/opencode-provider.ts` | OpenAI-compatible custom API endpoint handler |
| **Git Workspace Service** | `src/services/git/git-service.ts` | `isomorphic-git` clone/commit/diff/push engine |
| **Git Sync Service** | `src/services/git/git-sync-service.ts` | Multi-node git sync: auto-pull/push, conflict detection |
| **Xavier Memory Node** | `src/services/memory/xavier-memory-node.ts` | Local IndexedDB vector memory store |
| **edge-mesh P2P Sync** | `src/services/memory/edge-mesh-sync.ts` | Real-time WebRTC pairing with PC Xavier master node |
| **Device Identity** | `src/services/mesh/device-identity.ts` | Persistent device ID (IndexedDB) with auto type detection |
| **CRDT Event Bus** | `src/services/mesh/crdt-event-bus.ts` | P2P event bus over Yjs shared types |
| **CRDT Memory Store** | `src/services/mesh/crdt-memory-store.ts` | Working memory P2P sync via Y.Map with TTL |
| **Edge Mesh Client** | `src/services/mesh/edge-mesh-client.ts` | Dual-mode mesh: legacy PeerJS 1:1 + y-webrtc multi-peer rooms |
| **MeshPanel UI** | `src/components/MeshPanel.tsx` | Multi-peer mesh management UI (device identity, peer list, room actions) |
| **WebContainer Runner** | `src/services/runtime/webcontainer-runner.ts` | Programmatic Wasm Node.js process executor |
| **Python Runner** | `src/services/runtime/python-runner.ts` | Pyodide WASM Python runtime with pip support |
| **Gesture Worker** | `src/workers/gestalt-worker.ts` | Web Worker for Gestalt WASM engine (MockEngine + WASM loader) |

---

## 4. Build, Run & Test Commands

```bash
# Install dependencies
npm install

# Start Vite dev server with COEP/COOP headers
npm run dev

# Build production bundle with PWA service worker
npm run build

# Preview production build locally
npm run preview

# Run all unit and integration tests (vitest)
npm run test

# Run mutation testing (stryker)
npm run test:mutation

# Run accessibility audit (requires Playwright)
npx playwright test test/a11y/

# Run visual regression tests (requires Playwright)
npx playwright test test/visual/

# Run DAST security scan (requires Docker + OWASP ZAP)
bash test/security/dast.sh

# Run Lighthouse CI performance audit
npx lhci collect
```

---

## 5. Environment Variables

| Variable | Description | Default / Example |
|---|---|---|
| `VITE_CORS_PROXY_URL` | Proxy URL for Git remote operations | `https://cors-proxy.swal.dev` |
| `VITE_GOOGLE_OAUTH_CLIENT_ID` | OAuth2 Client ID for Google AI Pro authentication | `YOUR_CLIENT_ID.apps.googleusercontent.com` |
| `VITE_DEFAULT_XAVIER_PEER` | Target PC Xavier HTTP/WebSocket node endpoint | `http://localhost:8006` |

---

## 6. Cross-Links

- **Architecture Rules:** [.gitcore/ARCHITECTURE.md](file:///home/belal/proyectosSWAL/swal-agent-runner/.gitcore/ARCHITECTURE.md)
- **Feature Manifest:** [.gitcore/features.json](file:///home/belal/proyectosSWAL/swal-agent-runner/.gitcore/features.json)
- **Task List:** [.gitcore/planning/tasks.json](file:///home/belal/proyectosSWAL/swal-agent-runner/.gitcore/planning/tasks.json)
- **Agent Instructions:** [AGENTS.md](file:///home/belal/proyectosSWAL/swal-agent-runner/AGENTS.md)
- **SRS Specifications:** [docs/SRS/index.md](file:///home/belal/proyectosSWAL/swal-agent-runner/docs/SRS/index.md)

---
*SWAL GitCore Protocol v3.9.0*
