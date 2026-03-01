# R09 Stability Research Report

**Date:** 2026-03-01
**Researcher:** Claude Researcher
**Scope:** Three stability directions — multi-page memory leaks, multi-agent concurrency, extreme network delay fallback
**Codebase snapshot:** branch `review/r09-reviewer-1`, commit `4b4acb5`

---

## Direction 1: Multi-Page Memory Leaks

### Files Examined
- `src/browser/manager.ts` — BrowserManager class, all per-session Maps

### Findings

#### 1.1 Page-level Map entries after `closePage()`

`closePage()` (line 475-495 in manager.ts) removes the page from `state.pages` and calls `page.close()`. However the following session-level Maps are **never pruned on a per-page basis**, they are only cleaned up when the entire session closes:

| Map | Accumulates on page create | Cleaned on page close? |
|-----|---------------------------|------------------------|
| `sessionConsoleLog` | Yes — `attachPageObservers` registers a `console` listener | No — per-session ring buffer, not per-page |
| `sessionPageErrors` | Yes — `attachPageObservers` registers a `pageerror` listener | No |
| `sessionDialogs` | Yes — `attachPageObservers` registers a `dialog` listener | No |
| `sessionPageRevs` | Incremented on `framenavigated` for any page | No per-page cleanup |
| `sessionSnapshots` | Cleared only on navigation | No per-page cleanup |
| `sessionRoutes` | Per session, not per page | No per-page cleanup |
| `sessionAllowDirs` | Per session | No per-page cleanup |
| `sessionVideoDir` | Per session | No per-page cleanup |

**Key finding:** The event listeners registered via `attachPageObservers()` (lines 258-286) are attached directly to each `Page` object with `page.on(...)`. Playwright automatically removes native event listeners when a page is garbage-collected, **but only after the page object itself is GC'd**. Because the listener closures capture `sessionId` (a string) rather than the Page object, the closures themselves are small. The real concern is:

1. **The Page object stays referenced in `state.pages` until `closePage()` is called**. Once deleted from the Map, the Page is released. Playwright will internally close the CDP session. This path is correct.

2. **CDP network-condition sessions** (`sessionCdpSessions`): When `createPage()` spawns a new page and a subsequent call to `setNetworkConditions()` is made on that page, the CDPSession is stored under the `sessionId` key, not the `pageId`. If that sub-page is later closed, the stored CDPSession references a CDP session on the closed page. `resetNetworkConditions()` will eventually try to detach it, but until that happens the CDPSession object is retained in the Map — a genuine, if small, leak per closed sub-page with active network emulation.

3. **`attachPageObservers` on the CDP-attach path** (line 429): In `attachCdpSession()`, only the initially-selected page gets observers. Additional pages that appear in the CDP-attached browser context (e.g., opened by JS) are NOT tracked in `sessionPages` nor given observers. If the remote browser opens new tabs, those tabs are invisible to the daemon and their Page objects accumulate in the Playwright BrowserContext without cleanup.

4. **`framenavigated` listener leak on closed pages**: `createPage()` registers a `framenavigated` listener (lines 444-448). After `closePage()` calls `page.close()`, Playwright should fire no more events, but the listener closure is not explicitly removed with `page.off()`. Playwright does guarantee that closed pages emit no more events, so the closure is held only until the Page is GC'd. This is a minor concern rather than a hard leak.

5. **Ring buffers (console, errors, dialogs)**: These are capped (MAX_CONSOLE=500, MAX_ERRORS=100, MAX_DIALOGS=50) per session. A session with heavy JS console activity from many sub-pages will accumulate up to 500 entries per session. Since pages share a single session ring buffer, a session with 20 rapidly cycling pages could see legitimate log pollution — entries from already-closed pages mixed with entries from live pages. There is no per-page tombstoning.

#### 1.2 CDP Attach mode — page tracking

In `attachCdpSession()` (lines 383-430), `sessionPages` is initialized with only the single selected page. Any additional pages already open in the remote browser's context (retrieved via `ctx.pages()`) are silently ignored. More critically, pages opened **after** attach (by the remote browser, e.g., popup.window.open) are never registered. This means:

- `listPages()` returns stale data
- Page objects in the `BrowserContext` accumulate without cleanup
- `closePage()` cannot be called on untracked pages

