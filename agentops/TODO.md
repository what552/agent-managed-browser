# 协作待办（TODO）

> 用途：追踪当前迭代可执行事项，明确优先级、负责人、截止时间和状态。

## 状态定义
- `TODO`：待开始
- `IN_PROGRESS`：进行中
- `BLOCKED`：受阻
- `DONE`：已完成

## R02 完成状态

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

## R03 待办（下一轮）

| ID | 任务 | 优先级 | 负责人 | 截止日期 | 状态 | 备注 |
|---|---|---|---|---|---|---|
| R03-T01 | CDP WebSocket 原生升级端点 | P1 | `<Owner>` | `<YYYY-MM-DD>` | TODO | 当前仅 HTTP relay |
| R03-T02 | `operator` 从 session/agent 自动推断 | P1 | `<Owner>` | `<YYYY-MM-DD>` | TODO | 降低调用方负担 |
| R03-T03 | Xvfb/Linux headed 场景 CI 实机验证 | P1 | `<Owner>` | `<YYYY-MM-DD>` | TODO | 固化到 CI pipeline |
| R03-T04 | npm/pip 正式发布流程（非 dry-run） | P1 | `<Owner>` | `<YYYY-MM-DD>` | TODO | 包含回滚与版本策略 |
| R03-T05 | auditLogger 注入类型安全化（Fastify decorator typing） | P2 | `<Owner>` | `<YYYY-MM-DD>` | TODO | 来自 r02-b3 交付评审建议 |
| R03-T06 | CDP 错误消息审计脱敏策略 | P2 | `<Owner>` | `<YYYY-MM-DD>` | TODO | 来自 r02-b3 交付评审建议 |

## R04 待办（命名迁移：完全去掉 openclaw）

| ID | 任务 | 优先级 | 负责人 | 截止日期 | 状态 | 备注 |
|---|---|---|---|---|---|---|
| R04-T01 | CLI 命令面切换为 `agentmb`（含文档示例） | P0 | Claude | 2026-02-27 | DONE | r04-c01（已完成） |
| R04-T02 | 全仓移除 `openclaw` 命名（代码/脚本/CI/文档） | P0 | Claude | 2026-02-27 | TODO | r04-c02（本轮核心） |
| R04-T03 | Python SDK 包名与 import 迁移到 `agentmb` | P0 | Claude | 2026-02-27 | TODO | 需同步 tests 与 README |
| R04-T04 | 环境变量前缀迁移：`OPENCLAW_*` -> `AGENTMB_*` | P0 | Claude | 2026-02-27 | TODO | 本轮不保留旧前缀 |
| R04-T05 | 默认数据目录迁移：`~/.openclaw` -> `~/.agentmb` | P1 | Claude | 2026-02-27 | TODO | 含 daemon/CLI/script |
| R04-T06 | CI 增加安装后命令校验（仅 `agentmb`） | P1 | Claude | 2026-02-27 | TODO | 防止 bin 映射回归 |
| R04-T07 | 迁移影响面回归测试（Node+Python+E2E） | P0 | Claude | 2026-02-27 | TODO | r04-b2 评审前必须完成 |

### r04-c02 详细任务拆解（执行基线）

1. Node/CLI 命名清理
- 修改 `package.json`：
- `name` 改为 `agentmb`（或最终确认的新名）。
- `bin` 仅保留 `agentmb`，删除 `openclaw` 入口。
- 修改 `src/cli/**`、`src/daemon/**` 中所有 `openclaw` 文案与提示。

2. Python SDK 命名清理
- 修改 `sdk/python/pyproject.toml` 包名与描述。
- 包目录从 `sdk/python/openclaw` 迁移到 `sdk/python/agentmb`。
- 全量替换 import：`from openclaw ...` -> `from agentmb ...`。
- 更新 `sdk/python/README.md` 与安装命令示例。

3. 运行时配置迁移
- 环境变量统一改为 `AGENTMB_*`（如 `AGENTMB_PORT`、`AGENTMB_DATA_DIR`、`AGENTMB_API_TOKEN`、`AGENTMB_ENCRYPTION_KEY`）。
- 默认路径统一改为 `~/.agentmb`。
- 脚本 `/tmp/openclaw-*` 临时文件名改为 `/tmp/agentmb-*`。

4. 文档与脚本一致性
- 更新 `README.md`、`INSTALL.md`、`docs/**`、`scripts/**` 中所有旧命名。
- 更新 GitHub Actions：SDK import、命令调用、日志提示全部切换为 `agentmb`。
- 历史评审/归档文件可保留原文，不作为本轮阻塞项。

5. 验收标准（r04-c02 Gate）
- `rg -n "openclaw" src sdk scripts docs README.md INSTALL.md .github/workflows package*.json`
- 结果要求：业务代码/脚本/CI/主文档中不出现 `openclaw`。
- `npm ci && npm run build` 通过。
- `node dist/cli/index.js --help` 显示 `agentmb`。
- `pip install -e sdk/python` 后，`python3 -c "import agentmb"` 通过。
- E2E 与关键 smoke 测试通过（至少 auth/handoff/cdp/smoke 全绿）。

6. 非目标（r04-c02 不做）
- 不处理历史报告中的旧命名文本清洗。
- 不引入兼容别名层（按当前决策：合并前完全去掉 `openclaw`）。

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
