# 🏗️ SWAL Agent Runner — Architectural Diagrams & Technical Design

> **Protocol Version:** v3.9.0
> **Documentation Scope:** System Components, Execution Runtimes, Local Git Workspace, and WebRTC P2P Memory Mesh

This document provides a comprehensive technical overview and visualization of the **SWAL Agent Runner** architecture. As a zero-desktop-dependency Progressive Web App (PWA), the system achieves full PC and mobile parity by operating execution environments, memory systems, and version control entirely within the browser context.

---

## 1. High-Level Component Topology

The architecture is divided into five distinct planes, coordinating local browser capabilities (WebContainers, Pyodide, LightningFS) with decentralized real-time memory synchronization and multi-provider LLM orchestration.

```mermaid
graph TD
    %% Styling and classes
    classDef ui fill:#e3f2fd,stroke:#1565c0,stroke-width:2px,color:#0d47a1;
    classDef core fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px,color:#1b5e20;
    classDef runtime fill:#fff3e0,stroke:#ef6c00,stroke-width:2px,color:#e65100;
    classDef storage fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px,color:#4a148c;
    classDef external fill:#ffebee,stroke:#c62828,stroke-width:2px,color:#b71c1c;

    subgraph UI_Layer ["1. User Interface Plane (React 19 & Tailwind v4)"]
        ProjectsView["ProjectsView<br/>(Repo Dashboard)"]:::ui
        NewTaskView["NewTaskView<br/>(Task Spec & Launcher)"]:::ui
        TaskProgressView["TaskProgressView<br/>(Live Loop Monitor)"]:::ui
        TaskResultView["TaskResultView<br/>(Diff & Commit Review)"]:::ui
        MeshPanel["MeshPanel<br/>(Device & Peer Manager)"]:::ui
        AuthSettingsModal["AuthSettingsModal<br/>(Encrypted Credentials)"]:::ui
    end

    subgraph Core_Plane ["2. Core Agent Control Plane"]
        AgentLoopRunner["AgentLoopRunner<br/>(ReAct Controller Loop)"]:::core
        AgentToolExecutor["AgentToolExecutor<br/>(Tool Command Dispatcher)"]:::core
        LLMProviderManager["LLMProviderManager<br/>(Provider Route & Auth Store)"]:::core
        edgeMeshClient["edgeMeshClient<br/>(Multi-Peer mesh interface)"]:::core
    end

    subgraph Runtime_Plane ["3. Headless Execution Runtimes"]
        WebContainerRunnerService["WebContainerRunner<br/>(WASM Node.js Runtime)"]:::runtime
        PythonRunnerService["PythonRunner<br/>(Pyodide WASM Runtime)"]:::runtime
        GestaltWorker["GestaltWorker<br/>(Web Worker WASM Bridge)"]:::runtime
    end

    subgraph Storage_Plane ["4. Storage & Version Control Plane"]
        GitWorkspaceService["GitWorkspaceService<br/>(Workspace & Git Orchestrator)"]:::storage
        LightningFS["LightningFS<br/>(IndexedDB Virt Filesystem)"]:::storage
        IsomorphicGit["isomorphic-git<br/>(WASM Git Engine)"]:::storage
        XavierMemoryNode["XavierMemoryNode<br/>(IndexedDB Vector Memory)"]:::storage
    end

    subgraph External_Plane ["5. External Integration Plane"]
        RemoteGit["Remote Repository<br/>(GitHub / GitLab)"]:::external
        CorsProxy["SWAL CORS Proxy<br/>(HTTP Gateway)"]:::external
        XavierMaster["Xavier Workstation Master<br/>(Rust / sqlite-vec @ :8006)"]:::external
        LLM_Providers["LLM Providers<br/>(Google AI Pro / OpenRouter / OpenCodeGo)"]:::external
    end

    %% UI Interactions
    ProjectsView --> GitWorkspaceService
    NewTaskView --> AgentLoopRunner
    TaskProgressView --> AgentLoopRunner
    TaskResultView --> GitWorkspaceService
    MeshPanel --> edgeMeshClient
    AuthSettingsModal --> LLMProviderManager

    %% Agent Interactions
    AgentLoopRunner --> LLMProviderManager
    AgentLoopRunner --> AgentToolExecutor
    AgentLoopRunner --> XavierMemoryNode
    AgentLoopRunner --> edgeMeshClient

    %% Tool Dispatch
    AgentToolExecutor --> GitWorkspaceService
    AgentToolExecutor --> WebContainerRunnerService
    AgentToolExecutor --> PythonRunnerService
    AgentToolExecutor --> XavierMemoryNode

    %% Runtime / Storage Interactions
    WebContainerRunnerService -.-> LightningFS : "Sync Files (Mount)"
    GitWorkspaceService --> IsomorphicGit
    IsomorphicGit --> LightningFS

    %% External Connections
    IsomorphicGit --> CorsProxy
    CorsProxy --> RemoteGit
    LLMProviderManager --> LLM_Providers
    XavierMemoryNode --> XavierMaster : "Real-Time / Paired WebRTC Sync"
    edgeMeshClient <--> XavierMaster : "WebRTC edge-mesh Channel"
```

