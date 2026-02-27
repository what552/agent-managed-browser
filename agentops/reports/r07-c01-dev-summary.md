# r07-c01 Dev Summary

**Branch**: `feat/r07-next`
**Baseline commit**: `d347991`
**Date**: 2026-02-27
**Scope**: R07-T01 (element_map) + R07-T02 (get/assert) + R07-T07 (wait_page_stable)

---

## Deliverables

### R07-T01 — Element Index Location Model

- `POST /api/v1/sessions/:id/element_map` — scans interactive DOM elements, injects stable `data-agentmb-eid` attributes, returns array of `ElementInfo` objects
- All action routes (click, fill, type, press, hover, wait-selector) extended with optional `element_id` body field
- `resolveTarget()` helper converts `element_id` → `[data-agentmb-eid="eN"]` CSS selector; falls back to `selector`; returns 400 if neither provided
- Backward compatible: existing `selector` callers unchanged

### R07-T02 — Read / Assert Primitives

- `POST /api/v1/sessions/:id/get` — reads `text|html|value|attr|count|box` from any element (selector or element_id)
- `POST /api/v1/sessions/:id/assert` — checks `visible|enabled|checked` and returns `passed` (actual vs expected)
- Uses Playwright locator API throughout (`.innerText()`, `.innerHTML()`, `.inputValue()`, `.getAttribute()`, `.count()`, `.boundingBox()`, `.isVisible()`, `.isEnabled()`, `.isChecked()`)

### R07-T07 — Stability Policy V2

- `POST /api/v1/sessions/:id/wait_page_stable` — three-phase gate:
  1. `waitForLoadState('networkidle')` — no network activity for 500 ms
  2. MutationObserver quiescence — DOM unchanged for `dom_stable_ms` (default 300 ms)
  3. Optional overlay polling — waits until `overlay_selector` matches 0 elements
- Configurable `timeout_ms`, `dom_stable_ms`, `overlay_selector`

---

## Files Changed

| File | Change |
|---|---|
| `src/browser/actions.ts` | +`elementMap()`, `getProperty()`, `assertState()`, `waitPageStable()` |
| `src/daemon/routes/actions.ts` | +`resolveTarget()`, 5 modified routes, 4 new routes |
| `sdk/python/agentmb/models.py` | +`ElementRect`, `ElementInfo`, `ElementMapResult`, `GetPropertyResult`, `AssertResult`, `StableResult` |
| `sdk/python/agentmb/client.py` | +`element_map()`, `get()`, `assert_state()`, `wait_page_stable()` on Session + AsyncSession |
| `sdk/python/agentmb/__init__.py` | +6 new exports |
| `src/cli/commands/actions.ts` | +`element-map`, `get`, `assert`, `wait-stable` commands |
| `tests/e2e/test_element_map.py` | 9 e2e tests (T-EM-01..09) covering all three scenarios |
| `scripts/verify.sh` | TOTAL 12→13; added `element-map` suite |
| `README.md` | Added Element Map section with CLI + SDK examples |
| `agentops/TODO.md` | Marked R07-T01/T02/T07 as DONE |

---

## Key Design Decisions

1. **DOM attribute injection**: element_map injects `data-agentmb-eid="e1"` directly into the page DOM. Element IDs are valid until next navigation (expected; callers should re-scan after nav).

2. **TypeScript / tsconfig compatibility**: `page.evaluate()` callbacks type-checked as Node.js (no DOM lib). All browser globals accessed via `(globalThis as any).document`, `(globalThis as any).MutationObserver` etc.

3. **No server-side element registry**: element_id resolution is pure CSS (`[data-agentmb-eid="eN"]`), requiring zero server state. Clean and stateless.

4. **Frame support**: `getProperty()` and `assertState()` accept optional `frame` param (name/url/nth) via existing `resolveFrame()`.

---

## E2E Test Scenarios

| ID | Scenario |
|---|---|
| T-EM-01 | element_map returns labeled elements |
| T-EM-02 | click via element_id; selector backward-compat |
| T-EM-03 | fill via element_id |
| T-EM-04 | Dynamic list — re-scan after DOM mutation |
| T-EM-05 | Lazy load — wait_page_stable then element_map |
| T-EM-06 | Overlay detection — wait_page_stable with overlay_selector |
| T-EM-07 | get text/html property |
| T-EM-08 | assert visible/enabled/checked |
| T-EM-09 | get count property |

---

## Gate Status

- Build: PASS (tsc clean)
- verify.sh: TOTAL=13 (10 pytest suites including new element-map suite)
- R07-T01: DONE
- R07-T02: DONE
- R07-T07: DONE
