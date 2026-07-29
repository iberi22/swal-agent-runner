# OWASP ZAP DAST Security Scanning

> **Dynamic Application Security Testing (DAST)** for `swal-agent-runner`

## Overview

[OWASP ZAP](https://www.zaproxy.org/) (Zed Attack Proxy) is an open-source web
application security scanner. It performs automated vulnerability scanning by
interacting with a running instance of the application — the same way an attacker
would, but systematically.

This project provides three ways to run ZAP:

| Method | Script | Best for |
|--------|--------|----------|
| Docker (recommended) | `test/security/dast.sh` | Local dev — zero install beyond Docker |
| GitHub Actions | `.github/workflows/security.yml` | CI — weekly scheduled + on push |
| Local (no Docker) | Manual steps below | When Docker is unavailable |

---

## 1. Docker — Quick start (recommended)

```bash
# Full active scan (default) — starts the dev server automatically
./test/security/dast.sh

# Quick spider-only scan (faster, less thorough)
./test/security/dast.sh --quick

# Scan an already-running server on a different URL
./test/security/dast.sh --target http://localhost:4173
```

The script:
1. Checks Docker is installed and the daemon is running
2. Pulls `zaproxy/zap-stable` if not cached (the official ZAP Docker image — `owasp/zap2docker-stable` was discontinued)
3. Starts `npm run dev` if no server is detected on the target URL
4. Runs the ZAP scanner with the report written to `test/security/zap-report.html`
5. Stops the dev server on exit (even if interrupted)

**Report:** Open `test/security/zap-report.html` in your browser after the scan.

**Configuration:**

| Env var | Default | Description |
|---------|---------|-------------|
| `ZAP_REPORT` | `test/security/zap-report.html` | Output path for the HTML report |
| `DEV_SERVER_URL` | `http://localhost:5173` | URL to scan |
| `ZAP_OPTIONS` | *(empty)* | Extra CLI flags for the ZAP Python script |

---

## 2. Local (without Docker)

If Docker is not available, install ZAP natively.

### Linux (Debian/Ubuntu)

```bash
# Install Java (ZAP requires JDK 11+)
sudo apt update && sudo apt install -y openjdk-17-jre wget

# Download and extract ZAP
ZAP_VERSION="2.16.0"
wget "https://github.com/zaproxy/zaproxy/releases/download/v${ZAP_VERSION}/ZAP_${ZAP_VERSION}_Linux.tar.gz"
tar -xzf "ZAP_${ZAP_VERSION}_Linux.tar.gz"
sudo mv ZAP_${ZAP_VERSION} /opt/zap
sudo ln -s /opt/zap/zap.sh /usr/local/bin/zap
rm "ZAP_${ZAP_VERSION}_Linux.tar.gz"

# Verify
zap -version
```

Or via package manager:

```bash
# Arch Linux
sudo pacman -S zaproxy

# NixOS (if in nixpkgs)
nix-env -iA nixpkgs.zaproxy
```

### macOS

```bash
brew install zaproxy
```

### Windows

Download the cross-platform JAR from the
[ZAP releases page](https://github.com/zaproxy/zaproxy/releases) and run:

```powershell
java -jar zap-2.16.0.jar
```

### Running the scan natively

Once ZAP is installed, run the scan manually:

```bash
# 1. Start the dev server
cd /path/to/swal-agent-runner
npm run dev &

# 2. Wait for it to be ready
until curl -sf http://localhost:5173; do sleep 1; done

# 3. Run ZAP in headless daemon mode
zap -daemon -port 8080 -host 127.0.0.1 -config api.key=change-me

# 4. Use the ZAP API to run the scan
#    (Alternative: use zap-full-scan.py if Python + ZAP add-ons are installed)
#    See: https://www.zaproxy.org/docs/docker/about/

# 5. Stop the daemon
curl "http://127.0.0.1:8080/JSON/core/action/shutdown/?apikey=change-me"
```

---

## 3. GitHub Actions CI

A weekly DAST scan runs automatically via
`.github/workflows/security.yml`:

- **Schedule:** Every Monday at 06:00 UTC
- **Triggers:** On push/PR to `main` when `src/`, `vite.config.ts`, or
  `package.json` change
- **Manual trigger:** Use the `workflow_dispatch` event via the GitHub UI

The CI workflow:
1. Builds the production bundle
2. Starts `vite preview` on port 4173 (production build, not dev server)
3. Runs ZAP with `--network host` (Linux-native Docker networking)
4. Uploads `zap-report.html` as a build artifact (retained 30 days)
5. Posts a summary to the workflow run page

### Downloading the report from CI

1. Go to **Actions** → **Security Scan (DAST)** → select a run
2. Scroll to **Artifacts**
3. Download **zap-report** and open the HTML in your browser

---

## Understanding ZAP alerts

ZAP classifies findings by risk level:

| Risk | Meaning | Typical examples |
|------|---------|-----------------|
| 🔴 **High** | Critical vulnerabilities | XSS, SQL injection, RCE |
| 🟠 **Medium** | Security weaknesses | Missing CSP headers, insecure cookies |
| 🟡 **Low** | Informational | Server version disclosure, missing HSTS |
| 🔵 **Informational** | Debug info | Request/response details |

**False positives:** Not every alert is a real vulnerability. Review each finding
in the context of the application. The PWA nature of this project means some
checks (e.g., CSP bypasses on service worker scope) need manual verification.

---

## Resources

- [OWASP ZAP User Guide](https://www.zaproxy.org/docs/)
- [ZAP Full Scan documentation](https://github.com/zaproxy/zap-full-scan)
- [ZAP Docker images](https://www.zaproxy.org/docs/docker/)
- [DAST vs SAST vs SCA — OWASP Guide](https://owasp.org/www-community/controls/Static_Application_Security_Testing)
