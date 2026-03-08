# R10-C04 Dev Summary

**Branch**: `feat/r10-builder`
**Baseline SHA**: `373036e`
**Target SHA**: `daf3b42`
**Date**: 2026-03-05
**Builder**: Claude (Builder)

---

## 交付内容

### R10-T04 — session switch-engine（热切换引擎）

#### API: `PUT /api/v1/sessions/:id/switch-engine`

**请求体**:
```json
{
  "target_channel": "chrome|chromium|msedge",
  "keep_source": false,
  "headed": false
}
```

**响应**:
```json
{
  "session_id": "sess_new_xxx",
  "old_session_id": null,
  "old_channel": "chromium",
  "new_channel": "chrome",
  "profile": "my-profile",
  "headless": true,
  "cookies_transferred": 5,
  "origins_transferred": 2,
  "keep_source": false
}
```

**逻辑**:
1. 验证 `target_channel`（chromium|chrome|msedge）
2. 从源 session 导出 `storageState()`（cookies + localStorage origins）
3. 创建并启动新 session（target_channel 对应的引擎）
4. 启动失败 → 返回 `502`，源 session 完全保留（rollback-safe）
5. 启动成功 → 注入 cookies（即时）+ localStorage（initScript 延迟）
6. `keep_source=false`（默认）→ 关闭源 session；`keep_source=true` → 源 session 继续运行
7. 返回新 session_id

**错误码**:
- `400`: `target_channel` 缺失或无效
- `404`: 源 session 不存在
- `410`: 源 session 为 zombie
- `502`: 目标引擎启动失败（源保留，附 `old_channel` / `new_channel` 字段）
- `500`: storageState 导出失败

#### CLI

```bash
agentmb session switch-engine <session-id> --target-channel chrome
agentmb session switch-engine <session-id> --target-channel chromium --keep-source --headed
```

---

### P1 文档补齐（D01~D06）

| Gap | 补充位置 | 内容 |
|-----|---------|------|
| D01 | README + SKILL | `session grant-permission` CLI/API 用法，权限枚举 |
| D02 | README + SKILL | `profile list/delete` CLI/REST，zone 参数说明，423 响应 |
| D03 | README + SKILL | `eval` 自动 top-level `await` 包装行为，示例 |
| D04 | README + SKILL | `session fork` 完整用法，source 不关闭的说明 |
| D05 | README + SKILL | `session adopt` 完整用法，non-invasive 原则 |
| D06 | README + SKILL | adopt CDP 前置条件（`--remote-debugging-port`），adopt vs attach 对比 |

---

## 变更文件范围

| 文件 | 类型 |
|------|------|
| `src/daemon/routes/sessions.ts` | 修改 — 新增 switch-engine 路由（~100 行） |
| `src/cli/commands/session.ts` | 修改 — 新增 switch-engine 子命令；import apiPut |
| `tests/e2e/test_r10c04.py` | 新建 — 10 tests (9 passed, 1 skipped) |
| `scripts/verify.sh` | 修改 — 新增 r10c04 suite；TOTAL 33→34 |
| `README.md` | 修改 — 新增 D01~D06 全部文档（~180 行） |
| `skills/agentmb/SKILL.md` | 修改 — 新增 Session State Transfer 章节（~79 行） |

---

## 验证结果

```
AGENTMB_PORT=19315 AGENTMB_DATA_DIR=/tmp/agentmb-builder bash scripts/verify.sh
```

```
34/34 ALL GATES PASSED
  r10c04: 9 passed, 1 skipped
```

**r10c04 跳过说明**: `test_t04_switch_to_chrome` 在 Chrome 未安装的机器上 `pytest.skip`（502 rollback 路径返回时跳过）。此为预期行为 — 切换 Chrome 需系统安装 Google Chrome。`test_t04_switch_engine_rollback_invalid_channel` 当 Chrome 可用时也跳过（改为验证成功路径）。

---

## 关键设计决策

| 决策 | 原因 |
|------|------|
| 返回新 session_id（非原地切换） | 同 fork 模式保持一致；避免 registry 中同一 ID 的引擎/目录切换复杂度 |
| 先 launch 新 session，再 close 源 | rollback-safe：目标启动失败时源 session 不受影响 |
| 同 channel 切换（chromium→chromium）允许 | 便于 E2E 测试；本质是带 state 迁移的 fork |
| localStorage 延迟注入（initScript） | 同 fork/adopt 路径一致 |

---

## 未完成项（转下一批次）

- T02 — Launcher 2.0（`browser-launch --profile` 自动路径构造）
- T08 — 上传直传模式（零内存，解决 767KB 限制）
- T11 — 视觉素材提取（`extract-image` 接口）
- R10 其余 TODO 项
