# R09-B3 Gate Summary — Engineering Review

**Round**: R09
**Batch**: B3
**Reviewer**: Reviewer-1
**Date**: 2026-03-01
**Baseline SHA**: `1feb53a` (R09-B2 Go)
**Target SHA**: `95c2432` (feat(r09-c04): T02/T08/T12/T14)
**Incremental commits reviewed**: `1feb53a..95c2432`
**Environment**: `AGENTMB_PORT=19357`
**Gate result**: ✅ **GO — 27/27 PASS**

---

## 核心复核区域

### 1. T12 — 敏感域名预警（安全网关）

**实现文件**: `src/daemon/routes/actions.ts`

| 项目 | 结论 |
|------|------|
| 模式覆盖 | 5 类内置（financial / medical / gambling / adult / crypto）|
| 环境变量扩展 | `AGENTMB_SENSITIVE_DOMAINS` 支持逗号分隔自定义 regex，`try/catch` 防止非法 regex 崩溃 ✓ |
| 触发位置 | `Actions.navigate()` 成功后追加，不阻断导航（设计为 warning 而非 block）✓ |
| 无感知场景 | 非敏感域名响应中 **完全不含** `sensitive_warning` 字段，向后兼容 ✓ |
| 正则范围 | 仅匹配 `hostname`（`new URL(url).hostname`），URL path 不被误判 ✓ |
| 测试验证 | T12: 2/2 PASS（bank → warning, example.local → no warning）|

**轻微观察（非阻断）**: `detectSensitiveDomain` 在 policy 拦截导致 navigate 失败时不被调用——合理，因为此时也无响应体返回。

---

### 2. T14 — 本地文件感知（`--allow-dir` / `/utils/ls`）

**实现文件**: `src/browser/manager.ts`, `src/daemon/routes/sessions.ts`, `src/cli/commands/session.ts`

| 项目 | 结论 |
|------|------|
| 路径白名单 | `launchSession` 时 `path.resolve()` 转为绝对路径 ✓ |
| 路径遍历防护 | `abs.startsWith(d + path.sep)` — 含 `sep` 后缀防止 `/tmp/allowed` 匹配 `/tmp/allowedevil` ✓ |
| 无白名单 → 403 | `allowDirs.length === 0` 返回 403，不泄露任何信息 ✓ |
| 路径越界 → 403 | `/etc` 等路径正确返回 403 ✓ |
| 深度限制 | `Math.min(depth, 5)` 防止超深递归 ✓ |
| 资源清理 | `closeSession` 中 `sessionAllowDirs.delete(sessionId)` ✓ |
| CLI 透传 | `--allow-dir <path>`（repeatable）→ `allow_dirs[]` ✓ |
| 测试验证 | T14: 3/3 PASS（allowed/denied/no-allow-dirs）|

**轻微观察（非阻断）**: `/utils/ls` 不解析 symlink，允许目录内的符号链接指向外部。低风险（daemon 本地可信环境），可作为后续 hardening 项。

---

### 3. T02 — Mock API 正则路由

**实现文件**: `src/browser/manager.ts`

| 项目 | 结论 |
|------|------|
| 格式识别 | `parseRoutePattern()` 正确识别 `/pattern/flags` 格式 → `RegExp`，否则 fallback glob string ✓ |
| 非法 regex | `try/catch` 包裹 `new RegExp()`，fallback 返回字面字符串，不崩溃 ✓ |
| unroute 一致性 | `RouteEntry.playwrightPattern` 存储编译后的 `string \| RegExp`，`removeRoute`/`cleanupRoutes` 均使用该字段 ✓ |
| `delay_ms` | `RouteMockConfig` 新增可选字段，`Promise<void>` 延迟实现正确 ✓ |
| glob 不退化 | 既有 glob 路由测试全部通过（r08c05 30 PASS 含路由相关用例）✓ |
| 测试验证 | T02: 2/2 PASS（regex intercept + glob not regressed）|

---

### 4. T08 — Session Proxy + 视频录制

**实现文件**: `src/browser/manager.ts`, `src/daemon/routes/sessions.ts`

| 项目 | 结论 |
|------|------|
| Proxy 传参 | `proxy: { server: proxyUrl }` 符合 Playwright API ✓ |
| 视频目录 | `agentmb-video-<sessionId>` 隔离，`mkdir recursive` ✓ |
| 视频获取 | `GET /sessions/:id/video` 返回路径 ✓ |
| 视频保存 | `POST /sessions/:id/video/save { dest_path }` copyFile + mkdir 父目录 ✓ |
| 资源清理 | `closeSession` 中 `sessionVideoDir.delete(sessionId)` ✓ |
| 测试验证 | T08: 1/1 PASS（proxy_url 接受 → 201，不测真实连通性符合设计）|

**轻微观察（非阻断）**: `page.video()` 仅覆盖 context 默认页，popup 页面的视频需单独处理。MVP 阶段可接受。

---

## 全量门禁

```
27/27 PASS  (AGENTMB_PORT=19357, AGENTMB_DATA_DIR=/tmp/agentmb-reviewer)
```

| Gate | Suite | 结果 |
|------|-------|------|
| 1 | Build | PASS |
| 2 | Daemon start | PASS |
| 3-25 | smoke / auth / handoff / cdp / actions-v2 / pages-frames / network-cdp / c05-fixes / policy / element-map / r07c02-04 / r08c01-07 / r08c06-modes / r09c02-03 | **全 PASS** |
| 26 | r09c04 | PASS (8 passed, 1 warning) |
| 27 | Daemon stop | PASS |

无回归，无 SKIP（r07c04 的 1 skip 为已知 platform-level 跳过项，R09-B2 基线已存在）。

---

## 结论

**R09-B3: ✅ GO**

- T12 敏感预警：实现正确，hostname 匹配，可扩展，warning 不阻断，无 BC 破坏。
- T14 本地感知：路径遍历防护健全，白名单模型正确，CLI 透传完整。
- T02 Mock API：正则/glob 双模式实现健壮，unroute 路径修复了原有潜在 bug。
- T08 Proxy/Video：API 完整，资源清理正确，设计合理。
- 全量 27/27 PASS，无回归。

轻微观察项（symlink 穿透、popup 视频、proxy URL 未验证格式）均为非阻断，可在后续批次酌情 hardening。

**补充观察（实测发现）**：

- **P2 — `/utils/ls` 中文路径编码**：`GET /api/v1/utils/ls` 使用 query params 传 `path`，当路径含中文时，若客户端未做 percent-encode（如裸 `curl`），Fastify 在 query string 解析阶段返回 400，路由处理器根本未执行。安全上不构成漏洞（400 即拒绝），但 API 易用性差——含中文路径的目录在实际使用中常见。建议 Builder 在后续批次增加 `POST /api/v1/utils/ls`（JSON body），与其他 agentmb 接口风格统一，从根本上消除客户端编码负担。

- **P1 — `navigate` 不支持 `file://` URL**：对本地文件路径（`file:///...`）调用 `navigate` 返回 Internal Server Error，无法直接操控本地文件。实测需绕道起 HTTP server 提供服务。建议明确支持或在错误信息中说明限制。

- **P1 — CDP `PUT /json/new` 开的 tab 不被 session 追踪**：通过 CDP REST API（`PUT /json/new`）打开的 tab 不出现在 `agentmb pages list` 中，`--page-id` 无法定位，只能直接走 CDP WebSocket 操作。在 CDP attach 模式下，外部打开的 tab 应纳入 session 的 page 追踪，或提供 `pages adopt` 类命令将已存在的 CDP page 注册进 session。