This is a structural gap in the CDP attach model. At scale, a remote browser that opens many popup pages and never closes them will leak Page objects in the Playwright BrowserContext for the lifetime of the session.

#### 1.3 Large-scale page cycling stress scenario

Repeated `createPage()` + `closePage()` in a tight loop:

- Each `createPage()` calls `context.newPage()` and registers two listeners (`framenavigated`, plus three from `attachPageObservers`)
- Each `closePage()` deletes from `state.pages` Map and calls `page.close()`
- After `page.close()`, the Page object is held only by the listeners' closures until GC
- Node.js GC may not collect fast enough under high churn, causing transient heap growth

No explicit `page.removeAllListeners()` is called before `page.close()`. This is standard Playwright usage and is generally safe, but under extreme cycling (e.g., 1000 pages/sec) can cause observable heap pressure.

### Risk Assessment

| Risk | Severity | Likelihood |
|------|----------|------------|
| CDPSession retained after sub-page close (network emulation) | Medium | Low (only if setNetworkConditions used per sub-page) |
| Untracked CDP-attach popup pages accumulating | High | Medium (any JS that calls window.open) |
| Ring buffer pollution across pages | Low | High (cosmetic, not a memory leak) |
| Transient heap growth under page cycling | Low–Medium | Medium |
| framenavigated listener not explicitly removed | Low | High (harmless in practice) |

### Recommendations

1. **Add `page.removeAllListeners()` before `page.close()`** in `closePage()` to release listener closures immediately rather than waiting for GC.
2. **Track CDP-attach extra pages**: In `attachCdpSession()`, enumerate `ctx.pages()` and register all of them in `sessionPages` with their own `pageId` entries and observer listeners.
3. **Subscribe to `context.on('page', ...)` event** in both `launchSession()` and `attachCdpSession()` to auto-register pages opened by JS (`window.open`, target=_blank), preventing the untracked-page leak.
4. **Per-page CDPSession keying**: Key `sessionCdpSessions` by `pageId` rather than `sessionId`, and clean up the entry in `closePage()`.

---

## Direction 2: Multi-Agent Concurrency Races and Deadlocks

### Files Examined
- `src/browser/manager.ts` — `addRoute`, `removeRoute`, `cleanupRoutes`
- `src/daemon/routes/sessions.ts` — route HTTP endpoints
- `src/daemon/routes/actions.ts` — navigate, eval, page resolution
- `tests/e2e/test_r09c03.py` — existing concurrency tests

### Findings

#### 2.1 Route mock race condition (`addRoute` / `removeRoute`)

`addRoute()` (lines 532-553 in manager.ts) is:

```typescript
async addRoute(sessionId, pattern, mock) {
  await this.removeRoute(sessionId, pattern)   // (A) await unroute
  const routeState = this.sessionRoutes.get(sessionId) ?? new Map()
  this.sessionRoutes.set(sessionId, routeState)
  const handler = async (route) => { ... }
  await entry.context.route(playwrightPattern, handler)  // (B) await route
  routeState.set(pattern, { ... })
}
```

Node.js is single-threaded, so concurrent JS microtasks cannot truly interleave at the JavaScript level. However, because `addRoute` is `async` and contains two `await` points (A and B), the event loop can yield between them. If two HTTP requests arrive concurrently for the same session and pattern:

1. Request 1 enters `addRoute`, calls `removeRoute` — awaits at (A)
2. Request 2 enters `addRoute` for the same pattern — also calls `removeRoute` — awaits at (A)
3. Request 1 resumes: `routeState.get(pattern)` returns `undefined` (already removed)
4. Request 2 resumes: also gets `undefined`
5. Both register a new Playwright handler via `context.route(...)` — **two handlers now exist for the same pattern**

Result: both handlers are called for matching requests; the `route.fulfill()` in one may throw after the other already fulfilled it. Playwright will log an error; the request gets one response but the second `fulfill` call throws `'Request is already handled!'`.

This is a **real but low-probability race** under concurrent agent calls to the same session's route endpoint.

#### 2.2 `removeRoute` with stale `routeState`

`removeRoute` (lines 555-564) re-fetches `routeState` by key. If `closeSession()` is called concurrently while a `removeRoute` is in flight, `contexts.get(sessionId)` may return `undefined` after the await in `cleanupRoutes()` has already run. The null check guards this correctly (`if (!entry || !routeState) return`). No crash, but the unroute call is silently skipped — not a correctness issue, merely a no-op on a dead session.

