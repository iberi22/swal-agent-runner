# 🏗️ .gitcore/ARCHITECTURE.md — SWAL Agent Runner Architectural Decisions

## Architectural Vision

`swal-agent-runner` is a sovereign, zero-desktop-dependency PWA that acts as an autonomous coding agent execution node and distributed memory peer in the SWAL ecosystem.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    SWAL AGENT RUNNER PWA (PC & Mobile)                      │
│                                                                             │
│  ┌──────────────────────┐  ┌──────────────────────┐  ┌───────────────────┐  │
│  │   UI & Task Panel    │  │ Headless Agent Loop  │  │  Xavier Memory    │  │
│  │ (Projects/Tasks/Diff)│  │ (ReAct Planner/Exec) │  │  (Isar/IndexedDB) │  │
│  └──────────┬───────────┘  └──────────┬───────────┘  └─────────┬─────────┘  │
│             │                         │                        │            │
│  ┌──────────▼─────────────────────────▼────────────────────────▼─────────┐  │
│  │                     MULTI-LLM ROUTER ENGINE                          │  │
│  │  (Google AI Pro OAuth2 / Gemini / OpenRouter / OpenCodeGo / Custom)  │  │
│  └────────────────────────────────────┬──────────────────────────────────┘  │
│                                       │                                     │
│  ┌────────────────────────────────────▼──────────────────────────────────┐  │
│  │                HEADLESS RUNTIME & GIT STORAGE PLANE                  │  │
│  │     (WebContainers Wasm + isomorphic-git + LightningFS IndexedDB)     │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────┬─────────────────────────────────────┘
                                        │ (edge-mesh WebRTC P2P Sync)
                                        ▼
                   ┌────────────────────────────────────────┐
                   │    PRIMARY PC XAVIER MEMORY NODE       │
                   │ (Rust, sqlite-vec, HTTP :8006, libp2p) │
                   └────────────────────────────────────────┘
```

## Key Architectural Decisions (Non-Negotiable)

1. **Cross-Platform PWA Parity**:
   - No native Node.js binaries required.
   - Runs in standard modern browsers (Chrome Desktop, Chrome Android WebAPK, Brave, Edge).
   - COEP (`require-corp`) and COOP (`same-origin`) headers enforced via Vite and Service Worker for `SharedArrayBuffer` support (WebContainers).

2. **In-Browser Git Storage & Filesystem**:
   - Repositories are cloned to IndexedDB via `isomorphic-git` and `@isomorphic-git/lightning-fs`.
   - Bypasses the absence of `showDirectoryPicker()` on mobile devices.
   - Local edits are committed locally and pushed to GitHub/GitLab via CORS proxy.

3. **Memory Synchronization Engine (Xavier Pair)**:
   - Contains a local memory store compatible with `isar_agent_memory` and Xavier's vector schema.
   - Integrates with `edge-mesh` for real-time WebRTC P2P pairing with the PC Xavier master node (`http://localhost:8006`).
   - Automatically synchronizes memory chunks, task executions, and codebase graphs upon pairing.

4. **Multi-LLM Provider Engine & OAuth2**:
   - **Google AI Pro / Gemini**: Supports OAuth2 PKCE flow (`https://accounts.google.com/o/oauth2/v2/auth`) for direct login with Google AI Pro / One Ultra subscriptions, plus direct API Key input (`GEMINI_API_KEY`).
   - **OpenRouter**: Access to 100+ models via `openrouter.ai/api/v1`.
   - **OpenCodeGo & Custom Providers**: OpenAI-compatible endpoint abstraction for self-hosted or specialized API keys.
   - **Anthropic**: Direct or CORS-proxied API calls.

5. **Headless Operation**:
   - No embedded code editor (Monaco) or interactive terminal (xterm) required in main execution view.
   - The user sees task status, progress indicators, step logs, and complete diff summaries.

---
*SWAL GitCore Protocol v3.9.0*
