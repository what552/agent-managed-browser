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

## R03 完成状态

| ID | 任务 | 优先级 | 负责人 | 截止日期 | 状态 | 备注 |
|---|---|---|---|---|---|---|
| R03-T01 | CDP WebSocket 原生升级端点 | P1 | Claude | 2026-02-27 | DONE | 并入 R05-T06（browser wsEndpoint via /cdp/ws） |
| R03-T02 | `operator` 从 session/agent 自动推断 | P1 | Claude | 2026-02-27 | DONE | 并入 R05-T09（inferOperator + X-Operator header） |
| R03-T03 | Xvfb/Linux headed 场景 CI 实机验证 | P1 | Claude | 2026-02-26 | DONE | r03-c02（ubuntu 下 xvfb-run verify 已接入 CI） |
| R03-T04 | npm/pip 正式发布流程（非 dry-run） | P1 | Claude | 2026-02-27 | DONE | 并入 R05-T10（scripts/release.sh 含回滚与版本策略） |
| R03-T05 | auditLogger 注入类型安全化（Fastify decorator typing） | P2 | Claude | 2026-02-27 | DONE | 并入 R05-T11（src/daemon/types.ts 类型增强） |
| R03-T06 | CDP 错误消息审计脱敏策略 | P2 | Claude | 2026-02-27 | DONE | 并入 R05-T12（sanitizeCdpError 过滤栈帧/路径） |

## R04 完成状态（命名迁移：完全去掉 openclaw）

| ID | 任务 | 优先级 | 负责人 | 截止日期 | 状态 | 备注 |
|---|---|---|---|---|---|---|
| R04-T01 | CLI 命令面切换为 `agentmb`（含文档示例） | P0 | Claude | 2026-02-27 | DONE | r04-c01（已完成） |
| R04-T02 | 全仓移除 `openclaw` 命名（代码/脚本/CI/文档） | P0 | Claude | 2026-02-27 | DONE | r04-c02/r04-c03 完成 |
| R04-T03 | Python SDK 包名与 import 迁移到 `agentmb` | P0 | Claude | 2026-02-27 | DONE | r04-c02 完成并通过 CI import 校验 |
| R04-T04 | 环境变量前缀迁移：`OPENCLAW_*` -> `AGENTMB_*` | P0 | Claude | 2026-02-27 | DONE | r04-c02 完成 |
| R04-T05 | 默认数据目录迁移：`~/.openclaw` -> `~/.agentmb` | P1 | Claude | 2026-02-27 | DONE | r04-c02 完成（daemon/CLI/script） |
| R04-T06 | CI 增加安装后命令校验（仅 `agentmb`） | P1 | Claude | 2026-02-27 | DONE | r04-c04 完成（npm pack 后 bin 检查） |
| R04-T07 | 迁移影响面回归测试（Node+Python+E2E） | P0 | Claude | 2026-02-27 | DONE | r04-c04/r04-c05 + CI verify gate |

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

## R05 待办（Playwright 覆盖增强）

| ID | 任务 | 优先级 | 负责人 | 截止日期 | 状态 | 备注 |
|---|---|---|---|---|---|---|
| R05-T01 | 动作能力补齐：`type/press/select/hover/wait` | P0 | Claude | 2026-03-06 | DONE | r05-c01 |
| R05-T02 | 文件输入与下载：`file upload/download` | P0 | Claude | 2026-03-06 | DONE | r05-c01 |
| R05-T03 | 多页面能力：`new/list/switch/close page` | P0 | Claude | 2026-03-06 | DONE | r05-c02 |
| R05-T04 | Frame 能力：按 frame 执行动作与提取 | P1 | Claude | 2026-03-06 | DONE | r05-c02 |
| R05-T05 | 事件等待能力：`wait_for_url/selector/response` | P0 | Claude | 2026-03-06 | DONE | r05-c01 |
| R05-T06 | CDP WebSocket 原生升级端点 | P1 | Claude | 2026-03-07 | DONE | r05-c03（browser wsEndpoint via /cdp/ws） |
| R05-T07 | 网络拦截与观测：request/response + route mock | P1 | Claude | 2026-03-07 | DONE | r05-c03（context.route() + CRUD endpoints） |
| R05-T08 | 调试工件：trace/video/har 导出接口 | P1 | Claude | 2026-03-07 | DONE | r05-c04（trace start/stop → base64 ZIP） |
| R05-T09 | `operator` 自动推断（session/agent/cli/sdk） | P1 | Claude | 2026-03-07 | DONE | r05-c03（inferOperator + X-Operator header） |
| R05-T10 | npm/pip 正式发布流程（含版本与回滚） | P1 | Claude | 2026-03-08 | DONE | r05-c04（scripts/release.sh） |
| R05-T11 | auditLogger 类型安全化（Fastify decorator typing） | P2 | Claude | 2026-03-08 | DONE | r05-c04（src/daemon/types.ts augmentation） |
| R05-T12 | CDP 错误消息审计脱敏策略 | P2 | Claude | 2026-03-08 | DONE | r05-c04（sanitizeCdpError in sessions.ts） |
| R05-T13 | 命名一致性修复：`AGENTMB_PROFILE_KEY`/`AGENTMB_ENCRYPTION_KEY` 统一 | P0 | Claude | 2026-03-06 | DONE | r05-c02（README+INSTALL） |

