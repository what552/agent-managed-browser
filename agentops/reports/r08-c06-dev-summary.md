# r08-c06 Dev Summary — R08 收口-2

**Branch**: `feat/r08-next`
**Date**: 2026-02-28
**Scope**: R08-R01 + R08-R08 + R08-R10 + R08-R11 + R08-R13 + R08-R14 + R08-R15 + R08-R16 + R08-R17 + R08-R18
**Verify gate**: 22/22 PASSED
**Tests added**: 30 (tests/e2e/test_r08c06.py)

---

## Deliverables

### R08-R01 — Fill 人性化: fill_strategy + char_delay_ms

**Route change** (`src/daemon/routes/actions.ts`):
```typescript
// POST /api/v1/sessions/:id/fill
Body: { ..., fill_strategy?: 'type'; char_delay_ms?: number }
```

- `fill_strategy='type'` calls `page.type(selector, value, { delay: char_delay_ms ?? 0 })` instead of `page.fill()`
- Default (`undefined`) behavior unchanged — uses fast `page.fill()`
- **Python SDK**: `Session.fill(selector, value, fill_strategy=None, char_delay_ms=None)` + `AsyncSession` async mirror

---

### R08-R08 — Mouse smooth steps + scroll step_delay_ms

**mouse_move** (`src/daemon/routes/actions.ts`):
```typescript
Body: { x, y, steps?: number, ... }
// calls: Actions.mouseMove(s.page, x, y, steps ?? 1, ...)
```

- `steps` forwarded to `page.mouse.move(x, y, { steps })` — higher value = smoother trajectory
- Response: `{ status, x, y, steps, duration_ms }` (MouseResult updated with x/y/steps)

**scroll_until** (`src/daemon/routes/actions.ts`):
```typescript
Body: { ..., step_delay_ms?: number }
// response: { ...result, session_id: s.id }
```

- `step_delay_ms` forwarded to `scrollUntil()` opts in `src/browser/actions.ts`
- Each scroll step waits `step_delay_ms` ms before next step (default: same as `stall_ms`)

**Python SDK**: `Session.mouse_move(steps=None)`, `Session.scroll_until(step_delay_ms=None)`
**Models**: `MouseResult.x/y/steps: Optional[int]`, `ScrollUntilResult.session_id: Optional[str]`, `LoadMoreResult.session_id: Optional[str]`

---

### R08-R10 — Semantic find (Playwright semantic locators)

**New endpoint**: `POST /api/v1/sessions/:id/find`

```json
// Request
{ "query_type": "role|text|label|placeholder|alt_text", "query": "button", "name": null, "exact": false, "nth": 0 }

// Response
{ "status": "ok", "found": true, "count": 2, "nth": 0, "query_type": "role", "query": "button",
  "tag": "button", "text": "Submit", "bbox": { "x": 10, "y": 20, "width": 80, "height": 30 } }
```

**Locator mapping**:
| query_type | Playwright call |
|---|---|
| `role` | `page.getByRole(query, { name, exact })` |
| `text` | `page.getByText(query, { exact })` |
| `label` | `page.getByLabel(query, { exact })` |
| `placeholder` | `page.getByPlaceholder(query, { exact })` |
| `alt_text` | `page.getByAltText(query, { exact })` |

**Python SDK**: `Session.find(query_type, query, name=None, exact=False, nth=0, ...)` → `FindResult`

---

### R08-R11 — Browser settings GET

**New endpoint**: `GET /api/v1/sessions/:id/settings`

```json
{
  "session_id": "s_abc123",
  "viewport": { "width": 1280, "height": 720 },
  "user_agent": "Mozilla/5.0 ...",
  "url": "https://example.com",
  "headless": true,
  "profile": "default"
}
```

- `viewport`: from `page.viewportSize()` (null if not set)
- `user_agent`: from `page.evaluate('navigator.userAgent')`
- `url`: from `page.url()`
- `headless`: from session's `headless` field
- `profile`: from session's `profile` field

**Python SDK**: `Session.get_settings()` → `SessionSettings`; `SessionSettings`, `ViewportSize` models added

---

### R08-R13 — Error recovery hints (enrichDiag)

**Helper function** (`src/daemon/routes/actions.ts`):

```typescript
function enrichDiag(diag: ActionDiagnostics): ActionDiagnostics & { recovery_hint?: string } {
  const msg = diag.error.toLowerCase()
  let recovery_hint: string | undefined
  if (msg.includes('timeout') || msg.includes('waiting for'))
    recovery_hint = 'Increase timeout_ms or add stability.wait_before_ms; ensure element is visible before acting'
  else if (msg.includes('target closed') || msg.includes('execution context') || msg.includes('detached'))
    recovery_hint = 'Page may have navigated or element was removed; re-navigate or re-snapshot'
  else if (msg.includes('not found') || msg.includes('no element') || msg.includes('failed to find'))
    recovery_hint = 'Check selector; use snapshot_map to verify element exists on current page'
  else if (msg.includes('intercept') || msg.includes('overlap') || msg.includes('obscur'))
    recovery_hint = 'Element may be covered by overlay; try executor=auto_fallback or scroll into view first'
  return recovery_hint ? { ...diag, recovery_hint } : diag
}
```

All 422 `ActionDiagnosticsError` paths now route through `enrichDiag()`:
- `click`, `fill`, `type`, `press`, `hover`, `select`, `scroll`, `drag`, `wait_for_selector` routes
- Click route's special `suggested_fallback` path also wrapped

