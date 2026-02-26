# 协作待办（TODO）

> 用途：追踪当前迭代可执行事项，明确优先级、负责人、截止时间和状态。

## 状态定义
- `TODO`：待开始
- `IN_PROGRESS`：进行中
- `BLOCKED`：受阻
- `DONE`：已完成

## R02 待办

| ID | 任务 | 优先级 | 负责人 | 截止日期 | 状态 | 备注 |
|---|---|---|---|---|---|---|
| R02-T01 | session rm CLI 修复（DELETE 不带 content-type） | P0 | Claude | 2026-02-26 | DONE | r02-c01 |
| R02-T02 | login handoff 循环稳定性 | P0 | Claude | 2026-02-26 | DONE | r02-c01 |
| R02-T03 | auth + handoff e2e 测试 | P0 | Claude | 2026-02-26 | DONE | r02-c01 |
| R02-T04 | profile 加密（AES-256-GCM） | P1 | Claude | 2026-02-26 | DONE | r02-c02 |
| R02-T05 | Node 20 LTS 基线锁定 | P1 | Claude | 2026-02-26 | DONE | r02-c02 |
| R02-T06 | Linux headless 基线记录 | P1 | Claude | 2026-02-26 | DONE | r02-c02 |
| R02-T07 | Linux headed Xvfb 自动化脚本与文档 | P1 | Claude | 2026-02-26 | DONE | r02-c03 |
| R02-T08 | CDP 直通端点 `/api/v1/sessions/:id/cdp` + 测试 | P1 | Claude | 2026-02-26 | DONE | r02-c03 |
| R02-T09 | Gate 脚本 `scripts/gate.sh` | P0 | Claude | 2026-02-26 | DONE | r02-c02 |
| R02-T10 | 审计日志 purpose/operator 字段增强 | P1 | Claude | 2026-02-26 | DONE | r02-c03 |
| R02-T11 | CDP 端点审计落盘（method/session_id/purpose/operator） | P1 | Claude | 2026-02-26 | DONE | r02-c04 |
| R02-T12 | CDP 鉴权自动化测试（无token=401，有token=200/404） | P1 | Claude | 2026-02-26 | DONE | r02-c04 |
| R02-T13 | verify.sh 步骤分母与 gate 计数统一（[N/7] + 7/7） | P1 | Claude | 2026-02-26 | DONE | r02-c04 |

## 阻塞项（Blockers）

无

## 完成记录（Done Log）

| 日期 | 任务ID | 完成内容 | 完成人 |
|---|---|---|---|
| 2026-02-26 | R02-T01 | session rm DELETE 不带 content-type 修复 | Claude |
| 2026-02-26 | R02-T02 | login handoff 循环修复 + headed/headless 切换稳定 | Claude |
| 2026-02-26 | R02-T03 | tests/e2e/test_auth.py (7 tests) + test_handoff.py (5 tests) | Claude |
| 2026-02-26 | R02-T04 | profile 加密（AES-256-GCM，OPENCLAW_PROFILE_KEY） | Claude |
| 2026-02-26 | R02-T05 | engines.node >= 20 锁定 + linux-verify.sh 检查 | Claude |
| 2026-02-26 | R02-T06 | scripts/linux-verify.sh + agentops/reports/linux-baseline.md | Claude |
| 2026-02-26 | R02-T07 | scripts/xvfb-headed.sh + docs/linux-headed.md | Claude |
| 2026-02-26 | R02-T08 | GET+POST /api/v1/sessions/:id/cdp + tests/e2e/test_cdp.py (8 tests) | Claude |
| 2026-02-26 | R02-T09 | scripts/gate.sh (r02-c02) | Claude |
| 2026-02-26 | R02-T10 | AuditEntry.purpose/operator 全链路（daemon+SDK+tests） | Claude |
| 2026-02-26 | R02-T11 | CDP GET/POST 写入 AuditLogger（type=cdp，含 error path） | Claude |
| 2026-02-26 | R02-T12 | test_auth.py 新增 4 个 CDP auth 用例（11 tests 全通过） | Claude |
| 2026-02-26 | R02-T13 | verify.sh STEP/TOTAL 变量化，[1/7]~[7/7] 与摘要 7/7 一致 | Claude |