### r05-c01（P0 核心动作与等待）
1. 新增动作端点与 SDK/CLI 映射：`type/press/select/hover/wait_for_*`。
2. 新增文件上传/下载能力（路径校验、错误码统一）。
3. 新增对应 E2E：动作成功、超时失败、错误诊断字段完整。

### r05-c02（多页面与 frame）
1. 会话内 page 管理：创建、列出、切换、关闭。
2. frame 选择策略：`main`、`by-name`、`by-url-pattern`。
3. 回归：handoff 前后 page/frame 状态一致，日志可追溯。

### r05-c03（CDP/网络/调试工件）
1. 新增 CDP WebSocket 原生升级端点（token 鉴权、session 绑定）。
2. 提供 request/response 事件采集与 route mock 能力。
3. 新增 trace/video/har 导出接口和落盘策略。

### r05-c04（发布与工程收口）
1. 补齐 npm/pip 正式发布流程文档与脚本（tag/version/rollback）。
2. 完成 auditLogger typing 与 CDP 脱敏策略。
3. 验收：`verify.sh` + 新增 r05 gate 全绿（Node + Python + E2E）。

### R05 验收标准（Gate）
- 功能覆盖：P0 项全部 `DONE`，P1 至少完成 `R05-T06/T07/T08/T09`。
- 质量门禁：新增/更新 E2E 用例通过；CI 全绿（ubuntu/macos/windows）。
- 文档门禁：README/INSTALL/SDK README 与 CLI `--help` 保持一致。
- 安全门禁：上传下载与 CDP 升级接口默认鉴权开启；审计日志无敏感明文泄漏。

## R06 完成状态（CLI 硬化 + 安全执行策略）

| ID | 任务 | 优先级 | 负责人 | 截止日期 | 状态 | 备注 |
|---|---|---|---|---|---|---|
| R06-T01 | CLI 对齐补齐：pages/route/trace/cdp-ws 子命令 | P0 | Claude | 2026-02-27 | DONE | r06-c01 |
| R06-T02 | dist 一致性 Gate：check-dist-consistency.sh（27项） | P0 | Claude | 2026-02-27 | DONE | r06-c01 |
| R06-T03 | 安全执行策略层：throttle/jitter/cooldown/retry/sensitive guardrail | P0 | Claude | 2026-02-27 | DONE | r06-c02 |
| R06-T04 | AGENTMB_POLICY_PROFILE 环境变量 + per-session API 覆盖 | P0 | Claude | 2026-02-27 | DONE | r06-c02 |
| R06-T05 | Windows full-test CI（三平台全测） | P1 | Claude | 2026-02-27 | DONE | r06-c03 |
| R06-T06 | eval/extract 路由挂载 applyPolicy（策略覆盖完整） | P1 | Claude | 2026-02-27 | DONE | r06-c03 |
| R06-T07 | PolicyEngine TTL/LRU 域状态清理（30min TTL，5min check） | P1 | Claude | 2026-02-27 | DONE | r06-c03 |
| R06-T08 | pages close CLI 交互增强（[page-id] 可选，交互式列表选择） | P1 | Claude | 2026-02-27 | DONE | r06-c03 |
| R06-T09 | TASK/TODO 文档收口（去占位符，历史状态更新） | P2 | Claude | 2026-02-27 | DONE | r06-c03 |

## R07 待办（动作覆盖扩展 + 对齐同类 CLI 可用性）

> 来源：`research_todo.md`（research 分支）+ 本轮 CLI 能力差距对比结论合并。

