# R10-C07 Dev Summary

**Branch**: `feat/r10-builder`
**Baseline SHA**: `6169223`（r10-c06 docs commit）
**Target SHA**: `f68716e`
**Date**: 2026-03-09
**Builder**: Claude (Builder)

---

## 交付内容

6 个 GitHub issue 一次性修复批次（Issues #10–#15）。

---

### Issue #10 — pages new 不自动切换 active context

#### 根因
`createPage()` 在成功注册新 page 后直接 `return`，未调用 `switchPage()`。session 的 `activePageId` 和 registry 的 `page` 引用仍指向旧 page。

#### 修复
`manager.ts:createPage()` 两条返回路径（已存在 page early-return 路径、新建路径）末尾均加 `await this.switchPage(sessionId, pageId)`。

---

### Issue #11 — switchPage 后截图仍截旧 tab

#### 根因
`switchPage()` 是同步 `void`，只更新内存中的引用，未调用 `page.bringToFront()`。Chrome headed/attach 模式下只渲染聚焦 tab，截图会捕获错误内容。

#### 修复
`switchPage()` 改为 `async Promise<void>`，在更新 activePageId 和 registry 后 `try { await page.bringToFront() } catch { /* ignore */ }`（headless 模式会忽略，不报错）。

更新了两处调用方：
- `manager.ts:closePage()` → `await this.switchPage(...)`
- `sessions.ts:pages/switch route` → `await manager.switchPage(...)`

---

### Issue #12 — CDP attach session browser-launch 未传 profile 名

#### 根因
`browser-launch` 的 "Connect with" 输出固定为：
```
agentmb session new --launch-mode attach --cdp-url <url>
```
用户在 `browser-launch --profile myprofile` 时，看不到需要带 `--profile myprofile` 的提示，attach 后 session 的 profile 字段显示 'default'。

#### 修复
`browser-launch.ts` 输出逻辑：
- 若 `opts.profile` 存在，额外打印 `Zone: stable (chrome-profiles/<name>)`
- "Connect with" CLI 提示拼接 ` --profile <name>`
- Python SDK 示例拼接 `, profile='<name>'`

---

### Issue #13 — profile delete 404 无跨 zone 提示

#### 根因
`DELETE /api/v1/profiles/:name` 找不到 profile 时，直接返回 `{ error: "..." }` 404，不提示另一个 zone 是否存在。

#### 修复
- API：404 前检查另一 zone 目录是否存在同名 profile，若存在则 404 body 附加 `hint` 字段
- CLI `profile.ts`：404 时若 `res.data?.hint` 存在，打印 `Hint: <hint>`

---

### Issue #14 — 无 session prune 命令

#### 根因
无 API 路由、无 CLI 命令。zombie session（daemon 重启后 browser 已不运行的历史记录）无法批量清理。

#### 修复
新增：
- API：`DELETE /api/v1/sessions?state=zombie[&dry_run=true][&older_than_days=N]`
  - 返回 `{ pruned: number, ids: string[], dry_run: boolean }`
  - 仅支持 `state=zombie`，其他值返回 400
- CLI：`agentmb session prune [--dry-run] [--older-than <days>]`

---

### Issue #15 — session list 不显示 zone

#### 根因
`GET /api/v1/sessions` 响应体缺少 `zone` 字段；CLI session list 输出中也没有 zone 信息。

#### 修复
- API：session list 映射时按 `browserChannel` 推断 zone（`chrome`/`msedge` → `stable`，其余 → `managed`），添加到每条记录
- CLI：`session list` 输出格式加入 `zone=managed/stable`

---

## 变更文件范围

| 文件 | 类型 | 说明 |
|------|------|------|
| `src/browser/manager.ts` | 修改 | `createPage()` 自动 switchPage；`switchPage()` async + bringToFront；`closePage()` await |
| `src/daemon/routes/sessions.ts` | 修改 | sessions list 加 zone；prune 路由；profile delete 404 hint；switchPage await |
| `src/cli/commands/session.ts` | 修改 | session list 显示 zone；新增 prune 子命令；import apiDeleteJson |
| `src/cli/commands/profile.ts` | 修改 | profile delete 404 时显示 hint |
| `src/cli/commands/browser-launch.ts` | 修改 | "Connect with" 拼接 --profile；Zone 行 |
| `tests/e2e/test_r10c07.py` | 新建 | 11 tests |
| `scripts/verify.sh` | 修改 | TOTAL 36→37，加 r10c07 suite |

---

## 验证结果

```
AGENTMB_PORT=19315 AGENTMB_DATA_DIR=/tmp/agentmb-builder bash scripts/verify.sh
```

```
37/37 ALL GATES PASSED
  r10c07: 11 passed
```

---

## 测试覆盖（test_r10c07.py）

| 测试 | 验证点 |
|------|--------|
| `test_new_page_becomes_active` | POST /pages 后新 page 成为 active |
| `test_original_page_deactivated_after_new` | 原 page active=false |
| `test_switch_page_returns_ok` | switchPage 正常返回 200 并更新 active |
| `test_switch_to_nonexistent_page_returns_404` | 无效 page_id 返回 404 |
| `test_profile_delete_nonexistent_returns_404` | 不存在 profile 返回 404 |
| `test_profile_delete_404_has_error_field` | 404 body 含 error 字段 |
| `test_prune_returns_pruned_count` | prune 返回 pruned/ids 字段 |
| `test_prune_dry_run_does_not_remove` | dry_run 与实际 zombie 数量一致 |
| `test_prune_invalid_state_returns_400` | state!=zombie 返回 400 |
| `test_session_list_includes_zone` | session list 有 zone 字段 |
| `test_chromium_session_zone_is_managed` | chromium session zone=managed |

---

## 关键设计决策

| 决策 | 原因 |
|------|------|
| `bringToFront()` 包裹 try/catch | headless 模式下调用不报错，attach 模式下 context 可能已关闭 |
| prune 用 `DELETE /api/v1/sessions?state=zombie` 而非 POST | 语义上是删除操作；`/api/v1/sessions/:id` 不冲突（不同路径段） |
| zone 从 browserChannel 推断而非存入 SessionInfo | 避免序列化变更；推断逻辑稳定 |
| profile delete hint 在 404 响应体中用 `hint` 字段 | 非侵入式扩展，向后兼容 |

---

## 已知局限（未解决，转下轮）

- **Issue #11 完整保证**：`bringToFront()` 在 CDP attach 模式下若 Chrome 处于后台或有其他聚焦限制，可能不生效。目前是 best-effort。
- **zone 精确性**：attach 模式 session 的 zone 依赖用户是否通过 `browser-launch --profile` 后再 `session new --profile`，目前仍按 channel 推断，attach 模式统一显示 managed（除非 channel 是 chrome/msedge）。
