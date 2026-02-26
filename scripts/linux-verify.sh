#!/usr/bin/env bash
# =============================================================================
# openclaw-browser — Linux baseline verification script
# =============================================================================
# Run this on a fresh Linux environment to validate headless operation.
# macOS CI passes; this script documents the reproducible Linux path.
#
# Requirements:
#   - Node.js 20 LTS  (nvm install 20)
#   - Python 3.11+    (for pytest / SDK)
#   - ms-playwright Chromium installed (~/.local/share/ms-playwright or /root/.cache/)
#     Run once: npx playwright install chromium
#
# Usage:
#   bash scripts/linux-verify.sh
#   OPENCLAW_PORT=19315 bash scripts/linux-verify.sh
# =============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${OPENCLAW_PORT:-19315}"
DATA_DIR="${OPENCLAW_DATA_DIR:-/tmp/openclaw-linux-verify}"
DAEMON_PID=""

# ── Cleanup on exit ────────────────────────────────────────────────────────
cleanup() {
  if [[ -n "$DAEMON_PID" ]]; then
    kill "$DAEMON_PID" 2>/dev/null || true
    wait "$DAEMON_PID" 2>/dev/null || true
  fi
  rm -rf "$DATA_DIR"
}
trap cleanup EXIT

echo "=============================="
echo " openclaw-browser Linux verify"
echo "=============================="
echo "  Repo:     $REPO_DIR"
echo "  Port:     $PORT"
echo "  DataDir:  $DATA_DIR"
echo ""

# ── 1. Node version check ──────────────────────────────────────────────────
echo "[1/5] Node.js version..."
node_version=$(node --version)
node_major=$(echo "$node_version" | sed 's/v\([0-9]*\).*/\1/')
echo "  Found: $node_version"
if [[ "$node_major" -lt 20 ]]; then
  echo "  ERROR: Node 20+ required. Install: nvm install 20"
  exit 1
fi
echo "  OK: Node $node_major >= 20"

# ── 2. Build ───────────────────────────────────────────────────────────────
echo ""
echo "[2/5] Build..."
cd "$REPO_DIR"
npm run build
echo "  OK: TypeScript build passed"

# ── 3. Start daemon (headless, --no-sandbox already in manager.ts) ─────────
echo ""
echo "[3/5] Start daemon..."
# On Linux servers without a display, headless mode uses --no-sandbox.
# The args are hardcoded in src/browser/manager.ts:
#   --no-sandbox, --disable-setuid-sandbox, --disable-dev-shm-usage
# No DISPLAY env var needed for headless sessions.
OPENCLAW_PORT="$PORT" OPENCLAW_DATA_DIR="$DATA_DIR" node dist/daemon/index.js &
DAEMON_PID=$!

# Wait for daemon (up to 10 s)
echo "  Waiting for daemon on :$PORT..."
for i in $(seq 1 20); do
  if curl -sf "http://127.0.0.1:$PORT/health" > /dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

health=$(curl -s "http://127.0.0.1:$PORT/health")
status=$(echo "$health" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")
echo "  OK: daemon status=$status"

# ── 4. Python tests ────────────────────────────────────────────────────────
echo ""
echo "[4/5] Python e2e tests..."
OPENCLAW_PORT="$PORT" python3 -m pytest tests/e2e/test_smoke.py tests/e2e/test_handoff.py -q

# ── 5. --no-sandbox code path confirmation ────────────────────────────────
echo ""
echo "[5/5] Confirming --no-sandbox args in manager.ts..."
if grep -q "\-\-no-sandbox" "$REPO_DIR/src/browser/manager.ts"; then
  echo "  OK: --no-sandbox present in src/browser/manager.ts"
else
  echo "  ERROR: --no-sandbox NOT found in manager.ts — Linux headless will fail"
  exit 1
fi
if grep -q "\-\-disable-setuid-sandbox" "$REPO_DIR/src/browser/manager.ts"; then
  echo "  OK: --disable-setuid-sandbox present"
fi
if grep -q "\-\-disable-dev-shm-usage" "$REPO_DIR/src/browser/manager.ts"; then
  echo "  OK: --disable-dev-shm-usage present (prevents /dev/shm OOM on small VMs)"
fi

echo ""
echo "=============================="
echo " Linux baseline: ALL PASSED"
echo "=============================="
echo ""
echo "Notes for headed mode (visual login handoff on Linux):"
echo "  1. Install Xvfb:   apt-get install -y xvfb"
echo "  2. Start Xvfb:     Xvfb :99 -screen 0 1280x720x24 &"
echo "  3. Export display: export DISPLAY=:99"
echo "  4. Then use:       openclaw login <session-id>"
