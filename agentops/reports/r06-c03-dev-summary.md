# r06-c03 Dev Summary — CI Windows, Policy Hardening, UX Polish

**Branch:** `feat/r06-next`
**Date:** 2026-02-27
**Gate:** 12/12 PASS (policy suite: 11 tests)

---

## Issues Fixed

| Issue | Fix | File(s) |
|---|---|---|
| C1: eval/extract not covered by policy | Added `applyPolicy()` before eval and extract routes | `src/daemon/routes/actions.ts` |
| C2: PolicyEngine domain state unbounded growth | `maybeCleanupStaleDomains()` — TTL 30min, check every 5min | `src/policy/engine.ts` |
| C3: `pages close` requires knowing page-id | Made `[page-id]` optional; interactive numbered list when omitted | `src/cli/commands/pages.ts` |
| A: Windows missing from full-test CI | Added `windows-latest` to full-test matrix | `.github/workflows/ci.yml` |
| B: TASK.md had openclaw name + template placeholders | Rewrote with agentmb name, actual R02-R06 scope, removed `<placeholder>` | `agentops/TASK.md` |
| B: TODO.md R03 tasks marked TODO but completed | Updated R03 to DONE; added R06 section (T01-T09 all DONE) | `agentops/TODO.md` |

---

## Changes by File

### `src/daemon/routes/actions.ts` (C1)
- `eval` body: added `sensitive?: boolean; retry?: boolean`; `applyPolicy()` called before frame resolution
- `extract` body: same additions; `applyPolicy()` called before frame resolution
- Both use `extractDomain(s.page.url())` as the policy domain key

### `src/policy/engine.ts` (C2)
- Added `DOMAIN_TTL_MS = 30 * 60_000` and `CLEANUP_INTERVAL_MS = 5 * 60_000` class constants
- Added `lastCleanupTs: number = 0` instance field
- Added `maybeCleanupStaleDomains()` — iterates `lastActionTs`, removes entries idle > TTL, cascades to `actionWindow`/`retryCount`/`cooldownUntil`
- Called from `checkAndWait()` after the fast-path disabled check

### `src/cli/commands/pages.ts` (C3)
- `pages close <session-id> [page-id]` — page-id now optional (backward-compatible, original usage unchanged)
- When page-id omitted: lists all pages with numbers, prompts for selection via readline
- Guards: 1-page session → immediate error; invalid number → error; empty input → cancel
- Added `import readline from 'readline'`

### `.github/workflows/ci.yml` (A)
- `full-test` job: added `windows-latest` to matrix (was `ubuntu-latest, macos-latest`)
- Renamed job: `Full test suite (ubuntu + macOS)` → `Full test suite (${{ matrix.os }})`
- `Install Playwright Chromium` split into two steps:
  - Linux: `--with-deps` (installs system packages)
  - macOS/Windows: without `--with-deps` (browser only)
- `Run verify gate (non-ubuntu)` step: added `shell: bash` (required for Windows Git Bash)

### `agentops/TASK.md` (B)
- Project name: `openclaw-browser` → `agentmb`
- All `<placeholder>` text replaced with actual content
- In-scope list reflects R02-R06 delivered capabilities
- Risks table updated with real risks + mitigations
- Milestones reflect actual delivery dates

### `agentops/TODO.md` (B)
- R03 section renamed from "待办" to "完成状态"; all 6 tasks set to DONE with accurate references
- R06 section added: 9 tasks (T01-T09) all DONE
- Done Log: R06 entries added (T01-T09)

### `tests/e2e/test_policy.py` (D)
- T-POL-10: `test_policy_eval_sensitive_blocked` — eval with `sensitive=True` denied by safe profile (→ 403, `policy_event=deny`)
- T-POL-11: `test_policy_extract_sensitive_blocked` — extract with `sensitive=True` denied by safe profile (→ 403, `policy_event=deny`)

---

## Test Results

```
[11/12] policy... PASS  (11 passed in 15.69s)
Gate: 12/12 ALL PASSED
```

Policy suite breakdown (11 tests):
| T-POL-01 | GET /policy default | PASS |
| T-POL-02 | POST /policy set profile | PASS |
| T-POL-03 | disabled no throttle | PASS |
| T-POL-04 | safe blocks sensitive click | PASS |
| T-POL-05 | allow_sensitive override | PASS |
| T-POL-06 | retry budget exhausted | PASS |
| T-POL-07 | policy events in audit logs | PASS |
| T-POL-08 | SDK PolicyInfo round-trip | PASS |
| T-POL-09 | invalid profile → 400 | PASS |
| T-POL-10 | eval sensitive blocked (NEW) | PASS |
| T-POL-11 | extract sensitive blocked (NEW) | PASS |

---

## Design Notes

**PolicyEngine cleanup** — lazy TTL approach (no `setInterval`):
- No background timer needed; cleanup is triggered by the next action on any session
- TTL of 30 minutes removes state for domains that haven't been visited in a while
- Check interval of 5 minutes prevents O(n) scan on every single action
- Entries for explicitly closed sessions are still removed immediately via `clearSession()`

**pages close interactivity** — backward-compatible:
- `agentmb pages close <session-id> <page-id>` still works exactly as before
- `agentmb pages close <session-id>` (new usage) triggers interactive prompt
- Empty Enter cancels cleanly; invalid number gives clear error