---

## 2. ReAct Agent Loop & Telemetry Flow

The **ReAct Execution Loop** operates autonomously through iterative prompts. It handles tool execution, live telemetry streaming, and updates status values upon completion.

```mermaid
sequenceDiagram
    autonumber
    actor User as User UI (NewTaskView)
    participant Runner as AgentLoopRunner
    participant Memory as XavierMemoryNode
    participant Git as GitWorkspaceService
    participant LLM as LLMProviderManager
    participant Exec as AgentToolExecutor
    participant Mesh as edgeMeshClient (CRDT Event Bus)

    User->>Runner: Launch Task (prompt, project, branch)
    activate Runner
    Runner->>Runner: Update status to 'planning'
    Runner->>Mesh: Publish event 'run:started' & 'run:phase' (planning)

    %% Context Loading
    Runner->>Memory: queryMemory(projectId, prompt)
    Memory-->>Runner: Return semantic memory chunks
    Runner->>Git: createBranch(projectId, targetBranch)
    Git-->>Runner: Checkout target branch in LightningFS

    loop Iterative ReAct Loop (Max 20 Iterations)
        Runner->>Runner: Update status to 'executing'
        Runner->>Mesh: Publish event 'run:phase' (executing)
        Runner->>LLM: executeAgentStep(systemPrompt, conversationHistory, tools)
        activate LLM
        LLM-->>Runner: Return text and/or ToolCalls (e.g., run_command, write_file)
        deactivate LLM

        alt No ToolCalls
            Runner->>Runner: Inject tool usage guidance to conversationHistory
        else Has ToolCalls
            loop For each ToolCall
                Runner->>Mesh: Publish event 'step:progress' (invoking tool)
                Runner->>Exec: executeTool(toolName, arguments)
                activate Exec

                alt Workspace Tool (read_file, write_file, git_diff, list_directory)
                    Exec->>Git: Perform GitFS I/O operation
                    Git-->>Exec: Return File/Diff contents
                else WebContainer Tool (run_command)
                    Exec->>Exec: Mount project files
                    Exec-->>Exec: Spawn process & stream stdout/stderr
                else Python Tool (run_python, pip_install)
                    Exec-->>Exec: Execute code in Pyodide WASM
                else Memory Search Tool (memory_search)
                    Exec->>Memory: Query local memory store
                    Memory-->>Exec: Return matches
                end

                Exec-->>Runner: ToolResult (output, isComplete metadata)
                deactivate Exec
                Runner->>Runner: Append ToolResult to conversationHistory
            end
        end
    end

    %% Task Completion Flow
    rect rgb(230, 245, 230)
        Note over Runner, Mesh: Agent calls 'complete' tool successfully
        Runner->>Runner: Update status to 'verifying'
        Runner->>Mesh: Publish event 'run:phase' (verifying)
        Runner->>Git: commitChanges(projectId, commitMessage)
        Git-->>Runner: Return Commit SHA
        Runner->>Memory: storeChunk(episodic memory)
        Memory-->>Runner: Return Chunk ID
        Runner->>Runner: Trigger background edge-mesh paired sync
        Runner->>Git: getDiff(projectId)
        Git-->>Runner: Return final Diff summary
        Runner->>Runner: Update status to 'completed'
        Runner->>Mesh: Publish event 'run:completed' & 'run:phase' (idle)
    end

    Runner-->>User: Navigate to TaskResultView (Diff Review & Push Button)
    deactivate Runner
```

