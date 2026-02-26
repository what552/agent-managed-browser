# r05-c03 Dev Summary

**Branch**: feat/r05-next
**Commit**: a8d8b6e
**Date**: 2026-02-26
**Scope**: T06 CDP WS URL + T07 network route mock + T09 operator auto-inference

---

## Changes

### T06: CDP WebSocket native URL
- `src/browser/manager.ts`: `getCdpWsUrl(sessionId)` — accesses `context.browser().wsEndpoint()` via `any` cast (not in playwright-core types but available at runtime)
- `src/daemon/routes/sessions.ts`: `GET /api/v1/sessions/:id/cdp/ws` — returns `{ session_id, browser_ws_url, note }`; audit-logged; 404/410 for missing/zombie sessions
- `sdk/python/agentmb/client.py`: `cdp_ws_url()` on `Session` and `AsyncSession`

### T07: Network route mock management
- `src/browser/manager.ts`: added `RouteMockConfig` interface, `RouteEntry` interface, `sessionRoutes` Map; methods: `addRoute()`, `removeRoute()`, `listRoutes()`, `cleanupRoutes()` (private); uses `context.route()` (context-level — applies to all pages, persists through page switches); `launchSession` initializes `sessionRoutes`; `closeSession` and `switchMode` call `cleanupRoutes()`
- `src/daemon/routes/sessions.ts`: `GET /routes`, `POST /route` (201), `DELETE /route` (204, body with `pattern`); all audit-logged
- `sdk/python/agentmb/models.py`: `RouteMock`, `RouteEntry`, `RouteListResult` Pydantic models
- `sdk/python/agentmb/client.py`: `routes()`, `route(pattern, mock)`, `unroute(pattern)` on both sync/async Session; `_delete_with_body()` helper on both clients
- `sdk/python/agentmb/__init__.py`: exported `RouteMock`, `RouteEntry`, `RouteListResult`

### T09: operator auto-inference
- `src/daemon/routes/actions.ts`: added `inferOperator(req, s, explicit?)` — checks: 1) explicit body param, 2) `X-Operator` header, 3) `session.agentId`, 4) `'agentmb-daemon'` fallback; applied to all 15 action routes
- `sdk/python/agentmb/client.py`: `BrowserClient` and `AsyncBrowserClient` accept `operator` param + `AGENTMB_OPERATOR` env; `_base_headers()` now accepts `operator` and adds `X-Operator` header

### Tests
- `tests/e2e/test_network_cdp.py`: 8 tests — T06 CDP WS response, T07 route add/list/unroute/serve, T09 operator from header/agent_id/fallback

---

## Design decisions
- T07 uses `context.route()` not `page.route()` so mocks persist across page switches (T03 integration)
- T06 returns `null` for `browser_ws_url` if `wsEndpoint()` is not available (launchPersistentContext edge case)
- T09 fallback chain is intentional: explicit body > header > session > daemon; SDK sets header so per-client default works without per-call overhead
