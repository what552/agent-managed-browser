# R09-C03 Dev Summary

**分支**: `feat/r09-builder`
**日期**: 2026-03-01
**Gate**: 26/26 PASS（含 R09-b2 修复后重跑）

---

## 交付内容

### P0 — page_id 定向操作（多标签页不切换即可操作）

**问题**：现有所有 action 路由（navigate/click/fill/eval/screenshot 等）只能操作"当前活跃标签页"，要对非活跃页操作必须先调用 `switch_page()`，在并发场景下来回切换会互相干扰。

**修改**：`src/browser/manager.ts` + `src/daemon/routes/actions.ts`

**manager.ts**（新增 `getPageById`）：
```typescript
getPageById(sessionId: string, pageId: string): Page | null {
  const state = this.sessionPages.get(sessionId)
  if (!state) return null
  return state.pages.get(pageId) ?? null
}
```

**actions.ts**（新增 `resolveWithPage` helper + 10 个路由注入 `page_id` 参数）：
```typescript
function resolveWithPage(id, pageId, reply): ReadySession | null {
  const s = resolve(id, reply)
  if (!s) return null
  if (!pageId) return s       // 向后兼容：无 page_id 使用活跃页
  const page = bm?.getPageById(id, pageId)
  if (!page) {
    reply.code(404).send({ error: `Page ${pageId} not found in session ${id}...` })
    return null
  }
  return { ...s, page }       // 替换 page，其余 session 字段不变
}
```

**支持 `page_id` 的路由**（10 个）：
- `navigate` / `click` / `fill` / `type` / `press`
- `eval` / `screenshot`
- `element_map` / `snapshot_map` / `scroll`

**行为**：
- `page_id` 存在且有效 → 路由在指定 page 上执行，不改变 session 的活跃页
- `page_id` 存在但无效 → `404` 返回 `Page not found`
- 无 `page_id` → 原行为不变（向后兼容）

---

### P1 — Skill 系统升级：多页协作 + 反封禁指南

**修改**���`skills/agentmb/SKILL.md` + `skills/agentmb/references/session-management.md`

**SKILL.md 新增**：
- Multi-Page 命令表增加 `page_id` 直接定向说明（Python SDK + CLI 示例）
- Pattern 7：单账号多 Page 并发操作（`asyncio.gather` + `page_id` 不切换示例）
- Pattern 8：反封禁/人性化操作指南（Chrome Stable、`fill_strategy="type"`、mouse_move、profile 隔离等）

**session-management.md 新增**：
- `page_id Direct Targeting (R09-C03)` 完整参考节：Python SDK + REST 示例，错误说明

---

### R09-b2 — CLI / SDK 对齐（评审修复）

**修改**：`src/cli/commands/actions.ts` + `sdk/python/agentmb/client.py`

#### CLI 对齐（10 个命令新增 `--page-id` 选项）

`navigate` / `screenshot` / `eval` / `click` / `fill` / `type` / `press` / `element-map` / `snapshot-map` / `scroll`

所有命令均新增 `.option('--page-id <id>', 'Target a specific page/tab by page_id (default: active tab)')` 并通过 `if (opts.pageId) body.page_id = opts.pageId` 透传到 API body。

#### Python SDK 对齐

**Session 类**（10 个方法新增 `page_id: Optional[str] = None`）：
- `navigate` / `click` / `fill` / `eval` / `screenshot`
- `type` / `press` / `element_map` / `snapshot_map` / `scroll`

**AsyncSession 类**（同等 10 个方法）：
- `navigate` / `click` / `fill` / `eval` / `screenshot`
- `type` / `press` / `element_map` / `snapshot_map`
- **`scroll`**：AsyncSession 中原本缺失此方法，本次补全新增

---

### P2 — 并发测试补全

**修改**：`tests/e2e/test_r09c03.py`

新增 `TestConcurrentPageOps` 类（2 个测试）：
- `test_concurrent_eval_on_different_pages`：两个线程同时对两个不同 page 执行 eval，验证结果互不干扰
- `test_concurrent_navigate_on_different_pages`：两个线程同时对两个不同 page 执行 navigate，各自正确落地

---

### 工程配套

- `scripts/verify.sh`：新增 `r09c03` 套件，TOTAL 25→26
- `tests/e2e/test_r09c03.py`：新增（初版 7 个测试 + R09-b2 并发补充 2 个 = 共 9 个）

---

## Gate 结果

```
[25/26] r09c03... PASS  (9 passed, 1 warning in 5.88s)
ALL GATES PASSED (26/26)
```

**变更文件**：
- `src/browser/manager.ts`（新增 `getPageById`）
- `src/daemon/routes/actions.ts`（新增 `resolveWithPage`，10 个路由注入 `page_id`）
- `src/cli/commands/actions.ts`（10 个 CLI 命令新增 `--page-id` 选项）
- `sdk/python/agentmb/client.py`（Session + AsyncSession 各 10 个方法补齐 `page_id`；AsyncSession.scroll 全新补全）
- `skills/agentmb/SKILL.md`（Pattern 7 & 8，Multi-Page 命令表增强）
- `skills/agentmb/references/session-management.md`（page_id Direct Targeting 节）
- `tests/e2e/test_r09c03.py`（9 个测试：7 基础 + 2 并发）
- `scripts/verify.sh`（TOTAL+1，新增 r09c03 套件）
