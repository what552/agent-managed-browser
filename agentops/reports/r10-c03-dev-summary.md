# R10-C03 Dev Summary

**Branch**: `feat/r10-builder`
**Baseline SHA**: `7f63f6c`
**Target SHA**: `37e4f8d`
**Date**: 2026-03-04
**Builder**: Claude (Builder)

---

## 交付内容

### R10-T03 — session fork + session adopt

#### session fork (`POST /api/v1/sessions/:id/fork`)

**请求体**:
```json
{ "channel": "chrome|chromium|msedge", "profile": "my-profile", "headed": true }
```

**响应**:
```json
{
  "session_id": "sess_fork_xxx",
  "profile": "my-profile",
  "channel": "chromium",
  "source_session_id": "sess_abc",
  "cookies_injected": 5,
  "origins_pending": 2
}
```

**逻辑**:
1. 从源 session 的 `context.storageState()` 导出 cookies + localStorage origins
2. 按 `channel`/`profile`/`headless` 创建并启动新 session
3. 立即注入 cookies（`context.addCookies()`）
4. 注入 localStorage via `context.addInitScript()` — 每次导航到对应 origin 时自动触发
5. 源 session 继续运行（两者独立）

**验证要点**: channel `chromium` 传 `undefined`（默认），非 chromium 才传 `channel` 参数

#### session adopt (`POST /api/v1/sessions/adopt`)

**请求体**:
```json
{ "cdp_url": "http://127.0.0.1:9222", "profile": "xhs-cdp-import", "headed": false }
```

**响应**:
```json
{
  "session_id": "sess_adopted_xxx",
  "profile": "xhs-cdp-import",
  "channel": "chromium",
  "source_cdp_url": "http://127.0.0.1:9222",
  "cookies_injected": 12,
  "origins_pending": 3,
  "note": "Source browser untouched — state extracted read-only. New managed session ready."
}
```

**逻辑**:
1. `chromium.connectOverCDP(cdp_url)` — 非侵入式挂载
2. `contexts[0].storageState()` — 只读提取
3. `browser.close()` — 仅断连，不关闭远端浏览器进程
4. 创建并启动新 Managed Chromium session
5. 注入 cookies + localStorage（同 fork 路径）

**错误码**: 400 缺 cdp_url/profile，502 CDP 不可达，422 无 context

#### CLI

```bash
agentmb session fork <session-id> [--channel chromium|chrome|msedge] [--profile <name>] [--headed]
agentmb session adopt --cdp-url <url> --profile <name> [--headed]
```

**注意**: `/api/v1/sessions/adopt` 路由注册顺序在 `/:id/fork` 之前，确保 Fastify 静态路径优先匹配。

---

## 变更文件范围

| 文件 | 类型 |
|------|------|
| `src/daemon/routes/sessions.ts` | 修改 — 新增 adopt + fork 路由（~150行）|
| `src/cli/commands/session.ts` | 修改 — 新增 fork + adopt 子命令 |
| `tests/e2e/test_r10c03.py` | 新建 — 12 tests (10 passed, 2 skipped) |
| `scripts/verify.sh` | 修改 — 新增 r10c03 suite；TOTAL 33 |

---

## 验证结果

```
AGENTMB_PORT=19315 AGENTMB_DATA_DIR=/tmp/agentmb-builder bash scripts/verify.sh
```

```
33/33 ALL GATES PASSED
  r10c01:  7 passed
  r10c02: 16 passed
  r10c03: 10 passed, 2 skipped
```

**r10c03 跳过说明**: 2 个 adopt 测试 (`test_t03_adopt_from_cdp_ws`, `test_t03_adopt_inherits_cookies`) 在 Playwright 管理的 headless Chromium 不暴露 WS 端点时 `pytest.skip`。这是预期行为 — 生产中 adopt 面向的是系统 Chrome 的外部 CDP 端点。

---

## 关键设计决策

| 决策 | 原因 |
|------|------|
| localStorage via initScript（延迟注入） | Playwright 不支持在 `launchPersistentContext` 后直接写入 localStorage；initScript 在每次导航前执行，是唯一正确路径 |
| cookies 立即注入 | `addCookies()` 在任何时候均可调用，无需导航 |
| adopt 不对源浏览器执行任何操作 | 非侵入原则：只读提取，disconnect 后源浏览器状态不变 |
| fork channel='chromium' → undefined | `launchPersistentContext` 的 `channel` 参数为 `undefined` 时使用默认 Chromium |

---

## 已知局限（记录于 R10-SPEC）

- `storageState()` 不包含 **IndexedDB** — fork/adopt 后目标网站若将认证态存于 IndexedDB，新 session 可能行为异常，待后续迭代补充
- localStorage 注入是延迟的（需导航到目标 origin 才触发），不是即时写入

---

## 未完成项（转下一批次）

- T04 — switch-engine（运行时热切换）
- T11 — extract-image 视觉素材提取
- R10 其余 TODO 项