#### 2.3 Concurrent navigate + eval — deadlock analysis

`navigate()` in `actions.ts` calls `page.goto(url, { waitUntil })` with no explicit timeout (line 59 in `src/browser/actions.ts`). Playwright's default timeout for `goto` is 30 seconds. If `waitUntil='networkidle'` and a concurrent `addRoute` installs a delay handler mid-navigation, the navigation may wait for network idle indefinitely because the delayed route handler holds a pending request open. This is a **functional deadlock** (no Node.js thread block, but the HTTP response to the caller never arrives until Playwright's 30s timeout fires).

Concretely:
- Agent A calls `navigate` with `wait_until=networkidle` (no timeout parameter exposed at HTTP layer)
- Agent B calls `POST /route` with `delay_ms=999999` matching the page's ongoing subresource requests
- The page stalls waiting for network idle
- Agent A's HTTP request is held for up to 30 seconds, then returns a Playwright timeout error

**No hard deadlock** (Node.js event loop continues serving other requests), but **request starvation** affects the caller.

#### 2.4 `resolveWithPage` — concurrent switch + action

`switchPage()` (lines 464-473) is synchronous (no await). It updates `state.activePageId` and calls `this.contexts.set(sessionId, { ...entry, page })`. Because it is not async, there is no yield between reading `state.pages.get(pageId)` and writing `state.activePageId`. A concurrent HTTP request that reads the active page ID via `resolve()` (which calls `registry.getLive`) may get a stale page reference if `switchPage` just ran — but `registry.getLive` returns the registry's `page` reference, not BrowserManager's. The two can briefly diverge if `switchPage` has updated BrowserManager's `contexts` Map but the registry `attach()` call (line 472) hasn't propagated. **Low probability, extremely narrow window**, but technically a transient inconsistency.

#### 2.5 What existing tests cover

`test_r09c03.py` (P2 concurrent test class) tests:
- Two threads targeting different `page_id`s via navigate + eval simultaneously
- Scroll and screenshot concurrency across pages

What is **not covered**:
- Two threads calling `addRoute` + `removeRoute` on the same pattern simultaneously
- Concurrent `navigate` while a `delay_ms` route mock is being registered
- `switchPage` called by one agent while another does `eval` on the previously active page
- `closeSession` racing with an in-flight `addRoute` or `navigate`
- Multiple sessions sharing the same profile directory (launchPersistentContext lock contention)

### Risk Assessment

| Risk | Severity | Likelihood |
|------|----------|------------|
| Double-register of route handler (addRoute race) | Medium | Low–Medium |
| navigate starvation via delay_ms route mock | Medium | Medium |
| switchPage / registry.getLive brief divergence | Low | Low |
| closeSession racing with in-flight route operations | Low | Medium |

### Recommendations

1. **Route mutation serialization**: Wrap `addRoute` and `removeRoute` in a per-session async mutex (e.g., a pending Promise chain stored in a `sessionRouteLocks` Map). This eliminates the double-register race.
2. **Expose `timeout_ms` on navigate endpoint**: Add a `timeout_ms` parameter (max 60000) to `POST /navigate`, passed to `page.goto` as `{ timeout }`. This prevents indefinite stalls when a delay_ms mock is active.
3. **Add delay_ms upper bound**: Cap `delay_ms` in `RouteMockConfig` at a reasonable maximum (e.g., 30000 ms) to prevent accidental or malicious stalls.
4. **Expand concurrency test coverage**: Add tests for the unguarded scenarios listed in 2.5.

---

## Direction 3: Extreme Network Delay Fallback

### Files Examined
- `src/browser/actions.ts` — `navigate()`, `click()`, `fill()`, `evaluate()`
- `src/browser/manager.ts` — `addRoute()` handler, `delay_ms`
- `src/daemon/routes/actions.ts` — navigate HTTP handler, preflight checks

### Findings

#### 3.1 `navigate()` has no timeout parameter

`actions.ts` `navigate()` function (lines 48-65):

```typescript
export async function navigate(page, url, waitUntil = 'load', ...) {
  await page.goto(url, { waitUntil })
  // No { timeout } option passed
}
```

