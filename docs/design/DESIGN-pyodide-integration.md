# Pyodide Python Runtime Integration — Design Document

> **Project:** swal-agent-runner PWA  
> **Status:** Draft — Phase 5 Feature Proposal  
> **Date:** 2026-07-29  
> **Authors:** SWAL Engineering  

---

## Table of Contents

1. [Motivation & Goals](#1-motivation--goals)
2. [Architecture Overview](#2-architecture-overview)
3. [Pyodide Loading Strategy](#3-pyodide-loading-strategy)
4. [Project File Mounting](#4-project-file-mounting)
5. [New Agent Tools](#5-new-agent-tools)
6. [AgentToolExecutor Integration](#6-agenttoolexecutor-integration)
7. [Memory & Performance Considerations](#7-memory--performance-considerations)
8. [File Island Mapping & Risk Assessment](#8-file-island-mapping--risk-assessment)
9. [Implementation Plan](#9-implementation-plan)
10. [Testing Strategy](#10-testing-strategy)
11. [Open Questions](#11-open-questions)

---

## 1. Motivation & Goals

### Problem

The swal-agent-runner PWA currently supports **Node.js execution only**, via `@webcontainer/api`. WebContainers are WASM-compiled Node.js — they cannot run Python. The agent has no ability to execute Python scripts, install pip packages, or run Python-based tools (e.g., test runners, linters, data scripts).

### Goals

- Allow the agent to **run arbitrary Python code** inside the browser (no server).
- Allow the agent to **install pip packages** via `micropip`.
- Expose Python execution as first-class agent tools alongside `run_command`.
- Minimize download size: lazy-load Pyodide only when a Python tool is invoked.
- Preserve offline capability via PWA Service Worker caching.
- **Isolate Python filesystem from Node.js WebContainer filesystem** to prevent conflicts.

### Non-Goals

- Full Python REPL in the UI (the agent is headless).
- Pyodide kernel in a Web Worker for UI responsiveness (defer to Phase 5.1).
- WASM-native packages requiring complex native compilation (e.g., TensorFlow.js).
- Running Python and Node.js simultaneously in the same execution context.

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                      SWAL AGENT RUNNER PWA                          │
│                                                                     │
│  ┌──────────────────────┐    ┌──────────────────────────────────┐   │
│  │   Headless Agent     │    │     Headless Runtimes            │   │
│  │   Loop (ReAct)       │───▶│                                  │   │
│  │                      │    │  ┌───────────────────────────┐   │   │
│  │  ┌────────────────┐  │    │  │ WebContainer (Node.js)    │   │   │
│  │  │ AgentToolExec  │  │    │  │ - npm/node/npx            │   │   │
│  │  │  - read_file   │  │    │  │ - COEP/COOP required      │   │   │
│  │  │  - write_file  │  │    │  └───────────────────────────┘   │   │
│  │  │  - run_command │  │    │                                  │   │
│  │  │  - run_python  │──┼────│▶ ┌───────────────────────────┐   │   │
│  │  │  - pip_install │  │    │  │ PyodideRuntime (Python)   │   │   │
│  │  │  - ...         │  │    │  │ - CPython→WASM            │   │   │
│  │  └────────────────┘  │    │  │ - MEMFS virtual FS        │   │   │
│  └──────────────────────┘    │  │ - micropip for packages   │   │   │
│                              │  └───────────────────────────┘   │   │
│  ┌──────────────────────┐    └──────────────────────────────────┘   │
│  │  Git / LightningFS   │                                           │
│  │  (IndexedDB)         │◀─── File read/write for both runtimes    │
│  └──────────────────────┘                                           │
└─────────────────────────────────────────────────────────────────────┘
```

### Separation Principle

**WebContainer** and **Pyodide** are separate runtime sandboxes. They do not share a filesystem. When the agent calls `run_command`, it mounts project files into WebContainer's WASM FS. When it calls `run_python`, it writes project files into Pyodide's MEMFS. This prevents:

- `/node_modules` → Python import contamination
- Python bytecode caches (`.pyc`) interfering with Node.js operations
- Conflicting `PATH`/environment expectations

---

## 3. Pyodide Loading Strategy

### 3.1 Decision: CDN Loading (Recommended)

**Chosen approach:** Load Pyodide from CDN at runtime, with SW precaching for offline support.

**Rationale:**

| Approach | Pros | Cons |
|----------|------|------|
| **CDN** (chosen) | ~0KB in initial bundle, SW cacheable, simple config | Requires network on first Python tool call (unless precached) |
| **Bundled (viteStaticCopy)** | Works fully offline, no CDN dependency | Adds ~12MB to `dist/`, longer builds, larger PWA update |
| **npm import + optimizeDeps.exclude** | Clean TypeScript types | Still needs WASM + data files served separately |

### 3.2 Vite Configuration

**Add to `vite.config.ts`:**

```typescript
// Exclude pyodide from Vite's dependency pre-bundling
optimizeDeps: {
  exclude: ['pyodide'],
},

// Add runtime caching rule for Pyodide CDN assets
// (in the VitePWA workbox.runtimeCaching array)
{
  urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/pyodide\/.*/i,
  handler: 'CacheFirst',
  options: {
    cacheName: 'pyodide-cdn-cache',
    expiration: {
      maxEntries: 50,
      maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
    },
    // Pyodide WASM file is ~8MB — allow it
    matchOptions: {
      ignoreSearch: false,
    },
  },
},
```

### 3.3 `package.json` Changes

```json
{
  "dependencies": {
    "pyodide": "^0.27.0"
  }
}
```

### 3.4 Lazy Loader Module

Create `src/services/runtime/pyodide-loader.ts`:

```typescript
/**
 * PyodideRuntime — Lazy singleton that loads Pyodide on first use.
 *
 * Loading flow:
 * 1. Dynamic import('pyodide') → loads the JavaScript bootstrap
 * 2. loadPyodide({ indexURL }) → fetches pyodide.asm.wasm (~8MB) +
 *    pyodide.asm.data + pyodide-lock.json
 * 3. Load core packages (micropip, pyodide_http) on init
 * 4. Return ready Pyodide instance
 *
 * Memoizes the promise so concurrent callers share one load.
 */

let pyodideInstancePromise: Promise<Pyodide> | null = null;
let pyodideReady = false;

export interface PyodideRunResult {
  output: string;
  error?: string;
}

export class PyodideRuntime {
  private static readonly PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/v0.27.0/full/';

  /**
   * Get or initialize the Pyodide instance.
   * Returns the same promise for concurrent callers.
   */
  static async getInstance(): Promise<Pyodide> {
    if (!pyodideInstancePromise) {
      pyodideInstancePromise = this.boot();
    }
    return pyodideInstancePromise;
  }

  private static async boot(): Promise<Pyodide> {
    const { loadPyodide } = await import('pyodide');

    const pyodide = await loadPyodide({
      indexURL: this.PYODIDE_CDN,
      // Optional: preload packages during boot
      packages: ['micropip'],
    });

    // Patch HTTP to use fetch/XHR (pyodide_http)
    await pyodide.loadPackage('pyodide_http');
    await pyodide.runPythonAsync(`
      import pyodide_http
      pyodide_http.patch_all()
    `);

    pyodideReady = true;
    return pyodide;
  }

  static isReady(): boolean {
    return pyodideReady;
  }

  static async reset(): Promise<void> {
    // For testing / clean state
    pyodideInstancePromise = null;
    pyodideReady = false;
  }
}
```

### 3.5 Service Worker Precaching Consideration

For **offline Python execution**, we can optionally extend the `VitePWA` config to precache key Pyodide assets:

```typescript
// In a future optimization, use injectManifest mode
// to precache pyodide.asm.wasm and pyodide-lock.json
```

This is deferred to Phase 5.2 — the PWA currently uses `generateSW` mode. Switching to `injectManifest` would be needed for custom precaching of CDN assets.

---

## 4. Project File Mounting

### 4.1 The Challenge

Project files live in **IndexedDB** (`@isomorphic-git/lightning-fs`) and are mounted into WebContainer's WASM FS via `instance.mount(tree)`. Pyodide runs in a **separate** WASM instance — it has its own MEMFS. We must copy project files into Pyodide's virtual FS.

### 4.2 Mount Strategy

Create `src/services/runtime/pyodide-runner.ts`:

```typescript
import { GitWorkspaceService } from '../git/git-service';
import { PyodideRuntime } from './pyodide-loader';

export class PyodideRunnerService {
  /**
   * Mount project files into Pyodide's MEMFS.
   * Only mounts text files (code). Skips node_modules, .git, binaries.
   */
  static async mountProjectFiles(projectName: string): Promise<void> {
    const pyodide = await PyodideRuntime.getInstance();
    const files = await GitWorkspaceService.listDirectory(projectName);

    // Filter: only .py, .txt, .json, .yaml, .toml, .cfg, .ini, .md
    // Skip: node_modules/, .git/, *.bin, .wasm, images
    const PYTHON_RELEVANT = /\.(py|txt|json|yaml|yml|toml|cfg|ini|md|cfg|conf|env|sh|js|ts|html|css)$/i;
    const SKIP_DIRS = /(^|\/)(node_modules|\.git|__pycache__|\.venv|venv|dist|build)(\/|$)/;

    const relevant = files.filter(
      (f) => PYTHON_RELEVANT.test(f) && !SKIP_DIRS.test(f)
    );

    for (const filePath of relevant) {
      try {
        const content = await GitWorkspaceService.readFile(projectName, filePath);
        const pyPath = '/' + filePath;

        // Ensure parent directories exist
        const parent = pyPath.substring(0, pyPath.lastIndexOf('/'));
        if (parent) {
          try {
            pyodide.FS.mkdirTree(parent);
          } catch {
            // Directory may already exist
          }
        }

        pyodide.FS.writeFile(pyPath, content);
      } catch {
        // Skip unreadable files
      }
    }
  }

  /**
   * Get the working directory inside Pyodide.
   * Project files are mounted at /project/<name>/
   */
  static getProjectDir(projectName: string): string {
    return `/project/${projectName}`;
  }
}
```

### 4.3 File Path Mapping Convention

| Location | Runtime | Path Scheme |
|----------|---------|-------------|
| IndexedDB (source of truth) | — | `/<projectName>/<path>` |
| WebContainer (Node.js) | `run_command` | `/` (mount root) |
| Pyodide MEMFS | `run_python` | `/project/<projectName>/<path>` |
| Pyodide tmp | `run_python` | `/tmp/` |

### 4.4 MEMFS → IDBFS for Persistence (Optional)

By default Pyodide uses **MEMFS** (in-memory, lost on reload). For long-running agent sessions that need Python state to persist across page reloads, we can optionally mount **IDBFS** (IndexedDB-backed FS):

```typescript
// Mount IDBFS at /persist for cross-session Python data
const mountDir = '/persist';
pyodide.FS.mkdirTree(mountDir);
pyodide.FS.mount(pyodide.FS.filesystems.IDBFS, {}, mountDir);
// Sync from IndexedDB → MEMFS on mount
pyodide.FS.syncfs(true, (err) => { /* handle */ });
```

This is an **optional optimization** — the source of truth remains `GitWorkspaceService` (IndexedDB), so we can always re-mount on reload.

---

## 5. New Agent Tools

### 5.1 Tool Declarations

Add to `src/agent/agent-tools.ts`:

```typescript
{
  name: 'run_python',
  description: 'Execute Python code inside the browser Pyodide runtime. ' +
    'Project files (.py, .json, .txt, .yaml) are mounted at /project/<name>/ ' +
    'before execution. Supports Python standard library + installed packages.',
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'Python code to execute. Can be a multi-line script.',
      },
      projectName: {
        type: 'string',
        description: 'Project name to mount files from (optional, uses current project if omitted).',
      },
      cwd: {
        type: 'string',
        description: 'Working directory inside Pyodide FS (default: /project/<projectName>).',
      },
    },
    required: ['code'],
  },
},
{
  name: 'pip_install',
  description: 'Install one or more Python packages via micropip into the Pyodide runtime. ' +
    'Only pure-Python wheels (or packages pre-built for Pyodide) are supported.',
  parameters: {
    type: 'object',
    properties: {
      packages: {
        type: 'string',
        description: 'Space-separated list of package names, e.g. "numpy pandas requests". ' +
          'Can also be a requirements.txt fragment.',
      },
    },
    required: ['packages'],
  },
},
```

### 5.2 Tool Behavior Specifications

#### `run_python`

**Input:** Python code string + optional project name + optional cwd  
**Execution logic:**

1. Lazily boot Pyodide (if not already loaded).
2. If `projectName` is provided and differs from the last mounted project, call `mountProjectFiles()`.
3. Optionally `chdir` to the project directory: `pyodide.runPython(`os.chdir('${cwd}')`)`.
4. Execute code via `pyodide.runPythonAsync(code)`.
5. Capture stdout/stderr (via `pyodide.setStdout` / `pyodide.setStderr`).
6. Return captured output + exit code semantics (0 for success, 1 for exception).

**stdout/stderr capture strategy:**

```typescript
private static stdoutBuffer: string[] = [];
private static stderrBuffer: string[] = [];

private static captureOutput(pyodide: Pyodide): void {
  this.stdoutBuffer = [];
  this.stderrBuffer = [];

  pyodide.setStdout({
    batched: (text: string) => this.stdoutBuffer.push(text),
  });
  pyodide.setStderr({
    batched: (text: string) => this.stderrBuffer.push(text),
  });
}

private static getCapturedOutput(): { stdout: string; stderr: string } {
  return {
    stdout: this.stdoutBuffer.join('\n'),
    stderr: this.stderrBuffer.join('\n'),
  };
}
```

**Output format:**

```
Exit Code: 0
——— stdout ———
<captured stdout>
——— stderr ———
<captured stderr>
```

#### `pip_install`

**Input:** Space-separated package names string  
**Execution logic:**

1. Ensure micropip is loaded (done during boot).
2. Parse package string into array (split by whitespace, ignore empties).
3. Call `await pyodide.runPythonAsync(`import micropip; await micropip.install([...])`)`.
4. Capture output.

**Known limitations communicated to the LLM via tool description:**

- Only pure-Python wheels supported (no C extensions unless pre-built for Pyodide).
- Network access required for micropip (respects PWA offline constraints).
- Large packages (numpy, pandas, scipy) are pre-built for Pyodide on CDN — use exact version pins.

---

## 6. AgentToolExecutor Integration

### 6.1 New Cases in `executeTool`

Add two new cases to the switch in `AgentToolExecutor.executeTool()`:

```typescript
case 'run_python': {
  const code = args.code as string;
  const projectName = (args.projectName as string) || projectName;
  const cwd = args.cwd as string | undefined;

  if (onLog) onLog(`Executing Python code (${code.length} chars)...`);

  try {
    if (projectName) {
      await PyodideRunnerService.mountProjectFiles(projectName);
    }

    // Set working directory
    if (cwd) {
      // chdir is handled inside the Python execution
    }

    const output = await PyodideRunnerService.runPython(code, projectName, cwd);
    return { output };
  } catch (err: any) {
    return { output: `Python execution error: ${err.message || err}` };
  }
}

case 'pip_install': {
  const packages = args.packages as string;
  if (onLog) onLog(`Installing pip packages: ${packages}`);

  try {
    const output = await PyodideRunnerService.installPackages(packages);
    return { output };
  } catch (err: any) {
    return { output: `Pip install error: ${err.message || err}` };
  }
}
```

### 6.2 Tool Availability Toggle

Since Pyodide is ~8MB WASM, the agent should know whether Python tools are available:

```typescript
// In agent-tools.ts or a new runtime-status module
export const AVAILABLE_RUNTIMES = {
  node: true,         // WebContainer always available
  python: true,       // Pyodide — available after first boot
};

// The AGENT_TOOLS array always includes both run_python and pip_install.
// If Pyodide fails to load, the tools return an explanatory error.
```

No runtime detection in the tool declarations — the agent always sees the tools but gets an error if boot fails.

### 6.3 System Prompt Update

The agent system prompt in `agent-loop.ts` should be updated to mention Python capabilities:

```
Your goal is to complete the assigned coding task independently...

Available runtimes:
- Node.js (via run_command): Use for JavaScript/TypeScript projects.
- Python (via run_python): Use for Python projects. Project files are 
  automatically mounted into Pyodide's filesystem. Use pip_install to 
  install packages before importing them.
```

---

## 7. Memory & Performance Considerations

### 7.1 Pyodide WASM Size

| Asset | Size | Notes |
|-------|------|-------|
| `pyodide.asm.wasm` | ~8.1 MB | Main WASM binary (gzipped: ~3.2 MB) |
| `pyodide.asm.data` | ~1.2 MB | Data segment |
| `pyodide-lock.json` | ~180 KB | Package index |
| `pyodide.mjs` | ~280 KB | JS bootstrap (gzipped: ~85 KB) |
| **Total initial load** | **~10 MB** (~4 MB gzipped) |

### 7.2 Memory Budget

- Pyodide runtime baseline: **~15-25 MB** WASM heap
- Per additional package (numpy): **+5-10 MB**
- Recommended ceiling: **100 MB** total WASM memory

### 7.3 Mitigation Strategies

| Strategy | Implementation |
|----------|----------------|
| **Lazy loading** | Boot Pyodide only on first `run_python` or `pip_install` call. The `PyodideRuntime.getInstance()` memoized promise ensures a single boot sequence. |
| **Single instance** | Reuse the same Pyodide instance across the agent's lifetime. No create/destroy cycles. |
| **Worker isolation (Phase 5.1)** | Run Pyodide in a dedicated Web Worker to avoid blocking the UI thread during Python execution. |
| **Package caching** | SW `CacheFirst` for CDN assets means Pyodide is cached after first load. Subsequent loads are instant. |
| **Memory limit** | Pyodide supports `PYTHONMEMORY` env var or `_pyodide._module.setStandardModuleElfSizeLimit()`. Set a reasonable cap. |
| **GC hints** | After large Python operations, call `pyodide.runPython('import gc; gc.collect()')` to reclaim unused memory. |

### 7.4 Thread Model

```
┌──────────────────────────────────────────────────────────────┐
│                     Main Thread                               │
│  ┌─────────────┐  ┌──────────────────┐  ┌─────────────────┐  │
│  │ React UI    │  │ Agent Loop       │  │ Tool Executor   │  │
│  │ (components)│  │ (LLM calls)      │  │ (dispatch)      │  │
│  └─────────────┘  └──────────────────┘  └────────┬────────┘  │
│                                                  │            │
│  ┌───────────────────────────────────────────────▼──────────┐ │
│  │  PyodideRuntime (main-thread, synchronous runPython)     │ │
│  │  WARNING: Blocks UI during long Python executions        │ │
│  └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

**Current design:** Pyodide runs on the **main thread** because `runPython` is synchronous. `runPythonAsync` yields for `await` but still runs on main. This is acceptable because:

- Agent tasks are already asynchronous (LLM calls take longer than most Python execs).
- For CPU-bound Python (e.g., data processing), a **Worker** should be used (Phase 5.1).

### 7.5 Phase 5.1: Web Worker Migration (Future)

For heavy Python workloads, wrap Pyodide in a Worker:

```typescript
// pyodide-worker.ts
import { loadPyodide } from 'pyodide';

let pyodide: Pyodide;

self.onmessage = async (e) => {
  const { id, type, code, packages } = e.data;

  if (!pyodide) {
    pyodide = await loadPyodide({ indexURL: '...' });
  }

  switch (type) {
    case 'run':
      try {
        const result = await pyodide.runPythonAsync(code);
        self.postMessage({ id, result });
      } catch (err) {
        self.postMessage({ id, error: err.message });
      }
      break;
    case 'install':
      await pyodide.runPythonAsync(`await micropip.install(${JSON.stringify(packages)})`);
      self.postMessage({ id, result: 'installed' });
      break;
  }
};
```

---

## 8. File Island Mapping & Risk Assessment

### 8.1 Filesystem Isolation Diagram

```
┌────────────────────────────────────────────────────────────────────┐
│                        BROWSER TAB                                 │
│                                                                    │
│  ┌─────────────────────┐    ┌──────────────────────────────────┐   │
│  │  IndexedDB           │    │  WebContainer (Node.js WASM)    │   │
│  │  (LightningFS)       │    │  Files: / (all mounted files)   │   │
│  │  ┌─────────────────┐ │    │  ├── package.json              │   │
│  │  │ /swal-project/  │ │    │  ├── src/                      │   │
│  │  │   package.json  │ │    │  └── ...                       │   │
│  │  │   src/          │ │    │  node_modules/ accessible      │   │
│  │  │   .git/         │◄┼────│  /home/user (NODERAWFS)        │   │
│  │  └─────────────────┘ │    └──────────────────────────────────┘   │
│  └─────────────────────┘                                            │
│         │                                                           │
│         │ writeFile / readFile (GitWorkspaceService)                │
│         ▼                                                           │
│  ┌─────────────────────────────────────────────────────────┐       │
│  │  Pyodide MEMFS (Python WASM)                            │       │
│  │  Files: /project/<name>/ (copied, not symlinked)        │       │
│  │  ├── /project/swal-project/src/main.py                  │       │
│  │  ├── /project/swal-project/requirements.txt             │       │
│  │  └── /tmp/                                              │       │
│  │  NO node_modules, NO .git in Pyodide FS                 │       │
│  └─────────────────────────────────────────────────────────┘       │
└────────────────────────────────────────────────────────────────────┘
```

### 8.2 Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| **File write conflicts** — Python writes file, then Node.js tries to read stale version | Medium | Source of truth is IndexedDB. Both runtimes copy files **in** before execution. Python writes back via `GitWorkspaceService.writeFile()` or the agent's `write_file` tool. |
| **`node_modules` in Python path** — Python accidentally imports JS code | Low | Pyodide FS is fully separate. `node_modules/` is never mounted. |
| **`.pyc`/`__pycache__` in IndexedDB** | Low | Filtered by mount function (SKIP_DIRS). If Python writes cache, it stays in MEMFS only. |
| **Large file copies** — mounting multi-GB projects into MEMFS | High | LightningFS already stores all files. We filter to <100KB per file in initial mount, or cap total mount size at 50MB. Agent should `mountProjectFiles()` once, not per invocation. |
| **Pyodide boot failure** — CDN down, WASM unsupported | Medium | Tools return descriptive error. Agent can fall back to Node.js. Feature detection on boot. |
| **Memory exhaustion** — Python allocates >100MB | Medium | Set WASM memory ceiling. Monitor with `performance.memory`. |
| **COOP/COEP conflict** — Pyodide's SharedArrayBuffer requirements | Low | Vite already serves COEP/COOP headers for WebContainer. Pyodide doesn't need SAB for basic operation — only for `PYTHONWORKER` mode (not used). |
| **CSP violation** — Pyodide uses `eval()` / `Function()` | Low | Pyodide's WASM execution doesn't require `unsafe-eval` in CSP. `runPython` compiles to WASM, not eval. |

### 8.3 Security Considerations

1. **micropil installs from PyPI** — same trust model as pip. The agent is already trusted code within the PWA sandbox.
2. **No filesystem escape** — Pyodide MEMFS is sandboxed within the browser; no access to host OS files.
3. **No network sockets** — Pyodide cannot open raw TCP/UDP sockets. All HTTP uses browser Fetch API.
4. **XSS surface** — Python code string comes from LLM output. Use `runPythonAsync` (not `pyodide.eval` or `pyodide.globals.set`). The code string is already agent-generated, not user-provided, but still prudent to wrap in a fresh globals dict per invocation:

```typescript
// Isolation per run_python call
const result = await pyodide.runPythonAsync(code, {
  globals: pyodide.toPy({ __name__: '__main__' }),
});
```

---

## 9. Implementation Plan

### Phase 5.0 — Core Integration (Estimated: 2-3 days)

| Step | File(s) | Description |
|------|---------|-------------|
| 1 | `package.json` | Add `pyodide` dependency |
| 2 | `vite.config.ts` | Add `optimizeDeps.exclude: ['pyodide']` + CDN SW caching rule |
| 3 | `src/services/runtime/pyodide-loader.ts` | Lazy singleton loader for Pyodide |
| 4 | `src/services/runtime/pyodide-runner.ts` | File mounting + `runPython` + `installPackages` |
| 5 | `src/agent/agent-tools.ts` | Add `run_python` and `pip_install` tool declarations |
| 6 | `src/agent/agent-tools.ts` | Add switch cases in `AgentToolExecutor.executeTool` |
| 7 | `src/agent/agent-loop.ts` | Update system prompt with Python capabilities |
| 8 | `src/types/index.ts` | Add any new types (optional) |

### Phase 5.1 — Worker & Offload (Future)

| Step | Description |
|------|-------------|
| 1 | Create `pyodide.worker.ts` |
| 2 | Refactor `PyodideRuntime` to proxy through worker |
| 3 | Add Comlink or manual postMessage bridge |
| 4 | Benchmark thread blocking improvement |

### Phase 5.2 — Offline & Precaching (Future)

| Step | Description |
|------|-------------|
| 1 | Switch VitePWA to `injectManifest` mode |
| 2 | Add Pyodide assets to precache manifest |
| 3 | Test full offline Python execution |

---

## 10. Testing Strategy

### Unit Tests

| Test | File | Description |
|------|------|-------------|
| `pyodide-loader.boot()` | `pyodide-loader.test.ts` | Verify singleton pattern, promise memoization |
| `pyodide-runner.mountProjectFiles()` | `pyodide-runner.test.ts` | Verify files from GitWorkspaceService are written to MEMFS with correct paths |
| `pyodide-runner.runPython()` | `pyodide-runner.test.ts` | Verify stdout capture, error handling |
| `agent-tools: run_python` | `agent-tools.test.ts` | Verify executor dispatches to PyodideRunnerService |
| `agent-tools: pip_install` | `agent-tools.test.ts` | Verify executor dispatches install command |

### Integration Tests

| Test | Description |
|------|-------------|
| Agent loop using `run_python` | Complete task: write Python file → run Python → verify output |
| Agent mixing `run_command` + `run_python` | Verify file island isolation (no cross-contamination) |

### Testing Constraints

- Pyodide **cannot boot in Node.js test runner** (requires WASM + browser APIs).
- Use `vitest` + `jsdom` environment with **mock** for `pyodide` module during unit tests.
- Integration tests require a real browser (Playwright or Cypress).

**Mock strategy for unit tests:**

```typescript
// src/services/runtime/__mocks__/pyodide.ts
export const loadPyodide = vi.fn().mockResolvedValue({
  FS: {
    writeFile: vi.fn(),
    mkdirTree: vi.fn(),
    readFile: vi.fn(),
    mount: vi.fn(),
    syncfs: vi.fn(),
    filesystems: { IDBFS: {} },
  },
  runPythonAsync: vi.fn().mockResolvedValue(undefined),
  runPython: vi.fn().mockReturnValue(undefined),
  loadPackage: vi.fn().mockResolvedValue(undefined),
  setStdout: vi.fn(),
  setStderr: vi.fn(),
  globals: { get: vi.fn() },
  toPy: vi.fn(),
});
```

---

## 11. Open Questions

1. **Worker timing** — Should Worker offloading be included in Phase 5.0 or deferred to 5.1? Recommendation: defer, as the agent loop is already async and Pyodide's synchronous execution fits the current model.

2. **Python version pinning** — Pyodide ships CPython 3.12. Should we pin a specific Pyodide version in the CDN URL? YES — pin `v0.27.0` to avoid breaking changes.

3. **npm package type declarations** — `pyodide` npm package ships its own `d.ts`. Do we need custom type augmentations? Minimal — we may need to declare `Pyodide.FS.mkdirTree()` (not always in types).

4. **micropil package URLs** — For offline operation, should we vendor specific `.whl` files and serve them from the PWA's own origin? Deferred to Phase 5.2.

5. **`run_python` timeout** — Should we enforce a timeout on Python execution to prevent infinite loops? YES — add a configurable timeout (default: 30s) wrapping `runPythonAsync` with `Promise.race`:

```typescript
static async runPythonWithTimeout(code: string, timeoutMs = 30_000): Promise<PyodideRunResult> {
  const pyodide = await this.getInstance();
  const result = pyodide.runPythonAsync(code);
  const timer = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Python execution timed out')), timeoutMs)
  );
  return Promise.race([result, timer]);
}
```

---

## Appendix A: Dependency Graph

```
agent-loop.ts
  └── agent-tools.ts
        ├── git-service.ts
        ├── xavier-memory-node.ts
        ├── webcontainer-runner.ts ──── @webcontainer/api (existing)
        └── pyodide-runner.ts ──── pyodide-loader.ts ──── pyodide (npm)
              └── git-service.ts (read files to mount)
```

## Appendix B: CDN Cache Strategy Flow

```
First run_python call
  │
  ▼
Dynamic import('pyodide') ──┬── SW cache hit (CacheFirst) → load from cache
                            └── SW cache miss → fetch from CDN → cache for 30d
  │
  ▼
loadPyodide({ indexURL })
  │
  ├── pyodide.asm.wasm  (~8MB) ── cached by SW
  ├── pyodide-lock.json (~180KB) ── cached by SW
  └── pyodide.asm.data (~1.2MB) ── cached by SW
  │
  ▼
loadPackage('micropip') ── cached by SW (same CDN pattern)
  │
  ▼
Pyodide ready for run_python / pip_install
```

---

*End of Design Document — SWAL GitCore Protocol v3.9.0*
