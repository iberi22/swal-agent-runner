# 🚀 SWAL Agent Runner (`swal-agent-runner`)

[![CI Status](https://img.shields.io/github/actions/workflow/status/swal-labs/swal-agent-runner/ci.yml?branch=main&style=flat-square)](https://github.com/swal-labs/swal-agent-runner/actions)
[![Protocol Version](https://img.shields.io/badge/SWAL%20GitCore-v3.9.0-blue?style=flat-square)](https://github.com/swal-labs/swal-agent-runner)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square)](CONTRIBUTING.md)
[![Platform Parity](https://img.shields.io/badge/Platform-PC%20%26%20Android%20Chrome-orange?style=flat-square)](https://github.com/swal-labs/swal-agent-runner)

> **Sovereign Agent Development & Memory Node PWA**
> *Part of the Southwest AI Labs (SWAL) Software & Intelligence Network*

`swal-agent-runner` is an autonomous coding agent execution workspace and distributed memory node. Built as an installable Progressive Web App (PWA), it runs on both desktop PCs and Android mobile devices with 100% feature parity.

It turns your phone, tablet, or desktop browser tab into a self-contained "Jules/Devin-style" autonomous developer:
- 🚫 **No IDE / Code Editor required**
- 🚫 **No interactive terminal required**
- 📥 **Task-driven dashboard UI**: Enter task → Agent executes → Inspect diff & test results → Push commit

---

## 🌟 Key Features

1. **In-Browser Git Workspace**:
   - Shallow clone repositories into IndexedDB via `isomorphic-git` and `@isomorphic-git/lightning-fs`.
   - Complete support for mobile browsers (bypasses missing File System Access APIs).

2. **Headless Execution Engine**:
   - Programmatic Node.js execution via WebContainers (`@webcontainer/api`).
   - Runs npm installs, test suites, and build scripts invisibly.

3. **Multi-LLM Provider & Auth**:
   - **Google AI Pro / One Ultra OAuth2**: Login directly with your Google account via PKCE OAuth2 flow to utilize Gemini 2.5 Pro & Gemini 3 Pro subscriptions.
   - **Google Gemini API**: Direct API key support.
   - **OpenRouter**: Unified access to Claude 3.5, DeepSeek R1/V3, Llama 3.3, Qwen 2.5.
   - **OpenCodeGo & Custom API Keys**: OpenAI-compatible custom endpoints.

4. **Xavier Local Memory Node & Real-Time Sync**:
   - Acts as a local memory core powered by IndexedDB (`src/services/memory/xavier-memory-node.ts`).
   - Pairs in real time with the primary workstation Xavier node (`http://localhost:8006`) via `EdgeMeshSyncService` (`src/services/memory/edge-mesh-sync.ts`) — HTTP `/health` + `/api/v1/memory/sync`, with `edge-mesh` WebRTC P2P as the mesh transport — to synchronize context, vector memories, and execution logs.
   - Default peer endpoint: `http://localhost:8006` (overridable in UI / `localStorage` key `swal_xavier_peer_endpoint`).

---

## 📸 Dashboard Preview

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ 🚀 SWAL AGENT RUNNER                                      [PAIR: CONNECTED] │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌───────────────────────┐   ┌───────────────────────────────────────────┐  │
│  │ 📁 Projects           │   │ 📝 Active Task: Implement tests           │  │
│  ├───────────────────────┤   ├───────────────────────────────────────────┤  │
│  │ ▶ my-react-app        │   │ Status: Running (Iteration 4/20)          │  │
│  │ 📦 express-api        │   │ Current File: src/services/git-sync.ts    │  │
│  │ ⚙️ memory-node-config  │   │                                           │  │
│  └───────────────────────┘   │ [PLAN]   1. Read git-sync-service.ts      │  │
│                              │ [TOOL]   read_file("src/git-sync.ts")     │  │
│  ┌───────────────────────┐   │ [OUTPUT] Successfully read 142 lines      │  │
│  │ 🧠 Xavier Memory      │   │ [PLAN]   2. Edit sync queue function      │  │
│  ├───────────────────────┤   │ [TOOL]   write_file("src/git-sync.ts",..) │  │
│  │ Episodic:  12 chunks  │   ├───────────────────────────────────────────┤  │
│  │ Semantic:  54 chunks  │   │ 📋 Console & Progress Output              │  │
│  │ Sync Queue: [Pending] │   │ ■■■■■■■■■■■■■■■□□□□□ [75%]                │  │
│  └───────────────────────┘   └───────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🛠️ Quick Start

Follow these simple steps to run your own local instance of the PWA development node:

### 1. Clone the Repository
```bash
git clone https://github.com/swal-labs/swal-agent-runner.git
cd swal-agent-runner
```

### 2. Install Dependencies
```bash
# Recommended package manager: pnpm
pnpm install

# Alternatively, using npm
npm install
```

### 3. Run Development Server
```bash
pnpm run dev
```
> **Note:** The development server automatically starts with `Cross-Origin-Embedder-Policy: require-corp` and `Cross-Origin-Opener-Policy: same-origin` headers. These headers are strictly required by `@webcontainer/api` to enable `SharedArrayBuffer` support in modern web browsers.

---

## 🏗️ Architecture Overview

`swal-agent-runner` utilizes a highly decoupled multi-layered architecture designed to run complex development workloads entirely inside a web browser.

```
┌────────────────────────────────────────────────────────────────────────────┐
│                        FRONTEND UI (React 19 + Tailwind v4)                │
│   ProjectsView │ NewTaskView │ TaskProgressView │ TaskResultView │ AuthView │
└─────────────────────────────────────┬──────────────────────────────────────┘
                                      │
┌─────────────────────────────────────▼──────────────────────────────────────┐
│                         AUTONOMOUS REACTION AGENT                          │
│          ReAct Planner Loop │ Tool Executor │ Progress Telemetry           │
└──────────┬──────────────────────────┬──────────────────────────┬───────────┘
           │                          │                          │
┌──────────▼───────────┐   ┌──────────▼───────────┐   ┌──────────▼───────────┐
│ MULTI-LLM MANAGER    │   │ WEBCONTAINER RUNTIME │   │ XAVIER MEMORY NODE   │
│ - Google AI Pro OAuth│   │ - Headless Wasm Exec │   │ - Local Vector DB    │
│ - Gemini API         │   │ - Process Supervisor │   │ - edge-mesh P2P Pair │
│ - OpenRouter API     │   │ - LightningFS Mount  │   │ - PC Sync Manager    │
│ - OpenCodeGo API     │   └──────────────────────┘   └──────────────────────┘
└──────────────────────┘
```

### Core Architecture Components

*   **React 19 Frontend Dashboard:** Implements the 4 core screens—*Projects*, *New Task*, *Task Progress*, and *Results & Diff Review*—responsive for desktop and mobile PWA.
*   **Autonomous ReAct Agent Loop:** Evaluates agent goals, synthesizes planning steps, runs tool executions, processes feedback, and creates commit branches sequentially.
*   **Headless WebContainer Execution Engine:** Spawns programmatic, fully-isolated sandboxed container runtimes natively in-browser. Capable of executing commands like `npm install`, testing, or building assets without user shell intervention.
*   **Xavier Local Memory Node:** Backed by IndexedDB via `idb` for multi-store hierarchical agent memory (Episodic, Semantic, Procedural, Working). Synchronizes in real-time via `y-webrtc` / peer mesh sync with workstation hosts.
*   **Multi-Provider LLM Router:** Configures and authenticates connections to external model endpoints seamlessly, incorporating direct API keys, PKCE-based Google OAuth2 flows, and OpenAI-compatible proxies.

---

## 🧪 Testing & Quality

```bash
pnpm run test    # Vitest unit + integration (378 tests) — WebContainer is mocked
pnpm run build   # tsc + Vite production build + PWA service worker
pnpm run lint    # Requires ESLint config (not yet shipped; CI skips when absent)
pnpm run test:e2e  # Playwright — needs browser; not required for local unit CI
```

**WebContainer note:** `test/webcontainer-runner.test.ts` and related Vitest suites mock `@webcontainer/api`. They do **not** boot a real WebContainer. Real container boots need a secure context with COEP/COOP (`pnpm run dev`) and a browser that supports `SharedArrayBuffer`.

## 📚 Technical Documentation & Protocol References

This project strictly adheres to the **SWAL GitCore Protocol v3.9.0**:

*   **[docs/getting-started.md](docs/getting-started.md) — Comprehensive Getting Started & User Guide** 👈 Start here!
*   **[docs/deployment.md](docs/deployment.md) — Production Deployment, Configuration, Monitoring & Troubleshooting Guide**
*   **[AGENTS.md](AGENTS.md) — Developer guidelines & agent operational rules**
*   **[SRC.md](SRC.md) — Project source code reference & directory mappings**
*   **[.gitcore/ARCHITECTURE.md](.gitcore/ARCHITECTURE.md) — Core architectural invariants**
*   **[docs/SRS/index.md](docs/SRS/index.md) — Software Requirements Specification Overview**
*   **[docs/SRS/REQUIREMENTS.md](docs/SRS/REQUIREMENTS.md) — Detailed functional requirements & acceptance criteria**
*   **[docs/feedback/](docs/feedback/) — Persisted agent/user reality audits**

---
*SWAL GitCore Protocol v3.9.0*