---

## 3. Git Workspace and Local Filesystem Data Flow

To preserve PWA accessibility on sandbox-constrained environments like Android Chrome, the runner implements a fully simulated local Git filesystem backed by IndexedDB.

```mermaid
graph TD
    subgraph Browser_Sandbox ["Browser Sandbox (PC & Mobile)"]
        UI_Trigger["ProjectsView / TaskResultView"]

        subgraph Git_Workspace_Control ["Git Workspace System"]
            GitService["GitWorkspaceService"]
            IsomorphicGit["isomorphic-git WASM Engine"]
            LightningFS["@isomorphic-git/lightning-fs"]
        end

        subgraph Runtime_Isolation ["Runtime Isolation Plane"]
            WebContainerFS["WebContainer Virtual Filesystem"]
            WebContainerProc["Node.js Process (e.g., npm test)"]
        end

        subgraph Storage_Engine ["Storage Engine"]
            IndexedDB_FS["IndexedDB (LightningFS Tables)"]
        end
    end

    subgraph External_Network ["External Network"]
        Proxy["SWAL CORS Proxy"]
        Remote["Remote Git Repository (GitHub/GitLab)"]
    end

    %% Workflows
    %% Clone/Fetch Flow
    UI_Trigger -->|1. Request Clone| GitService
    GitService -->|2. Command Clone| IsomorphicGit
    IsomorphicGit -->|3. Route Git Protocol| Proxy
    Proxy -->|4. Forward Request| Remote
    Remote -->|5. Return packfile/refs| Proxy
    Proxy -->|6. Unpack| IsomorphicGit
    IsomorphicGit -->|7. Write Files| LightningFS
    LightningFS -->|8. Persist Block-Store| IndexedDB_FS

    %% Command Execution File Sync
    GitService -->|9. run_command Trigger| WebContainerFS
    LightningFS -->|10. Mount Files (Read)| WebContainerFS
    WebContainerFS -->|11. Execute Script| WebContainerProc
    WebContainerProc -->|12. Write Output/Artifacts| WebContainerFS
    WebContainerFS -.->|13. Synchronize Changes| LightningFS

    %% Commit/Push Flow
    UI_Trigger -->|14. Approve Commit & Push| GitService
    GitService -->|15. Stage & Commit| IsomorphicGit
    IsomorphicGit -->|16. Push Command| Proxy
    Proxy -->|17. Authenticated Git Push| Remote
```

---

## 4. Real-Time P2P WebRTC Memory Sync & Mesh Networking

Sovereign memory is managed locally via vector chunks and paired dynamically with the primary desktop workstation via **`edge-mesh` P2P WebRTC connection**, synchronizing Yjs-backed CRDT graphs.

```mermaid
graph TD
    %% Custom Styling
    classDef meshCore fill:#e0f7fa,stroke:#00acc1,stroke-width:2px;
    classDef storageCore fill:#ede7f6,stroke:#5e35b1,stroke-width:2px;
    classDef networkCore fill:#fffde7,stroke:#fbc02d,stroke-width:2px;

    subgraph Local_PWA_Node ["Local PWA Node (Mobile/PC Browser)"]
        DeviceIdentity["DeviceIdentity<br/>(Auto Type Detect & ID)"]:::meshCore

        subgraph Mesh_Stack ["Edge Mesh Stack"]
            EdgeMeshClient["EdgeMeshClient<br/>(y-webrtc multi-peer rooms + PeerJS)"]:::meshCore
            CrdtEventBus["CRDT Event Bus<br/>(Yjs Shared Array Broadcast)"]:::meshCore
            CrdtMemoryStore["CRDT Memory Store<br/>(Yjs Y.Map Store with TTL)"]:::meshCore
            YjsAdapter["YjsAdapter<br/>(Shared State Sync)"]:::meshCore
        end

        subgraph Local_Memory_Db ["Local Memory Database"]
            XavierMemoryNode["XavierMemoryNode"]:::storageCore
            IndexedDB_Memory["IndexedDB (isar_agent_memory)"]:::storageCore
        end
    end

    subgraph Master_Workstation_Node ["Master Workstation Node (Desktop Workstation)"]
        MasterService["Workstation Master Xavier Node<br/>(Rust HTTP/WebSocket Server @ :8006)"]:::networkCore
        SqliteVec["sqlite-vec Database<br/>(Semantic Vector Index)"]:::networkCore
    end

    %% Connections
    DeviceIdentity --> EdgeMeshClient
    EdgeMeshClient --> CrdtEventBus
    EdgeMeshClient --> CrdtMemoryStore
    CrdtEventBus --> YjsAdapter
    CrdtMemoryStore --> YjsAdapter

    XavierMemoryNode --> IndexedDB_Memory
    XavierMemoryNode -->|Real-time Paired Push/Pull| EdgeMeshClient

    %% P2P Bridge
    EdgeMeshClient <-->|WebRTC DataChannel / Signaling| MasterService
    XavierMemoryNode <-->|Fallthrough REST API Pair| MasterService
    MasterService --> SqliteVec
```

