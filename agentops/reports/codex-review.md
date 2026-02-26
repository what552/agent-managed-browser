# Codex 评审报告

## R05-b3 最终评审（仅复核 5e1ac3e）
- **评审日期**：`2026-02-26`
- **评审轮次**：`R05`
- **评审批次**：`r05-b3`
- **目标开发分支**：`origin/feat/r05-next`
- **复核提交（SHA）**：`5e1ac3e`
- **评审分支**：`review/codex-r05`
- **评审范围**：`origin/main..origin/feat/r05-next`（含 `5e1ac3e`）
- **评审人**：`Codex`

## 总体结论
- **Gate**：`No-Go`
- **一句话结论**：`A/B/C 三条修复本身已落地并有用例通过，但当前基线仍存在回归失败（download 默认路径）且 verify gate 未全绿，不满足放行条件。`

## 执行记录
- 已执行：`git fetch origin`
- 已执行：`git checkout review/codex-r05 && git reset --hard origin/review/codex-r05 && git merge --no-edit 5e1ac3e`
- 已执行：`npm ci && npm run build`
- 已执行：`AGENTMB_PORT=19357 AGENTMB_DATA_DIR=/tmp/agentmb-codex-r05-b3 bash scripts/verify.sh`
- 已执行：`AGENTMB_PORT=19357 python3 -m pytest tests/e2e/test_actions_v2.py tests/e2e/test_pages_frames.py tests/e2e/test_network_cdp.py -q`（通过 daemon 托管方式复跑得到有效结果）
- 补充核验：`AGENTMB_PORT=19357 python3 -m pytest tests/e2e/test_c05_fixes.py -q`

## 关键测试结果
1. `npm run build`：`PASS`
2. `scripts/verify.sh`：`FAIL`（`9/11`）
   - `tests/e2e/test_cdp.py::test_audit_purpose_optional` 失败（期望 `operator is None`，实际为 `agentmb-daemon`）
   - `tests/e2e/test_actions_v2.py::test_download_file` 失败（`422 Unprocessable Entity`）
3. 指定三测（有效复跑）：`tests/e2e/test_actions_v2.py tests/e2e/test_pages_frames.py tests/e2e/test_network_cdp.py`
   - 汇总：`1 failed, 24 passed`
   - 唯一失败：`tests/e2e/test_actions_v2.py::test_download_file`（`422`）
4. A/B/C 专项：`tests/e2e/test_c05_fixes.py`
   - 汇总：`10 passed`

## 三条重点核验
| 核验项 | 结论 | 证据 |
|---|---|---|
| A. frame 不存在必须 422 且不回退主页面 | 通过 | `src/daemon/routes/actions.ts:32-69` 显式 `FrameResolutionError` + `422`；`tests/e2e/test_c05_fixes.py:35-75` 两个非法 frame 用例断言 `422`，专项套件通过 |
| B. acceptDownloads 必须会话/BrowserContext 级，不得全局默认污染 | 通过（但有兼容性回归） | `src/browser/manager.ts:41-67,226-249` 使用 `sessionAcceptDownloads`（默认 false，按会话持有，切模态保留）；`src/daemon/routes/sessions.ts:27-53` 接收并回传 `accept_downloads`；`tests/e2e/test_c05_fixes.py:111-164` 全通过。兼容性回归见 `test_download_file` 默认会话下返回 `422` |
| C. 关闭最后一个 page 行为可预期（409 或等效错误），不破坏 active page 语义 | 通过 | `src/browser/manager.ts:124-143` 最后页触发 `LAST_PAGE`；`src/daemon/routes/sessions.ts:178-197` 映射 `409`；`tests/e2e/test_c05_fixes.py:171-215` 通过 |

## Findings（P0/P1/P2）
### P0
- 无

### P1
1. 默认会话下载路径回归：`tests/e2e/test_actions_v2.py::test_download_file` 失败（`422`），导致指定回归集与 verify gate 非全绿。
   - 现象：`session.download("#dl")` 调用 `/api/v1/sessions/:id/download` 返回 `422`
   - 影响：现有动作能力回归门禁失败，发布风险不可接受

### P2
1. `tests/e2e/test_cdp.py::test_audit_purpose_optional` 与当前 operator 推断实现不一致（测试期望 `None`，实际默认 `agentmb-daemon`），需明确规范并统一。

## 结论建议
- 本次 `r05-b3` 评审结论为 `No-Go`，建议先关闭上述 P1 后再复评。

---

## R05-b4 最终评审（目标 `b7d2a91`）
- **评审日期**：`2026-02-26`
- **评审轮次**：`R05`
- **评审批次**：`r05-b4`
- **评审分支**：`review/codex-r05`
- **评审范围**：`origin/main..origin/feat/r05-next`（纳入最新提交，含 `b7d2a91`）
- **评审方式**：`仅评审，不改业务代码`

### 执行记录
- 基线同步：`git fetch origin && git checkout review/codex-r05 && git reset --hard origin/review/codex-r05 && git merge --no-edit origin/feat/r05-next`
- 构建验证：`npm ci && npm run build && bash scripts/verify.sh`
- 当前评审头部：`3e23851`（merge `origin/feat/r05-next`，包含 `b7d2a91`）

### verify 结果
- `npm ci`：通过
- `npm run build`：通过
- `bash scripts/verify.sh`：**通过，11/11 全绿**
  - 证据：`scripts/verify.sh:22-23`（TOTAL=11）、`scripts/verify.sh:103-110`（8 个 e2e 子套件）、本次实跑输出 `ALL GATES PASSED (11/11)`

### Findings（P0/P1/P2）
#### P0
- 无

#### P1
- 无

#### P2
- 无

### 变更与一致性复核（文件:行号）
1. 下载测试已显式按会话开启 `accept_downloads`，与 r05-c05 默认关闭策略一致：
   - `tests/e2e/test_actions_v2.py:204-209`
   - `tests/e2e/test_actions_v2.py:216-227`
2. 审计兼容测试已与 `operator` 自动推断语义一致（默认 `agentmb-daemon`）：
   - `tests/e2e/test_cdp.py:103-117`

### 结论
- **Go/No-Go**：`Go`
- 说明：目标提交 `b7d2a91` 解决了 r05-b3 阻塞项在测试基线层面的不一致，当前 verify gate 11/11 通过，未发现新增 P0/P1/P2。