| ID | 任务 | 优先级 | 负责人 | 截止日期 | 状态 | 备注 |
|---|---|---|---|---|---|---|
| R07-T01 | 元素索引定位模型（`element_map` + `element_id`） | P0 | Claude | 2026-03-10 | DONE | r07-c01：API/CLI/SDK 三端；DOM 注入 data-agentmb-eid；向后兼容 selector |
| R07-T02 | 读取/断言原语：`get text/html/value/attr/count/box` + `is visible/enabled/checked` | P0 | Claude | 2026-03-10 | DONE | r07-c01：/get + /assert 端点；Playwright locator API |
| R07-T03 | 交互原语扩展：`dblclick/focus/check/uncheck/scroll/scroll-into-view/drag` + 低层鼠标键盘事件 | P0 | Claude | 2026-03-11 | TODO | 覆盖复杂组件与富交互站点 |
| R07-T04 | Wait/导航控制增强：`wait text/load/function` + `back/forward/reload` + frame/page 切换增强 | P1 | Claude | 2026-03-11 | TODO | 提升流程稳定性 |
| R07-T05 | 会话状态能力：cookie/storage import-export + auth-state save/load | P1 | Claude | 2026-03-12 | TODO | 跨环境登录态迁移 |
| R07-T06 | 可观测性增强：network/console/error 采集 + 高亮截图/标注截图 | P1 | Claude | 2026-03-12 | TODO | 便于 Codex 诊断与回放 |
| R07-T07 | 稳定性策略 V2：`wait_page_stable`/遮挡检测/重试策略注入 | P0 | Claude | 2026-03-10 | DONE | r07-c01：networkidle + MutationObserver + overlay_selector 轮询 |
| R07-T08 | 通用滚动原语：`scroll_until` / `load_more_until`（计数/停滞/最大尝试/结束标记） | P1 | Claude | 2026-03-12 | TODO | 从业务滚动逻辑抽象为通用 API |
| R07-T09 | MCP 适配层 PoC（独立 adapter 形态，不侵入核心 runtime） | P2 | Claude | 2026-03-13 | TODO | 最小工具集：session/navigate/click/extract/screenshot |
| R07-T10 | 任务级编排（Recipe）MVP：step/checkpoint/resume（SDK-first） | P2 | Claude | 2026-03-13 | TODO | 先在 SDK 试点，再评估下沉 daemon |
| R07-T11 | 项目级配置与输出标准化：`agentmb.config.*` + 统一 `--json` envelope | P2 | Claude | 2026-03-13 | TODO | 对齐多 Agent 调用体验 |
| R07-T12 | 文档与兼容性回归：README/INSTALL/SDK + e2e 回归（ubuntu/macos/windows） | P1 | Claude | 2026-03-13 | TODO | 发布前 gate |

### r07-c01（P0：定位与稳定性核心）
1. 交付 `R07-T01/T02/T07`：element_map/element_id、读取断言、稳定性策略 V2（页面稳定 + 遮挡检测）。
2. 保持向后兼容：原 selector 入参继续可用，`element_id` 为新增能力。
3. 验收：新增 e2e 覆盖至少 3 类复杂页面场景（动态列表、延迟加载、浮层遮挡）。

### r07-c02（P0/P1：交互与流程控制）
1. 交付 `R07-T03/T04/T08`：交互原语、wait/导航增强、通用滚动原语。
2. CLI/API/SDK 三端对齐命名与错误码，避免“CLI 有而 SDK 无”。
3. 验收：同一 workflow 中 `scroll_until + element_id click + wait` 稳定跑通。

### r07-c03（P1/P2：状态、观测、适配）
1. 交付 `R07-T05/T06/T09/T10/T11/T12`：会话状态、可观测性、MCP adapter PoC、Recipe MVP、配置标准化、文档回归。
2. MCP 采用“外置 adapter”策略，避免核心 daemon 复杂度失控。
3. 验收：跨平台 CI 全绿，且提供 1 条 SDK recipe + 1 条 MCP PoC 演示。

