# r06-c01 Dev Summary

**Branch**: feat/r06-next
**Commit**: (this commit)
**Date**: 2026-02-27
**Scope**: Release consistency gate + CLI capability alignment (pages/route/trace/cdp-ws)

---

## Changes

### 1. Release Consistency Gate: `scripts/check-dist-consistency.sh`

New script that validates dist/source consistency on every build. Checks (27 assertions total):

- **Build artifacts**: `dist/cli/index.js` and `dist/daemon/index.js` exist
- **Binary name**: `package.json` `bin` key is `agentmb`
- **Top-level help**: All key commands appear in `agentmb --help` (start, stop, status, session, navigate, screenshot, eval, pages, route, trace, cdp-ws)
- **AGENTMB_ prefix**: Env var prefix used in ≥1 CLI source file
- **Subcommand help**:
  - `agentmb session --help` lists: new, list, rm
  - `agentmb pages --help` lists: list, new, switch, close
  - `agentmb route --help` lists: list, add, rm
  - `agentmb trace --help` lists: start, stop

Integrated into CI `build-smoke` job (runs on all platforms: ubuntu, macOS, Windows) after `npm run build`.

### 2. New CLI Command: `agentmb pages` (T03)

File: `src/cli/commands/pages.ts`

| Subcommand | Description |
|---|---|
| `pages list <sess>` | List all open tabs with page_id and URL |
| `pages new <sess>` | Open a new tab (returns page_id) |
| `pages switch <sess> <page-id>` | Make tab the active automation target |
| `pages close <sess> <page-id>` | Close tab (409 guard if last page) |

### 3. New CLI Command: `agentmb route` (T07)

File: `src/cli/commands/route.ts`

| Subcommand | Description |
|---|---|
| `route list <sess>` | List active route mocks |
| `route add <sess> <pattern>` | Register mock (`--status`, `--body`, `--content-type`, `--headers`) |
| `route rm <sess> <pattern>` | Remove mock by pattern |

### 4. New CLI Command: `agentmb trace` (T08)

File: `src/cli/commands/trace.ts`

| Subcommand | Description |
|---|---|
| `trace start <sess>` | Start Playwright trace recording |
| `trace stop <sess> [-o file.zip]` | Stop and save ZIP (default: trace.zip) |

### 5. New CLI Command: `agentmb cdp-ws` (T06)

Added to `src/cli/commands/actions.ts`:
- `cdp-ws <session-id>` — prints browser-level CDP WebSocket URL (or a note if unavailable)

### 6. `src/cli/client.ts` — `apiDeleteWithBody`

Added `apiDeleteWithBody(path, body)` helper for DELETE requests that carry a JSON body (required by `DELETE /api/v1/sessions/:id/route` which needs `{ pattern }` in the body, and `DELETE /api/v1/sessions/:id/pages/:pageId`).

### 7. `src/cli/index.ts` — Command registration

Imports and registers: `pagesCommands`, `routeCommands`, `traceCommands`.

### 8. `.github/workflows/ci.yml` — CI integration

Added `Dist/source consistency gate` step in `build-smoke` job (all 3 platforms) immediately after `npm run build`.

### 9. `README.md` — CLI documentation

Added sections for:
- Multi-Page Management (`pages` commands)
- Network Route Mocks (`route` commands)
- Playwright Trace Recording (`trace` commands)
- CDP WebSocket URL (`cdp-ws` command)

---

## Verify Results

```
check-dist-consistency.sh: ALL CHECKS PASSED (27/27)

verify.sh:
[1/11] Build              PASS
[2/11] Daemon start       PASS
[3/11] smoke              PASS  (15 passed)
[4/11] auth               PASS  (11 passed)
[5/11] handoff            PASS  (6 passed)
[6/11] cdp                PASS  (8 passed)
[7/11] actions-v2         PASS  (10 passed)
[8/11] pages-frames       PASS  (7 passed)
[9/11] network-cdp        PASS  (8 passed)
[10/11] c05-fixes         PASS  (10 passed)
[11/11] Daemon stop       PASS
ALL GATES PASSED (11/11)
```

---

## CLI Gap Before/After

| Feature | Before r06-c01 | After r06-c01 |
|---------|---------------|---------------|
| pages list/new/switch/close | Missing | ✓ `agentmb pages` |
| route list/add/rm | Missing | ✓ `agentmb route` |
| trace start/stop | Missing | ✓ `agentmb trace` |
| cdp-ws | Missing | ✓ `agentmb cdp-ws` |
| Consistency gate | Missing | ✓ `scripts/check-dist-consistency.sh` + CI |
