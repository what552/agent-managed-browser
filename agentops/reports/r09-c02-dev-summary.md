# R09-C02 Dev Summary

**分支**: `feat/r09-builder`
**日期**: 2026-03-01
**Gate**: 25/25 PASS

---

## 交付内容

### P0 — Profile 持久化验证（代码已正确，补测试）

**现状确认**：
- Named profiles：`launchPersistentContext` 使用 `profilesDir(config)/<name>` = `AGENTMB_DATA_DIR/profiles/<name>`，代码路径正确，登录态随 profile 目录持久化
- Ephemeral：`/tmp/agentmb-eph-<sessionId>`，session close 后清理，行为正确
- `browser-launch` CDP sandbox：`/tmp/agentmb-cdp-<port>`，临时使用，正确

**新增测试**（`tests/e2e/test_r09c02.py::TestProfilePersistence`，4项）：
- `test_cookie_persists_across_sessions`：同一 profile 的两次 session，cookie 跨 close 存活
- `test_profile_dir_listed_in_profiles_api`：session 创建后 `/api/v1/profiles` 中可查到该 profile
- `test_ephemeral_session_flag`：ephemeral session 创建成功，`ephemeral: true` 标志正确
- `test_different_profiles_isolated`：不同 profile 的 cookie 不互漏

---

### P1 — bbox 409 stale_ref 语义统一

**问题**：`/api/v1/sessions/:id/bbox` 使用 `ref_id` 时，若 snapshot/page_rev 校验通过但元素已从 DOM 移除，返回 `200 { found: false }`，与 `resolveTarget`（click/fill/get 用的路径）返回 `409 stale_ref` 不一致。

**修改**：`src/daemon/routes/interaction.ts`

```typescript
// 修改前
return await Actions.getBbox(s.page, resolved, ...)

// 修改后
const result = await Actions.getBbox(s.page, resolved, ...)
if (ref_id && !result.found) {
  return reply.code(409).send({
    error: 'stale_ref',
    ref_id,
    message: 'Element no longer exists in DOM; ref may be stale. Call element_map or snapshot_map again.',
  })
}
return result
```

注意：`selector` 和 `element_id` 路径不变，仍返回 `200 found:false`（非 ref 语义）。

**新增测试**（`tests/e2e/test_r09c02.py::TestBbox409StaleRef`，5项）：
- `test_bbox_missing_snapshot_returns_409`：不存在的 snapshot → 409
- `test_bbox_stale_after_navigation`：导航后旧 ref_id → 409（page_rev 变化）
- `test_bbox_ref_id_element_removed_from_dom`：DOM 中移除元素后 ref_id → 409（P1 修复验证）
- `test_bbox_selector_not_found_returns_200`：CSS selector 无匹配 → 200 found:false（不变）
- `test_bbox_element_id_not_found_returns_200`：element_id 无匹配 → 200 found:false（不变）

---

### P2 — Python SDK Recipe async 文档修正

**问题**：`sdk/python/agentmb/recipe.py` 模块级 docstring 的 async 示例：
```python
# 错误：client.sessions.create() 是 async def（协程），不能直接 async with
async with client.sessions.create(profile="demo") as session:
```

**修正**：
```python
# 正确：先 await 得到 AsyncSession 对象，再 async with
session = await client.sessions.create(profile="demo")
async with session:
```

---

### 工程配套

- `scripts/verify.sh`：新增 `r09c02` 套件，TOTAL 24→25
- `agentmb/TODO.md`：R09 backlog 新增（上轮 r09-c01 完成）

---

## Gate 结果

```
[24/25] r09c02... PASS  (9 passed, 1 warning in 8.52s)
ALL GATES PASSED (25/25)
```

**变更文件**：
- `src/daemon/routes/interaction.ts`（bbox 409 修复）
- `sdk/python/agentmb/recipe.py`（async docstring）
- `tests/e2e/test_r09c02.py`（新增，9个测试）
- `scripts/verify.sh`（TOTAL+1，新增 r09c02 套件）
