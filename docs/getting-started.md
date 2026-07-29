# 📖 SWAL Agent Runner — Getting Started Guide

> **Protocol Version:** v3.9.0
> **Target Audience:** Developers, Sovereign Node Operators, and Intelligent Agent Developers

Welcome to the **SWAL Agent Runner** Getting Started Guide. This document provides an exhaustive, end-to-end tutorial on setting up, configuring, and executing autonomous software development tasks entirely in your web browser.

Whether running as an installable Progressive Web App (PWA) on **Android Chrome** or as a browser tab on a **Desktop PC**, this runner gives you a self-contained, sovereign execution workspace with 100% feature parity.

---

## 📋 Prerequisites

Before you begin, ensure you have the following:

1.  **Node.js**: Version 18.x or later (v20+ recommended).
2.  **Package Manager**: `pnpm` (highly recommended for performance and lockfile integrity) or `npm`.
3.  **Modern Web Browser**: A browser supporting `SharedArrayBuffer` (e.g., Google Chrome, Microsoft Edge, Mozilla Firefox, or Apple Safari).
4.  **Secure Context**: WebContainers require a Secure Context (`https://` or `http://localhost`).
5.  **LLM API Access**: Active credentials for at least one supported AI model provider (Google Gemini, OpenRouter, OpenCodeGo, or Google AI Pro).

---

## 🛠️ Step 1: Local Installation & Setup

Follow these commands to pull and run the runner locally:

### 1. Clone the Repository
```bash
git clone https://github.com/swal-labs/swal-agent-runner.git
cd swal-agent-runner
```

### 2. Install Project Dependencies
```bash
# Using pnpm (recommended)
pnpm install

# Using npm
npm install
```

### 3. Start the Local Development Server
```bash
# Using pnpm
pnpm run dev

# Using npm
npm run dev
```

The terminal will print the local server address (typically `http://localhost:5173`). Open this URL in your web browser.

### 🔒 Crucial Security Headers (COOP & COEP)
The Vite configuration (`vite.config.ts`) is pre-configured to output the following HTTP response headers:
*   `Cross-Origin-Embedder-Policy: require-corp`
*   `Cross-Origin-Opener-Policy: same-origin`

These security headers isolate the browser window context, which is **strictly required** for modern browsers to unlock `SharedArrayBuffer` API. Without these headers, the headless `@webcontainer/api` runtime will fail to boot.

---

## 🔑 Step 2: Configure LLM Providers

`swal-agent-runner` does not run LLMs locally; instead, it orchestrates model calls over secure remote APIs. The system includes a robust Multi-Provider manager that secures your credentials in local encrypted storage.

Navigate to the **Settings/Auth** tab inside the PWA to configure your preferred provider:

### Option A: Google AI Pro / Gemini Advanced (OAuth2 PKCE)
This is the premier login option for users with active personal Google Gemini subscriptions.
1.  Click **Login with Google**.
2.  The application initiates an OAuth2 flow utilizing **Proof Key for Code Exchange (PKCE)**.
3.  Upon consent, an OAuth2 access token is obtained securely. No manual API keys are required, and the token is automatically refreshed.

