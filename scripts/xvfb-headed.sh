#!/usr/bin/env bash
# =============================================================================
# openclaw-browser — Linux headed (Xvfb) demo script
# =============================================================================
# Starts a virtual display with Xvfb, launches the daemon, creates a headed
# browser session, navigates to a URL, takes a screenshot, then tears down.
#
# Requirements (Ubuntu/Debian):
#   apt-get install -y xvfb
#   npm install && npm run build
#   npx playwright install chromium
#
# Usage:
#   bash scripts/xvfb-headed.sh
#   OPENCLAW_PORT=19316 bash scripts/xvfb-headed.sh
#   TARGET_URL=https://example.com bash scripts/xvfb-headed.sh
#
# Exit: 0 = success, 1 = failure
# =============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${OPENCLAW_PORT:-19315}"
DATA_DIR="${OPENCLAW_DATA_DIR:-/tmp/openclaw-xvfb-test}"
TARGET_URL="${TARGET_URL:-https://example.com}"
DISPLAY_NUM=":99"
XVFB_PID=""
DAEMON_PID=""
SCREENSHOT_OUT="/tmp/openclaw-headed-screenshot.png"

# ── Color helpers ──────────────────────────────────────────────────────────
green() { printf '\033[32m%s\033[0m\n' "$*"; }
red()   { printf '\033[31m%s\033[0m\n' "$*"; }
bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
info()  { printf '  %s\n' "$*"; }

# ── Cleanup on exit ────────────────────────────────────────────────────────
cleanup() {
  if [[ -n "$DAEMON_PID" ]]; then
    info "Stopping daemon (PID $DAEMON_PID)..."
    kill "$DAEMON_PID" 2>/dev/null || true
    wait "$DAEMON_PID" 2>/dev/null || true
  fi
  if [[ -n "$XVFB_PID" ]]; then
    info "Stopping Xvfb (PID $XVFB_PID)..."
    kill "$XVFB_PID" 2>/dev/null || true
    wait "$XVFB_PID" 2>/dev/null || true
  fi
  rm -rf "$DATA_DIR"
}
trap cleanup EXIT

bold "============================================="
bold " openclaw-browser — Linux headed (Xvfb) demo"
bold "============================================="
info "Repo:      $REPO_DIR"
info "Port:      $PORT"
info "DataDir:   $DATA_DIR"
info "Display:   $DISPLAY_NUM"
info "TargetURL: $TARGET_URL"
echo ""

# ── Step 1: Check Xvfb ─────────────────────────────────────────────────────
printf "[1/6] Checking Xvfb availability... "
if ! command -v Xvfb > /dev/null 2>&1; then
  red "FAIL"
  echo "  Xvfb not found. Install with:"
  echo "    apt-get install -y xvfb"
  exit 1
fi
green "OK ($(command -v Xvfb))"

# ── Step 2: Start Xvfb ─────────────────────────────────────────────────────
printf "[2/6] Starting Xvfb on display %s... " "$DISPLAY_NUM"
# Kill any leftover Xvfb on the same display
pkill -f "Xvfb $DISPLAY_NUM" 2>/dev/null || true
rm -f "/tmp/.X${DISPLAY_NUM#:}-lock" 2>/dev/null || true

Xvfb "$DISPLAY_NUM" -screen 0 1280x720x24 &
XVFB_PID=$!
sleep 1

if ! kill -0 "$XVFB_PID" 2>/dev/null; then
  red "FAIL (Xvfb did not start)"
  exit 1
fi
green "OK (PID $XVFB_PID)"

export DISPLAY="$DISPLAY_NUM"

# ── Step 3: Build ──────────────────────────────────────────────────────────
printf "[3/6] Build (npm run build)... "
cd "$REPO_DIR"
if npm run build > /tmp/openclaw-xvfb-build.log 2>&1; then
  green "OK"
else
  red "FAIL"
  cat /tmp/openclaw-xvfb-build.log
  exit 1
fi

# ── Step 4: Start daemon ───────────────────────────────────────────────────
printf "[4/6] Starting daemon on :%s (DISPLAY=%s)... " "$PORT" "$DISPLAY_NUM"
OPENCLAW_PORT="$PORT" OPENCLAW_DATA_DIR="$DATA_DIR" DISPLAY="$DISPLAY_NUM" \
  node dist/daemon/index.js > /tmp/openclaw-xvfb-daemon.log 2>&1 &
DAEMON_PID=$!

# Poll up to 10 s
ready=0
for i in $(seq 1 20); do
  if curl -sf "http://127.0.0.1:${PORT}/health" > /dev/null 2>&1; then
    ready=1; break
  fi
  sleep 0.5
done

if [[ $ready -eq 0 ]]; then
  red "FAIL (daemon did not start)"
  cat /tmp/openclaw-xvfb-daemon.log
  exit 1
fi
green "OK (PID $DAEMON_PID)"

# ── Step 5: Headed session flow ────────────────────────────────────────────
printf "[5/6] Headed session: create → navigate → screenshot... "

# Create session in headed mode
SESSION_JSON=$(curl -sf -X POST \
  -H "Content-Type: application/json" \
  -d "{\"profile\":\"xvfb-headed-demo\",\"headless\":false}" \
  "http://127.0.0.1:${PORT}/api/v1/sessions")

SESSION_ID=$(echo "$SESSION_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['session_id'])")
info ""
info "Session created: $SESSION_ID"

# Navigate
curl -sf -X POST \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"$TARGET_URL\",\"purpose\":\"xvfb-headed-demo\",\"operator\":\"xvfb-headed.sh\"}" \
  "http://127.0.0.1:${PORT}/api/v1/sessions/${SESSION_ID}/navigate" > /dev/null

# Screenshot
SHOT_JSON=$(curl -sf -X POST \
  -H "Content-Type: application/json" \
  -d '{"format":"png"}' \
  "http://127.0.0.1:${PORT}/api/v1/sessions/${SESSION_ID}/screenshot")

echo "$SHOT_JSON" | python3 -c "
import sys, json, base64
data = json.load(sys.stdin)['data']
with open('$SCREENSHOT_OUT', 'wb') as f:
    f.write(base64.b64decode(data))
"

SIZE=$(wc -c < "$SCREENSHOT_OUT")
green "OK"
info "Screenshot saved: $SCREENSHOT_OUT (${SIZE} bytes)"

# Close session
curl -sf -X DELETE "http://127.0.0.1:${PORT}/api/v1/sessions/${SESSION_ID}" > /dev/null || true

# ── Step 6: Verify screenshot ──────────────────────────────────────────────
printf "[6/6] Verify screenshot size (>= 5000 bytes)... "
if [[ "$SIZE" -ge 5000 ]]; then
  green "OK (${SIZE} bytes)"
else
  red "FAIL (screenshot too small: ${SIZE} bytes)"
  exit 1
fi

echo ""
bold "============================================="
green " Linux headed (Xvfb) demo: ALL STEPS PASSED"
bold "============================================="
echo ""
info "Screenshot: $SCREENSHOT_OUT"
info "To view: scp this file to your local machine or use a VNC viewer"
