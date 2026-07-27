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
│   └── SRS/
│       ├── ARCHITECTURE.md
│       ├── REQUIREMENTS.md
│       └── index.md
├── public/
│   ├── icon-192.png
│   ├── icon-512.png
│   └── manifest.json
├── src/
│   ├── agent/
│   │   ├── agent-loop.ts
│   │   └── agent-tools.ts
│   ├── components/
│   │   ├── AuthSettingsModal.tsx
│   │   ├── MemorySyncPanel.tsx
│   │   ├── NewTaskView.tsx
│   │   ├── ProjectsView.tsx
│   │   ├── TaskProgressView.tsx
│   │   └── TaskResultView.tsx
│   ├── services/
│   │   ├── git/
│   │   │   └── git-service.ts
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
│   │   └── runtime/
│   │       └── webcontainer-runner.ts
│   ├── types/
│   │   └── index.ts
│   ├── App.tsx
│   ├── index.css
│   ├── main.tsx
│   ├── sw.ts
│   └── vite-env.d.ts
├── AGENTS.md
├── INDEX.html
├── PROJECT_README.md
├── README.md
├── SRC.md
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## 3. Core Components Table

| Component | Path | Purpose |
|---|---|---|
| **Agent Planner & Loop** | `src/agent/agent-loop.ts` | ReAct decision loop (Plan → Act → Observe → Report) |
| **Agent Tools** | `src/agent/agent-tools.ts` | Headless execution primitives (read, write, run, diff, memory) |
| **LLM Provider Manager** | `src/services/llm/llm-provider-manager.ts` | Multi-LLM provider abstraction & key/token management |
| **Gemini OAuth2 PKCE** | `src/services/llm/providers/gemini-oauth.ts` | Google AI Pro OAuth2 PKCE authentication flow handler |
| **OpenRouter Provider** | `src/services/llm/providers/openrouter-provider.ts` | OpenRouter unified LLM API client |
| **OpenCodeGo Provider** | `src/services/llm/providers/opencode-provider.ts` | OpenAI-compatible custom API endpoint handler |
| **Git Workspace Service** | `src/services/git/git-service.ts` | `isomorphic-git` clone/commit/diff/push engine |
| **Xavier Memory Node** | `src/services/memory/xavier-memory-node.ts` | Local IndexedDB vector memory store |
| **edge-mesh P2P Sync** | `src/services/memory/edge-mesh-sync.ts` | Real-time WebRTC pairing with PC Xavier master node |
| **WebContainer Runner** | `src/services/runtime/webcontainer-runner.ts` | Programmatic Wasm Node.js process executor |

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
