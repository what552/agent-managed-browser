# Agent Team Branch & Review Rules

> 适用于当前多 Agent 协作项目（Claude / Codex / Gemini）。
> 目标：`main` 稳定、职责隔离、轮次可追溯、评审可执行。

## 1) 核心原则（必须遵守）

1. `main` 只做集成，不做日常功能开发。  
2. Claude 负责主开发；Codex/Gemini 负责评审。  
3. 一轮（Round）一个里程碑，先过 Gate 再合并。  
4. 合并后保持角色分离，不把所有窗口切回 `main`。  
5. **每个开发批次（`rXX-cNN`）完成后，必须先完成对应评审批次（`rXX-bY`）并形成 Gate 结论，再允许进入下一个开发批次（`rXX-cNN+1`）。**

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
   - Claude 每完成一批（`cNN`）即冻结评审基线，先评审后继续开发下一批。
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
- **默认归档（by default）**：每次评审完成后，由主控立即在 `main` 归档该批次评审摘要（即使尚未合并代码）。
- **Gate 通过后**：再进行代码合并相关决策与执行。
- `main` 不按轮次切分分支；轮次通过分支名与报告头信息区分。

归档最小要求：

1. 归档文件命名：`agentops/reports/rXX-bY-gate-summary.md`
2. 必填字段：目标分支、目标 SHA、Codex 结论、Gemini 结论、P0/P1、主控建议动作
3. 归档提交信息：`docs(review): archive rXX-bY gate summary`

注意：**归档到 `main` 不等于代码已批准合并**。

### 5.1.1 开发总结归档（强制）

- 每次 Claude 完成一批代码提交（如 `rXX-cNN`）后，必须产出开发总结并归档到 `main`。
- 建议文件命名：`agentops/reports/rXX-cNN-dev-summary.md`（或按轮次汇总为 `rXX-dev-summary.md`）。
- 最小内容：提交 SHA、变更文件范围、验证命令与结果、未完成项。
- 建议提交信息：`docs(dev): archive rXX-cNN development summary`

### 5.1.2 归档门禁（强制阻断）

以下任一归档缺失时，流程必须阻断：

1. **开发归档缺失**：存在新的 Claude 开发提交（`feat/rXX-cNN`）但 `main` 没有对应 `rXX-cNN-dev-summary.md`。
2. **评审归档缺失**：Codex/Gemini 已完成同一批次评审并 commit，但 `main` 没有对应 `rXX-bY-gate-summary.md`。

阻断动作（未归档不得执行）：

- 不得开始下一开发批次（`rXX-cNN+1`）。
- 不得发起下一评审批次（`rXX-bY+1`）。
- 不得执行目标分支合并到 `main`。

主控执行时序（必须）：

1. Claude 提交 `feat/rXX-cNN` 后，先归档开发总结到 `main`。
2. Codex/Gemini 完成 `rXX-bY` 并提交后，先归档 gate summary 到 `main`。
3. 归档 commit 完成后，才进入下一批次或合并决策。

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
5. **归档完整**
   - 对应开发批次的 `dev-summary` 已归档到 `main`。
   - 对应评审批次的 `gate-summary` 已归档到 `main`。

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

- 当前 Round：`R02`
- 开发分支：`feat/r02-hardening`
- 工程评审分支：`review/codex-r02`
- 交付评审分支：`review/gemini-r02`

## 10) Pane 调度纪律（强制）

1. 主控不得主动打断正在运行的 pane（禁止无指令 `C-c`、禁止覆盖式重发任务）。
2. 每个 pane 同一时刻只允许 1 条活动任务；上一条未完成前不得追加新任务。
3. 任务变更必须先经用户确认，再向对应 pane 下发新指令。
4. 主控默认只做轮询与汇总（如 `tmux capture-pane`），不替代 pane 执行其职责内测试/开发。
5. 仅当用户明确下达“中断/重跑”指令时，主控才可中断对应 pane。
6. 主控在回复用户的正式执行结论前，需先输出固定前缀：`好的，飞飞`（用于自检是否按规则执行）。

## 11) 远端推送策略（强制）