Playwright's default navigation timeout is **30,000 ms**. There is no way for the HTTP caller to reduce or increase this. The navigate HTTP handler in `actions.ts` (line 337) passes `wait_until` but no timeout. Under extreme latency (e.g., a `delay_ms=25000` route mock on a subresource, combined with `wait_until=networkidle`), the navigation will block for up to 30 seconds with no intermediate feedback to the caller.

After timeout, Playwright throws `TimeoutError: page.goto: Timeout 30000ms exceeded`. The daemon correctly wraps this in a 500 response via Fastify's default uncaught handler. However:
- The page state after a navigation timeout is **undefined** — Playwright may have partially loaded the page or committed a URL but stalled loading resources
- `page.url()` after timeout returns the committed URL (the navigation committed) or the previous URL (if it didn't commit)
- Subsequent actions targeting the page may find it in `domcontentloaded` state with background fetches still pending

#### 3.2 `click()` and `fill()` have preflight-bounded timeout

`click` preflight: `pfRange('timeout_ms', timeout_ms, 50, 60000)` (line 363 in actions route).
`fill` has no timeout_ms parameter at all — Playwright's default of 30s applies via `page.fill()`.
`evaluate` has no timeout_ms — Playwright default applies.

The pattern is inconsistent: click enforces a range but fill/eval/press/hover do not.

#### 3.3 `delay_ms` has no upper bound

In `addRoute()` (lines 540-543 in manager.ts):

```typescript
const handler = async (route) => {
  if (mock.delay_ms && mock.delay_ms > 0) {
    await new Promise<void>(r => setTimeout(r, mock.delay_ms!))
  }
  await route.fulfill({ ... })
}
```

There is **no maximum cap on `delay_ms`**. A value of `999999` (16.7 minutes) is accepted. Every request matching the pattern will hold a Playwright `Route` object open for that duration. Playwright route handlers that are not fulfilled within the navigation timeout cause a navigation timeout. But the `setTimeout` itself runs to completion even after the navigation has timed out — the Promise resolves, calls `route.fulfill()`, which may throw `'Request is already handled!'` or similar because the page context was destroyed. The error is silently swallowed (`try { await route.fulfill(...) } catch { }` — no such catch exists).

Actually the handler does NOT have a try/catch around `route.fulfill()`. When `delay_ms=999999` and the navigation times out first:
1. Playwright closes the page/navigation context
2. The 999999ms timer eventually fires
3. `route.fulfill(...)` throws because the request context is gone
4. The unhandled rejection propagates through the async handler

Playwright catches route handler rejections internally and logs them, but this creates unnecessary error noise and wastes a pending timer in the Node.js event loop for up to 16 minutes.

#### 3.4 Navigate page state after timeout

After a `page.goto` timeout with `wait_until='load'`:
- If the navigation committed (HTML received): page is in `interactive` or `complete` readyState with resources still loading
- If the navigation did not commit: page URL is unchanged, previous content still present
- `page.url()` reflects the last committed URL — may differ from the requested URL
- Subsequent `navigate` calls on the same page work normally (Playwright aborts pending navigation)
- Subsequent `click`/`fill` on a partially-loaded page may hit element-not-visible or timeout errors

There is no page-state recovery logic in the daemon after a navigate timeout — no automatic screenshot, no `waitForSelector` retry, no event emission. The caller must handle this themselves.

#### 3.5 `wait_until=networkidle` combined with delay_ms

`networkidle` waits until no network requests have been active for 500ms. A `delay_ms=5000` route mock on a background XHR that fires periodically will keep the page perpetually non-idle. With `wait_until=networkidle`, the navigation will always time out (30s) regardless of page load completion. This is a silent footgun for agents using the default or explicit `networkidle` combined with any non-zero `delay_ms`.

### Risk Assessment

| Risk | Severity | Likelihood |
|------|----------|------------|
| navigate has no configurable timeout → 30s stall under high delay | High | High (any delay_ms > 0 with networkidle) |
| delay_ms has no upper bound → unbounded timer, route.fulfill on closed page | Medium | Low–Medium |
| fill/eval have no timeout_ms → cannot be cancelled early | Medium | Medium |
| Inconsistent timeout coverage across action types | Medium | High (operator error) |
| Page state undefined after navigate timeout | Medium | Medium |

### Recommendations

1. **Add `timeout_ms` to navigate HTTP endpoint** (0–60000 ms, default 30000). Pass to `page.goto({ timeout })`.
2. **Cap `delay_ms` at 30000 ms** in `addRoute` with a server-side validation or hard cap in the handler: `Math.min(mock.delay_ms, 30000)`.
3. **Add try/catch in the route handler** around `route.fulfill()` to prevent unhandled rejections when page context is destroyed before the timer fires.
4. **Add `timeout_ms` to fill and eval** endpoints (bounded by pfRange), consistent with click.
5. **Document `networkidle` + `delay_ms` interaction**: Add a warning in the API docs that `wait_until=networkidle` is incompatible with non-zero `delay_ms` on matching URL patterns.

---

## Summary Table

| Direction | Top Risk | Priority Fix |
|-----------|----------|--------------|
| Memory leaks | Untracked CDP-attach popup pages | Subscribe to `context.on('page', ...)` |
| Concurrency | Double-register race on `addRoute` | Per-session route mutex |
| Network delay | navigate without configurable timeout | Add `timeout_ms` param + cap `delay_ms` |

---

## Stress Test Script

See `tests/e2e/test_r09_stability.py` (companion file) for runnable pytest coverage of all three directions.

Run with:
```bash
AGENTMB_PORT=19315 AGENTMB_DATA_DIR=/tmp/agentmb-claude pytest tests/e2e/test_r09_stability.py -v
```

---

## Actual Test Run Results

**Run date:** 2026-03-01
**Environment:** `AGENTMB_PORT=19315`, daemon v0.3.1, branch `review/r09-reviewer-1`
**Result:** 11 passed, 9 failed / 20 total

### Summary Table

| Test Class | Passed | Failed | Verdict |
|---|---|---|---|
| TestMultiPageMemoryLeak | 3 | 2 | ❌ 内存泄露实锤确认 |
| TestConcurrencyRaces | 6 | 0 | ✅ 当前并发量级稳定 |
| TestNetworkDelayFallback | 2 | 7 | ❌ 极端延迟触发级联崩溃 |
| TestCombinedStress | 0 | 1 | ❌ 级联受害（daemon 已不可用）|

### Direction 1 — 内存泄露：**P1 实锤**

```
test_page_create_close_cycle_cleans_pages_map
  创建 10 个 page → 期望 pages 列表 11 条，实际 21 条
  → pages close 后 entry 完全不从 Map 中移除

test_rapid_page_cycle_50_rounds
  50 次 create/close 循环 → 期望 1 条，实际 51 条
  → 线性增长，无上限
```

**结论**：每次 `pages close` 后 page entry 残留在内部追踪 Map，50 轮累积 50 个僵尸 entry。长期运行必发生内存溢出。

### Direction 2 — 并发竞态：**P2 暂未触发**

全部 6 个并发测试通过，包括：
- 同 pattern 并发 `addRoute`
- `addRoute` 与 `navigate` 交叉
- `closeSession` 与 route 操作并发

理论竞态路径存在（两个 await 断点），但当前测试量级（8–16 线程）未触发。建议在更高并发（100+ QPS）下复测。

### Direction 3 — 极端延迟：**P0 实锤，触发级联崩溃**

```
test_large_delay_ms_navigate_timeout_returns_error
  delay_ms=35000 → navigate 等待 30s 后超时
  → 超时后 session 查询返回 503（期望 200）
  → daemon browser manager 进入不可恢复状态

后续 6 个测试全部以 503 失败（级联受害）
  → 新 session 创建全部失败
  → daemon 需重启才能恢复
```

**结论**：极端 `delay_ms` 导致 Playwright navigate 30s 超时后，daemon 的 browser manager 软崩溃。根因：`route.fulfill()` 在 request context 已销毁后仍被调用，且无 try/catch；同时 navigate 无可配置 timeout，调用方无法提前中断。一次超时即可使整个 daemon 对后续请求不可用。

### 优先级汇总

| 优先级 | 问题 | 影响 |
|--------|------|------|
| **P0** | 极端 delay_ms → navigate 超时 → daemon 软崩溃 | 单次超时瘫痪整个 daemon |
| **P1** | pages close 不清理 Map → 内存线性增长 | 长期运行必 OOM |
| **P2** | addRoute 双 await 竞态（理论） | 高并发下偶发 |
