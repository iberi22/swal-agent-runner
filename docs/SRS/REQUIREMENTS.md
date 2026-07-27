# Functional Requirements Specification — SWAL Agent Runner

> **Protocol Version:** 3.9.0  
> **Status:** 100% Complete & Synced

## Functional Requirements

### REQ-PWA-01: Cross-Platform PWA & Service Worker
- **Description**: The system must run as an installable Progressive Web App on both PC (Windows/Linux/macOS) and Mobile (Android Chrome standalone / WebAPK).
- **Acceptance Criteria**:
  - Valid `manifest.json` with standalone display mode and maskable icons.
  - Service Worker registers successfully and caches application shell assets.
  - Vite dev server and production build output `Cross-Origin-Embedder-Policy: require-corp` and `Cross-Origin-Opener-Policy: same-origin` headers.
- **Traceability**: `src/sw.ts`, `public/manifest.json`, `vite.config.ts`

### REQ-GIT-02: isomorphic-git IndexedDB Workspace
- **Description**: The system must clone, commit, diff, and push Git repositories without requiring Desktop File System Access APIs.
- **Acceptance Criteria**:
  - Clone shallow repositories into `@isomorphic-git/lightning-fs` backed by IndexedDB.
  - Generate visual file diffs between branches/commits.
  - Perform authenticated `git push` via configurable CORS proxies.
- **Traceability**: `src/services/git/git-service.ts`

### REQ-LLM-03: Multi-Provider LLM & OAuth2 PKCE Engine
- **Description**: The system must route agent requests across Google Gemini, Google AI Pro OAuth2 PKCE, OpenRouter, OpenCodeGo, and custom OpenAI-compatible endpoints.
- **Acceptance Criteria**:
  - Google AI Pro OAuth2 PKCE authorization flow allows logging in with Google accounts and acquiring access tokens for Gemini 2.5/3 models.
  - OpenRouter provider supports model selection (Claude 3.5, DeepSeek R1/V3, Llama 3.3, Qwen 2.5).
  - OpenCodeGo and custom API Key providers support direct endpoint configuration and key persistence.
- **Traceability**: `src/services/llm/llm-provider-manager.ts`, `src/services/llm/providers/`

### REQ-XAV-04: Xavier Local Memory Node & Real-Time Sync
- **Description**: The system must host an embedded Xavier memory core and pair with the primary PC Xavier node for real-time bi-directional synchronization.
- **Acceptance Criteria**:
  - Local IndexedDB memory store supports vector chunking, semantic retrieval, and memory category classification.
  - Pair status indicator shows real-time WebSocket / WebRTC connection to primary PC Xavier node (`http://localhost:8006`).
  - Automatic synchronization flushes pending memory logs upon pairing.
- **Traceability**: `src/services/memory/xavier-memory-node.ts`, `src/services/memory/edge-mesh-sync.ts`

### REQ-RUN-05: Headless WebContainer Execution Engine
- **Description**: The system must boot `@webcontainer/api` instances to execute shell commands, install npm packages, and verify code without terminal UI clutter.
- **Acceptance Criteria**:
  - Programmatic process spawning captures stdout/stderr streams invisibly.
  - File tree mounting synchronizes LightningFS virtual filesystem with WebContainer virtual filesystem.
- **Traceability**: `src/services/runtime/webcontainer-runner.ts`

### REQ-AGT-06: Autonomous ReAct Agent Loop & Control Dashboard
- **Description**: The system must execute multi-step ReAct planning loops (Plan → Tool Exec → Verify → Commit) and expose a 4-screen UI dashboard.
- **Acceptance Criteria**:
  - UI screens: **Projects**, **New Task**, **Task Progress**, **Results & Diff Review**.
  - Structured tools: `read_file`, `write_file`, `run_command`, `search_code`, `list_directory`, `git_diff`, `memory_search`, `complete`.
  - Notifications alert user upon task completion.
- **Traceability**: `src/agent/agent-loop.ts`, `src/agent/agent-tools.ts`, `src/components/`

---
*SWAL GitCore Protocol v3.9.0*
