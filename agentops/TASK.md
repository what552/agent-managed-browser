# 项目任务说明（TASK）

> 用途：定义项目目标、范围与交付标准，作为多 Agent 协作的统一"任务合同"。

## 1) 目标（Goal）
- **项目名称**：`agentmb`（agent-managed browser daemon）
- **项目定位**：面向多 Agent 的本地浏览器运行时（Browser Runtime），让 Agent 不依赖 relay 即可直接调用 Chromium 完成搜索、浏览、提取与登录态复用。
- **核心业务目标**：
  - 为 LangGraph/Claude/通用脚本提供统一 CLI + REST API + Python SDK 能力，降低 Agent 集成浏览器的复杂度。
  - 支持"人工登录 + 自动执行"的混合模式：登录时可见浏览器接管，平时无头自动运行。
  - 提供可追溯输出：关键操作有证据片段与审计记录，满足投研与业务合规场景。
  - 以 Linux/macOS/Windows 三平台为目标，确保可安装、可运行、可调试、可扩展。
- **目标用户**：
  - 需要让 Agent 访问真实网页并可登录站点的开发者/平台团队。
  - 需要"登录后自动化浏览与提取"能力的多用户服务系统（如 LangGraph 编排服务）。
- **关键使用场景**：
  - Agent 自动搜索并打开目标页面，抽取结构化内容返回上层工作流。
  - 站点登录态过期时，系统提示用户完成可视化登录后自动恢复任务。
  - 同一 profile 下连续执行多步任务，保证上下文连续与审计可追踪。
- **成功指标（KPI）**：
  - 指标1（可用性）：`MVP 核心命令（navigate/click/fill/extract/screenshot）端到端成功率 >= 95%`
  - 指标2（稳定性）：`同一 profile 的登录态复用成功率 >= 90%（24小时内）`
  - 指标3（集成效率）：`新 Agent 接入 CLI 后 2 小时内完成最小链路联调`
  - 指标4（可追溯性）：`100% 命令调用生成 audit_id，关键结果包含 evidence`
  - 指标5（安全性）：`所有敏感动作受 policy 层守护（safe/permissive/disabled 三档）`

## 2) MVP 范围（In Scope）
- **已交付（P0）**：
  - 浏览器 daemon 进程（Fastify + Playwright，Node 20 LTS）
  - Session 生命周期管理（创建/列出/删除/恢复）
  - 核心动作：navigate/click/fill/eval/extract/screenshot/type/press/select/hover
  - 等待动作：wait_for_selector/wait_for_url/wait_for_response
  - 文件动作：upload/download
  - 多标签页管理：pages list/new/switch/close
  - Frame 支持：按 name/url/nth 定位执行动作
  - 登录态复用：handoff start/complete（headed ↔ headless 切换）
  - 网络拦截：route mock add/remove/list
  - 调试工件：trace start/stop（base64 ZIP）
  - CDP 直通：WebSocket URL + HTTP relay
  - 审计日志：type/action/policy 三类事件，purpose/operator 字段
  - Profile 加密：AES-256-GCM，AGENTMB_ENCRYPTION_KEY
  - 安全执行策略：safe/permissive/disabled 三档，per-session 覆盖
  - Python SDK：BrowserClient / AsyncBrowserClient / Session / AsyncSession
  - CLI：20+ 子命令，bash 可脚本化
- **已交付（P1）**：
  - 一致性 Gate 脚本：scripts/check-dist-consistency.sh（27 项检查）
  - CI：三平台 build-smoke + 三平台 full-test
  - scripts/release.sh：npm + pip 版本发布与回滚

## 3) 非目标（Out of Scope）
- 浏览器录制/回放（Playwright codegen 风格）
- 分布式多节点 Session 调度
- 内置代理/VPN 集成
- 浏览器指纹伪装（anti-bot）

## 4) 验收标准（Acceptance Criteria）
- **功能验收**：
  - [x] 所有 P0 项均有可演示路径
  - [x] 关键流程具备明确输入/输出（REST API + SDK + CLI 三通道）
- **质量验收**：
  - [x] 无阻塞级缺陷（Blocker）
  - [x] 12 个 Gate 全绿（verify.sh 12/12），含 9 个 pytest 套件（75+ 测试）
- **文档验收**：
  - [x] README.md、INSTALL.md、SDK README 与 CLI --help 保持一致
  - [x] 评审报告归档至 agentops/reports/

## 5) 约束（Constraints）
- **技术约束**：Node.js ≥ 20 LTS；Python ≥ 3.9；Playwright 仅调用 Chromium
- **合规约束**：审计日志无敏感明文（CDP 错误脱敏、profile 加密落盘）
- **兼容约束**：API 向后兼容（新增字段不破坏旧调用方）

## 6) 风险（Risks）
| 风险 | 影响 | 概率 | 应对策略 |
|---|---|---|---|
| Playwright 版本升级破坏 wsEndpoint() 内部 API | 中 | 低 | 固定 playwright-core 版本，CI 覆盖 |
| Windows 平台 Playwright headless 行为差异 | 中 | 中 | CI 三平台 full-test 覆盖 |
| 长会话 domain 状态内存增长 | 低 | 低 | PolicyEngine TTL 30min 自动清理（r06-c03） |
| 敏感动作误放行（policy bypass） | 高 | 低 | 每个 action 路由均经过 applyPolicy 守门 |

## 7) 里程碑（Milestones）
| 里程碑 | 时间 | 产出 | 验收人 |
|---|---|---|---|
| R02 MVP | 2026-02-26 | session/handoff/audit/encrypt/CDP | Codex/Gemini |
| R04 命名迁移 | 2026-02-27 | openclaw→agentmb 全面收口 | Codex/Gemini |
| R05 Playwright 覆盖 | 2026-02-27 | 15 动作 + 多页 + Frame + CDP/网络/trace | Codex/Gemini |
| R06 硬化与安全 | 2026-02-27 | CLI 对齐 + 一致性 Gate + 执行策略 + CI 三平台 | Codex/Gemini |

## 8) 变更记录（Change Log）
| 日期 | 变更内容 | 变更人 |
|---|---|---|
| 2026-02-26 | 初始化模板 | Claude |
| 2026-02-26 | 细化项目目标、用户场景与KPI | Codex |
| 2026-02-27 | 全面更新：agentmb 正式名称、R02-R06 实际交付内容、去除占位符 | Claude |
