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

## r07-c01-fix Review Fixes (post-commit)

### Issues Fixed

| # | Issue | Fix |
|---|---|---|
| 1 | `client.create_session()` in test file — wrong API | Changed to `client.sessions.create()` throughout `test_element_map.py` |
| 2 | SDK `Session.click()` / `Session.fill()` didn't accept `element_id` | Added `element_id: Optional[str] = None` param; raises `ValueError` if neither selector nor element_id provided |
| 3 | `AsyncSession.click()` / `AsyncSession.fill()` — same gap | Same fix applied to async counterparts |
| 4 | CLI `click`/`fill` missing `--element-id` flag | Changed positional `<selector>` to `<selector-or-eid>` + `--element-id` flag (same pattern as `get`/`assert`) |
| 5 | README CLI examples used wrong syntax `--element-id e3` | Fixed to `e3 --element-id` (value before flag) |
| 6 | Tests T-EM-04/T-EM-07 used non-interactive `<li>`/`<p>` elements | Fixed: T-EM-04 uses `<button class="item">` items; T-EM-07 uses `<a href>` for element_id path |
| 7 | T-EM-04 filter `"Item" in e.text` matched "Add Item" button too | Fixed filter to `e.text.startswith("Item")` |

### Verification Results (verify.sh)

```
[1/13]  Build            PASS
[2/13]  Daemon start     PASS
[3/13]  smoke            PASS  (15 passed)
[4/13]  auth             PASS  (11 passed)
[5/13]  handoff          PASS  (6 passed)
[6/13]  cdp              PASS  (8 passed)
[7/13]  actions-v2       PASS  (10 passed)
[8/13]  pages-frames     PASS  (7 passed)
[9/13]  network-cdp      PASS  (8 passed)
[10/13] c05-fixes        PASS  (10 passed)
[11/13] policy           PASS  (11 passed)
[12/13] element-map      PASS  (9 passed)
[13/13] Daemon stop      PASS

ALL GATES PASSED (13/13)
```

## Gate Status

- Build: PASS (tsc clean)
- verify.sh: 13/13 PASS (10 pytest suites including new element-map suite)
- R07-T01: DONE
- R07-T02: DONE
- R07-T07: DONE
