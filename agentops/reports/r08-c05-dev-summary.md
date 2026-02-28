# r08-c05 Dev Summary — R08 收口-1

**Branch**: `feat/r08-next`
**Date**: 2026-02-28
**Scope**: R08-R12 + R08-R05 + R08-R06 + R08-R02 + R08-R09
**Verify gate**: 21/21 PASSED
**Tests added**: 24 (tests/e2e/test_r08c05.py)

---

## Deliverables

### R08-R12 — Snapshot Ref 强化: page_rev endpoint

**New endpoint**: `GET /api/v1/sessions/:id/page_rev`

Returns current page revision (monotonic counter incremented on main-frame navigation):
```json
{ "status": "ok", "session_id": "...", "page_rev": 3, "url": "https://..." }
```

- `snapshot_map` response already included `page_rev` (via BrowserManager.getPageRev)
- Stale ref 409 errors now include `suggestions` array:
  ```json
  {
    "error": "stale_ref",
    "ref_id": "snap_xxx:e5",
    "message": "Snapshot not found or expired; call snapshot_map again",
    "suggestions": ["call snapshot_map to get fresh ref_ids", "use selector or element_id as fallback"]
  }
  ```
- Python SDK: `Session.page_rev()` → `PageRevResult`; `AsyncSession.page_rev()` async version
- New model: `PageRevResult` (status, session_id, page_rev, url)

---

### R08-R05 — Ref->Box->Input: mouse_move with ref_id/element_id/selector

`mouse_move` now accepts element references in addition to raw coordinates:

```python
session.mouse_move(selector="#target")     # by CSS selector
session.mouse_move(element_id="e3")        # by element_map ID
session.mouse_move(ref_id="snap_abc:e3")   # by snapshot ref
session.mouse_move(x=200, y=150)           # explicit coords (unchanged)
```

Server resolves reference → CSS selector via `resolveTarget()` → `locator.boundingBox()` → computes center → `page.mouse.move(cx, cy)`.

---

### R08-R06 — 双轨执行器: executor='auto_fallback', executed_via

`click` now accepts `executor` parameter:

- `executor='strict'` (default): standard Playwright click; error on failure
- `executor='auto_fallback'`: if high-level click fails, falls back to `page.mouse.click(cx, cy)` using bbox center

Response includes `executed_via` field:
- `'high_level'` — Playwright locator click succeeded
- `'low_level'` — bbox coord fallback was used

```python
res = session.click(selector="#btn", executor="auto_fallback")
print(res.executed_via)  # 'high_level' or 'low_level'
```

Also preserved backward-compat `track: 'coords'` field on legacy `fallback_x/fallback_y` path (r07c04 compatibility).

---

### R08-R02 — 稳定性策略中间层: wait_before/after/dom_stable

`click` and `fill` now accept `stability` dict:

```python
session.click(selector="#b", stability={"wait_before_ms": 200, "wait_after_ms": 100})
session.fill(selector="#inp", value="text", stability={"wait_dom_stable_ms": 500})
```

Fields:
- `wait_before_ms`: sleep before action
- `wait_after_ms`: sleep after action
- `wait_dom_stable_ms`: `waitForFunction('document.readyState==="complete"')` before action

Implemented via `applyStabilityPre()` / `applyStabilityPost()` async helpers in actions.ts.

---

### R08-R09 — preflight 参数校验层

Centralized `preflight()` helper validates params before executing actions, returning `400 preflight_failed` with structured error:

```json
{
  "error": "preflight_failed",
  "field": "timeout_ms",
  "constraint": "must be 50–60000",
  "value": 10
}
```

Rules enforced:
- `timeout_ms`: must be in range [50, 60000]
- `fill.value`: max length 100,000 chars

Composable check helpers: `pfRange(field, value, min, max)` and `pfMaxLen(field, value, max)`.

---

## Files Changed

| File | Changes |
|------|---------|
| `src/daemon/routes/actions.ts` | preflight helpers, StabilityOpts type, stability pre/post helpers, stale_ref suggestions, click route (executor+stability+preflight), fill route (stability+preflight), mouse_move (ref_id/element_id/selector), GET page_rev endpoint |
| `sdk/python/agentmb/models.py` | ActionResult: +executed_via, +suggested_fallback; new PageRevResult |
| `sdk/python/agentmb/client.py` | Session.click/fill/mouse_move/page_rev; AsyncSession same; mouse_move x/y now Optional |
| `tests/e2e/test_r08c05.py` | 24 new e2e tests (new file) |
| `scripts/verify.sh` | TOTAL 20→21; added r08c05 suite |
| `agentops/TODO.md` | R08-R12/R05/R06/R02/R09 DONE entries |

---

## P1 Bug Fixes (post-review)

### P1-A: wait_dom_stable_ms timeout arg position (actions.ts:177)

**Bug**: `page.waitForFunction(fn, arg?, options?)` — `{timeout}` was passed as `arg` (2nd param) instead of `options` (3rd param). Playwright silently passed it to the page function as an argument; the actual timeout used was the Playwright default (30 000 ms).

**Fix**:
```typescript
// Before (wrong): {timeout} as arg
await page.waitForFunction('document.readyState === "complete"', { timeout: opts.wait_dom_stable_ms })
// After (correct): {timeout} as options
await page.waitForFunction('document.readyState === "complete"', undefined, { timeout: opts.wait_dom_stable_ms })
```

### P1-B: auto_fallback uses page.locator instead of target.locator in frame context (actions.ts:308)

**Bug**: `s.page.locator(selector).boundingBox()` was used in the `auto_fallback` path. When `target` is a `Frame` (not the main page), `s.page.locator(selector)` finds nothing → `bbox = null` → fallback path fails → original error re-raised.

**Fix**:
```typescript
// Before (wrong): always searches main page
const bbox = await s.page.locator(selector).boundingBox()
// After (correct): searches in frame context when target is a Frame
const bbox = await target.locator(selector).boundingBox()
```

Also added `frame?: Optional[dict]` parameter to `Session.click()` and `AsyncSession.click()` in Python SDK.

---

## Test Results

```
[20/21] r08c05... PASS  (28 passed in 7.34s)
ALL GATES PASSED (21/21)
```

Test classes:
- `TestSnapshotRefEnhancement` (5): page_rev endpoint, increments on nav, snapshot_map includes page_rev, stale_ref suggestions, stable without nav
- `TestRefBoxInput` (4): mouse_move by selector/element_id/ref_id/coordinates
- `TestDualTrackExecutor` (4): executed_via field, auto_fallback on obscured element, auto_fallback on valid element
- `TestStabilityMiddleware` (5): wait_before/after timing, fill with stability, dom_stable, backward compat
- `TestPreflightValidation` (6): timeout_ms too low/high/boundary, fill value within/over limit, valid range
- `TestR08C05P1Fixes` (4): wait_dom_stable_ms short timeout completes quickly, wait_dom_stable_ms on complete page, auto_fallback main page bbox, **auto_fallback in frame resolves frame locator** (regression for P1-B)
