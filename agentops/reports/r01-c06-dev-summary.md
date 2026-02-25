# R01-C06 Development Summary

- **轮次**：`R01`
- **开发批次**：`r01-c06`
- **来源分支**：`feat/r01-mvp`
- **开发提交（SHA）**：`3b9aa87`
- **文档补充提交**：`bb00734`（更新 `claude-review.md`）
- **归档日期**：`2026-02-26`

## 1) 目标

定点修复 Codex `r01-b2` 提出的 3 个工程回归问题，不做额外重构。

## 2) 修复项与落点

1. **`session list` 字段兼容**
   - 文件：`src/cli/commands/session.ts`
   - 修复：兼容 `session_id/created_at` 与旧字段 `id/createdAt`，并补充 `state` 展示。

2. **`status --port` 实际请求端口一致性**
   - 文件：`src/cli/commands/status.ts`
   - 修复：`--port` 参数写回请求路径配置，确保显示端口与实际请求端口一致。

3. **`launchSession` 失败回滚持久化**
   - 文件：`src/daemon/routes/sessions.ts`
   - 修复：失败回滚改走 `registry.close(id)`，确保删除后触发持久化，避免 `sessions.json` 残留孤儿会话。

4. **附带修复（Bonus）**
   - 文件：`src/cli/client.ts`
   - 修复：`http.get()` 改为字符串 URL + options，修复 GET 请求静默失败风险。

## 3) 验证摘要（来自 Claude 执行记录）

- `npm run build`：通过
- `openclaw session list`：字段显示正常
- `openclaw status --port 19315/19316`：路由行为与端口提示一致
- `pytest tests/e2e/test_smoke.py -v`：通过（14/14）

## 4) 已知遗留（转 R02 候选）

- `src/cli/client.ts` 中 `apiDelete()` 仍带 `content-type: application/json` 请求头，部分无 body 的 DELETE 路由可能返回 400。
- 建议在下一轮修复：为 DELETE 请求使用无 `content-type` 的独立 headers。
