# r05-c02 Dev Summary

**Branch**: feat/r05-next
**Commit**: d980f6e
**Date**: 2026-02-26
**Scope**: T13 naming fix + r05-b1 P1/P2 fixes + T03 multi-page + T04 frame support

---

## Changes

### T13: Naming consistency
- README.md, INSTALL.md: `AGENTMB_PROFILE_KEY` → `AGENTMB_ENCRYPTION_KEY` everywhere

### b1 P1/P2 fixes
- `src/browser/actions.ts`: removed unused `path`, `os`, `BrowserContext` imports; added `Frame` import
- Added `export type Actionable = Page | Frame` — union type enabling frame-level action dispatch
- `src/cli/commands/actions.ts`: added missing `wait-response` CLI command
- Upload/download 50MB memory guard: route-level 413 check + `maxBytes` param in `downloadFile` with `fs.statSync`
- `sdk/python/agentmb/client.py`: `AsyncSession.upload` uses `asyncio.to_thread` for non-blocking file I/O
- `src/browser/manager.ts`: `acceptDownloads: true` added to `launchPersistentContext`

### T03: Multi-page management
- `src/browser/manager.ts`: added `SessionPageState` interface, `sessionPages` Map, `newPageId()`, `createPage()`, `listPages()`, `switchPage()`, `closePage()`, `getActivePageId()` methods; `switchMode` and `closeSession` clean up `sessionPages`
- `src/daemon/routes/sessions.ts`: 4 new routes: `GET/POST /pages`, `POST /pages/switch`, `DELETE /pages/:pageId`
- `sdk/python/agentmb/models.py`: `PageInfo`, `PageListResult`, `NewPageResult`
- `sdk/python/agentmb/client.py`: `pages()`, `new_page()`, `switch_page()`, `close_page()` on `Session` and `AsyncSession`
- `sdk/python/agentmb/__init__.py`: export new page models

### T04: Frame support
- `src/browser/actions.ts`: changed `page: Page` → `page: Actionable` on 9 functions (click, fill, evaluate, extract, typeText, press, selectOption, hover, waitForSelector, collectDiagnostics)
- `src/daemon/routes/actions.ts`: added `FrameSelector` interface (`type: 'name'|'url'|'nth'`), `resolveFrame()` helper; updated 9 action routes to accept optional `frame?: FrameSelector` body param

### Tests
- `tests/e2e/test_pages_frames.py`: 7 tests covering T03 (list/new/switch/close/independent pages) and T04 (eval + extract in frame context)

---

## Build / test
- `npm run build`: 0 errors
- Tests are e2e (require running daemon); verified by inspection