---

### R08-R14 — Profile lifecycle

**New endpoints** (`src/daemon/routes/sessions.ts`):

```
GET  /api/v1/profiles           → ProfileListResult
POST /api/v1/profiles/:name/reset → ProfileResetResult
```

- `list_profiles`: reads `AGENTMB_DATA_DIR/profiles/` directory, returns each subdirectory as `ProfileInfo { name, path, last_used }`
- `reset_profile`: validates name (`/^[a-zA-Z0-9_-]+$/`), rejects if live session uses this profile (409), then `rmSync({recursive,force:true})` + `mkdirSync({recursive:true})`

**Python SDK**: `BrowserClient.list_profiles()`, `BrowserClient.reset_profile(name)` + Async variants
**Models**: `ProfileInfo`, `ProfileListResult`, `ProfileResetResult`

---

### R08-R15 — Cookie delete by name

**New endpoint** (`src/daemon/routes/state.ts`):

```
POST /api/v1/sessions/:id/cookies/delete
Body: { "name": "session_token", "domain": "example.com" }  // domain optional
Response: { "status": "ok", "removed": 1, "remaining": 5 }
```

Implementation: get all → filter out matching (name + optional domain) → clear all → re-add kept.

**Python SDK**: `Session.delete_cookie(name, domain=None)` → `DeleteCookieResult`

---

### R08-R16 — upload_url (asset ingestion from URL)

**New endpoint** (`src/daemon/routes/actions.ts`):

```
POST /api/v1/sessions/:id/upload_url
Body: { "url": "https://...", "selector": "#file-input", "filename": "photo.jpg" }
Response: { "status": "ok", "selector": "#file-input", "filename": "photo.jpg",
            "size_bytes": 42310, "mime_type": "image/jpeg", "duration_ms": 234,
            "url": "https://...", "fetched_bytes": 42310 }
```

Flow:
1. `fetch(url)` — Node 20 global fetch
2. Write `Buffer` to `os.tmpdir()/agentmb-upload-{timestamp}.{ext}` temp file
3. Call `Actions.uploadFile(s.page, resolvedSelector, tmpPath, mimeType, ...)`
4. `finally` block removes temp file

**Python SDK**: `Session.upload_url(url, selector=None, element_id=None, ref_id=None, filename=None, mime_type=None, ...)` → `UploadUrlResult`

---

### R08-R17 — Response consistency (session_id in scroll responses)

Both scroll routes now include `session_id`:

```typescript
// scroll_until route
return { ...result, session_id: s.id }

// load_more_until route
return { ...result, session_id: s.id }
```

**Python SDK**: `ScrollUntilResult.session_id: Optional[str] = None`, `LoadMoreResult.session_id: Optional[str] = None`

---

### R08-R18 — run_steps batch dispatcher

**New endpoint** (`src/daemon/routes/actions.ts`):

```
POST /api/v1/sessions/:id/run_steps
Body: {
  "steps": [
    { "action": "navigate", "url": "https://..." },
    { "action": "click", "selector": "#btn", "timeout_ms": 3000 },
    { "action": "fill", "selector": "#inp", "value": "hello" }
  ],
  "stop_on_error": true
}
Response: {
  "status": "ok|partial|failed",
  "total_steps": 3,
  "completed_steps": 3,
  "failed_steps": 0,
  "results": [
    { "step": 0, "action": "navigate", "result": {...} },
    ...
  ]
}
```

**Supported actions**: `navigate`, `click`, `fill`, `type`, `press`, `hover`, `scroll`, `wait_for_selector`, `wait_text`, `screenshot`, `eval`

**Python SDK**: `Session.run_steps(steps, stop_on_error=True, purpose=None, operator=None)` → `RunStepsResult`
**Models**: `StepResult`, `RunStepsResult`

---

## Files Changed

| File | Change |
|---|---|
| `src/daemon/routes/actions.ts` | `enrichDiag()` helper; mouse_move steps; scroll_until step_delay_ms + session_id; load_more session_id; /find endpoint; /upload_url endpoint; /run_steps endpoint |
| `src/daemon/routes/sessions.ts` | GET /settings; GET /profiles; POST /profiles/:name/reset |
| `src/daemon/routes/state.ts` | POST /cookies/delete |
| `sdk/python/agentmb/models.py` | MouseResult x/y/steps; ScrollUntilResult/LoadMoreResult session_id; FindResult; ViewportSize; SessionSettings; ProfileInfo; ProfileListResult; ProfileResetResult; DeleteCookieResult; UploadUrlResult; StepResult; RunStepsResult |
| `sdk/python/agentmb/client.py` | Session.fill fill_strategy/char_delay_ms; Session.mouse_move steps; Session.scroll_until step_delay_ms; Session.find; Session.get_settings; Session.delete_cookie; Session.upload_url; Session.run_steps; AsyncSession mirrors; BrowserClient/AsyncBrowserClient list_profiles/reset_profile |
| `tests/e2e/test_r08c06.py` | 30 e2e tests |
| `scripts/verify.sh` | TOTAL 21→22; r08c06 gate |

## Build

```
npm run build  # ✓ no TypeScript errors
```

## Test Results

```
30 passed in test_r08c06.py
verify gate: 22/22 PASSED
```
