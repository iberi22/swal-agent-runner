# Security Policy — SWAL Agent Runner

> **Southwest AI Labs (SWAL)** — Sovereign Intelligence Ecosystem

## Supported Versions

The following table indicates the security support status for versions of `swal-agent-runner`:

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

Southwest AI Labs (SWAL) takes security vulnerabilities seriously. If you discover a security vulnerability in `swal-agent-runner`, please do **not** create a public GitHub issue.

Instead, please report the vulnerability through one of the following channels:

1. **GitHub Private Security Advisory**: Submit a security disclosure via GitHub Security Advisories on the repository if enabled.
2. **Security Contact**: Contact the SWAL maintainers directly via repository security channels.

Please include the following details in your security report:
- Type of vulnerability (e.g., token exposure, cross-site scripting, origin isolation bypass)
- Step-by-step proof of concept or instructions to reproduce
- Affected component(s) and version(s)
- Potential impact and suggested mitigation if known

## Security Guarantees & Architecture

`swal-agent-runner` enforces strict security boundaries:
* **Isolation**: Execution of user code runs in isolated WebContainers / WASM runtimes.
* **Header Hardening**: Strict COEP (`require-corp`), COOP (`same-origin`), and CSP rules prevent cross-origin leaks.
* **Encrypted Secrets**: API keys and OAuth tokens are stored exclusively in client-side secure storage (`localStorage`/`IndexedDB`).
