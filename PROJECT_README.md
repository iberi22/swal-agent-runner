# 🚀 SWAL Agent Runner (`swal-agent-runner`)

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
   - Acts as a local memory core powered by IndexedDB.
   - Pairs in real time with the primary workstation Xavier node (`http://localhost:8006`) via `edge-mesh` WebRTC P2P to synchronize context, vector memories, and execution logs.

---

## 🛠️ Getting Started

```bash
# Clone the repository
git clone https://github.com/swal-labs/swal-agent-runner.git
cd swal-agent-runner

# Install dependencies
npm install

# Start dev server (includes COEP/COOP headers for WebContainers)
npm run dev

# Build PWA production bundle
npm run build
```

---

## 📜 Protocol & Documentation

This project strictly adheres to the **SWAL GitCore Protocol v3.9.0**:
- [AGENTS.md](file:///home/belal/proyectosSWAL/swal-agent-runner/AGENTS.md) — Agent guidelines & operational rules
- [SRC.md](file:///home/belal/proyectosSWAL/swal-agent-runner/SRC.md) — Source code reference
- [.gitcore/ARCHITECTURE.md](file:///home/belal/proyectosSWAL/swal-agent-runner/.gitcore/ARCHITECTURE.md) — Architectural invariants
- [docs/SRS/index.md](file:///home/belal/proyectosSWAL/swal-agent-runner/docs/SRS/index.md) — Software Requirements Specification

---
*SWAL GitCore Protocol v3.9.0*