### Option B: Google Gemini API (Direct)
1.  Obtain an API key from the [Google AI Studio](https://aistudio.google.com/).
2.  Select the **Gemini API** provider.
3.  Paste your API key and click **Save**.
4.  Select your preferred model (e.g., `gemini-2.5-pro` or `gemini-3-pro`).

### Option C: OpenRouter
Provides a single interface to model families from Anthropic, DeepSeek, Meta, and Qwen.
1.  Generate an API key from [OpenRouter](https://openrouter.ai/).
2.  Configure your Active Provider to **OpenRouter**.
3.  Enter the API key and choose from models such as `claude-3.5-sonnet`, `deepseek-r1`, or `qwen-2.5-coder`.

### Option D: OpenCodeGo / Custom OpenAI-compatible Endpoints
For sovereign setups, enterprise proxying, or local mock runners:
1.  Enter your custom API Base URL (e.g., `https://api.opencode.go/v1` or `http://localhost:11434/v1`).
2.  Input your custom authentication token/key.

---

## 📁 Step 3: Initialize your Git Workspace

The application handles Git repositories natively in-browser without demanding desktop File System Access APIs. It stores your files in an **IndexedDB virtual filesystem** managed by `isomorphic-git` and `@isomorphic-git/lightning-fs`.

### 1. Create or Clone a Project
1.  On the **Projects** dashboard screen, click **New Project**.
2.  To clone a remote repository:
    *   Enter the repository URL (e.g., `https://github.com/username/my-project.git`).
    *   Set the checkout branch (e.g., `main`).
    *   *Optional:* Enter your Git username and Personal Access Token (PAT) for private repositories.
3.  Click **Clone Project**.

### 🌐 CORS Proxies
Because web browsers enforce strict Same-Origin Policies (SOP), direct Git communication with GitHub or GitLab will fail. `swal-agent-runner` utilizes configurable CORS Proxies to route Git commands securely. You can use the default SWAL protocol proxy or specify your own in settings.

---

## 🧠 Step 4: Pair with the Xavier Memory Workstation

The runner hosts an embedded **Xavier Local Memory Core** to store agent execution history, semantic vectors, and coding logs. For enhanced workflow context, you can pair it with your primary desktop workstation.

```
┌──────────────────┐               WebRTC P2P               ┌──────────────────┐
│  Mobile PWA Node │ <────────────────────────────────────> │ PC Workstation   │
│  (IndexedDB Log) │            (edge-mesh Sync)            │ (Xavier Master)  │
└──────────────────┘                                        └──────────────────┘
```

1.  Ensure your primary workstation Xavier Node is running (typically listening on `http://localhost:8006`).
2.  In the PWA, look for the **Xavier Pairing** status indicator in the upper-right corner.
3.  If pairing via local network, enter your workstation endpoint.
4.  For remote/mobile pairing, the system uses WebRTC P2P (`edge-mesh`) to establish a real-time CRDT sync channel.
5.  Once **[CONNECTED]**, any local episodic, semantic, or procedural memory chunks are synced bidirectionally, updating both environments in real-time.

---

## 🚀 Step 5: Run an Autonomous Task (End-to-End Walkthrough)

With LLM credentials and a Git project loaded, you are ready to initiate an execution loop.

### 1. Define the Task
1.  Select your project on the **Projects** screen.
2.  Click **Create New Task**.
3.  Enter a clear, task-oriented goal.
    *   *Example:* "Add a function `is_prime(n)` in `src/math.ts` and add tests in `tests/math.test.ts`. Run the tests to verify."
4.  Select the desired LLM Provider and Agent Model.
5.  Click **Launch Agent**.

### 2. Follow the ReAct Loop Execution
The UI automatically transitions to the **Task Progress** screen. Here, you can watch the autonomous loop operate in real-time:

*   **Plan:** The agent breaks your task into sequential steps.
*   **Tool Exec:** The agent executes headless workspace commands. You will see active logs like:
    *   `read_file("src/math.ts")`
    *   `write_file("src/math.ts", ...)`
    *   `run_command("npm test")` (boots WebContainer under the hood!)
*   **Console Feed:** A live stdout/stderr capture showing real-time test run results or compilation issues.

### 3. Review and Commit Results
Once the agent meets its criteria and runs the `complete` tool, you are navigated to the **Results & Diff Review** screen:

1.  **Inspect Diffs:** View exact Git merge modifications side-by-side.
2.  **Verify Status:** Check final compiler checks and execution logs.
3.  **Commit & Push:**
    *   Review the auto-generated semantic commit message.
    *   Click **Approve and Commit**.
    *   Click **Push to Remote** to securely upload the changes back to your repository branch via the CORS proxy.

---

## ❓ Troubleshooting & FAQs

### Q: I get a "SharedArrayBuffer is not defined" or "WebContainer failed to boot" error.
**A:** This is almost always due to missing security contexts or headers.
*   Ensure you are accessing the runner over `http://localhost:5173` or a secure `https://` domain.
*   If hosting the production bundle on services like GitHub Pages or Vercel, ensure you configure them to send the COOP/COEP headers, or deploy a service worker proxy that injects them.

### Q: Git clone or Git push fails with "Network Error" or "CORS restriction".
**A:** Browsers prevent raw TCP connections to Git servers. Make sure your configured CORS proxy is online and accessible. If pushing to GitHub, ensure your Personal Access Token (PAT) has the correct `repo` write scopes.

### Q: The agent gets stuck in an infinite loop.
**A:** The autonomous loop is bounded to a maximum of 20 iterations by default to conserve tokens. If the agent gets stuck, you can click the **Stop Agent** button on the Task Progress screen to abort the run safely, preserve your progress, and adjust the instructions.

### Q: Can I run this offline?
**A:** Yes! Because this is a Progressive Web App, you can install it onto your device home screen. Once installed, the asset shell and local IndexedDB workspace are fully functional offline. The agent will run local mock routines, write memories locally, queue sync items, and push updates once network connectivity is restored.

---
*SWAL GitCore Protocol v3.9.0*
