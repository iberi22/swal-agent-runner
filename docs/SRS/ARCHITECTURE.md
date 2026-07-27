# System Architecture Specification — SWAL Agent Runner

> **Protocol Version:** 3.9.0  
> **Status:** 100% Complete & Synced

## Component Map

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

## Interface Contracts & Data Flow

1. **LLM Provider API**: Abstract provider interface (`LLMProvider`) implementing `chatStream(messages, tools)`.
2. **Git Workspace**: `GitWorkspaceService` exposing `clone()`, `commit()`, `diff()`, and `push()`.
3. **Xavier Pair Protocol**: `XavierMemoryNode` exposing `search()`, `store()`, and `syncWithMasterNode(endpoint)`.

---
*SWAL GitCore Protocol v3.9.0*
