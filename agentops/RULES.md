# Agent Team Branch & Review Rules

> 适用于当前多 Agent 协作项目（Claude / Codex / Gemini）。
> 目标：`main` 稳定、职责隔离、轮次可追溯、评审可执行。

## 1) 核心原则（必须遵守）

1. `main` 只做集成，不做日常功能开发。  
2. Claude 负责主开发；Codex/Gemini 负责评审。  
3. 一轮（Round）一个里程碑，先过 Gate 再合并。  
4. 合并后保持角色分离，不把所有窗口切回 `main`。  

## 2) 角色与工作区映射

- **Codex 主窗口（Orchestrator）**
  - worktree：主仓库
  - 分支：`main`
  - 职责：任务编排、汇总报告、控制 Merge Gate、执行合并
- **Claude（Builder）**
  - worktree：`../bppool-claude`
  - 分支：`feat/rXX-<topic>`
  - 职责：架构落地、核心实现、更新实现总结
- **Codex（Engineering Reviewer）**
  - worktree：`../bppool-codex`
  - 分支：`review/codex-rXX`
  - 职责：工程质量评审（build/lint/test/边界/异常）
- **Gemini（Delivery Reviewer）**
  - worktree：`../bppool-gemini`
  - 分支：`review/gemini-rXX`
  - 职责：交付质量评审（README/env/部署/一致性）

## 3) 分支命名规范

- 集成分支：`main`
- Claude 开发分支：`feat/rXX-<topic>`
- Codex 评审分支：`review/codex-rXX`
- Gemini 评审分支：`review/gemini-rXX`

说明：`rXX` 必须两位（`r01`、`r02`...），每轮新建，不复用旧分支。

## 4) Round 生命周期

1. **Round Start**
   - 三个分支均从最新 `main` 创建。
2. **Round Execution**
   - Claude 在 `feat/*` 实现里程碑。
   - Codex/Gemini 默认输出评审报告，不直接改核心业务。
3. **Round Merge**
   - 仅在 Gate 通过后，将 Claude 分支合并到 `main`。
4. **Round Close**
   - 记录未完成项到下一轮；可清理本轮短命分支。

## 5) Review 与目标分支绑定（防串轮）

每份评审报告必须包含以下字段（必填）：

- `评审轮次`：如 `R01`
- `目标开发分支`：如 `feat/r01-mvp`
- `目标提交`：如 `<commit sha>`
- `评审分支`：如 `review/codex-r01` / `review/gemini-r01`
- `评审结论`：`Go / Conditional Go / No-Go`

推荐流程：

1. Claude 提交后，先固定待评审 commit（SHA）。
2. Codex/Gemini 仅针对该 SHA 评审并出报告。
3. 若 Claude 继续提交，视为新评审批次，报告需更新“目标提交”。

### 5.1 Review 报告存放与归档

- **评审过程**：报告先保存在各自 review 分支（`review/codex-rXX`、`review/gemini-rXX`）。
- **Gate 通过后**：由主控将最终结论归档到 `main` 的 `agentops/reports/`。
- `main` 不按轮次切分分支；轮次通过分支名与报告头信息区分。

### 5.2 Review 分支 commit 时点（必须）

1. Claude 先提供 checkpoint commit（固定 SHA）。
2. Codex/Gemini 基于该 SHA 完成报告填写。
3. **报告写完立即在各自 review 分支 commit**（至少 1 次）。
4. 若后续补评审结论，可追加 commit，但必须更新目标 SHA/说明。

推荐提交信息：

- Codex：`docs(review): codex review for feat/rXX @ <sha>`
- Gemini：`docs(review): gemini review for feat/rXX @ <sha>`

### 5.3 Claude commit 时点（必须）

Claude 在 `feat/rXX-*` 分支至少执行两次关键 commit：

1. **Checkpoint Commit（评审前）**
   - 条件：本轮阶段目标达到可运行/可演示。
   - 作用：冻结评审基线，产出唯一评审 SHA。
2. **Gate Commit（修复后）**
   - 条件：已处理 Codex/Gemini 的 Gate 问题并更新说明。
   - 作用：作为最终合并到 `main` 的候选提交。

补充规则：

- Codex/Gemini 评审必须基于 Claude 的 Checkpoint SHA。
- 若 Checkpoint 后 Claude 继续改动，需更新目标 SHA 并触发新一轮评审确认。

### 5.4 轮次与 commit 批次（防混淆）

- **轮次（RXX）不是每次 commit 增长**，而是“一个里程碑/一个开发阶段”。
- 同一轮（如 `R01`）允许多个 commit（例如 M1~M4 连续开发）。
- 建议在 commit message 中增加批次号，便于追踪：
  - `feat(r01-c01): ...`
  - `feat(r01-c02): ...`
  - `feat(r01-c03): ...`
- 评审报告中可增加“评审批次”字段（如 `r01-b2`）用于标记本次评审覆盖的 SHA 区间。
- **只有开启新里程碑时才进入下一轮（R02）**，不是“下一个 commit 自动变 R02”。

### 5.5 Commit Message 批次规范（强制）

- Claude 在 `feat/rXX-*` 分支提交时，必须使用以下前缀格式：
  - `feat(rXX-cNN): <summary>`
- 其中：
  - `rXX`：轮次（如 `r01`）
  - `cNN`：该轮内递增提交号（`c01`、`c02`、`c03`...）
- 同一轮内不得复用同一个 `cNN`。

R01 示例：

- `feat(r01-c03): m1-m3 runnable skeleton`（对应当前 `7cb239f`）
- `feat(r01-c04): m4 python sdk + smoke tests`
- `feat(r01-c05): p1 fixes for review gate`

## 6) Merge Gate（合并门禁）

合并到 `main` 前必须满足：

1. **Claude 里程碑完成**
   - 本轮范围完成且可运行/可演示。
2. **Codex 工程评审通过**
   - `build`/`lint`/关键测试通过；
   - 报告无 Blocking 问题。
3. **Gemini 交付评审通过**
   - README、环境变量、部署说明达到当前阶段要求；
   - 结论为 `Go` 或 `Conditional Go`（附条件）。
4. **主控确认**
   - scope 冻结、trade-off 已记录、遗留项已入下一轮 TODO。

## 7) 合并后规则

- Codex 主窗口保持在 `main`。
- Claude 新开下一轮 `feat/rXX-*`。
- Codex/Gemini 新开下一轮 `review/*-rXX`。
- 不允许三方都回到 `main` 并并行开发。

## 8) 变更边界

- Claude：可改 `src/**`、`tests/**`、必要文档。
- Codex：默认仅改评审报告；授权后可改 `tests/**`、`scripts/**`。
- Gemini：默认仅改评审报告；授权后可改 `docs/**`、`deploy/**`、`.env.example`。
- 未经授权，Codex/Gemini 不改核心业务逻辑。

## 9) 当前轮次（当前项目）

- 当前 Round：`R01`
- 开发分支：`feat/r01-mvp`
- 工程评审分支：`review/codex-r01`
- 交付评审分支：`review/gemini-r01`