---

## 5. Multi-LLM Routing and Token Flow

The Multi-LLM Engine provides adaptive routing across providers, managing PKCE OAuth2 flows, API keys, and model configuration securely.

```mermaid
flowchart TD
    %% Styles
    classDef manager fill:#eceff1,stroke:#546e7a,stroke-width:2px;
    classDef providers fill:#e0f2f1,stroke:#00695c,stroke-width:2px;
    classDef ext fill:#fff3e0,stroke:#e65100,stroke-width:2px;

    subgraph Secure_Config_Scope ["Secure Browser Configuration Context"]
        LLMManager["LLMProviderManager<br/>(Get Active Provider & Route API Calls)"]:::manager
        EncryptedStore["Browser Encrypted LocalStorage<br/>(Encrypted Provider API Tokens)"]:::manager
    end

    subgraph Internal_Providers ["Internal Provider Clients"]
        GeminiOAuth["GeminiOAuthProvider<br/>(Google AI Pro)"]:::providers
        GeminiDirect["GeminiProvider<br/>(Direct API Key)"]:::providers
        OpenRouter["OpenRouterProvider<br/>(Unified Endpoint)"]:::providers
        OpenCodeGo["OpenCodeProvider<br/>(OpenAI-Compatible Custom)"]:::providers
    end

    subgraph Authentication_Endpoints ["Authentication & OAuth2 PKCE Endpoints"]
        GoogleOAuth2["Google Accounts OAuth2 v2<br/>(PKCE Verification Code Flow)"]:::ext
    end

    subgraph External_LLM_APIs ["External LLM API Endpoints"]
        GeminiProAPI["Gemini API Endpoint<br/>(gemini-2.5-pro / gemini-3-pro)"]:::ext
        OpenRouterAPI["OpenRouter API Gateway<br/>(Claude 3.5 / DeepSeek R1 / Qwen Coder)"]:::ext
        CustomAPI["Custom Endpoint Gateway<br/>(Self-Hosted / OpenCodeGo)"]:::ext
    end

    %% Lookups
    LLMManager -->|1. Retrieve API key/Token| EncryptedStore
    EncryptedStore -->|2. Return credentials| LLMManager

    %% Routing Decision
    LLMManager -->|Route to Google AI Pro| GeminiOAuth
    LLMManager -->|Route to Gemini API| GeminiDirect
    LLMManager -->|Route to OpenRouter| OpenRouter
    LLMManager -->|Route to Custom API| OpenCodeGo

    %% OAuth2 PKCE Login flow
    GeminiOAuth <-->|Interactive OAuth2 Grant| GoogleOAuth2
    GoogleOAuth2 -->|Returns Bearer Token| GeminiOAuth

    %% Remote API Dispatch
    GeminiOAuth -->|Authorized Bearer Header| GeminiProAPI
    GeminiDirect -->|Direct GEMINI_API_KEY Header| GeminiProAPI
    OpenRouter -->|Direct OpenRouter Bearer Token| OpenRouterAPI
    OpenCodeGo -->|Custom Auth Headers| CustomAPI
```

---
*SWAL GitCore Protocol v3.9.0*
