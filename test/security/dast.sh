#!/usr/bin/env bash
# =============================================================================
# dast.sh — OWASP ZAP DAST Security Scan (Docker)
# =============================================================================
# Runs an automated DAST (Dynamic Application Security Testing) scan against the
# swal-agent-runner dev server using OWASP ZAP in a Docker container.
#
# Usage:
#   ./test/security/dast.sh                          # Full scan (default)
#   ./test/security/dast.sh --quick                   # Quick spider-only scan
#   ./test/security/dast.sh --target http://...       # Scan a different target
#   ./test/security/dast.sh --help                    # Show this help
#
# Requirements:
#   - Docker (Docker Engine 20.10+ or Docker Desktop)
#   - The dev server must be running OR the script will start one automatically
#
# Environment variables:
#   ZAP_REPORT      Path for the HTML report (default: test/security/zap-report.html)
#   DEV_SERVER_URL  Target URL to scan   (default: http://localhost:5173)
#   ZAP_OPTIONS     Extra CLI flags for zap-full-scan.py
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
REPORT_PATH="${ZAP_REPORT:-${PROJECT_DIR}/test/security/zap-report.html}"
TARGET_URL="${DEV_SERVER_URL:-http://localhost:5173}"
# OWASP ZAP Docker images moved from owasp/zap2docker-stable to zaproxy/zap-stable
# See: https://www.zaproxy.org/blog/2023-06-13-ghcr-docker-images/
ZAP_IMAGE="${ZAP_IMAGE:-zaproxy/zap-stable}"
HOST_PORT=5173

# ── Helper functions ────────────────────────────────────────────────────────

print_usage() {
  sed -n '2,/^$/p' "$0" | sed 's/^# //; s/^#//'
}

cleanup() {
  echo "› Cleaning up..."
  if [ -n "${DEV_PID:-}" ]; then
    kill "${DEV_PID}" 2>/dev/null || true
    wait "${DEV_PID}" 2>/dev/null || true
    echo "  ✓ Dev server stopped (PID ${DEV_PID})"
  fi
}
trap cleanup EXIT INT TERM

# ── Parse arguments ─────────────────────────────────────────────────────────

SCAN_TYPE="full"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --quick)       SCAN_TYPE="quick" ; shift ;;
    --target)      TARGET_URL="$2"   ; shift 2 ;;
    -h|--help)     print_usage       ; exit 0 ;;
    *)             echo "Unknown option: $1" ; print_usage ; exit 1 ;;
  esac
done

echo "══════════════════════════════════════════════════"
echo "  OWASP ZAP DAST Security Scan"
echo "══════════════════════════════════════════════════"
echo "  Target : ${TARGET_URL}"
echo "  Report : ${REPORT_PATH}"
echo "  Type   : ${SCAN_TYPE}"
echo ""

# ── Check prerequisites ────────────────────────────────────────────────────

if ! command -v docker &>/dev/null; then
  echo "✗ Docker is required but not installed."
  echo "  Install: https://docs.docker.com/engine/install/"
  echo ""
  echo "  To run ZAP locally without Docker, see:"
  echo "  docs/security/README.md"
  exit 1
fi

if ! docker info --format '{{.ServerVersion}}' &>/dev/null; then
  echo "✗ Docker daemon is not running."
  exit 1
fi

# ── Pull ZAP image if not cached ────────────────────────────────────────────

if ! docker image inspect "${ZAP_IMAGE}" &>/dev/null; then
  echo "› Pulling ZAP Docker image (${ZAP_IMAGE})..."
  docker pull "${ZAP_IMAGE}"
  echo ""
fi

# ── Start dev server if not already running ─────────────────────────────────

if ! curl -sf "${TARGET_URL}" >/dev/null 2>&1; then
  echo "› Dev server not detected — starting 'npm run dev' in the background..."
  cd "${PROJECT_DIR}"
  npm run dev &
  DEV_PID=$!
  echo "  Dev server starting (PID ${DEV_PID})..."

  # Wait for the dev server to become ready (max 30s)
  for i in $(seq 1 30); do
    if curl -sf "http://localhost:${HOST_PORT}" >/dev/null 2>&1; then
      echo "  ✓ Dev server is ready on http://localhost:${HOST_PORT}"
      break
    fi
    if [ "$i" -eq 30 ]; then
      echo "✗ Dev server failed to start within 30 seconds."
      exit 1
    fi
    sleep 1
  done
  echo ""
else
  echo "› Dev server is already running at ${TARGET_URL}"
fi

# ── Run the ZAP scan ────────────────────────────────────────────────────────

# On Linux the `--add-host host.docker.internal:host-gateway` flag makes
# `host.docker.internal` resolve to the host, matching Docker Desktop behaviour.
# On Docker Desktop (macOS/Windows) it's a no-op alias.

echo "› Starting ZAP ${SCAN_TYPE} scan (this may take several minutes)..."
echo ""

REPORT_DIR="$(dirname "${REPORT_PATH}")"
mkdir -p "${REPORT_DIR}"

case "${SCAN_TYPE}" in
  quick)
    # Spider-only — faster but less thorough
    docker run --rm \
      --add-host host.docker.internal:host-gateway \
      -v "${REPORT_DIR}:/zap/wrk:rw" \
      "${ZAP_IMAGE}" \
      zap-spider.py \
        -t "${TARGET_URL}" \
        -r zap-report.html \
        ${ZAP_OPTIONS:-}
    ;;
  full)
    # Full active-scan — thorough but slower
    docker run --rm \
      --add-host host.docker.internal:host-gateway \
      -v "${REPORT_DIR}:/zap/wrk:rw" \
      "${ZAP_IMAGE}" \
      zap-full-scan.py \
        -t "${TARGET_URL}" \
        -r zap-report.html \
        ${ZAP_OPTIONS:-}
    ;;
esac

EXIT_CODE=$?
echo ""

# ── Report summary ─────────────────────────────────────────────────────────

if [ -f "${REPORT_PATH}" ]; then
  REPORT_SIZE="$(du -h "${REPORT_PATH}" | cut -f1)"
  echo "══════════════════════════════════════════════════"
  echo "  ✓ Scan complete! Report saved:"
  echo "    ${REPORT_PATH}  (${REPORT_SIZE})"
  echo ""
  echo "  Open in browser:"
  echo "    file://${REPORT_PATH}"
  echo "══════════════════════════════════════════════════"
else
  echo "⚠  Scan finished but report was not found at ${REPORT_PATH}"
fi

exit ${EXIT_CODE}
