# R07-C03 Dev Summary

**Branch:** feat/r07-hardening
**Baseline:** c7379e4 (r07-c02-fix)
**Date:** 2026-02-27
**Scope:** R07-T05 / T06 / T09 / T10 (+ sub-tasks T15/T16/T17)

---

## Deliverables

### T05 — Session State: Cookie/Storage Import-Export
- **API:** `GET/POST/DELETE /api/v1/sessions/:id/cookies`, `GET/POST /api/v1/sessions/:id/storage_state`
- **BrowserManager:** `getCookies()`, `addCookies()`, `clearCookies()`, `getStorageState()` wrapping Playwright context APIs
- **Python SDK:** `Session.cookies()`, `add_cookies()`, `clear_cookies()`, `storage_state()`, `restore_storage_state()` + models `CookieListResult`, `StorageStateResult`, `StorageStateRestoreResult`
- **CLI:** `cookie-list`, `cookie-clear`, `storage-export`, `storage-import` commands

### T06 / T15–T17 — Observability: Console/Error Buffers + Annotated Screenshot

**T15 — Annotated Screenshot**
- **API:** `POST /api/v1/sessions/:id/annotated_screenshot`
- Injects `<style id="__agentmb_hl__">` per `{selector, color, label}` highlight spec (CSS outline + `::before` pseudo-element label), takes screenshot, removes injected style (cleanup on success and error path)
- **Python SDK:** `Session.annotated_screenshot()` → `AnnotatedScreenshotResult` (`.to_bytes()`, `.save(path)`)
- **CLI:** `annotated-screenshot` command with repeatable `--highlight <selector>` option

**T16 — Console Log Ring Buffer**
- `page.on('console', ...)` listener attached to every page (initial + `createPage()` tabs)
- Ring buffer in `BrowserManager` (max 500 entries), `ConsoleEntry` = `{ts, type, text, url}`
- **API:** `GET /api/v1/sessions/:id/console?tail=N`, `DELETE /api/v1/sessions/:id/console`
- **Python SDK:** `Session.console_log(tail?)`, `clear_console_log()` → `ConsoleLogResult`
- **CLI:** `console-log` command

**T17 — Page Error Ring Buffer**
- `page.on('pageerror', ...)` listener, same attachment strategy as T16
- Ring buffer (max 100 entries), `PageErrorEntry` = `{ts, message, url}`
- **API:** `GET /api/v1/sessions/:id/page_errors?tail=N`, `DELETE /api/v1/sessions/:id/page_errors`
- **Python SDK:** `Session.page_errors(tail?)`, `clear_page_errors()` → `PageErrorListResult`
- **CLI:** `page-errors` command

### T09 — MCP Adapter PoC
- **File:** `adapters/mcp/agentmb_mcp.py` (standalone, no external MCP library)
- Manual JSON-RPC 2.0 over stdin/stdout (MCP stdio transport)
- Handles: `initialize`, `tools/list`, `tools/call`
- 5 tools: `agentmb_create_session`, `agentmb_navigate`, `agentmb_click`, `agentmb_extract`, `agentmb_screenshot`
- Added `SessionsManager.get_handle(session_id)` to Python SDK for handle-only (no network) session access

### T10 — Recipe MVP
- **File:** `sdk/python/agentmb/recipe.py`
- `Recipe(session, name, checkpoint?, stop_on_error?)` with `@recipe.step(name)` decorator
- `Recipe.run()` → `RecipeResult` with per-step `StepResult` (status: ok/error/skipped)
- `RecipeResult.ok`, `.failed_step`, `.summary()`
- `CheckpointStore`: JSON file persistence; on second `run()`, already-completed steps are skipped
- Checkpoint cleared on full success

---

## Changed Files

### New Files
| File | Purpose |
|---|---|
| `src/daemon/routes/state.ts` | Cookie/storage/console/pageerror/annotated-screenshot routes |
| `sdk/python/agentmb/recipe.py` | Recipe MVP (T10) |
| `adapters/mcp/agentmb_mcp.py` | MCP adapter PoC (T09) |
| `tests/e2e/test_r07c03.py` | e2e tests (18 tests) |

### Modified Files
| File | Changes |
|---|---|
| `src/browser/manager.ts` | Console/error ring buffers + observer attachment; cookie/storage methods |
| `src/browser/actions.ts` | `annotatedScreenshot()` + `HighlightSpec` interface |
| `src/daemon/server.ts` | `registerStateRoutes()` call |
| `sdk/python/agentmb/models.py` | New models: CookieInfo/CookieListResult/StorageStateResult/StorageStateRestoreResult/AnnotatedScreenshotResult/ConsoleEntry/ConsoleLogResult/PageErrorEntry/PageErrorListResult |
| `sdk/python/agentmb/client.py` | New Session methods (10); SessionsManager.get_handle() |
| `sdk/python/agentmb/__init__.py` | New model exports |
| `src/cli/commands/actions.ts` | CLI commands: cookie-list/cookie-clear/storage-export/storage-import/annotated-screenshot/console-log/page-errors; collectValues helper |
| `agentops/TODO.md` | T05/T06/T09/T10 → DONE |
| `scripts/verify.sh` | TOTAL 14→15; added r07c03 suite |

---

## Test Results

