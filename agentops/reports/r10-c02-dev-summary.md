# R10-C02 Dev Summary

**Branch**: `feat/r10-builder`
**Baseline SHA**: `805abb8`
**Target SHA**: `e297e8a`
**Date**: 2026-03-04
**Builder**: Claude (Builder)

---

## 交付内容

### R10-T12 — eval top-level await 支持
**文件**: `src/browser/actions.ts:121`

```typescript
const wrapped = /\bawait\b/.test(expression)
  ? `(async () => { return (${expression}); })()`
  : expression
const evalResult = await page.evaluate(wrapped)
```

- 通过正则检测 `\bawait\b` 关键字，自动包裹 async IIFE
- 原始 `expression` 记录到 audit log（不记录 wrapped 版本）
- 无破坏性变更：无 `await` 的表达式走原有路径

---

### R10-T07 — session grant-permission
**文件**: `src/daemon/routes/sessions.ts` (新路由), `src/cli/commands/session.ts` (新子命令)

**API**: `POST /api/v1/sessions/:id/grant-permission`
```json
{ "permissions": ["camera", "microphone"], "origin": "https://example.com" }
```
- 白名单验证：13 种已知权限
- 无效权限名 → 400
- zombie session → 410
- 不存在 session → 404

**CLI**: `agentmb session grant-permission <session-id> [permissions...] [--origin <url>]`

---

### R10-T05 — profile list/delete with --zone managed|stable
**文件**: `src/daemon/routes/sessions.ts` (重构), `src/cli/commands/profile.ts` (新文件), `src/cli/index.ts`

**Zone 映射**:
- `managed` → `AGENTMB_DATA_DIR/profiles/` (Playwright-managed Chromium)
- `stable`  → `AGENTMB_DATA_DIR/chrome-profiles/` (Chrome/Edge native)

**API**:
- `GET /api/v1/profiles?zone=managed|stable` — 新增 `zone`, `size_bytes`, `sessions_live`, `session_ids`, `last_modified` 字段
- `DELETE /api/v1/profiles/:name?zone=managed|stable[&force=true]` — 新端点
  - 有 live session → 423 Locked + session_ids
  - `force=true` 强制删除
  - 不存在 → 404

**CLI**:
```bash
agentmb profile list [--zone managed|stable]
agentmb profile delete --name <name> [--zone managed|stable] [--force]
```

---

## 变更文件范围

| 文件 | 类型 |
|------|------|
| `src/browser/actions.ts` | 修改 — T12 await wrap |
| `src/daemon/routes/sessions.ts` | 修改 — T07 grant-permission 路由 + T05 profile list/delete 重构 |
| `src/cli/client.ts` | 修改 — 新增 `apiDeleteJson()` |
| `src/cli/commands/session.ts` | 修改 — T07 grant-permission 子命令 |
| `src/cli/commands/profile.ts` | 新建 — T05 profile list/delete CLI |
| `src/cli/index.ts` | 修改 — 注册 profileCommands |
| `tests/e2e/test_r10c02.py` | 新建 — 16 tests |
| `scripts/verify.sh` | 修改 — 新增 r10c01/r10c02 suite；TOTAL 32 |

---

## 验证结果

```
AGENTMB_PORT=19315 AGENTMB_DATA_DIR=/tmp/agentmb-builder bash scripts/verify.sh
```

```
[32/32] ALL GATES PASSED (32/32)
```

新增测试分布：
- r10c01: 7 passed
- r10c02: 16 passed (T12×3 + T07×5 + T05×8)

---

## 未完成项（转下一批次）

- T03 — asset bridge / upload 直传大文件优化（待 r10-c03）
- T11 — extract-image / 视觉素材提取（待后续）
- B01 — Attach 模式下载劫持修复（已在 r10-c01 完成）
