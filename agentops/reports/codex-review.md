# Codex 工程评审报告 - R04-b1

## 1) 基本信息
- **评审日期**：`2026-02-26`
- **评审轮次**：`R04`
- **目标开发分支**：`feat/r04-next`
- **目标提交（SHA）**：`d3df6bd`（`feat(r04-c01)`）
- **评审批次**：`r04-b1`
- **评审分支**：`review/codex-r04`
- **评审范围**：`CLI command surface rename（openclaw -> agentmb）+ docs/packaging impact`
- **评审重点**：`build、agentmb 可用性、旧命令兼容策略、脚本/CI 回归风险`
- **评审人**：`Codex`

## 2) 总体结论
- **结论等级**：`Conditional Go`
- **一句话结论**：`核心变更（agentmb 命令面）可用，且旧入口 openclaw 仍可执行；但兼容策略文档与 CI 对新旧入口的自动校验覆盖不足，建议带 2 个 P1 条件放行。`

## 3) 发现清单（P0/P1）
### P0（Blocking）
- 无。

### P1（Should-Fix）
1. **旧命令兼容策略未显式声明，迁移预期不清晰。**
   - 证据：`package.json` 同时保留 `agentmb` 与 `openclaw` bin，但 `README.md` / `INSTALL.md` 仅展示 `agentmb`，未说明 `openclaw` 的兼容期与废弃计划。
   - 影响：使用旧命令的用户无法判断是否应立即迁移，存在后续破坏性变更沟通风险。
   - 建议：在 `README.md` / `INSTALL.md` 增加“兼容策略”段（例如：`openclaw` 暂保留至 RXX，推荐迁移到 `agentmb`）。

2. **CI 未直接验证安装后 bin 映射（agentmb/openclaw），对命令面回归防护不足。**
   - 证据：`.github/workflows/ci.yml` 仅执行 `node dist/cli/index.js --help`，未验证安装产物中的 `agentmb` 与 `openclaw` 可执行入口。
   - 影响：若后续 `package.json#bin` 映射回归，CI 可能无法提前拦截。
   - 建议：在 build-smoke job 增加安装后命令校验（例如 `npm pack && npm i -g` 后执行 `agentmb --help`、`openclaw --help`）。

## 4) 验证命令与结果（独立 worktree @ d3df6bd）
1. `npm ci`：`PASS`
2. `npm run build`：`PASS`
3. `node dist/cli/index.js --help`：`PASS`（程序名显示为 `agentmb`）
4. `npm install -g . --prefix /tmp/agentmb-bin-test`：`PASS`
5. `/tmp/agentmb-bin-test/bin/agentmb --help`：`PASS`
6. `/tmp/agentmb-bin-test/bin/openclaw --help`：`PASS`（旧命令入口仍可执行，输出仍为 agentmb 命令面）
7. 代码审查：
   - `src/cli/index.ts`：CLI 名称与描述切换为 `agentmb`。
   - `package.json`：新增 `agentmb` bin，保留 `openclaw` bin（兼容保留）。
   - `README.md` / `INSTALL.md`：用户示例切换为 `agentmb`。
   - `.github/workflows/ci.yml`：未新增安装后 bin 级校验，存在覆盖缺口。

## 5) Gate 建议（供主控汇总）
- **建议结论**：`Conditional Go`
- **放行条件（P1，建议在后续提交关闭）**：
  1. 文档补充 `openclaw -> agentmb` 兼容/废弃策略说明。
  2. CI 增加安装后 `agentmb` 与 `openclaw` bin 校验步骤。