### `tests/e2e/test_r07c03.py` — 18 passed

| Class | Tests |
|---|---|
| TestCookies | T-CK-01..04 (list empty / list after clear / add via API / clear) |
| TestStorageState | T-SS-01..02 (export shape / restore) |
| TestAnnotatedScreenshot | T-AS-01..03 (highlight count / single highlight / save to file) |
| TestConsoleLog | T-CL-01..03 (collection / tail / clear) |
| TestPageErrors | T-PE-01..02 (uncaught error / clear) |
| TestRecipe | T-RC-01..04 (basic run / stop_on_error / checkpoint resume / summary) |

### `scripts/verify.sh` — 15/15 PASS

```
[1/15]  Build                PASS
[2/15]  Daemon start         PASS
[3/15]  smoke                PASS (15 passed)
[4/15]  auth                 PASS (11 passed)
[5/15]  handoff              PASS (6 passed)
[6/15]  cdp                  PASS (8 passed)
[7/15]  actions-v2           PASS (10 passed)
[8/15]  pages-frames         PASS (7 passed)
[9/15]  network-cdp          PASS (8 passed)
[10/15] c05-fixes            PASS (10 passed)
[11/15] policy               PASS (11 passed)
[12/15] element-map          PASS (9 passed)
[13/15] r07c02               PASS (24 passed)
[14/15] r07c03               PASS (18 passed)
[15/15] Daemon stop          PASS
ALL GATES PASSED (15/15)
```

---

## Fix Notes

**`test_add_and_list_cookies`**: Initial test called `session.eval("document.cookie = '...'")` on a `data:` URL page. Chromium blocks `document.cookie` on `data:` URIs (SecurityError → 422). Fixed by removing the eval call; the `add_cookies` API path is already covered by `T-CK-03`.

---

## r07-c03-fix

### P1 — Recipe async step detection + AsyncRecipe

**Issue:** `Recipe.run()` called `fn(session)` and stored the return value. If `fn` was `async def`, the return was a coroutine object (truthy → recorded as `status='ok'`); the actual async work never ran.

**Fix:**
- Added `inspect.iscoroutine(data)` check after each step call. Detected coroutine is `.close()`d and a `TypeError` is raised: `"Step '...' is an async function. Use AsyncRecipe..."`. Step records `status='error'`.
- Added **`AsyncRecipe`** class with `async def run()` that accepts sync and async steps; async steps are properly awaited. Exported from `agentmb.recipe`.
- Module docstring updated with async usage example.

### P2a — MCP adapter binary I/O

**Issue:** `main()` iterated `sys.stdin` in text mode; on non-UTF-8 locales or Windows (CRLF), multi-byte characters could be mangled.

**Fix:** Switched to `sys.stdin.buffer.readline()` + `.decode("utf-8", errors="replace")`. Output uses `sys.stdout.buffer.write(data.encode("utf-8"))`. Matches MCP stdio transport spec and avoids codec/CRLF issues.

### P2b — annotated_screenshot CSS label + color escaping

**Issue:** `label` was only single-quote escaped; a backslash would emit raw `\` into CSS, mangling the next char. `color` was used verbatim; `{`/`;` in it would break the CSS rule.

**Fix:**
- `label` escaping order: `\`→`\\`, `'`→`\'`, `\n`→`\A `, strip `\r`.
- `color` sanitized: strips `{`, `}`, `;`, `/*`, `*/` before injection.

### P2c — storage_state restore: origins_skipped + note

**Issue:** `restore_storage_state` silently dropped `origins` (localStorage/sessionStorage); SDK docstring only mentioned cookies.

**Fix:**
- Route returns `origins_skipped: <n>` and, when non-zero, a `note` explaining the limitation.
- `StorageStateRestoreResult` gains `origins_skipped: int = 0` + `note: Optional[str] = None`.
- `Session.restore_storage_state()` docstring updated with explicit limitation note.

### Test additions (r07-c03-fix, +4 tests → 22 total)

| Test | Class | What |
|---|---|---|
| T-RC-05 | TestRecipe | Recipe.run() records error (not ok) when step is async |
| T-RC-06 | TestRecipe | AsyncRecipe.run() properly awaits async steps + handles sync steps |
| T-AS-04 | TestAnnotatedScreenshot | Label with `'` and `\` doesn't break CSS injection |
| T-SS-03 | TestStorageState | origins entry → origins_skipped=1, note present |

### verify.sh after fix
```
[14/15] r07c03    PASS (22 passed)   ← was 18
ALL GATES PASSED (15/15)
```

---

## Design Notes

- **Observer attachment**: `attachPageObservers(sessionId, page)` is called from both `launchSession` (initial page) and `createPage()` (new tabs) to ensure console/error listeners are always wired up.
- **Route file separation**: State management routes isolated in `state.ts` to keep `sessions.ts` and `actions.ts` focused.
- **MCP adapter isolation**: No dependency on `@modelcontextprotocol/sdk`; pure JSON-RPC 2.0 over stdin/stdout keeps the adapter dependency-free and the core daemon untouched.
- **Recipe checkpointing**: JSON file stores `{recipe, completed: [stepNames], ts}`. On second run, steps in `completed` get `status='skipped'`; checkpoint is cleared on full success.
