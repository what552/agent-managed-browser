# R09-C04 Dev Summary

**Batch**: R09-C04
**Commit**: `feat(r09-c04): T02 regex route mock, T08 proxy/video, T12 sensitive_warning, T14 allow_dirs/ls`
**Gate result**: 27/27 PASS
**Date**: 2026-03-01

---

## Tasks Delivered

### T02 — Request Interception Mock Enhancement (Regex Support)

**File**: `src/browser/manager.ts`

- `RouteMockConfig` interface gains `delay_ms?: number` for simulated network latency.
- New `parseRoutePattern(pattern)` private method: detects `/regex/flags` string format → returns `RegExp`; falls back to glob string if parse fails.
- `addRoute()`: resolves pattern via `parseRoutePattern`, passes `RegExp | string` to `entry.context.route()`.
- `removeRoute()` / `cleanupRoutes()`: use stored `playwrightPattern` (not the raw string) for `unroute()` calls so RegExp patterns unregister correctly.
- `RouteEntry` interface updated with `playwrightPattern: string | RegExp`.

### T08 — Session-Level Proxy + Video Recording

**Files**: `src/browser/manager.ts`, `src/daemon/routes/sessions.ts`, `src/cli/commands/session.ts`

**manager.ts**:
- New class fields: `sessionVideoDir: Map<string, string>`, `sessionAllowDirs: Map<string, string[]>`.
- `launchSession` opts extended: `proxyUrl?: string`, `recordVideo?: boolean`, `allowDirs?: string[]`.
- Proxy: if `proxyUrl` set, adds `proxy: { server: proxyUrl }` to Playwright `launchPersistentContext` opts.
- Video: if `recordVideo=true`, creates tmp dir `agentmb-video-<sid>`, sets `recordVideo.dir` + `size` in launchOpts, stores dir.
- New method `getVideoPath(sessionId)`: returns `page.video().path()` or `null`.
- `closeSession`: cleans up `sessionAllowDirs` and `sessionVideoDir` entries.

**sessions.ts**:
- POST /sessions body extended: `proxy_url?: string`, `record_video?: boolean`, `allow_dirs?: string[]`.
- New `GET /api/v1/sessions/:id/video` → `{ session_id, video_path }`.
- New `POST /api/v1/sessions/:id/video/save { dest_path }` → copies video file to specified path.

**CLI**:
- `session new --proxy <url>` — proxy URL.
- `session new --record-video` — enable video recording.

### T12 — Sensitive Website Safety Warning

**File**: `src/daemon/routes/actions.ts`

- Added `SENSITIVE_DOMAIN_PATTERNS` constant array with 5 category patterns: financial, medical, gambling, adult, crypto.
- Supports `AGENTMB_SENSITIVE_DOMAINS` env var (comma-separated regex strings) for custom additions.
- `detectSensitiveDomain(url)` helper: extracts hostname, tests against patterns, returns `{ sensitive, category?, domain? }`.
- Navigate route: calls `detectSensitiveDomain(url)` AFTER `Actions.navigate()`; appends `sensitive_warning: { domain, category, message }` to result when sensitive (omits field entirely when not sensitive — no backward-compat break).

### T14 — Local Awareness Pipeline

**Files**: `src/browser/manager.ts`, `src/daemon/routes/sessions.ts`, `src/cli/commands/session.ts`

**manager.ts**:
- `launchSession` opts: `allowDirs?: string[]` → resolved to absolute paths via `path.resolve()`.
- New method `getAllowDirs(sessionId)`: returns whitelist array for session.

**sessions.ts**:
- POST /sessions: `allow_dirs?: string[]` passed through to `manager.launchSession`.
- New `GET /api/v1/utils/ls?session_id=<id>&path=<path>&depth=<1-5>`:
  - 400 if `session_id` or `path` missing.
  - 404 if session not found.
  - 403 if session has no `allowDirs`.
  - 403 if `path` resolves outside all allowed dirs (path traversal blocked).
  - Returns `{ path, entries[], session_id }` with recursive `LsEntry` tree up to `depth` (max 5).

**CLI**:
- `session new --allow-dir <path>` — repeatable option, collects into `allow_dirs` array.

---

## Test Coverage (`tests/e2e/test_r09c04.py`)

8 tests, all PASS:

| # | Class | Test | Feature |
|---|-------|------|---------|
| 1 | `TestSensitiveWarning` | `test_navigate_sensitive_domain_has_warning` | T12: bank URL → `sensitive_warning` present |
| 2 | `TestSensitiveWarning` | `test_navigate_non_sensitive_domain_no_warning` | T12: example.local → no `sensitive_warning` |
| 3 | `TestRegexRouteMock` | `test_regex_pattern_route_mock` | T02: `/regex/flags` pattern intercepts matching URLs |
| 4 | `TestRegexRouteMock` | `test_glob_pattern_route_not_regressed` | T02: glob patterns still work |
| 5 | `TestAllowDirsLs` | `test_ls_succeeds_within_allowed_dir` | T14: allow_dirs + /utils/ls returns entries |
| 6 | `TestAllowDirsLs` | `test_ls_denied_outside_allowed_dir` | T14: path outside allowDirs → 403 |
| 7 | `TestAllowDirsLs` | `test_ls_denied_no_allow_dirs` | T14: no allowDirs → 403 |
| 8 | `TestSessionProxy` | `test_session_creation_with_proxy_url` | T08: proxy_url accepted at creation → 201 |

*Note*: T12 tests use catch-all route mock (`**/*`) to ensure Playwright intercepts navigation before DNS lookup, making unreachable hostnames work in test environment.

---

## Verify Gate

```
27/27 PASS
r09c04: 8 passed, 1 warning in 2.99s
```

All previous suites continue to PASS (no regressions).
