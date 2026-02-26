#!/usr/bin/env bash
# =============================================================================
# openclaw-browser — regression gate (one-liner)
# =============================================================================
# Runs: build → daemon start → all pytest suites → daemon stop → report
#
# Usage:
#   bash scripts/verify.sh
#   OPENCLAW_PORT=19315 bash scripts/verify.sh
#
# Exit: 0 = all gates passed, 1 = any failure
# =============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${OPENCLAW_PORT:-19315}"
DATA_DIR="${OPENCLAW_DATA_DIR:-${HOME}/.openclaw}"
DAEMON_PID=""
PASS=0
FAIL=0

# ── Color helpers ──────────────────────────────────────────────────────────
green() { printf '\033[32m%s\033[0m\n' "$*"; }
red()   { printf '\033[31m%s\033[0m\n' "$*"; }
bold()  { printf '\033[1m%s\033[0m\n' "$*"; }

# ── Cleanup on exit ────────────────────────────────────────────────────────
cleanup() {
  if [[ -n "$DAEMON_PID" ]]; then
    kill "$DAEMON_PID" 2>/dev/null || true
    wait "$DAEMON_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

bold "==============================="
bold " openclaw-browser verify gate  "
bold "==============================="
echo "  Repo: $REPO_DIR"
echo "  Port: $PORT"
echo ""

# ── Gate: build ────────────────────────────────────────────────────────────
printf "[1/5] Build (npm run build)... "
cd "$REPO_DIR"
if npm run build > /tmp/openclaw-build.log 2>&1; then
  green "PASS"
  PASS=$((PASS + 1))
else
  red "FAIL"
  cat /tmp/openclaw-build.log
  FAIL=$((FAIL + 1))
  exit 1
fi

# ── Gate: daemon start ─────────────────────────────────────────────────────
printf "[2/5] Daemon start on :%s... " "$PORT"
OPENCLAW_PORT="$PORT" OPENCLAW_DATA_DIR="$DATA_DIR" node dist/daemon/index.js \
  > /tmp/openclaw-daemon.log 2>&1 &
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
  cat /tmp/openclaw-daemon.log
  FAIL=$((FAIL + 1))
  exit 1
fi
green "PASS"
PASS=$((PASS + 1))

# ── Gate: pytest suites ────────────────────────────────────────────────────
run_suite() {
  local label="$1"; shift
  printf "[3/5] %s... " "$label"
  if OPENCLAW_PORT="$PORT" python3 -m pytest "$@" -q --tb=short \
       > /tmp/openclaw-pytest-"${label// /-}".log 2>&1; then
    local passed
    passed=$(grep -E "passed" /tmp/openclaw-pytest-"${label// /-}".log | tail -1)
    green "PASS  ($passed)"
    PASS=$((PASS + 1))
  else
    red "FAIL"
    cat /tmp/openclaw-pytest-"${label// /-}".log
    FAIL=$((FAIL + 1))
  fi
}

run_suite "smoke"   tests/e2e/test_smoke.py
run_suite "auth"    tests/e2e/test_auth.py
run_suite "handoff" tests/e2e/test_handoff.py
run_suite "cdp"     tests/e2e/test_cdp.py

# ── Gate: daemon stop ──────────────────────────────────────────────────────
printf "[4/5] Daemon stop (SIGTERM)... "
kill "$DAEMON_PID" 2>/dev/null || true
wait "$DAEMON_PID" 2>/dev/null || true
DAEMON_PID=""
green "PASS"
PASS=$((PASS + 1))

# ── Summary ────────────────────────────────────────────────────────────────
echo ""
bold "==============================="
if [[ $FAIL -eq 0 ]]; then
  green " ALL GATES PASSED ($PASS/$((PASS + FAIL)))"
else
  red " FAILED: $FAIL gate(s) failed, $PASS passed"
fi
bold "==============================="

[[ $FAIL -eq 0 ]]
