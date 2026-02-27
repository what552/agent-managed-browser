#!/usr/bin/env bash
# =============================================================================
# agentmb — dist/source consistency gate
# =============================================================================
# Verifies that key CLI names, subcommands, env var prefix, and help text
# in the compiled dist match what the source code advertises.
#
# Usage:
#   bash scripts/check-dist-consistency.sh
#   bash scripts/check-dist-consistency.sh --verbose
#
# Exit: 0 = all checks passed, 1 = at least one check failed
# =============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI_JS="${REPO_DIR}/dist/cli/index.js"
VERBOSE="${1:-}"
PASS=0
FAIL=0

green() { printf '\033[32m  PASS\033[0m %s\n' "$*"; }
red()   { printf '\033[31m  FAIL\033[0m %s\n' "$*"; }

check() {
  local label="$1"
  local pattern="$2"
  local haystack="$3"
  if echo "$haystack" | grep -qE "$pattern"; then
    green "$label"
    PASS=$((PASS + 1))
  else
    red "$label  (expected pattern: ${pattern})"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== agentmb dist/source consistency check ==="
echo ""

# ---------------------------------------------------------------------------
# Gate 1: dist artifacts exist
# ---------------------------------------------------------------------------
echo "-- Build artifacts --"
for f in dist/cli/index.js dist/daemon/index.js; do
  if [[ -f "${REPO_DIR}/${f}" ]]; then
    green "artifact exists: ${f}"
    PASS=$((PASS + 1))
  else
    red "artifact missing: ${f}"
    FAIL=$((FAIL + 1))
  fi
done

# ---------------------------------------------------------------------------
# Gate 2: CLI binary name in package.json matches dist entry point
# ---------------------------------------------------------------------------
echo ""
echo "-- CLI binary name (package.json) --"
BIN_NAME=$(node -e "const p=require('${REPO_DIR}/package.json'); const keys=Object.keys(p.bin||{}); console.log(keys[0]||'')")
check "bin name is 'agentmb'" "^agentmb$" "$BIN_NAME"

# ---------------------------------------------------------------------------
# Gate 3: Top-level help text contains expected commands
# ---------------------------------------------------------------------------
echo ""
echo "-- Top-level help: required commands --"
HELP=$(node "$CLI_JS" --help 2>&1 || true)
[[ -n "$VERBOSE" ]] && echo "$HELP"

for cmd in start stop status session navigate screenshot eval pages route trace cdp-ws; do
  check "help lists '${cmd}'" "\b${cmd}\b" "$HELP"
done

# ---------------------------------------------------------------------------
# Gate 4: AGENTMB_ env var prefix appears in help or source
# ---------------------------------------------------------------------------
echo ""
echo "-- AGENTMB_ env var prefix in source --"
ENV_COUNT=$(grep -r "AGENTMB_" "${REPO_DIR}/src/cli/" --include="*.ts" -l | wc -l | tr -d ' ')
if [[ "$ENV_COUNT" -gt 0 ]]; then
  green "AGENTMB_ prefix referenced in ${ENV_COUNT} CLI source file(s)"
  PASS=$((PASS + 1))
else
  red "AGENTMB_ prefix not found in src/cli/"
  FAIL=$((FAIL + 1))
fi

# ---------------------------------------------------------------------------
# Gate 5: session subcommands
# ---------------------------------------------------------------------------
echo ""
echo "-- session subcommands --"
SESSION_HELP=$(node "$CLI_JS" session --help 2>&1 || true)
for sub in new list rm; do
  check "session has '${sub}'" "\b${sub}\b" "$SESSION_HELP"
done

# ---------------------------------------------------------------------------
# Gate 6: pages subcommands
# ---------------------------------------------------------------------------
echo ""
echo "-- pages subcommands --"
PAGES_HELP=$(node "$CLI_JS" pages --help 2>&1 || true)
for sub in list new switch close; do
  check "pages has '${sub}'" "\b${sub}\b" "$PAGES_HELP"
done

# ---------------------------------------------------------------------------
# Gate 7: route subcommands
# ---------------------------------------------------------------------------
echo ""
echo "-- route subcommands --"
ROUTE_HELP=$(node "$CLI_JS" route --help 2>&1 || true)
for sub in list add rm; do
  check "route has '${sub}'" "\b${sub}\b" "$ROUTE_HELP"
done

# ---------------------------------------------------------------------------
# Gate 8: trace subcommands
# ---------------------------------------------------------------------------
echo ""
echo "-- trace subcommands --"
TRACE_HELP=$(node "$CLI_JS" trace --help 2>&1 || true)
for sub in start stop; do
  check "trace has '${sub}'" "\b${sub}\b" "$TRACE_HELP"
done

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "=== Results ==="
TOTAL=$((PASS + FAIL))
if [[ $FAIL -eq 0 ]]; then
  printf '\033[32mALL CHECKS PASSED (%d/%d)\033[0m\n' "$PASS" "$TOTAL"
else
  printf '\033[31mFAILED: %d check(s) failed, %d/%d passed\033[0m\n' "$FAIL" "$PASS" "$TOTAL"
fi
echo ""

[[ $FAIL -eq 0 ]]
