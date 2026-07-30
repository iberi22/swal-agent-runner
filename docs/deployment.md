# 🌐 SWAL Agent Runner — Deployment, Configuration & Operations Guide

> **Protocol Version:** v3.9.0
> **Status:** Production Ready
> **Target Node Role:** SWAL Development & Memory Edge Node (Browser PWA + WebContainer + Pyodide + Xavier P2P)

This guide provides exhaustive, end-to-end instructions for deploying, configuring, monitoring, and troubleshooting the **SWAL Agent Runner** Progressive Web App (PWA).

---

## 📌 Table of Contents

1. [Overview & Architecture](#1-overview--architecture)
2. [Step-by-Step Deployment](#2-step-by-step-deployment)
   - [Building the Application](#building-the-application)
   - [Deploying to GitHub Pages](#deploying-to-github-pages)
   - [Deploying to Vercel](#deploying-to-vercel)
   - [Deploying to Netlify](#deploying-to-netlify)
   - [Deploying to Cloudflare Pages](#deploying-to-cloudflare-pages)
   - [Deploying with Docker & Nginx/Caddy](#deploying-with-docker--nginxcaddy)
3. [Configuration & Environment Variables](#3-configuration--environment-variables)
   - [Environment Variables Reference](#environment-variables-reference)
   - [CORS Proxies Explained](#cors-proxies-explained)
   - [Crucial Security Headers (COOP & COEP)](#crucial-security-headers-coop--coep)
   - [Secure Encrypted Storage](#secure-encrypted-storage)
4. [Monitoring & Telemetry](#4-monitoring--telemetry)
   - [WebRTC Room Mesh Monitoring](#webrtc-room-mesh-monitoring)
   - [CRDT Event Bus Lifecycle Events](#crdt-event-bus-lifecycle-events)
   - [Console Logs & Diagnostics](#console-logs--diagnostics)
   - [Storage Quotas & Estimates](#storage-quotas--estimates)
5. [Troubleshooting & FAQs](#5-troubleshooting--faqs)
   - [WebContainer & SharedArrayBuffer Errors](#webcontainer--sharedarraybuffer-errors)
   - [Git & CORS Connection Failures](#git--cors-connection-failures)
   - [Infinite ReAct Loops & Halting](#infinite-react-loops--halting)
   - [WebRTC & Pairing Failures](#webrtc--pairing-failures)
   - [Pyodide WASM & Dependency Failures](#pyodide-wasm--dependency-failures)
   - [PWA Service Worker & Caching Issues](#pwa-service-worker--caching-issues)
   - [IndexedDB Storage Quota Limits](#indexeddb-storage-quota-limits)

---

## 1. Overview & Architecture

`swal-agent-runner` is designed to operate as a completely self-contained, browser-based, zero-desktop-dependency execution environment for autonomous coding agents.

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
│ MULTI-LLM MANAGER    │   │ WEBCONTAINER RUNTIME │   │ PYODIDE WASM ENGINE  │
│ - Google AI Pro OAuth│   │ - Headless Wasm Exec │   │ - Python WASM Exec   │
│ - Gemini API         │   │ - Process Supervisor │   │ - pip/micropip pkgs  │
│ - OpenRouter API     │   │ - LightningFS Mount  │   └──────────────────────┘
│ - OpenCodeGo API     │   └──────────────────────┘   ┌──────────────────────┐
└──────────────────────┘                              │ XAVIER MEMORY NODE   │
                                                      │ - Local Vector DB    │
                                                      │ - edge-mesh P2P Sync │
                                                      └──────────────────────┘
```

The system pairs two in-browser sandbox runtimes:
- **Node.js WebContainer Engine (`@webcontainer/api`)**: Runs Node.js, installs npm packages, compiles TypeScript, and runs test suites inside a sandboxed browser environment.
- **Python Pyodide WASM Runtime**: Executes Python scripts directly on the main thread or Web Workers, with dynamic dependency installation via `micropip`.

To coordinate work across devices, it relies on an offline-first **Yjs CRDT Document Model** synchronized in real-time over **y-webrtc** or direct 1:1 PeerJS links.

---

## 2. Step-by-Step Deployment

Deploying `swal-agent-runner` requires building static assets and hosting them on a web server configured with specific HTTP headers (COOP and COEP) that allow browser context isolation.

### Building the Application

Ensure you have Node.js (v20+ recommended) and `pnpm` installed.

1. Install project dependencies:
   ```bash
   pnpm install
   ```

2. Compile TypeScript and generate the optimized production bundle:
   ```bash
   pnpm run build
   ```

The output will be placed inside the `dist/` folder. This includes the application's HTML, stylesheets, chunked JavaScript modules, Web Worker scripts, PWA manifests, and service worker registration assets.

---

### Deploying to GitHub Pages

`swal-agent-runner` is pre-configured to build for deployment to GitHub Pages under the subpath `/swal-agent-runner/`.

#### Automatic Deployment via GitHub Actions
A GitHub Actions workflow is provided in `.github/workflows/deploy.yml`. When you push changes to the `main` branch, the workflow:
1. Installs project dependencies via `pnpm`.
2. Compiles and builds the production bundle.
3. Automatically deploys the contents of `dist/` to the `gh-pages` branch.

To support subpath routing and service worker scopes without manual code adjustments, `vite.config.ts` uses:
- `base: '/swal-agent-runner/'` to ensure asset URLs map correctly.
- A custom `replace-sw-path` transform plugin that maps service worker registrations dynamically to the subpath base.

#### Manual Deployment & Actions Budget Monitoring
If the GitHub Actions budget is exhausted (which resets on the 1st of each month), automatic builds will not trigger. You can monitor the billing status and trigger the deploy workflow manually once the budget resets.

1. **Monitor Actions Budget**:
   Query the GitHub API to check if you have available minutes left:
   ```bash
   gh api repos/iberi22/swal-agent-runner/actions/billing
   ```
   Alternatively, you can run the provided utility monitoring script:
   ```bash
   ./bin/monitor-billing.sh
   ```

2. **Run the Workflow Manually**:
   Once the budget is reset, run the deployment workflow manually using the GitHub CLI:
   ```bash
   gh workflow run "Deploy PWA to GitHub Pages" --repo iberi22/swal-agent-runner
   ```
   Or go to the **Actions** tab on your GitHub repository, select **Deploy PWA to GitHub Pages**, click the **Run workflow** dropdown, and click **Run workflow**.

3. **Verify Site and Performance**:
   - Check that the `gh-pages` branch has been created/updated.
   - Verify that `https://iberi22.github.io/swal-agent-runner/` responds with `200 OK`.
   - Run a Lighthouse mobile audit to ensure the production score is greater than 90 (Mobile Score > 90).

#### Crucial Subpath Setup
If deploying to a custom user repository like `https://<username>.github.io/<custom-repo-name>/`, you **must** update the `base` property in `vite.config.ts` before building:
```typescript
// vite.config.ts
export default defineConfig({
  base: '/<custom-repo-name>/',
  // ...
})
```

---

### Deploying to Vercel

Vercel is an excellent hosting platform that allows injecting headers using a configuration file.

1. Create a `vercel.json` file in the root of the project:
   ```json
   {
     "headers": [
       {
         "source": "/(.*)",
         "headers": [
           {
             "key": "Cross-Origin-Embedder-Policy",
             "value": "require-corp"
           },
           {
             "key": "Cross-Origin-Opener-Policy",
             "value": "same-origin"
           },
           {
             "key": "X-Content-Type-Options",
             "value": "nosniff"
           },
           {
             "key": "X-Frame-Options",
             "value": "DENY"
           },
           {
             "key": "Content-Security-Policy",
             "value": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://api.qrserver.com; connect-src 'self' https://* wss://*; worker-src 'self' blob:;"
           }
         ]
       }
     ]
   }
   ```
2. Deploy using the Vercel CLI (`vercel --prod`) or link your repository to the Vercel Dashboard.

---

### Deploying to Netlify

Netlify allows configuring custom HTTP response headers via a `_headers` file.

1. Create a `public/_headers` file (which will be copied to `dist/` on build):
   ```text
   /*
     Cross-Origin-Embedder-Policy: require-corp
     Cross-Origin-Opener-Policy: same-origin
     X-Content-Type-Options: nosniff
     X-Frame-Options: DENY
     Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://api.qrserver.com; connect-src 'self' https://* wss://*; worker-src 'self' blob:;
   ```
2. Deploy through the Netlify dashboard or the CLI (`netlify deploy --prod`).

---

### Deploying to Cloudflare Pages

Cloudflare Pages lets you configure headers through a `_headers` file located in the build output directory.

1. Ensure the `_headers` file shown in the Netlify section is placed inside the `public/` directory so it is copied into `dist/` during the build step.
2. Link your GitHub repository to Cloudflare Pages.
3. Configure the **Build command** to `pnpm run build` and the **Output directory** to `dist`.

---

### Deploying with Docker & Nginx/Caddy

For self-hosted virtual private servers (VPS) or corporate environments, containerizing the build with Nginx or Caddy is the most secure approach.

#### Option A: Dockerfile with Nginx
Create a `Dockerfile` in the root directory:
```dockerfile
# Step 1: Build the PWA
FROM node:20-alpine AS builder
RUN npm install -g pnpm
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

# Step 2: Serve using Nginx
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

Create `nginx.conf`:
```nginx
server {
    listen 80;
    server_name localhost;
    root /usr/share/nginx/html;
    index index.html;

    # Crucial COOP & COEP Security Headers
    add_header Cross-Origin-Embedder-Policy "require-corp" always;
    add_header Cross-Origin-Opener-Policy "same-origin" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;

    # Strict Content-Security-Policy
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://api.qrserver.com; connect-src 'self' https://* wss://*; worker-src 'self' blob:;" always;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets aggressively
    location ~* \.(?:ico|css|js|gif|jpe?g|png|woff2?|eot|ttf|svg|webmanifest)$ {
        expires 6M;
        access_log off;
        add_header Cache-Control "public, max-age=15778463";
        add_header Cross-Origin-Embedder-Policy "require-corp" always;
        add_header Cross-Origin-Opener-Policy "same-origin" always;
    }
}
```

Build and run the Docker image:
```bash
docker build -t swal-agent-runner .
docker run -d -p 8080:80 swal-agent-runner
```

---

## 3. Configuration & Environment Variables

### Environment Variables Reference

Configure environment variables in a `.env` file for development or inject them into your hosting provider's dashboard for production:

| Variable Name | Description | Default Value / Example |
|---|---|---|
| `VITE_CORS_PROXY_URL` | CORS proxy URL for routing Git remote commands | `https://cors-proxy.swal.dev` |
| `VITE_GOOGLE_OAUTH_CLIENT_ID` | OAuth2 Client ID for Google AI Pro authentication | `your-id.apps.googleusercontent.com` |
| `VITE_DEFAULT_XAVIER_PEER` | Default PC workstation Xavier memory node URL | `http://localhost:8006` |

---

### CORS Proxies Explained

Web browsers strictly enforce the **Same-Origin Policy (SOP)**, blocking direct raw TCP or HTTPS requests from origin `localhost:5173` or `yoursite.com` to Git servers like `github.com` or `gitlab.com`.

```
┌─────────────┐                    Blocked by SOP                  ┌─────────────┐
│ Browser PWA │ ─────────────────────────────────────────────────> │ GitHub API  │
└─────────────┘                                                    └─────────────┘
       │                                                                  ▲
       │ Route Git remote requests securely                               │
       ▼                                                                  │
┌──────────────┐                                                          │
│ CORS Proxy   │ ─────────────────────────────────────────────────────────┘
│ (HTTP Bridge)│
└──────────────┘
```

`swal-agent-runner` utilizes `isomorphic-git` which routes all fetch, push, and clone operations through a configurable **CORS Proxy** specified by `VITE_CORS_PROXY_URL`.
- **Default Proxy**: Southwestern AI Labs hosts a public CORS proxy (`https://cors-proxy.swal.dev`).
- **Sovereign Setup**: For enterprise security, host your own CORS proxy using `cors-anywhere` or the isomorphic-git proxy server. Configure your VPS proxy URL and update the `VITE_CORS_PROXY_URL` accordingly.

---

### Crucial Security Headers (COOP & COEP)

The headless `@webcontainer/api` process execution runtime executes real Node.js programs compiled to WASM. To achieve near-native performance, it spawns multi-threaded contexts requiring browser **`SharedArrayBuffer`** APIs.

Modern browsers restrict `SharedArrayBuffer` strictly to **Secure Contexts** (HTTPS or localhost) and environments isolated by the following HTTP headers:

1. **Cross-Origin-Opener-Policy (COOP)**: Set to `same-origin`.
   * *Purpose*: Isolates your window context from other tabs on other origins.
2. **Cross-Origin-Embedder-Policy (COEP)**: Set to `require-corp`.
   * *Purpose*: Restricts your window from loading external resources that do not explicitly grant cross-origin read permissions.

#### Vite Build Integration
In `vite.config.ts`, these headers are automatically served during local development and production previewing:
```typescript
server: {
  headers: {
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Opener-Policy': 'same-origin',
  }
}
```

---

### Secure Encrypted Storage

`swal-agent-runner` prioritizes user credential security. All highly sensitive variables:
- Google Gemini API Keys
- OpenRouter API Keys
- Custom OpenCodeGo and OpenAI endpoint credentials
- Git Personal Access Tokens (PATs) and usernames

are **stored locally on the client's device** using browser encrypted local storage and IndexedDB.
- Credentials **never** touch SWAL servers.
- Google AI Pro / Gemini Advanced utilizes **OAuth2 with PKCE (Proof Key for Code Exchange)**. The authorization token is held entirely in memory or browser session context and is refreshed via secure PKCE token exchange directly with Google API servers.

---

## 4. Monitoring & Telemetry

Operating a decentralized node mesh requires tracing task completions, peering statuses, and local browser storage availability.

### WebRTC Room Mesh Monitoring

The P2P WebRTC mesh connects local phone, tablet, and PC nodes in a collaborative space.

```
┌──────────────────────────────────────────────┐
│  Connected Devices  (3)                       │
│                                               │
│  ● My Phone (this device)                     │
│    ID: swal-f10a-4293  | Type: Phone          │
│                                               │
│  ● PC-Workstation                             │
│    ID: swal-39f2-21ea  | Type: PC             │
│    Active: isomorphic-git (main)              │
│                                               │
│  ● Pixel Tablet                               │
│    ID: swal-92ba-771c  | Type: Tablet         │
│    Git Sync State: Synced                     │
└──────────────────────────────────────────────┘
```

Monitor your room's active membership on the **P2P Mesh** tab:
1. **Device Identity Panel**: View your device's persistent UUID and assign it a custom user-friendly name (e.g., "Developer iPad").
2. **Peer Directory List**: Displays active nodes, their current battery/online state, and active Git branch directories.
3. **Room Status Indicator**: Shows whether you are `joined`, `connecting`, or `synced` inside the room.

---

### CRDT Event Bus Lifecycle Events

The ReAct Agent Loop (`src/agent/agent-loop.ts`) publishes real-time telemetry events onto a shared Yjs `Y.Array` CRDT-backed Event Bus (`src/services/mesh/crdt-event-bus.ts`).

To programmatically monitor agent executions or hook third-party monitoring tools, subscribe to these 6 lifecycle events:

1. **`run:started`**: Emitted when a new agent task starts executing.
   * *Payload*: `{ taskId, prompt, provider, model, timestamp }`
2. **`run:phase`**: Fired when the agent transitions plan phases (e.g., from *Reading files* to *Running tests*).
   * *Payload*: `{ taskId, phaseName, stepNumber }`
3. **`step:progress`**: Dispatched during active tool execution.
   * *Payload*: `{ taskId, toolName, input, outputLog, iterationCount }`
4. **`run:completed`**: Triggered when the task successfully concludes and changes are staged.
   * *Payload*: `{ taskId, duration, filesChanged, resultSummary }`
5. **`run:failed`**: Emitted if the agent terminates due to errors or hits the execution limit.
   * *Payload*: `{ taskId, errorCode, errorMessage }`
6. **`mesh:peer-joined` / `mesh:peer-left`**: Emitted as WebRTC room connections fluctuate.

#### Subscribing to CRDT Events
Consume telemetry in real-time within React components using the provided `useCrdtEvents` hook:
```typescript
import { useCrdtEvents } from './hooks/useCrdtEvents';

const MyTelemetryMonitor = () => {
  const events = useCrdtEvents({ filterType: 'run:phase' });
  return (
    <ul>
      {events.map(ev => (
        <li key={ev.id}>{ev.payload.phaseName} at {new Date(ev.timestamp).toLocaleTimeString()}</li>
      ))}
    </ul>
  );
};
```

---

### Console Logs & Diagnostics

- **Foreman Telemetry Console**: Direct feed capturing the inner execution step logs of individual sub-agents and the main orchestrator loop.
- **WebContainer Output Terminal**: Live stream of standard output (`stdout`) and standard error (`stderr`) pipes from sandboxed shell runs (e.g., outputs of `npm install` and `vitest`).
- **Browser Developer Console**: To view low-level WebRTC connections, IndexedDB read/writes, and Pyodide compilation logs, open Chrome DevTools (`F12` / `Ctrl+Shift+I`) and filter by `[EdgeMesh]`, `[GitSync]`, or `[Pyodide]`.

---

### Storage Quotas & Estimates

Because LightningFS, Git workspaces, and Xavier memory chunks are backed by browser IndexedDB, monitoring storage quotas is essential, especially on space-constrained mobile browsers.

```typescript
// Query browser storage limits programmatically
navigator.storage.estimate().then((estimate) => {
  const usedMB = (estimate.usage || 0) / (1024 * 1024);
  const totalMB = (estimate.quota || 0) / (1024 * 1024);
  console.log(`IndexedDB Storage: ${usedMB.toFixed(2)} MB of ${totalMB.toFixed(2)} MB used`);
});
```

---

## 5. Troubleshooting & FAQs

### WebContainer & SharedArrayBuffer Errors

#### Symptom:
"SharedArrayBuffer is not defined", "WebContainer failed to boot", or the agent gets stuck loading on step 1 of task execution.

#### Root Causes:
1. **Unsecured Context**: You are serving the app over standard HTTP (`http://yoursite.com`). WebContainers require HTTPS.
2. **Missing Headers**: The hosting platform is serving the PWA without sending COOP and COEP headers.

#### Resolutions:
- Ensure the deployment URL uses `https://`.
- If hosting on local IP addresses from your PC to test on your Android phone, browsers treat local network IPs (e.g., `192.168.1.50`) as **insecure**. You **must** access it via `localhost` (using Chrome USB debugging or port-forwarding) or configure your mobile Chrome flags (`chrome://flags/#unsafely-treat-insecure-origin-as-secure`) to trust your local computer's IP address.
- Double-check the configuration of your web server (Vercel, Netlify, Nginx, or Docker) and verify using browser DevTools Network tab that the response headers `Cross-Origin-Embedder-Policy: require-corp` and `Cross-Origin-Opener-Policy: same-origin` are actually present.

---

### Git & CORS Connection Failures

#### Symptom:
"Network Error", "CORS restriction", or "Push failed: unauthorized" when cloning or pushing repositories.

#### Root Causes:
1. **CORS Proxy Offline**: The configured CORS proxy server is unreachable or offline.
2. **Incorrect GitHub PAT**: The GitHub Personal Access Token (PAT) does not have write access to the repository, or has expired.
3. **Invalid Remote Reference**: The repository URL contains typos or points to a non-existent branch.

#### Resolutions:
- Navigate to PWA settings and test your CORS proxy connection. If using `https://cors-proxy.swal.dev`, check its online status. If offline, configure your own CORS proxy.
- Ensure your GitHub PAT is generated with the `repo` scope (for classic tokens) or write permissions to "Repository contents" (for fine-grained tokens).
- Clear the project cache on the **Projects** view and re-clone the repository using the exact target HTTPS repository link.

---

### Infinite ReAct Loops & Halting

#### Symptom:
The agent enters a circular loop, modifying files back and forth, or running the same test suite repeatedly without finalizing.

#### Root Causes:
1. **Conflicting Agent Plans**: The LLM model lacks logical reasoning capacity to solve a compiler error, or keeps reverting its own code edits.
2. **Undetected File Modifications**: A mismatch between the virtual WebContainer file system and the Git workspace is preventing the agent from recognizing file updates.

#### Resolutions:
- **Default Hard Stop**: Every agent loop has a hard limit of 20 iterations (configurable in Task launcher). When the limit is reached, the runner automatically halts execution, issues a `run:failed` telemetry event, and notifies the user to prevent token drainage.
- **Manual Halt**: Click the red **Stop Agent** button in the top-right corner of the **Task Progress** screen. This immediately halts the runtime processes. You can then review the staged files, manually commit the progress so far, and launch a new task with refined instructions.

---

### WebRTC & Pairing Failures

#### Symptom:
Pairing status stays permanently on `connecting`, or mobile devices fail to sync with the PC workstation.

#### Root Causes:
1. **Signaling Server Down**: The public PeerJS or y-webrtc signaling servers are down or undergoing maintenance.
2. **NAT/Firewall Restrictions**: Symmetric NATs or strict corporate firewalls are blocking direct WebRTC data channel connections.

#### Resolutions:
- Verify that both devices are joined to the exact same **WebRTC Room Name** (case-sensitive) on the Pairing UI.
- Use a custom signaling server instead of public defaults. You can spin up a local signaling server easily:
  ```bash
  npx y-webrtc-signaling
  ```
  Configure this custom endpoint in the settings panel (e.g., `ws://your-signaling-ip:4444`).
- If direct WebRTC connection fails due to symmetric NATs, configure STUN and TURN server credentials in your y-webrtc options to enable NAT traversal.

---

### Pyodide WASM & Dependency Failures

#### Symptom:
"Pyodide failed to load", or "pip install / micropip failed to resolve package name".

#### Root Causes:
1. **No Internet Connection**: Pyodide downloads WASM binaries and dependencies directly from standard CDNs (e.g., `cdn.jsdelivr.net`).
2. **Missing pure-Python fallback**: You are attempting to install a Python package that requires C-bindings. Pyodide can only dynamically compile pure-Python wheels.

#### Resolutions:
- Ensure the device has active internet access. Pyodide relies on external CDN fetches for its package index.
- If running in a strictly offline environment, pre-download your project's wheel files, place them in your Git repository, and run `micropip.install("./path/to/wheel.whl")` locally.
- Review standard error outputs in the console. If a package fails, confirm if there is a pure-Python equivalent or if the library is already pre-compiled and bundled by Pyodide (e.g., `numpy`, `pandas`, and `scikit-learn` are pre-compiled and should be loaded via `pyodide.loadPackage`).

---

### PWA Service Worker & Caching Issues

#### Symptom:
Changes to the PWA UI are not visible after pulling from origin, or the application serves an outdated version of files.

#### Root Causes:
1. **Aggressive Service Worker Caching**: The Workbox service worker serves cached application shells to enable offline-first performance, skipping the network update.
2. **Service Worker Registration Stuck**: A new service worker is installed but waiting in the background because other tabs are still active.

#### Resolutions:
- Close all active tabs pointing to the PWA, then re-open. This allows the waiting service worker to take control.
- In desktop browsers, open Chrome Developer Tools (`F12`), navigate to **Application** -> **Service Workers**, and click **Update on reload** or click **Unregister** and refresh the page.
- Clear the browser cache to force-reload index assets.

---

### IndexedDB Storage Quota Limits

#### Symptom:
"QuotaExceededError" or "Failed to write database record" when committing work or synchronizing memory chunks.

#### Root Causes:
1. **Exhausted Disk Space**: The host device's physical storage is extremely low, causing the browser to restrict IndexedDB quotas.
2. **Over-bloated Project Workspace**: Multiple large Git repositories or heavy `node_modules` folders have been cloned inside the virtual LightningFS directory.

#### Resolutions:
- Run a storage estimation query (see [Storage Quotas & Estimates](#storage-quotas--estimates)) to check limits.
- On the **Projects** view, delete inactive or completed projects. This completely wipes their corresponding virtual file system trees, reclaiming the disk space.
- Run database cleanup within the PWA developer console by resetting working memory chunks and clearing the CRDT Event Bus history log.

---
*SWAL GitCore Protocol v3.9.0*
