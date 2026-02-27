# r07-c04 Dev Summary

**Branch**: `feat/r07-hardening`
**Baseline**: `4793181` (r07-c03-fix)
**Scope**: T19/T20/T21/T22/T23/T24/T25

---

## Deliverables

### T19 — Coordinate-based input primitives
- `POST /api/v1/sessions/:id/click_at` — `page.mouse.click(x, y, {button, click_count, delay_ms})`
- `POST /api/v1/sessions/:id/wheel` — `page.mouse.wheel(dx, dy)`
- `POST /api/v1/sessions/:id/insert_text` — `page.keyboard.insertText(text)` (bypasses key events, supports emoji/CJK)
- Actions: `clickAt`, `wheelAt`, `insertText` in `src/browser/actions.ts`
- Route: `src/daemon/routes/interaction.ts`

### T20 — Bounding box retrieval
- `POST /api/v1/sessions/:id/bbox` — accepts `selector`, `element_id`, or `ref_id`
- Returns `{found, x, y, width, height, center_x, center_y}`
- `ref_id` resolution includes `page_rev` stale detection (409)
- Inner timeout 2000ms prevents 30s Playwright hang on non-existent selectors

### T21 — Dual-track executor
- `click` route augmented with optional `fallback_x` / `fallback_y` body fields
- On DOM selector failure + coords provided → falls back to `page.mouse.click(fallback_x, fallback_y)`
- Coordinate fallback path returns `{track: 'coords', fallback_x, fallback_y}`
- Modified: `src/daemon/routes/actions.ts`

### T22 — Dialog observability
- `page.on('dialog', ...)` listener registered in `attachPageObservers`
- All dialogs auto-dismissed (accept/dismiss) + recorded in ring buffer (max 50 per session)
- `GET /api/v1/sessions/:id/dialogs?tail=N` — list history
- `DELETE /api/v1/sessions/:id/dialogs` — clear buffer
- `DialogEntry` model: `{ts, type, message, default_value, url, action}`

### T23 — Clipboard read/write
- `POST /api/v1/sessions/:id/clipboard` — write text via `navigator.clipboard.writeText()` with `execCommand('copy')` fallback
- `GET /api/v1/sessions/:id/clipboard` — read text via `navigator.clipboard.readText()`
  - Requires `clipboard-read` permission; returns 422 in sandboxed headless environments

### T24 — Viewport emulation
- `PUT /api/v1/sessions/:id/viewport` — `page.setViewportSize({width, height})`
- Returns `{status, width, height, duration_ms}`

### T25 — Network conditions (CDP)
- `POST /api/v1/sessions/:id/network_conditions` — CDP `Network.emulateNetworkConditions`
- `DELETE /api/v1/sessions/:id/network_conditions` — reset to normal
- CDP session stored per-session in `sessionCdpSessions` map
- Cleaned up on `closeSession` and `switchMode`

---

## Changed Files

| File | Change |
|------|--------|
| `src/browser/actions.ts` | +`clickAt`, `wheelAt`, `insertText`, `getBbox` (with 2s timeout), `setViewport`, `clipboardWrite`, `clipboardRead`; CSS escaping fix for `(globalThis as any).document` |
| `src/browser/manager.ts` | +`DialogEntry` interface, `sessionDialogs` map, `sessionCdpSessions` map, `pushDialog`, `getDialogs`, `clearDialogs`, `setNetworkConditions`, `resetNetworkConditions`; dialog listener in `attachPageObservers`; cleanup in `launchSession`/`switchMode`/`closeSession` |
| `src/daemon/routes/interaction.ts` | NEW — T19/T20 routes: `click_at`, `wheel`, `insert_text`, `bbox` |
| `src/daemon/routes/browser_control.ts` | NEW — T22-T25 routes: `dialogs` (GET/DELETE), `clipboard` (POST/GET), `viewport` (PUT), `network_conditions` (POST/DELETE) |
| `src/daemon/routes/actions.ts` | T21: added `fallback_x`/`fallback_y` to click route with dual-track try/catch |
| `src/daemon/server.ts` | +`registerInteractionRoutes`, `registerBrowserControlRoutes` |
| `src/cli/client.ts` | +`apiPut` |
| `src/cli/commands/actions.ts` | +10 CLI commands: `click-at`, `wheel`, `insert-text`, `bbox`, `dialogs`, `clipboard-write`, `clipboard-read`, `set-viewport`, `set-network`, `reset-network` |
| `sdk/python/agentmb/models.py` | +`ClickAtResult`, `WheelAtResult`, `InsertTextResult`, `BboxResult`, `DialogEntry`, `DialogListResult`, `ClipboardWriteResult`, `ClipboardReadResult`, `ViewportResult`, `NetworkConditionsResult` |
| `sdk/python/agentmb/client.py` | +Session/AsyncSession methods for T19-T25; +`_put` to BrowserClient/AsyncBrowserClient |
| `sdk/python/agentmb/__init__.py` | Export 10 new models |
| `tests/e2e/test_r07c04.py` | NEW — 23 tests covering T19-T25 |
| `scripts/verify.sh` | TOTAL 15→16, added `r07c04` suite |
| `agentops/TODO.md` | T19-T25 marked DONE + done log entries |

