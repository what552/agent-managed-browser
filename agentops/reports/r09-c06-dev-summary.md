# R09-C06 开发归档

**分支**：`feat/r09-builder`
**Commit**：`02bfac6` `feat(r09-c06): CLI v0.3.2, file:// guard, CDP page tracking, POST /utils/ls`
**日期**：2026-03-01
**验证结果**：28/28 ALL GATES PASSED

---

## 背景

本批次依据以下评审报告闭环 4 个发现：
- `agentops/reports/r09-b3-gate-summary.md`（B3 Gate，含 P1 file:// 及 CDP page 追踪缺口）
- `agentops/reports/r09-b4-gemini-review.md`（Gemini B4 Review，P0 CLI 版本号不一致）

---

## 实现清单

### P0 — CLI 版本修正
**文件**：`src/cli/index.ts`

Gemini Review 识别：`.version('0.3.1')` 未随 c05 版本升级而更新，CLI `--version` 报告错误版本。
修正为 `.version('0.3.2')`。

---

### P1a — file:// URL 导航安全守卫
**文件**：`src/daemon/routes/actions.ts`

在 navigate 路由入口，URL 匹配 `file://` 时：
1. 查询 session 的 `allowDirs` 白名单（via `bm.getAllowDirs(sessionId)`）
2. 无白名单 → 403（`file:// navigation requires allow_dirs`）
3. 解析 URL pathname，`path.resolve()` 后检查是否位于任意 allowDir 内（`startsWith(d + path.sep)` 防路径穿越）
4. 超出白名单 → 403（`file:// path X is not within allowed directories`）
5. 合法路径 → 继续正常 navigate 流程

测试覆盖（`TestFileUrlNavigate`）：
- `test_file_url_allowed_within_allow_dirs` — 允许路径内的 file:// 导航成功
- `test_file_url_denied_outside_allow_dirs` — `/etc/hosts` 在白名单外 → 403
- `test_file_url_denied_no_allow_dirs` — session 无 allow_dirs → 403

---

### P1b — CDP 外部开 Tab 自动追踪
**文件**：`src/browser/manager.ts`

新增 `autoTrackNewPages(sessionId, context)` 私有方法：
- 监听 `context.on('page', newPage)` 事件（由 `window.open()`、CDP 直连新建 tab 触发）
- 检查 `state.pages` 是否已含该 page 对象（防重复追踪）
- 若是新 page：分配 `newPageId`、注册 framenavigated 监听、调用 `attachPageObservers`

**调用点**：
- `launchSession()` 末尾
- `attachCdpSession()` 末尾

**回归修复**：`createPage()` 调用 `context.newPage()` 时，`context.on('page')` 事件在 `await` 期间触发，导致 `autoTrackNewPages` 先于 `createPage()` 的 `state.pages.set()` 执行，造成双重注册。

修复方法：在 `createPage()` 获得 page 对象后，先检查 `state.pages` 是否已含该对象（`autoTrackNewPages` 已注册），若已注册则直接返回已有的 `page_id`，跳过重复的 `set()` 和观察器绑定。

测试覆盖（`TestCdpPageTracking`）：
- `test_window_open_page_appears_in_pages_list` — window.open 后 pages 列表数量 ≥ 之前

回归测试：
- `test_pages_frames` — 7/7 通过（修复前 2 个失败）
- `test_c05_fixes` — 10/10 通过（修复前 1 个失败）

---

### P2 — POST /utils/ls 支持 Unicode 路径
**文件**：`src/daemon/routes/sessions.ts`

原有 `GET /api/v1/utils/ls`（query string）在 URL 编码层面对非 ASCII 路径支持有限。

重构：
- 提取 `handleLs(bm, session_id, reqPath, depthStr, reply)` 共享函数
- 保留原 GET 端点（向后兼容）
- 新增 `POST /api/v1/utils/ls`（JSON body：`{ session_id, path, depth? }`）——JSON 原生 UTF-8 支持 Unicode

测试覆盖（`TestPostUtilsLs`）：
- `test_post_ls_basic` — 基本 ASCII 路径返回正确文件列表
- `test_post_ls_unicode_path` — 中文目录 `测试目录/中文文件.txt` 正确返回
- `test_post_ls_403_outside_allowed` — `/etc` 超出 allow_dirs → 403

---

## 测试文件

`tests/e2e/test_r09c06.py` — 8 个测试，全部通过（`8 passed, 1 warning`）

---

## 验证

```
28/28 ALL GATES PASSED
```

新增 gate：`[27/28] r09c06... PASS  (8 passed, 1 warning in 4.13s)`

scripts/verify.sh: `TOTAL=27 → 28`

---

## 关键设计决策

| 决策 | 原因 |
|------|------|
| file:// 守卫在 navigate 路由入口（而非 Actions.navigate 内部） | 保持 Actions 层无权限逻辑，路由层统一做鉴权 |
| `autoTrackNewPages` + `createPage` 去重检查 | 避免破坏现有多页 API 语义，最小改动修复竞态 |
| POST /utils/ls 与 GET 并存 | 不破坏已有调用方，新增 POST 供 SDK/CLI 使用 |
| `path.sep` 防路径穿越 | `/tmp/allowed` 不应匹配 `/tmp/allowedevil` |
