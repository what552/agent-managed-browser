#!/usr/bin/env bash
# =============================================================================
# agentmb — regression gate (one-liner)
# =============================================================================
# Runs: build → daemon start → all pytest suites → daemon stop → report
#
# Usage:
#   bash scripts/verify.sh
#   AGENTMB_PORT=19315 bash scripts/verify.sh
#
# Exit: 0 = all gates passed, 1 = any failure
# =============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${AGENTMB_PORT:-19315}"
DATA_DIR="${AGENTMB_DATA_DIR:-${HOME}/.agentmb}"
DAEMON_PID=""
PASS=0
FAIL=0
STEP=0
# Total gates: build(1) + daemon-start(1) + suites(13 = smoke+auth+handoff+cdp+actions-v2+pages-frames+network-cdp+c05-fixes+policy+element-map+r07c02+r07c03+r07c04) + daemon-stop(1) = 16
TOTAL=16

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
bold " agentmb verify gate  "
bold "==============================="
echo "  Repo: $REPO_DIR"
echo "  Port: $PORT"
echo ""

# ── Gate: build ────────────────────────────────────────────────────────────
STEP=$((STEP + 1))
printf "[%d/%d] Build (npm run build)... " "$STEP" "$TOTAL"
cd "$REPO_DIR"
if npm run build > /tmp/agentmb-build.log 2>&1; then
  green "PASS"
  PASS=$((PASS + 1))
else
  red "FAIL"
  cat /tmp/agentmb-build.log
  FAIL=$((FAIL + 1))
  exit 1
fi

# ── Gate: daemon start ─────────────────────────────────────────────────────
STEP=$((STEP + 1))
printf "[%d/%d] Daemon start on :%s... " "$STEP" "$TOTAL" "$PORT"
AGENTMB_PORT="$PORT" AGENTMB_DATA_DIR="$DATA_DIR" AGENTMB_POLICY_PROFILE="disabled" node dist/daemon/index.js \
  > /tmp/agentmb-daemon.log 2>&1 &
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
  cat /tmp/agentmb-daemon.log
  FAIL=$((FAIL + 1))
  exit 1
fi
green "PASS"
PASS=$((PASS + 1))

# ── Gate: pytest suites ────────────────────────────────────────────────────
run_suite() {
  local label="$1"; shift
  STEP=$((STEP + 1))
  printf "[%d/%d] %s... " "$STEP" "$TOTAL" "$label"
  if AGENTMB_PORT="$PORT" python3 -m pytest "$@" -q --tb=short \
       > /tmp/agentmb-pytest-"${label// /-}".log 2>&1; then
    local passed
    passed=$(grep -E "passed" /tmp/agentmb-pytest-"${label// /-}".log | tail -1)
    green "PASS  ($passed)"
    PASS=$((PASS + 1))
  else
    red "FAIL"
    cat /tmp/agentmb-pytest-"${label// /-}".log
    FAIL=$((FAIL + 1))
  fi
}

run_suite "smoke"          tests/e2e/test_smoke.py
run_suite "auth"           tests/e2e/test_auth.py
run_suite "handoff"        tests/e2e/test_handoff.py
run_suite "cdp"            tests/e2e/test_cdp.py
run_suite "actions-v2"     tests/e2e/test_actions_v2.py
run_suite "pages-frames"   tests/e2e/test_pages_frames.py
run_suite "network-cdp"    tests/e2e/test_network_cdp.py
run_suite "c05-fixes"      tests/e2e/test_c05_fixes.py
run_suite "policy"         tests/e2e/test_policy.py
run_suite "element-map"   tests/e2e/test_element_map.py
run_suite "r07c02"        tests/e2e/test_r07c02.py
run_suite "r07c03"        tests/e2e/test_r07c03.py
run_suite "r07c04"        tests/e2e/test_r07c04.py

# ── Gate: daemon stop ──────────────────────────────────────────────────────
STEP=$((STEP + 1))
printf "[%d/%d] Daemon stop (SIGTERM)... " "$STEP" "$TOTAL"
kill "$DAEMON_PID" 2>/dev/null || true
wait "$DAEMON_PID" 2>/dev/null || true
DAEMON_PID=""
green "PASS"
PASS=$((PASS + 1))

# ── Summary ────────────────────────────────────────────────────────────────
echo ""
bold "==============================="
if [[ $FAIL -eq 0 ]]; then
  green " ALL GATES PASSED ($PASS/$TOTAL)"
else
  red " FAILED: $FAIL gate(s) failed, $PASS/$TOTAL passed"
fi
bold "==============================="

[[ $FAIL -eq 0 ]]
