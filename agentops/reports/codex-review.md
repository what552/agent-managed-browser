# Codex 工程评审报告 - R04-b2

## 1) 基本信息
- **评审日期**：`2026-02-26`
- **评审轮次**：`R04`
- **目标开发分支**：`feat/r04-next`
- **目标提交（SHA）**：`b3c3b37`（含 `r04-c02` + `r04-c03`）
- **评审批次**：`r04-b2`
- **评审分支**：`review/codex-r04`
- **评审范围**：`命名迁移收口（openclaw -> agentmb）+ build/test/script/CI 回归验证`
- **评审重点**：`全量验证（build + e2e + scripts/verify.sh）、openclaw 残留、命名一致性、CI 风险`
- **评审人**：`Codex`

## 2) 总体结论
- **结论等级**：`Conditional Go`
- **一句话结论**：`主流程已通过全量验证，命名迁移在代码与运行路径上基本一致；但仍存在 2 个 P1（lockfile 残留旧命名、CI 未验证安装后 bin），建议带条件放行。`

## 3) 发现清单（P0/P1）
### P0（Blocking）
- 无。

### P1（Should-Fix）
1. **`package-lock.json` 仍残留旧包名与旧 bin 映射，命名一致性未完全收口。**
   - 证据：`package.json` 已为 `name: "agentmb"` 且仅保留 `agentmb` bin；但 `package-lock.json` 头部仍为 `"name": "openclaw-browser"`，并记录 `"openclaw": "dist/cli/index.js"`。
   - 影响：发布/审计时会出现元数据不一致，增加维护与排障成本。
   - 建议：在 `agentmb` 命名迁移后重新生成并提交 lockfile，使其与 `package.json` 对齐。

2. **CI 仍未覆盖“安装产物 bin”验证，无法直接防护命令入口打包回归。**
   - 证据：`.github/workflows/ci.yml` 当前仅检查 `node dist/cli/index.js --help`，未验证安装后 `agentmb` 命令可执行性（例如 `npm pack` / `npm i -g` 后调用 bin）。
   - 影响：若后续 `bin` 映射或打包清单回归，CI 可能在运行时前无法发现。
   - 建议：build-smoke 增加安装后 bin 级 smoke（至少 `agentmb --help`）。

## 4) 验证命令与结果（独立 worktree @ b3c3b37）
1. `npm ci`：`PASS`
2. `npm run build`：`PASS`
3. 全量 e2e：
   - 命令：`AGENTMB_PORT=19435 python3 -m pytest tests/e2e/test_smoke.py tests/e2e/test_auth.py tests/e2e/test_handoff.py tests/e2e/test_cdp.py -q`
   - 结果：`PASS`（`38 passed in 32.68s`）
4. `scripts/verify.sh`：
   - 命令：`AGENTMB_PORT=19445 AGENTMB_DATA_DIR=/tmp/agentmb-r04-b2-verify bash scripts/verify.sh`
   - 结果：`PASS`
   - 细项：`build/auth/smoke/handoff/cdp` 全通过，汇总 `ALL GATES PASSED (7/7)`
5. 命名一致性检查：
   - `rg -n "openclaw" -S .`：运行代码主路径仅发现少量残留（主要为 `package-lock.json` 与注释/历史报告）。
   - `node dist/cli/index.js --help`：`PASS`，命令面为 `agentmb`。
   - `README.md` / `INSTALL.md` / `scripts/*` / `tests/e2e/*`：已统一为 `agentmb` 与 `AGENTMB_*` 环境变量。

## 5) Gate 建议（供主控汇总）
- **建议结论**：`Conditional Go`
- **放行条件（P1，建议下一提交关闭）**：
  1. 重新生成 `package-lock.json` 以清理旧命名残留并与 `package.json` 对齐。
  2. CI 增加安装后 `agentmb` bin 验证步骤，覆盖打包/入口回归风险。
