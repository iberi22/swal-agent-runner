# Multi-Node Git Sync Workflow — Design Document

**Status:** Draft  
**Author:** Hermes Agent (subagent)  
**Date:** 2026-07-29  
**Target:** swal-agent-runner PWA  
**Depends on:** Multi-Peer Mesh Extension (`docs/design/MULTI-PEER-MESH.md`)

---

## Table of Contents

1. [Problem & Scope](#1-problem--scope)
2. [Current Architecture (Baseline)](#2-current-architecture-baseline)
3. [Target Architecture](#3-target-architecture)
4. [1. Device Identity (IndexedDB)](#4-1-device-identity-indexeddb)
5. [2. Device Registry (Y.Map)](#5-2-device-registry-ymap)
6. [3. Git Sync Workflow (GitHub Bridge)](#6-3-git-sync-workflow-github-bridge)
7. [4. Conflict Detection](#7-4-conflict-detection)
8. [5. UI Considerations](#8-5-ui-considerations)
9. [6. File Island Mapping & Risk Assessment](#9-6-file-island-mapping--risk-assessment)
10. [Implementation Phasing](#10-implementation-phasing)

---

## 1. Problem & Scope

### Problem

Today, each `swal-agent-runner` PWA instance (phone, PC, tablet) operates in complete isolation:

1. **Device identity** is a volatile `Math.random()` string generated on every page load (PairingView line 20) — no persistence means no stable identifier across sessions, no way to attribute work.
2. **Git** pushes independently to GitHub — there is no `pull` operation, no cross-node awareness, no detection of parallel work on the same repo.
3. **No device registry** — nodes have no way to discover each other beyond the 1:1 PeerJS pairing, and that transport doesn't surface a persistent peer list.

### Goal

Enable **N-node git collaboration** where:
- Each device has a **persistent identity** stored in IndexedDB (survives page reloads, service worker updates)
- Devices register in a **shared CRDT-backed directory** (Y.Map over y-webrtc) so every node sees the full mesh
- Git sync flows through **GitHub as a centralized bridge**: NodeA commits → pushes → NodeB pulls → continues work
- Conflicts are detected and surfaced to the user for resolution
- The UI shows all connected devices, their sync state, and pending sync operations

### Non-Goals (Phase 0)

- Not building a custom git merge tool (rely on GitHub conflict markers + user resolution)
- Not replacing isomorphic-git with a different git implementation
- Not implementing automatic conflict resolution (CRDT for code)
- Not removing the 1:1 PeerJS transport (deprecated separately per MULTI-PEER-MESH.md)

---

## 2. Current Architecture (Baseline)

```
┌──────────────────────────────────────────────────────────────┐
│                        Node A (Phone)                         │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ PairingView: myPeerId = 'swal-' + Math.random().slice(2) │ │
│  │   → VOLATILE — regenerated every page load               │ │
│  └──────────────────────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ GitWorkspaceService (static class)                        │ │
│  │  ├─ LightningFS('swal_agent_git_fs') — in-memory+IDB     │ │
│  │  ├─ clone(url, depth=1)                                   │ │
│  │  ├─ commit(message)                                       │ │
│  │  ├─ push(token)                                           │ │
│  │  └─ ✗ NO pull()                                           │ │
│  └──────────────────────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ EdgeMeshClient — 1:1 peer (PeerJS), no mesh registry     │ │
│  └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│                        Node B (PC)                            │
│  Same layout — completely independent LightningFS instance    │
│  → Pushes same GitHub repo independently with NO coordination │
└──────────────────────────────────────────────────────────────┘
```

### Key Files

| File | Lines | Role |
|------|-------|------|
| `src/components/PairingView.tsx` | 138 | Device pairing UI — volatile identity generation |
| `src/services/git/git-service.ts` | 206 | Singleton git service — commit, push, clone, no pull |
| `src/services/git/__tests__/git-service.test.ts` | 73 | Basic tests for file ops |
| `src/services/mesh/edge-mesh-client.ts` | 125 | 1:1 P2P client, no mesh support |
| `src/services/mesh/crdt-sync.ts` | 63 | y-webrtc + y-indexeddb (UNWIRED) |
| `src/services/mesh/index.ts` | 4 | Barrel exports |
| `src/types/index.ts` | 97 | Type definitions (ProjectRepo, XavierPairStatus) |
| `src/App.tsx` | 119 | App shell, OAuth callback, P2P listener wiring |

### Current Identity Weakness

```typescript
// PairingView.tsx line 20
setMyPeerId('swal-' + Math.random().toString(36).slice(2, 10));
```

Problems:
- Regenerated every page load → cannot attribute commits to a specific device
- No stable key for device registry
- No user-friendly name
- No type classification (phone vs PC vs tablet)

### Current Git Weakness

```typescript
// git-service.ts — MISSING:
public static async pullChanges(...) { ... }         // NO PULL
public static async getCommits(...) { ... }           // NO LOG
public static async hasUnpushedCommits(...) { ... }   // NO CHECK
public async syncWithRemote(...) { ... }              // NO SYNC SEQUENCE
```

- `pushChanges` exists but no `pullChanges` → a node cannot receive remote changes
- No `hasUnpushedCommits` → no way to know if local work needs pushing before pulling
- No `fetch` or `log` → cannot inspect remote state before acting

---

## 3. Target Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                    Shared Y.Doc (via y-webrtc room)                  │
│  ┌────────────────────────────────┐   ┌──────────────────────────┐  │
│  │ swal:directory:{deviceId}       │   │ swal:git:locks:{repo}    │  │
│  │ → { deviceId, name, type,       │   │ → { deviceId, acquired, }│  │
│  │     lastHeartbeat, nodeId }      │   └──────────────────────────┘  │
│  └────────────────────────────────┘   ┌──────────────────────────┐  │
│                                       │ swal:git:syncQueue         │  │
│  ┌────────────────────────────────┐   │ → Y.Array<SyncOperation>  │  │
│  │ swal:registry:repos:{repoId}   │   └──────────────────────────┘  │
│  │ → { ref, lastKnownCommit }     │                                 │
│  └────────────────────────────────┘                                 │
└────────────────────────────────────────────────────────────────────┘
          ▲ y-webrtc mesh syncs doc ▲          ▲ y-webrtc syncs doc ▲
          │                         │          │                    │
┌─────────┴──────────┐  ┌──────────┴────────┐  ┌──────────────────┴──┐
│   Node A (Phone)    │  │  Node B (PC)      │  │  Node C (Tablet)   │
│                     │  │                   │  │                    │
│ ┌─────────────────┐ │  │ ┌────────────────┐│  │ ┌────────────────┐ │
│ │ DeviceIdentity   │ │  │ │ DeviceIdentity ││  │ │ DeviceIdentity │ │
│ │ → IndexedDB      │ │  │ │ → IndexedDB    ││  │ │ → IndexedDB    │ │
│ │   persistent UUID │  │ │   persistent UUID│  │ │   persistent    │ │
│ └─────────────────┘ │  │ └────────────────┘│  │ └────────────────┘ │
│ ┌─────────────────┐ │  │ ┌────────────────┐│  │ ┌────────────────┐ │
│ │ GitSyncManager   │ │  │ │ GitSyncManager ││  │ │ GitSyncManager │ │
│ │ ├─ commit + push │ │  │ │ ├─ commit+push ││  │ │ ├─ commit+push│ │
│ │ ├─ fetch + pull  │ │  │ │ ├─ fetch+pull  ││  │ │ ├─ fetch+pull │ │
│ │ └─ conflict check│ │  │ │ └─ conflict    ││  │ │ └─ conflict   │ │
│ └─────────────────┘ │  │ └────────────────┘│  │ └────────────────┘ │
│                     │  │                   │  │                    │
│ ┌─────────────────┐ │  │ ┌────────────────┐│  │ ┌────────────────┐ │
│ │ LightningFS IDB  │ │  │ │ LightningFS    ││  │ │ LightningFS   │ │
│ │ (independent FS) │ │  │ │ (independent)  ││  │ │ (independent) │ │
│ └─────────────────┘ │  │ └────────────────┘│  │ └────────────────┘ │
└─────────────────────┘  └──────────────────┘  └────────────────────┘
          │                      │                        │
          └──────────────────────┼────────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │    GitHub (central ref)   │
                    │  origin/main + branches   │
                    └─────────────────────────┘
```

### Sync Flow (Conceptual)

```
Node A commits "feat: add login" + pushes to GitHub
  → GitHub now ahead by 1 commit

Node B, seeing syncQueue update via Y.Map:
  1. Fetches from GitHub (isomorphic-git fetch)
  2. Detects remote is ahead: fast-forward merge or rebase
  3. Pulls changes into local LightningFS
  4. Reports sync status back to Y.Map

Node B commits "fix: tests" and pushes
  → GitHub now ahead by another commit

Node A pulls → repeats the cycle
```

---

## 4. 1. Device Identity (IndexedDB)

### Design: `DeviceIdentityManager`

New file: `src/services/mesh/device-identity.ts`

```typescript
interface DeviceIdentity {
  deviceId: string;             // UUID v4, generated once, stable for life
  deviceName: string;           // User-settable, default: "My {deviceType}"
  deviceType: DeviceType;       // 'phone' | 'tablet' | 'pc' | 'laptop' | 'web'
  instanceNonce: string;        // Random per-session, for dedup
  createdAt: number;            // Timestamp of first registration
  updatedAt: number;            // Timestamp of last identity update
}

type DeviceType = 'phone' | 'tablet' | 'pc' | 'laptop' | 'web';
```

### Persistence — IndexedDB via `idb` Wrapper

**Why IndexedDB over localStorage:**
- localStorage is synchronous and limited to ~5MB
- IndexedDB is async, survives service worker clears, and has no size limit
- The `idb` package (already in `package.json` v8.0.2) provides a clean promise-based API
- IndexedDB is already used by LightningFS and y-indexeddb — consistent storage layer

```typescript
// Storage structure
const DB_NAME = 'swal_agent_config';
const DB_VERSION = 1;
const STORE_NAME = 'device';

interface DeviceRecord {
  key: 'identity';
  value: DeviceIdentity;
}
```

### Implementation

```typescript
import { openDB, IDBPDatabase } from 'idb';

class DeviceIdentityManager {
  private static DB_NAME = 'swal_agent_config';
  private static STORE = 'device';
  private static KEY = 'identity';

  private identity: DeviceIdentity | null = null;
  private db: IDBPDatabase | null = null;

  async init(): Promise<DeviceIdentity> {
    this.db = await openDB(DeviceIdentityManager.DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(DeviceIdentityManager.STORE)) {
          db.createObjectStore(DeviceIdentityManager.STORE);
        }
      },
    });

    this.identity = await this.db.get(DeviceIdentityManager.STORE, DeviceIdentityManager.KEY);

    if (!this.identity) {
      this.identity = this.createIdentity();
      await this.persist();
    }

    return this.identity;
  }

  private createIdentity(): DeviceIdentity {
    return {
      deviceId: crypto.randomUUID(),
      deviceName: this.guessDeviceName(),
      deviceType: this.detectDeviceType(),
      instanceNonce: crypto.randomUUID(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  private detectDeviceType(): DeviceType {
    const ua = navigator.userAgent.toLowerCase();
    const isMobile = /mobile|android|iphone|ipad|tablet/i.test(ua);
    const isTablet = /tablet|ipad|playbook|silk/i.test(ua) ||
      (isMobile && window.innerWidth >= 768);
    const isPhone = isMobile && !isTablet;

    if (isPhone) return 'phone';
    if (isTablet) return 'tablet';
    if (/mac|win|linux/.test(navigator.platform || '') && !isMobile) return 'pc';
    return 'web';
  }

  private guessDeviceName(): string {
    const type = this.detectDeviceType();
    const deviceTypeLabel = type.charAt(0).toUpperCase() + type.slice(1);
    const existingNames = localStorage.getItem('swal_device_names') || '[]';
    const count = JSON.parse(existingNames).length;
    return `My ${deviceTypeLabel}${count > 0 ? ` (${count + 1})` : ''}`;
  }

  async updateName(name: string): Promise<void> {
    if (!this.identity) throw new Error('DeviceIdentityManager not initialized');
    this.identity.deviceName = name;
    this.identity.updatedAt = Date.now();
    await this.persist();
  }

  async getIdentity(): Promise<DeviceIdentity> {
    if (!this.identity) await this.init();
    return this.identity!;
  }

  private async persist(): Promise<void> {
    if (!this.db) throw new Error('DB not open');
    await this.db.put(DeviceIdentityManager.STORE, this.identity, DeviceIdentityManager.KEY);
  }
}

export const deviceIdentityManager = new DeviceIdentityManager();
```

### Device Type Detection

| User Agent Signal | Device Type |
|---|---|
| `mobile` + NOT `tablet` pattern | `phone` |
| `tablet` or `ipad` or large mobile | `tablet` |
| `android` + screen >= 768px | `tablet` |
| `mac`/`win`/`linux` desktop browsers | `pc` |
| Fallback / unknown | `web` |

### Migration Path

**Phase 1 (coexistence):**
- Identity stored in **both** localStorage and IndexedDB during transition
- Read from IndexedDB first, fall back to localStorage
- Window: `localStorage('swal_device_identity')` → migrate to IndexedDB

**Phase 2 (IndexedDB-only):**
- Pure IndexedDB reads/writes
- localStorage key deleted after migration confirmed

### Lifecycle

```
App Init
  └─ deviceIdentityManager.init()
       ├─ openDB('swal_agent_config', 1)
       ├─ load from 'device' store
       ├─ if missing → createIdentity() → persist
       └─ return DeviceIdentity

Hot Reload / Service Worker Update
  └─ IndexedDB survives → identity unchanged

Clear Site Data
  └─ Identity lost → regenerate on next init (same as any cleared PWA)
```

---

## 5. 2. Device Registry (Y.Map)

### Design: MeshPeerDirectory

Reuses the peer directory design from MULTI-PEER-MESH.md section 6, extended with:
- Git-specific capability flags
- Sync state tracking
- Last-known-ref tracking

### Y.Map Key Structure

```
swal:directory:{deviceId}
  → DeviceDirectoryEntry

swal:registry:repos:{repoId}:heads:{refName}
  → { deviceId, commitHash, updatedAt }

swal:registry:type:{roomName}
  → { version: 2, created: timestamp }

swal:registry:config:{deviceId}
  → { roles: string[], pinned: boolean, displayColor: string }
```

### DeviceDirectoryEntry (Enhanced)

```typescript
interface DeviceDirectoryEntry {
  // Identity
  deviceId: string;
  deviceName: string;
  deviceType: DeviceType;
  nodeId: string;               // y-webrtc internal peer id

  // Timing
  joinedAt: number;
  lastHeartbeat: number;

  // Capabilities
  capabilities: string[];       // ['agent-runner', 'filesystem', 'git-sync']
  canHostGit: boolean;          // Can act as git sync initiator
  userAgent: string;            // Browser UA for diagnostics

  // Git sync state
  gitRepos: GitRepoState[];     // Repos this node is working on

  // Version info
  appVersion: string;           // swal-agent-runner version
  protocolVersion: string;      // Sync protocol version (e.g., "3.9.0")
}

interface GitRepoState {
  repoId: string;               // ProjectRepo.id
  repoName: string;             // ProjectRepo.name
  currentBranch: string;        // Checked-out branch
  lastPulledAt: number;         // Last successful pull from GitHub
  lastPushedAt: number;         // Last successful push to GitHub
  uncommittedChanges: boolean;  // Has local modifications
  unpushedCommits: number;      // Commits ahead of remote
  behindRemote: number;         // Commits behind remote (known from last fetch)
}
```

### Subscribing to Peer Changes (React Hook)

```typescript
// src/hooks/useDeviceRegistry.ts
export function useDeviceRegistry() {
  const [peers, setPeers] = useState<DeviceDirectoryEntry[]>([]);

  useEffect(() => {
    // Subscribe to Y.Map changes
    const directory = edgeMeshClient.yjs.doc.getMap('swal:directory');
    const observer = () => {
      const entries: DeviceDirectoryEntry[] = [];
      directory.forEach((entry, key) => {
        if (key !== `swal:directory:${deviceIdentityManager.getIdentity().deviceId}`) {
          entries.push(entry);
        }
      });
      setPeers(entries);
    };

    directory.observe(observer);
    return () => directory.unobserve(observer);
  }, []);

  return peers;
}
```

### Heartbeat & Stale Detection

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Heartbeat interval | 30s | Low overhead, network-friendly |
| Stale threshold | 120s (4 missed) | Accounts for brief disconnections |
| Cleanup trigger | Every heartbeat cycle | O(N) over max 40 peers |
| Action on stale | Remove from Y.Map | Peer must rejoin on reconnect |

### Git Repo State Exchange

Each node's entry includes `gitRepos: GitRepoState[]`. This is updated:
- On repo clone → push entry to directory
- On branch switch → update `currentBranch`
- On commit → increment `unpushedCommits`
- On push → update `lastPushedAt`, reset `unpushedCommits`
- On pull → update `lastPulledAt`, reset `behindRemote`

This enables other nodes to know:
- Who is working on what repo
- Who has uncommitted work (may conflict)
- Who is behind/ahead of remote (sync readiness)

---

## 6. 3. Git Sync Workflow (GitHub Bridge)

### Core Principle

**GitHub is the single source of truth.** All nodes converge on the same remote. The CRDT/y-webrtc mesh is used only for:
1. Device discovery and peer presence
2. Sync coordination signals (locks, sync notifications)
3. Shared app-state (memory graph, event bus)

The actual git data flows through GitHub:

```
Node A: commit → push to GitHub
Node B: fetch from GitHub → merge/rebase → continue
```

### Step 1: Add `pullChanges` and `fetchChanges` to GitWorkspaceService

```typescript
// In git-service.ts — NEW methods

interface FetchResult {
  fetchHead: string;            // SHA of fetched remote HEAD
  branches: Record<string, string>;  // ref → SHA map
  pruned: string[];             // Removed remote tracking branches
}

interface PullResult {
  fastForward: boolean;
  fromHash: string;
  toHash: string;
  filesChanged: string[];
  conflictFiles: string[];      // Files with merge conflicts
}

static async fetchChanges(
  projectName: string,
  token: string,
  remoteName = 'origin',
  corsProxy?: string,
  prune = true
): Promise<FetchResult> {
  const dir = `/projects/${projectName}`;
  const proxy = corsProxy || this.defaultCorsProxy;

  const result = await git.fetch({
    fs: this.fs,
    http,
    dir,
    remote: remoteName,
    corsProxy: proxy,
    onAuth: () => ({ username: token }),
    prune,
  });

  // Map refs to readable format
  const branches: Record<string, string> = {};
  const remoteRefs = await git.listBranches({ fs: this.fs, dir, remote: remoteName });
  for (const branch of remoteRefs) {
    const ref = await git.resolveRef({
      fs: this.fs, dir, ref: `refs/remotes/${remoteName}/${branch}`,
    });
    branches[branch] = ref;
  }

  return {
    fetchHead: await git.resolveRef({ fs: this.fs, dir, ref: 'FETCH_HEAD' }),
    branches,
    pruned: result?.pruned ?? [],
  };
}

static async pullChanges(
  projectName: string,
  token: string,
  remoteName = 'origin',
  corsProxy?: string,
  author?: { name: string; email: string }
): Promise<PullResult> {
  const dir = `/projects/${projectName}`;
  const proxy = corsProxy || this.defaultCorsProxy;

  // 1. Fetch latest
  await this.fetchChanges(projectName, token, remoteName, proxy);

  // 2. Get current branch
  const currentBranch = await git.currentBranch({ fs: this.fs, dir });
  if (!currentBranch) throw new Error('Not on any branch');

  // 3. Check remote tracking ref
  const remoteRef = `refs/remotes/${remoteName}/${currentBranch}`;
  const currentHash = await git.resolveRef({ fs: this.fs, dir, ref: currentBranch });
  const remoteHash = await git.resolveRef({ fs: this.fs, dir, ref: remoteRef });

  // 4. Check fast-forward possibility
  const mergeBase = await git.findMergeBase({
    fs: this.fs, dir, sha1: currentHash, sha2: remoteHash,
  });

  const isFastForward = mergeBase === currentHash;
  const filesChanged: string[] = [];
  const conflictFiles: string[] = [];

  if (isFastForward) {
    // Fast-forward: no conflict possible
    await git.checkout({
      fs: this.fs, dir, ref: remoteRef, noUpdateHead: false,
    });
  } else if (mergeBase === remoteHash) {
    // Local is ahead of remote (nothing to pull)
    return {
      fastForward: false,
      fromHash: currentHash,
      toHash: currentHash,
      filesChanged: [],
      conflictFiles: [],
    };
  } else {
    // Divergent history: attempt merge or rebase
    // Try merge first
    try {
      const mergeResult = await git.merge({
        fs: this.fs,
        dir,
        ours: currentBranch,
        theirs: remoteRef,
        author: author ?? { name: 'SWAL Agent', email: 'agent@swal.dev' },
      });

      conflictFiles.push(...mergeResult.conflicts?.map(c => c.file) ?? []);
      filesChanged.push(...(mergeResult.treeChanges?.changes?.map(c => c.path) ?? []));
    } catch (err: any) {
      // Merge conflict — files will have conflict markers
      conflictFiles.push('[merge failed — see conflict markers]');
    }
  }

  // Update project metadata
  const projects = await this.listProjects();
  const p = projects.find(x => x.name === projectName);
  if (p) {
    const newHash = await git.resolveRef({ fs: this.fs, dir, ref: currentBranch });
    p.lastSyncedAt = Date.now();
    await this.saveProjects(projects);
  }

  return {
    fastForward: isFastForward,
    fromHash: currentHash,
    toHash: remoteHash,
    filesChanged,
    conflictFiles,
  };
}

static async getUnpushedCommits(
  projectName: string,
  remoteName = 'origin'
): Promise<number> {
  const dir = `/projects/${projectName}`;
  const branch = await git.currentBranch({ fs: this.fs, dir });
  if (!branch) return 0;

  try {
    const remoteRef = `refs/remotes/${remoteName}/${branch}`;
    const remoteHash = await git.resolveRef({ fs: this.fs, dir, ref: remoteRef });
    const localHash = await git.resolveRef({ fs: this.fs, dir, ref: branch });

    if (localHash === remoteHash) return 0;

    // Count commits by walking log
    const log = await git.log({
      fs: this.fs,
      dir,
      ref: branch,
      since: remoteHash,
    });
    return log.length;
  } catch {
    // Remote ref doesn't exist yet
    return 1;
  }
}
```

### Step 2: Create GitSyncManager (NEW file)

```typescript
// src/services/git/git-sync-manager.ts

import { GitWorkspaceService } from './git-service';
import { edgeMeshClient } from '../services/mesh/edge-mesh-client';
import { deviceIdentityManager } from '../services/mesh/device-identity';
import { ProjectRepo } from '../../types';

interface SyncState {
  repoId: string;
  repoName: string;
  state: 'idle' | 'fetching' | 'pulling' | 'pushing' | 'conflict';
  localAhead: number;
  remoteAhead: number;
  lastSyncAt: number;
  lastError?: string;
}

type SyncEvent =
  | { type: 'sync:started'; repoId: string }
  | { type: 'sync:fetching'; repoId: string }
  | { type: 'sync:pulling'; repoId: string }
  | { type: 'sync:pushing'; repoId: string }
  | { type: 'sync:completed'; repoId: string; result: PullResult }
  | { type: 'sync:conflict'; repoId: string; conflictFiles: string[] }
  | { type: 'sync:error'; repoId: string; error: string };

class GitSyncManager {
  private syncStates: Map<string, SyncState> = new Map();
  private syncListeners: ((event: SyncEvent) => void)[] = [];
  private syncInProgress = false;
  private token: string = '';  // GitHub token from auth

  setToken(token: string): void {
    this.token = token;
  }

  async syncRepository(repo: ProjectRepo): Promise<void> {
    if (this.syncInProgress) {
      console.warn('[GitSync] Sync already in progress, queuing');
      // In production, use a proper queue
      return;
    }

    this.syncInProgress = true;
    this.notify({ type: 'sync:started', repoId: repo.id });
    this.updateState(repo.id, { state: 'fetching' });

    try {
      // 1. Fetch remote state
      this.notify({ type: 'sync:fetching', repoId: repo.id });
      const fetchResult = await GitWorkspaceService.fetchChanges(
        repo.name, this.token
      );

      // 2. Check if remote is ahead
      const remoteRef = `refs/remotes/origin/${repo.branch}`;
      const localHash = await GitWorkspaceService.getLocalHash(repo.name);
      let remoteHash: string;
      try {
        remoteHash = await GitWorkspaceService.getRemoteRefHash(repo.name, remoteRef);
      } catch {
        remoteHash = localHash; // No remote ref yet
      }

      // 3. Check unpushed commits
      const unpushed = await GitWorkspaceService.getUnpushedCommits(repo.name);

      // 4. If remote is ahead, pull
      if (remoteHash !== localHash) {
        this.notify({ type: 'sync:pulling', repoId: repo.id });
        this.updateState(repo.id, { state: 'pulling' });

        const pullResult = await GitWorkspaceService.pullChanges(
          repo.name, this.token
        );

        if (pullResult.conflictFiles.length > 0) {
          this.updateState(repo.id, { state: 'conflict' });
          this.notify({
            type: 'sync:conflict',
            repoId: repo.id,
            conflictFiles: pullResult.conflictFiles,
          });
          return; // Stop — user must resolve conflicts
        }
      }

      // 5. If we have unpushed commits, push
      if (unpushed > 0) {
        this.notify({ type: 'sync:pushing', repoId: repo.id });
        this.updateState(repo.id, { state: 'pushing' });

        await GitWorkspaceService.pushChanges(repo.name, this.token);
      }

      this.updateState(repo.id, {
        state: 'idle',
        localAhead: 0,
        remoteAhead: 0,
        lastSyncAt: Date.now(),
      });
      this.notify({
        type: 'sync:completed',
        repoId: repo.id,
        result: {
          fastForward: false,
          fromHash: localHash,
          toHash: remoteHash,
          filesChanged: [],
          conflictFiles: [],
        },
      });
    } catch (err: any) {
      this.updateState(repo.id, {
        state: 'idle',
        lastError: err.message,
      });
      this.notify({
        type: 'sync:error',
        repoId: repo.id,
        error: err.message,
      });
    } finally {
      this.syncInProgress = false;
    }
  }

  // Periodically sync all known repos
  private syncInterval: number | null = null;

  startAutoSync(intervalMs = 60_000): void {
    this.stopAutoSync();
    this.syncInterval = window.setInterval(async () => {
      const repos = await GitWorkspaceService.listProjects();
      for (const repo of repos) {
        if (repo.status !== 'error') {
          // Don't wait — fire and forget for each repo
          this.syncRepository(repo).catch(console.error);
        }
      }
    }, intervalMs);
  }

  stopAutoSync(): void {
    if (this.syncInterval !== null) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  getSyncState(repoId: string): SyncState | undefined {
    return this.syncStates.get(repoId);
  }

  subscribe(listener: (event: SyncEvent) => void): () => void {
    this.syncListeners.push(listener);
    return () => {
      this.syncListeners = this.syncListeners.filter(l => l !== listener);
    };
  }

  private updateState(repoId: string, partial: Partial<SyncState>): void {
    const existing = this.syncStates.get(repoId) ?? {
      repoId,
      repoName: '',
      state: 'idle' as const,
      localAhead: 0,
      remoteAhead: 0,
      lastSyncAt: 0,
    };
    this.syncStates.set(repoId, { ...existing, ...partial });
  }

  private notify(event: SyncEvent): void {
    for (const listener of this.syncListeners) {
      listener(event);
    }
  }
}

export const gitSyncManager = new GitSyncManager();
```

### Step 3: Git Sync Coordination via Y.Map

To prevent two nodes from pushing simultaneously (causing a reject from GitHub), the device registry's Y.Map doubles as a **sync coordination channel**.

```typescript
// Shared Y.Map coordination

// Write lock per repo:
// swal:git:locks:swal-agent-runner
//   → { deviceId, acquired: timestamp, ttl: 30000 }

// Acquire lock before push
async function acquireGitLock(repoName: string): Promise<boolean> {
  const locks = edgeMeshClient.yjs.doc.getMap('swal:git:locks');
  const lockKey = `lock:${repoName}`;
  const existing = locks.get(lockKey);

  if (existing && (Date.now() - existing.acquired) < existing.ttl) {
    return false; // Lock held by another node
  }

  locks.set(lockKey, {
    deviceId: deviceIdentityManager.getIdentity().deviceId,
    acquired: Date.now(),
    ttl: 30_000,
  });
  return true;
}

async function releaseGitLock(repoName: string): Promise<void> {
  const locks = edgeMeshClient.yjs.doc.getMap('swal:git:locks');
  locks.delete(`lock:${repoName}`);
}
```

**Lock timeout:** If a node crashes during push, the lock auto-releases after 30s TTL. On reconnect, the stale lock is detected by `lastHeartbeat` staleness and removed.

### Step 4: Y.Map Sync Queue (Optional Enhancement)

For push-triggered pull notifications, write to a Y.Map sync queue:

```
swal:git:syncQueue
  → Y.Array<{
      type: 'push' | 'pull-request' | 'conflict-resolved',
      repoId: string,
      deviceId: string,
      timestamp: number,
      ref: string,
    }>
```

Nodes observe this array and trigger pulls when a new push notification appears from another node.

### Complete Sync Sequence Diagram

```
Node A                    Mesh (Y.Map)              Node B                  GitHub
  │                          │                        │                       │
  ├─ Commit (local)──────────│────────────────────────│───────────────────────│
  │                          │                        │                       │
  ├─ acquireGitLock(repo)────│──── set lock ──────────│───────────────────────│
  ├─ push() ─────────────────│────────────────────────│─────────── push ──────►
  │                          │                        │                       ├─ accept
  ├─ releaseGitLock(repo)────│──── delete lock ───────│───────────────────────│
  │                          │                        │                       │
  │       notify push via syncQueue                   │                       │
  │─────────────────────────►│──── new entry ────────►│                       │
  │                          │                        │                       │
  │                          │                        ├─ fetchChanges() ──────► fetch
  │                          │                        │◄─────── refs ─────────│
  │                          │                        │                       │
  │                          │                        ├─ pullChanges() ───────►
  │                          │                        │◄────── files ─────────│
  │                          │                        │                       │
  │                          │      update gitRepos   │                       │
  │                          │◄────── in directory ───│                       │
```

### Edge Cases

| Scenario | Handling |
|----------|----------|
| **Two nodes push simultaneously** | GitHub rejects the second push (non-fast-forward). The losing node's `push()` throws, `GitSyncManager` catches it, fetches latest, and re-attempts |
| **Node B pulls while Node A has uncommitted changes** | isomorphic-git refuses fetch/checkout with uncommitted changes. Detect via `git.statusMatrix()` first, stash or abort |
| **Node A goes offline mid-push** | `acquireGitLock` TTL expires (30s). Node B detects stale lock + old heartbeat, clears the lock |
| **Node A pushes, Node B is offline** | Node B's auto-sync timer pulls when it comes back online. The syncQueue entries accumulate but are processed idempotently |
| **Empty repo (no initial commit)** | First push must happen from one node. Other nodes detect `HEAD` doesn't resolve and wait |
| **Different branches** | Each branch syncs independently. `gitRepos.currentBranch` tells others what branch each node is on |

---

## 7. 4. Conflict Detection

### When Conflicts Occur

Conflicts happen when two nodes modify the same file in different ways and both push. GitHub returns a non-fast-forward push rejection. The second node must pull, merge, and resolve.

### Detection Points

**Point A: Before Push (Proactive)**

```typescript
// In syncRepository(), before push:
static async detectConflictBeforePush(projectName: string): Promise<ConflictCheck> {
  const dir = `/projects/${projectName}`;

  // 1. Fetch latest
  await git.fetch({ fs: this.fs, http, dir, ... });

  // 2. Check if remote is ahead of common ancestor
  const branch = await git.currentBranch({ fs: this.fs, dir });
  const remoteRef = `refs/remotes/origin/${branch}`;
  const remoteHash = await git.resolveRef({ fs: this.fs, dir, ref: remoteRef });
  const localHash = await git.resolveRef({ fs: this.fs, dir, ref: branch });
  const mergeBase = await git.findMergeBase({ fs: this.fs, dir, sha1: localHash, sha2: remoteHash });

  if (mergeBase !== remoteHash) {
    // Remote has diverged — merge or rebase needed
    // Check per-file conflicts
    const files = await this.getChangedFilesBetween(projectName, mergeBase, remoteHash);
    const localChanges = await this.getChangedFilesBetween(projectName, mergeBase, localHash);

    const conflicts = files.filter(f => localChanges.includes(f));
    return {
      hasConflict: conflicts.length > 0,
      remoteAhead: true,
      conflictingFiles: conflicts,
      allRemoteFiles: files,
    };
  }

  return { hasConflict: false, remoteAhead: false, conflictingFiles: [], allRemoteFiles: [] };
}
```

**Point B: During Merge (Reactive)**

```typescript
// isomorphic-git merge returns conflicts:
interface MergeConflict {
  file: string;
  // Conflict markers are written into the file: <<<<<<< ours ... ======= ... >>>>>>> theirs
}

const mergeResult = await git.merge({
  fs: this.fs, dir, ours: branch, theirs: remoteRef,
  abortOnConflict: false,  // Don't abort — write markers and let user resolve
});

if (mergeResult.conflicts?.length > 0) {
  // Files contain conflict markers — surface to user
}
```

### Conflict Resolution Strategy

| Strategy | Approach | When |
|----------|----------|------|
| **Auto-rebase** | `git rebase` before push if no shared edits | Remote ahead, no conflicting files |
| **Manual resolve** | User edits conflict markers in files | Same file edited on two nodes |
| **Abort and warn** | Skip push, log error | Unmergeable state |

### Conflict Marker Handling

```typescript
// Utility to detect conflict markers in files
static async checkForConflictMarkers(
  projectName: string,
  filePath: string
): Promise<boolean> {
  const content = await this.readFile(projectName, filePath);
  return /<<<<<<< |=======\n|>>>>>>> /.test(content);
}

// Utility to list all files with markers
static async listConflictFiles(projectName: string): Promise<string[]> {
  const dir = `/projects/${projectName}`;
  const files: string[] = [];

  // Walk the git conflict state
  const matrix = await git.statusMatrix({ fs: this.fs, dir });
  for (const [filepath, head, workdir, stage] of matrix) {
    // Stage === 3 means conflict (modified in both)
    if (stage === 3) {
      files.push(filepath);
    }
  }

  return files;
}
```

### Surfacing Conflicts to User

Conflict is communicated through:
1. `SyncEvent.type === 'sync:conflict'` — programmatic API
2. `GitRepoState` in device registry — `state: 'conflict'`
3. UI badge on ProjectsView — red indicator with file count
4. Notification toast: `"Conflict detected in: src/auth.ts"`

### Conflict State Flow

```
push → GitHub rejects (non-fast-forward)
  → fetch latest
  → attempt merge
  → merge conflict (stage === 3 files)
  → mark repo state as 'conflict'
  → update device registry entry
  → notify UI
  → user resolves manually
  → git add conflicted files
  → commit resolution
  → push resolution
  → state back to 'idle'
```

---

## 8. 5. UI Considerations

### 8.1 PairingView — Device Identity Section

Add a **Device Identity** panel to PairingView (above the pairing controls):

```
┌──────────────────────────────────────────────┐
│  Pair Device                                  │
│                                               │
│  ┌──────────────────────────────────────────┐ │
│  │  Your Device                              │ │
│  │  ┌─────────┐                             │ │
│  │  │ 📱 Phone │  My Phone (Pixel 7)        │ │
│  │  │   icon   │  ID: a1b2c3d4-e5f6...      │ │
│  │  └─────────┘                             │ │
│  │  [✏️ Rename]  [📋 Copy ID]               │ │
│  └──────────────────────────────────────────┘ │
│                                               │
│  ┌──────┐ ┌──────────┐                        │
│  │ 1:1  │ │ Mesh     │  ← tabs                │
│  └──────┘ └──────────┘                        │
│  ... existing content ...                     │
└──────────────────────────────────────────────┘
```

### 8.2 Device Registry Panel (NEW)

New component: `src/components/DeviceListPanel.tsx`

```
┌──────────────────────────────────────────────┐
│  Connected Devices  (3)                       │
│                                               │
│  ● My Phone (this device)                     │
│    ID: a1b2...  |  Capabilities: Agent, Git   │
│                                               │
│  ● PC-Workstation                             │
│    ID: f6e5...  |  Last seen: 12s ago         │
│    Git: swal-agent-runner (main)              │
│         Ahead: 2 | Behind: 0                  │
│                                               │
│  ● Pixel Tablet                               │
│    ID: c3d4...  |  Last seen: 45s ago         │
│    Git: swal-agent-runner (main)              │
│         Ahead: 0 | Behind: 3  [🔄 Sync Now]   │
│                                               │
│  ┌──────────────────────────────────────────┐ │
│  │ 🟢 All nodes synced to origin/main       │ │
│  └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

### 8.3 ProjectsView — Sync Status Column

Extend the ProjectsView repo card with sync metadata:

```
┌──────────────────────────────────────────────┐
│  swal-agent-runner         main               │
│  ────────────────────────────────────────      │
│  Status: ✅ Synced                            │
│  Last pushed: 2m ago (by PC-Workstation)     │
│  Last pulled: 30s ago                         │
│  Ahead: 0  |  Behind: 0                      │
│                                               │
│  Working on this repo:                        │
│  ● PC-Workstation (ahead 2)                  │
│  ● My Phone (this device)                    │
│                                               │
│  [🔄 Sync Now] [📋 View Changes]             │
└──────────────────────────────────────────────┘

Conflict state:
┌──────────────────────────────────────────────┐
│  ⚠️ Conflict detected!                        │
│  Files: src/auth.ts, src/api.ts               │
│  [📝 Resolve in Editor]  [🔄 Abort Merge]     │
└──────────────────────────────────────────────┘
```

### 8.4 Navbar — Sync Status Badge

```
┌──────────────────────────────────────────────┐
│  [Projects] [New Task] [Progress] [Memory]   │
│                                    ┌──────┐  │
│                                    │ ⇅ 2  │  │ ← sync badge
│                                    └──────┘  │
│                                  2 repos     │
│                                  need sync   │
└──────────────────────────────────────────────┘
```

### 8.5 Sync Notification Toast

```
┌──────────────────────────────────────────┐
│  🔄 Syncing swal-agent-runner...        │ (fade)
├──────────────────────────────────────────┤
│  ✅ Synced swal-agent-runner             │ (toast)
│    2 commits pulled from GitHub          │
├──────────────────────────────────────────┤
│  ⚠️ Conflict in swal-agent-runner        │ (warning)
│    Files: src/auth.ts, src/api.ts        │
│    [View Conflicts]                      │
└──────────────────────────────────────────┘
```

### 8.6 React Hooks for UI

```typescript
// src/hooks/useGitSyncEvents.ts
export function useGitSyncEvents() {
  const [syncEvent, setSyncEvent] = useState<SyncEvent | null>(null);

  useEffect(() => {
    return gitSyncManager.subscribe(setSyncEvent);
  }, []);

  return syncEvent;
}

// src/hooks/useDeviceRegistry.ts
export function useDeviceRegistry() {
  const [peers, setPeers] = useState<DeviceDirectoryEntry[]>([]);

  useEffect(() => {
    return edgeMeshClient.subscribeMeshPeers(setPeers);
  }, []);

  return peers;
}
```

---

## 9. 6. File Island Mapping & Risk Assessment

### File Island: What Must Change

#### New Files

| # | File | Est. Δ (lines) | Risk | Purpose |
|---|------|----------------|------|---------|
| 1 | `src/services/mesh/device-identity.ts` | +90 | Low | DeviceIdentityManager — IndexedDB identity persistence |
| 2 | `src/services/git/git-sync-manager.ts` | +200 | Medium | GitSyncManager — sync orchestration, auto-sync, coordination |
| 3 | `src/hooks/useDeviceRegistry.ts` | +30 | Low | React hook for consuming device registry |
| 4 | `src/hooks/useGitSyncEvents.ts` | +20 | Low | React hook for consuming sync events |
| 5 | `src/components/DeviceListPanel.tsx` | +120 | Low | Device registry UI panel |
| 6 | `src/types/mesh.ts` | +80 | Low | Mesh-specific types (extracted from types/index.ts) |

**Total new code:** ~540 lines  
**New files:** 6

#### Modified Files

| # | File | Change | Est. Δ (lines) | Risk | Migration |
|---|------|--------|----------------|------|-----------|
| 1 | `src/services/git/git-service.ts` | Add `fetchChanges()`, `pullChanges()`, `getUnpushedCommits()`, `getLocalHash()`, `getRemoteRefHash()`, `checkForConflictMarkers()`, `listConflictFiles()`, `detectConflictBeforePush()` | +200 | **High** — core git operations, must handle all edge cases | Additive — existing methods unchanged |
| 2 | `src/components/PairingView.tsx` | Replace volatile `myPeerId` with persistent `DeviceIdentityManager`; add device name editing; add Mesh tab | +80 | Medium — existing 1:1 path preserved | Dual-mode; old PeerJS path untouched |
| 3 | `src/components/ProjectsView.tsx` | Add sync status column, conflict badges, "Sync Now" button | +60 | Medium — UI changes only | Additive; existing layout preserved |
| 4 | `src/services/mesh/edge-mesh-client.ts` | Add mesh peer tracking (subscribe/unsubscribe); integrate device identity | +80 | **High** — core singleton | Extend class; existing API unchanged |
| 5 | `src/App.tsx` | Wire `deviceIdentityManager.init()` + `gitSyncManager.startAutoSync()` in startup `useEffect` | +20 | Low | Additive init |
| 6 | `src/types/index.ts` | Extend `ProjectRepo` with `lastPushedBy`, `conflictFiles`, `syncState`; extend `XavierPairStatus` with mesh awareness | +15 | Low | Optional fields added |
| 7 | `src/components/Navbar.tsx` | Sync badge showing pending sync count | +15 | Low | Additive badge |

**Total modified code:** ~470 lines  
**Modified files:** 7

#### Files NOT Changed

These files consume EdgeMeshClient or GitWorkspaceService through stable APIs and need zero changes:

- `src/services/mesh/crdt-sync.ts` — stays unwired until mesh P0 is implemented
- `src/services/mesh/crdt-event-bus.ts` — orthogonal CRDT pub/sub
- `src/services/mesh/crdt-graph.ts` — already reads from shared Y.Doc
- `src/services/mesh/yjs-adapter.ts` — internal Y.Doc wrapper
- `src/services/mesh/transport.ts` — PeerJS transport remains for legacy
- `src/services/memory/` — memory is orthogonal to git sync
- `src/services/offline/` — offline manager orthogonal
- `src/services/llm/` — LLM providers orthogonal
- `src/services/runtime/` — WebContainer runtime orthogonal
- `src/agent/` — agent loop uses Y.Doc directly, works with any Y.Doc backend
- `src/hooks/useCrdtEvents.ts` — reads from CrdtEventBus, unchanged
- `src/components/MemorySyncPanel.tsx` — reads pair status, unchanged
- `src/components/NewTaskView.tsx` — task creation, unchanged
- `src/components/TaskProgressView.tsx` — agent progress, unchanged
- `src/components/TaskResultView.tsx` — results display, unchanged
- `src/components/AuthSettingsModal.tsx` — auth settings, unchanged

### Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **IndexedDB unavailable** (private browsing, quota exceeded) | Low | Medium (no persistent identity) | Fall back to in-memory + localStorage; warn user |
| **GitHub token missing or expired** | Medium | **High** (push/pull fail) | Surface clear error in UI; prompt re-auth |
| **Concurrent push conflict** (two nodes push different changes to same branch) | Medium | Medium (rejected push, need pull) | `acquireGitLock` CRDT lock; auto-fetch-and-retry on rejection |
| **Large merge conflict** (>10 files) | Low | Low (user must resolve manually) | Clear file list in UI; provide abort option |
| **LightningFS corruption** (browser crash mid-write) | Low | **High** (repo may need re-clone) | Add `git fsck` equivalent check before sync; corruption detection |
| **y-webrtc disconnection mid-sync** | Medium | Low (sync continues on reconnection) | Sync state persisted; auto-retry on reconnect |
| **CORS proxy timeout** (cors-proxy.swal.dev) | Medium | Medium (push/pull fail) | Configurable proxy; auto-fallback to direct fetch |
| **Auto-sync conflicts with user workflow** (user editing while auto-sync pulls) | Medium | Medium | Skip sync if `uncommittedChanges` detected; use git stash |
| **Device type misdetection** (Chrome devtools mobile emulation) | Low | Low (cosmetic) | Allow manual override in PairingView |
| **IndexedDB schema migration** | Low | **High** (data loss if wrong) | Use `idb` upgrade function; always add stores, never remove |

### Test Plan

| Test Area | Approach | Coverage |
|-----------|----------|----------|
| DeviceIdentityManager init | Unit: mock IndexedDB via `fake-indexeddb` | First launch, re-launch, name update, reset |
| Device type detection | Unit: mock `navigator.userAgent` | phone, tablet, PC, web, edge cases |
| `fetchChanges()` | Integration: clone test repo via isomorphic-git + MemoryHTTP | Fetch existing refs, new refs, prune |
| `pullChanges()` | Integration: two in-memory LightningFS instances | Fast-forward, local ahead, divergent |
| `pullChanges()` conflict | Integration: modify same file on two LightningFS instances | Conflict detected, stage=3 files |
| `getUnpushedCommits()` | Unit: commit on top of known ref | 0, 1, N commits ahead |
| GitSyncManager sync cycle | Integration: mock git service + mock MeshClient | Full push→pull cycle |
| Git lock acquire/release | Unit: two Y.Docs exchanging Y.Map locks | Lock acquired, lock rejected, TTL expiry |
| Conflict marker detection | Unit: files with/without `<<<<<<<` | True positive, false negative |
| DeviceListPanel | RTL: render with mock peer directory entries | Rendering all fields, empty state |
| PairingView identity section | RTL: render with mock IndexedDB | Display identity, edit name, copy ID |

---

## 10. Implementation Phasing

### P0 — Foundation (this cycle)

| Step | Files | Est. Effort |
|------|-------|-------------|
| 1. Create `device-identity.ts` with IndexedDB persistence | NEW | 45 min |
| 2. Wire `deviceIdentityManager.init()` into `App.tsx` startup | Modified | 15 min |
| 3. Replace volatile `myPeerId` in PairingView with persistent identity | Modified | 30 min |
| 4. Add basic device name editing UI to PairingView | Modified | 30 min |
| 5. Add `fetchChanges()`, `pullChanges()`, `getUnpushedCommits()` to git-service.ts | Modified | 90 min |
| 6. Add conflict detection utilities to git-service.ts | Modified | 45 min |
| 7. Create GitSyncManager with `syncRepository()` and auto-sync timer | NEW | 90 min |
| 8. Extend `ProjectRepo` type with sync fields | Modified | 15 min |
| 9. Tests for device identity + git operations | NEW | 60 min |

**Total P0:** ~7 hours

### P1 — Mesh-Integrated Git Sync

| Step | Files | Est. Effort |
|------|-------|-------------|
| 1. Implement shared Y.Map device registry (mesh-peer-discovery.ts per MULTI-PEER-MESH.md) | NEW | 60 min |
| 2. Extend edge-mesh-client.ts with peer tracking + mesh state | Modified | 60 min |
| 3. Wire device registry heartbeat loop | Modified | 30 min |
| 4. Git lock via Y.Map (`swal:git:locks`) | Modified (GitSyncManager) | 45 min |
| 5. Sync queue notifications via Y.Map | Modified (GitSyncManager) | 45 min |
| 6. Wire `gitRepos` state into device registry entry | Modified | 30 min |
| 7. Integration tests: 2+-node sync cycle | NEW | 60 min |

**Total P1:** ~5.5 hours

### P2 — UI Phase

| Step | Files | Est. Effort |
|------|-------|-------------|
| 1. Create DeviceListPanel component | NEW | 90 min |
| 2. Add sync status column + conflict badges to ProjectsView | Modified | 60 min |
| 3. Add sync notification toast system | Modified (App.tsx) | 30 min |
| 4. Add sync badge to Navbar | Modified | 20 min |
| 5. Create `useDeviceRegistry` + `useGitSyncEvents` hooks | NEW | 20 min |
| 6. Add "Sync Now" button per repo + "Sync All" | Modified | 30 min |
| 7. E2E test with simulated mesh + git | NEW | 60 min |

**Total P2:** ~5 hours

### P3 — Hardening

| Step | Files | Est. Effort |
|------|-------|-------------|
| 1. Offline-aware sync (defer when offline, retry on reconnect) | Modified (GitSyncManager) | 30 min |
| 2. Conflict resolution UI (file-by-file accept ours/theirs) | Modified (ProjectsView) | 60 min |
| 3. Stash unsaved changes before pull | Modified (git-service.ts) | 45 min |
| 4. Enhanced error recovery (corrupted LightningFS) | Modified (GitSyncManager) | 30 min |
| 5. Performance: debounce sync events, batch Y.Map updates | Modified (GitSyncManager) | 30 min |
| 6. Documentation: update SRC.md, README | Docs | 20 min |

**Total P3:** ~3.5 hours

### Summary Timeline

| Phase | Hours | Deliverables |
|-------|-------|--------------|
| P0 | ~7h | Persistent identity + core git sync (single-node) |
| P1 | ~5.5h | Mesh-enabled sync (N-node) + lock coordination |
| P2 | ~5h | Full sync UI: registry panel, badges, toasts, hooks |
| P3 | ~3.5h | Hardening: offline, conflict resolution, recovery |
| **Total** | **~21h** | **Complete multi-node git sync system** |

---

## Appendix A: Type Definitions (mesh-types.ts)

If extracted from `types/index.ts`:

```typescript
// ── Device Identity ────────────────────────────────────

export type DeviceType = 'phone' | 'tablet' | 'pc' | 'laptop' | 'web';

export interface DeviceIdentity {
  deviceId: string;
  deviceName: string;
  deviceType: DeviceType;
  instanceNonce: string;
  createdAt: number;
  updatedAt: number;
}

// ── Device Registry ────────────────────────────────────

export interface DeviceDirectoryEntry {
  deviceId: string;
  deviceName: string;
  deviceType: DeviceType;
  nodeId: string;
  joinedAt: number;
  lastHeartbeat: number;
  capabilities: string[];
  canHostGit: boolean;
  userAgent: string;
  gitRepos: GitRepoState[];
  appVersion: string;
  protocolVersion: string;
}

export interface GitRepoState {
  repoId: string;
  repoName: string;
  currentBranch: string;
  lastPulledAt: number;
  lastPushedAt: number;
  uncommittedChanges: boolean;
  unpushedCommits: number;
  behindRemote: number;
}

// ── Git Sync ───────────────────────────────────────────

export type SyncPhase = 'idle' | 'fetching' | 'pulling' | 'pushing' | 'conflict';

export interface SyncState {
  repoId: string;
  repoName: string;
  state: SyncPhase;
  localAhead: number;
  remoteAhead: number;
  lastSyncAt: number;
  lastError?: string;
}

export type SyncEvent =
  | { type: 'sync:started'; repoId: string }
  | { type: 'sync:fetching'; repoId: string }
  | { type: 'sync:pulling'; repoId: string }
  | { type: 'sync:pushing'; repoId: string }
  | { type: 'sync:completed'; repoId: string; fromHash: string; toHash: string }
  | { type: 'sync:conflict'; repoId: string; conflictFiles: string[] }
  | { type: 'sync:error'; repoId: string; error: string };

export interface ConflictCheck {
  hasConflict: boolean;
  remoteAhead: boolean;
  conflictingFiles: string[];
  allRemoteFiles: string[];
}

export interface GitLock {
  deviceId: string;
  acquired: number;
  ttl: number; // ms
}

// ── Extended ProjectRepo ───────────────────────────────

export interface ExtendedProjectRepo {
  // ... existing ProjectRepo fields ...
  lastPushedBy?: string;    // deviceId of last pusher
  conflictFiles?: string[]; // files with merge conflicts
  syncState?: SyncPhase;    // current sync phase for this repo
  lastPullResult?: {
    fromHash: string;
    toHash: string;
    fastForward: boolean;
    filesChanged: string[];
    conflictFiles: string[];
  };
}
```

## Appendix B: GitWorkspaceService Addition Signatures

```typescript
// Methods to add to GitWorkspaceService:

interface FetchResult {
  fetchHead: string;
  branches: Record<string, string>;
  pruned: string[];
}

interface PullResult {
  fastForward: boolean;
  fromHash: string;
  toHash: string;
  filesChanged: string[];
  conflictFiles: string[];
}

static async fetchChanges(
  projectName: string,
  token: string,
  remoteName?: string,
  corsProxy?: string,
  prune?: boolean,
  onAuth?: (() => { username: string }) | undefined
): Promise<FetchResult>

static async pullChanges(
  projectName: string,
  token: string,
  remoteName?: string,
  corsProxy?: string,
  author?: { name: string; email: string }
): Promise<PullResult>

static async getUnpushedCommits(
  projectName: string,
  remoteName?: string
): Promise<number>

static async getLocalHash(
  projectName: string,
  ref?: string
): Promise<string>

static async getRemoteRefHash(
  projectName: string,
  ref: string
): Promise<string>

static async checkForConflictMarkers(
  projectName: string,
  filePath: string
): Promise<boolean>

static async listConflictFiles(
  projectName: string
): Promise<string[]>

static async detectConflictBeforePush(
  projectName: string,
  token: string
): Promise<ConflictCheck>
```

## Appendix C: Key Dependencies (Already Installed)

| Package | Version | Purpose | Already in package.json |
|---------|---------|---------|------------------------|
| `idb` | ^8.0.2 | Promise-based IndexedDB wrapper for device identity | ✅ |
| `isomorphic-git` | ^1.29.0 | In-browser git operations | ✅ |
| `@isomorphic-git/lightning-fs` | ^4.6.0 | In-browser filesystem | ✅ |
| `yjs` | ^13.6.31 | CRDT document model for shared state | ✅ |
| `y-webrtc` | ^10.3.0 | P2P document sync for device registry | ✅ |
| `y-indexeddb` | ^9.0.12 | Y.Doc persistence (crdt-sync.ts already uses it) | ✅ |
| `fake-indexeddb` | ^6.2.5 | IndexedDB mock for tests | ✅ (dev) |

**No new npm dependencies required.** All needed packages are already installed. The design only adds TypeScript source files.

---

*End of design document.*