---

## Test Results

```
verify.sh — 16/16 PASSED

[15/16] r07c04  PASS  (22 passed, 1 skipped in 3.78s)
```

- 22 tests passed
- 1 skipped: `test_clipboard_read_returns_text` — skipped in headless environments where `navigator.clipboard.readText()` requires explicit `clipboard-read` permission grant

Full suite (all 16 gates):
```
smoke: 15  auth: 11  handoff: 6  cdp: 8  actions-v2: 10  pages-frames: 7
network-cdp: 8  c05-fixes: 10  policy: 11  element-map: 9
r07c02: 24  r07c03: 22  r07c04: 22 (+1 skip)
```

---

---

## r07-c04-fix (P1 阻断修复)

**问题**: `interaction.ts` bbox 路由的 `ref_id` 索引解析存在 off-by-one 及语义不对齐问题。

### 修复内容

**1. Off-by-one bug** (`src/daemon/routes/interaction.ts`)

原代码通过数组下标查找元素：
```typescript
const elemIdx = parseInt(ref_id.split(':e')[1] ?? '-1')
const elem = snap.elements?.[elemIdx]  // e1 → elements[1] (二号元素) ← 错误!
```
`e1` 的数字部分是 `1`，但数组下标是 0-based，所以 `elements[1]` 是第二个元素。

**修复**: 改为对齐 `actions.ts` 的 `resolveTarget` 模式 — 不做数组下标查找，直接从 `eid` 字符串构造 CSS selector：
```typescript
const eid = ref_id.slice(colonIdx + 1)   // "e1"
resolved = `[data-agentmb-eid="${eid}"]` // ← Playwright 按 DOM 属性查元素
```

**2. 格式校验** (`eN` 验证)

新增对 `eN` 格式的校验：N 必须是 `>= 1` 的整数；`e0`、`eabc`、`e-1` 均返回 400。

**3. stale_ref 语义对齐**

| 场景 | 旧行为 | 修复后 |
|------|--------|--------|
| `sessionSnapshots` 无该会话 | 404 | 409 `stale_ref` + `message` |
| `snapId` 不存在（快照已清除） | 404 | 409 `stale_ref` + `message` |
| `page_rev` 不匹配 | 409 `page_rev` + `current_rev` | 409 `snapshot_page_rev` + `current_page_rev` + `message` |

字段名与 `actions.ts` `resolveTarget` 完全对齐。

**注**: `incrementPageRev()` 在每次导航时清除所有快照（`snaps.clear()`），因此导航后使用旧 ref_id 会命中"快照不存在"分支而非"rev 不匹配"分支。两者均返回 409 `stale_ref`。

### 新增测试 (tests/e2e/test_r07c04.py)

| 测试 | 覆盖 |
|------|------|
| T-BB-05 | `ref_id=e1` 单元素页面 → `found=True`（验证 off-by-one 已修复）|
| T-BB-06 | `ref_id` 无冒号 → 400 |
| T-BB-07 | `ref_id` 中 `e0`/`eabc`/`e-1` → 400 |
| T-BB-08 | 不存在的快照 → 409 `stale_ref` |
| T-BB-09 | 导航后使用旧 ref_id → 409 `stale_ref` |

### 测试结果 (fix 后)

```
r07c04: 27 passed, 1 skipped  (vs. 22 passed, 1 skipped before fix)
verify.sh: 16/16 PASSED
```

## Notes

- **getBbox timeout fix**: Playwright's `locator.boundingBox()` waits for element to appear by default (30s). Added inner try/catch with 2000ms timeout so non-existent selectors return `found: false` immediately instead of timing out the HTTP request.
- **clipboardWrite execCommand fallback**: Inside `page.evaluate()`, TypeScript node lib doesn't include DOM globals. Fixed by using `(globalThis as any).document` to reference `document` in the browser context.
- **Emoji length**: `page.keyboard.insertText()` returns JS string `.length` (UTF-16 code units). For multi-byte emoji (🌍 = 2 code units), this differs from Python `len()`. Tests use ASCII strings to avoid this discrepancy.
- **CDPSession lifecycle**: `sessionCdpSessions` map tracks CDP sessions per session; cleaned up in `closeSession` and `switchMode` to prevent leaks.