1. 默认仅允许推送 `main` 到 GitHub。
2. `feat/*`、`review/*`、`research/*` 分支默认禁止推送远端。
3. 仅当用户在当前会话中**明确说明**需要推送某个非 `main` 分支时，才可执行该分支推送。
4. 未获明确指令时，可在本地分支 commit，但不得 `git push`。

## 12) Builder/Reviewer 端口隔离（强制）

为避免 `503` 假失败、端口冲突和 daemon 串扰，Builder 与 Reviewer 必须使用**固定独立端口**与独立数据目录。

### 12.1 固定端口映射（默认）

- Claude（Builder）：`AGENTMB_PORT=19315`
- Codex（Reviewer）：`AGENTMB_PORT=19357`
- Gemini（Reviewer）：`AGENTMB_PORT=19358`

禁止事项：

1. Reviewer 不得使用 `19315`。
2. 不同 pane 不得共用同一端口并发跑测试。
3. 未显式导出端口时直接运行测试，视为流程违规。

### 12.2 数据目录隔离（默认）

- Claude：`AGENTMB_DATA_DIR=/tmp/agentmb-claude`
- Codex：`AGENTMB_DATA_DIR=/tmp/agentmb-codex`
- Gemini：`AGENTMB_DATA_DIR=/tmp/agentmb-gemini`

要求：

1. 所有 `pytest`、`scripts/verify.sh`、daemon 启停命令必须携带上述环境变量。
2. 评审报告必须记录“本次使用端口 + data dir”。

### 12.3 评审有效性门槛

以下任一情况，评审结论视为无效（需重跑）：

1. 在 detached worktree 产出报告但未提交到 `review/*` 分支。
2. 未提供 `git log -- agentops/reports/<review-file>` 新增 SHA。
3. 未声明端口/数据目录，或复用了 Builder 端口。

## 13) 回复前缀自检（强制）

为快速识别是否遵守规则，以下角色在每次对外回复时必须使用固定前缀：

- Builder（Claude）
- Reviewer（Codex / Gemini）
- Researcher（Codex-research）

执行要求：

1. 每次回复第一行必须以：`好的，老板` 开头。
2. 未带该前缀的回复，视为“可能未加载/未遵守最新 RULES”。
3. 主控发现未带前缀时，应立即提醒该 pane 重新按 RULES 执行。

## 14) R08 临时评审门禁（Gemini 非阻断）

仅在 `R08` 阶段生效：

1. 合并门禁以 `Builder(Claude) + Codex Reviewer` 为主判据。
2. Gemini Reviewer 结果作为参考输入，不作为阻断条件。
3. 触发条件：
   - Gemini 出现端口/daemon 环境不稳定，导致评审不可重复或无法稳定落 commit。
4. 仍需执行：
   - Gemini 报告继续归档到 `main`（标注参考性质）。
   - 若 Gemini 报告命中明确代码级 P0/P1，主控需转交 Claude/Codex 复核后再决定是否阻断。
5. 退出条件：
   - Gemini 连续两轮在独立端口环境下稳定提交可复现报告后，恢复为阻断门禁。

## 15) 四 Pane 协作补充规则（长期生效）

1. **功能代码边界**
   - Builder 仅在 `feat/*` 提交功能代码。
   - Reviewer/Researcher 默认不得提交 `src/**` 业务代码。
   - Orchestrator 在 `main` 仅提交流程文档与归档（`agentops/**`、README/INSTALL 等文档类改动）。

2. **每轮固定流程（不可跳步）**
   - `开发提交（cNN） -> dev-summary 归档到 main -> 双 reviewer 评审并各自 commit -> gate 结论 -> 下一开发批次（cNN+1）`。
   - 禁止“开发多轮后再一次性补评审”。

3. **评审基线强制记录**
   - 每份评审报告必须记录：`目标 SHA`、`daemon 端口`、`AGENTMB_DATA_DIR`、`health/version` 基线。
   - 缺任一项视为无效评审，必须补测重提。

4. **分支冻结与换轮**
   - 一个轮次收口后，旧 `feat/review/research` 分支只读冻结，不在旧分支继续叠加下一轮任务。
   - 新一轮必须从最新 `main` 新开三类分支。

5. **异常处理纪律**
   - 发现“脏工作区异常改动、端口串用、daemon 复用混线”时，先停、先记录、先上报，再继续执行。
   - 未经用户明确指令，不得自行做破坏性清理。