### R07 验收标准（Gate）
- 功能门禁：`R07-T01/T02/T03/T07` 至少完成（P0 全部 `DONE`）。
- 稳定性门禁：新能力引入后现有 r06 e2e 无回归，flaky 指标不劣化。
- 交付门禁：CLI/API/SDK 文档与 `--help` 一致；新增能力均有示例。
- 架构门禁：MCP 适配层保持外置，不破坏既有 HTTP/CLI/SDK 主架构。

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
| 2026-02-26 | R03-T03 | ubuntu CI 中使用 xvfb-run 执行 verify gate | Claude |
| 2026-02-26 | R04-T01 | CLI 命令面切换为 `agentmb`（文档示例同步） | Claude |
| 2026-02-26 | R04-T02 | 全仓 `openclaw` 命名迁移到 `agentmb`（代码/脚本/CI/文档） | Claude |
| 2026-02-26 | R04-T03 | Python SDK 包名与 import 迁移到 `agentmb` | Claude |
| 2026-02-26 | R04-T04 | 环境变量前缀迁移为 `AGENTMB_*` | Claude |
| 2026-02-26 | R04-T05 | 默认数据目录迁移到 `~/.agentmb` | Claude |
| 2026-02-26 | R04-T06 | CI 增加 npm pack 后 `agentmb` bin 校验 | Claude |
| 2026-02-26 | R04-T07 | 命名迁移影响面回归测试（Node+Python+E2E）收口 | Claude |
| 2026-02-26 | R05-T01 | type/press/select/hover/wait_for_* 动作（9 个端点+SDK+CLI+E2E） | Claude |
| 2026-02-26 | R05-T02 | upload/download 文件传输（50MB 限制，audit 落盘） | Claude |
| 2026-02-26 | R05-T05 | wait_for_url/selector/response 事件等待（含 trigger 触发导航） | Claude |
| 2026-02-26 | R05-T13 | README/INSTALL 中 AGENTMB_PROFILE_KEY → AGENTMB_ENCRYPTION_KEY 统一 | Claude |
| 2026-02-26 | R05-b1-P1 | CLI wait-response 命令补齐；unused imports 清理；Frame import 补齐 | Claude |
| 2026-02-26 | R05-b1-P2 | upload 50MB 路由级 guard；downloadFile maxBytes 参数；async upload to_thread | Claude |
| 2026-02-26 | R05-T03 | 多页面管理：createPage/listPages/switchPage/closePage + 4 个路由 + SDK | Claude |
| 2026-02-26 | R05-T04 | Frame 支持：Actionable 类型 + resolveFrame helper + 9 个路由 frame 参数 | Claude |
| 2026-02-26 | R05-T06 | GET /cdp/ws 返回 browser wsEndpoint；SDK cdp_ws_url() | Claude |
| 2026-02-26 | R05-T07 | context.route() 网络 mock：addRoute/removeRoute/listRoutes + 3 路由 + SDK | Claude |
| 2026-02-26 | R05-T09 | inferOperator：body→X-Operator header→agent_id→daemon fallback；SDK operator 参数 | Claude |
| 2026-02-26 | R05-T08 | trace start/stop 端点（base64 ZIP 导出）；SDK trace_start/trace_stop | Claude |
| 2026-02-26 | R05-T10 | scripts/release.sh：npm+pip 版本管理+发布+回滚 | Claude |
| 2026-02-26 | R05-T11 | src/daemon/types.ts Fastify 类型增强；去除 (server as any) 强转 | Claude |
| 2026-02-26 | R05-T12 | sanitizeCdpError()：过滤栈帧/路径/截断到 300 字符 | Claude |
| 2026-02-27 | R06-T01 | CLI pages/route/trace/cdp-ws 子命令补齐 | Claude |
| 2026-02-27 | R06-T02 | check-dist-consistency.sh 27项一致性 Gate + CI 接入 | Claude |
| 2026-02-27 | R06-T03 | PolicyEngine safe/permissive/disabled + checkAndWait 全链路 | Claude |
| 2026-02-27 | R06-T04 | POST/GET /policy 路由 + SDK set_policy/get_policy + PolicyInfo | Claude |
| 2026-02-27 | R06-T05 | CI full-test 增加 windows-latest 平台（三平台全测） | Claude |
| 2026-02-27 | R06-T06 | eval/extract 路由增加 applyPolicy 调用 | Claude |
| 2026-02-27 | R06-T07 | PolicyEngine.maybeCleanupStaleDomains（TTL 30min，间隔 5min） | Claude |
| 2026-02-27 | R06-T08 | pages close [page-id] 可选 + readline 交互式列表选择 | Claude |
| 2026-02-27 | R06-T09 | TASK.md 去模板占位符；TODO.md R03 状态更正 + R06 章节 | Claude |
