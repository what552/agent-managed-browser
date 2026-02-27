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

---

## R06-b1 最终评审（目标 `9a59a90`）
- **评审日期**：`2026-02-27`
- **评审轮次**：`R06`
- **评审批次**：`r06-b1`
- **评审分支**：`review/codex-r06`
- **目标开发分支**：`origin/feat/r06-next`
- **目标提交（SHA）**：`9a59a90`

### 执行记录
- `git fetch --all --prune`
- `git merge --no-edit origin/feat/r06-next`（Fast-forward 到 `9a59a90`）
- `npm ci`
- `npm run build`
- `bash scripts/check-dist-consistency.sh`
- `bash scripts/verify.sh`

### 校验结果
- `npm ci`：通过
- `npm run build`：通过
- `bash scripts/check-dist-consistency.sh`：通过（`27/27`）
- `bash scripts/verify.sh`：通过（`11/11`）

### Findings（P0/P1/P2）
#### P0
- 无

#### P1
- 无

#### P2
- 无

### 结论
- **Go/No-Go**：`Go`
- 说明：目标提交 `9a59a90` 在本地评审流程下构建与验证全绿，未发现新增 P0/P1/P2 问题。

---

## R06-b2 最终评审（目标 `5b2edac`）
- **评审日期**：`2026-02-27`
- **评审轮次**：`R06`
- **评审批次**：`r06-b2`
- **评审分支**：`review/codex-r06`
- **目标开发分支**：`origin/feat/r06-next`
- **目标提交（SHA）**：`5b2edac`
- **评审头部提交**：`ede9441`（merge `origin/feat/r06-next`）

### 执行记录
- `git fetch --all --prune`
- `git checkout review/codex-r06`
- `git reset --hard`
- `git merge origin/feat/r06-next`
- `npm ci`
- `npm run build`
- `bash scripts/check-dist-consistency.sh`
- `bash scripts/verify.sh`

### 校验结果
- `npm ci`：通过
- `npm run build`：通过
- `bash scripts/check-dist-consistency.sh`：通过（`27/27`）
- `bash scripts/verify.sh`：通过（`12/12`）

### Findings（P0/P1/P2）
#### P0
- 无

#### P1
- 无

#### P2
- 无

### 结论
- **Go/No-Go**：`Go`
- 说明：目标提交 `5b2edac` 在本地评审流程下构建与验证全绿，未发现新增 P0/P1/P2 问题。

---

## R06-b2 复跑评审（按指令合并最新 `origin/feat/r06-next`）
- **评审日期**：`2026-02-27`
- **评审轮次**：`R06`
- **评审批次**：`r06-b2`
- **评审分支**：`review/codex-r06`
- **目标提交（SHA）**：`5b2edac`
- **评审头部提交**：`7aa67e3`（merge `origin/feat/r06-next`，当前开发头 `5c14f69`）

### 执行记录
- `git fetch origin`
- `git merge origin/feat/r06-next`
- `npm ci`
- `npm run build`
- `bash scripts/check-dist-consistency.sh`
- `bash scripts/verify.sh`

### 校验结果
- `npm ci`：通过
- `npm run build`：通过
- `bash scripts/check-dist-consistency.sh`：通过（`27/27`）
- `bash scripts/verify.sh`：**失败**（`11/12`）
  - 失败 Gate：`[11/12] policy`
  - 失败明细：`tests/e2e/test_policy.py` 共 `11` 个用例全部失败，均在 `client.sessions.create(...)` 阶段返回 `503 Service Unavailable`（`POST /api/v1/sessions`）

### Findings（P0/P1/P2）
#### P0
- 无

#### P1
1. 新增 policy e2e 套件在 verify gate 中全量失败（11/11），直接导致 `scripts/verify.sh` 非全绿，当前分支不满足放行条件。

#### P2
- 无

### 结论
- **Go/No-Go**：`No-Go`
- 说明：在按指令合并最新 `origin/feat/r06-next` 后，构建与 dist 一致性检查通过，但 verify 被 policy 套件阻断，需要先修复 `POST /api/v1/sessions` 返回 `503` 的回归再复评。

---

## R06-b3 最终评审（目标 `5c14f69`）
- **评审日期**：`2026-02-27`
- **评审轮次**：`R06`
- **评审批次**：`r06-b3`
- **评审分支**：`review/codex-r06`
- **目标开发分支**：`origin/feat/r06-next`
- **目标提交（SHA）**：`5c14f69`
- **评审头部提交**：`bb0cb5e`（已包含 `5c14f69`，`git merge origin/feat/r06-next` 返回 `Already up to date`）

### 执行记录
- `git fetch --all --prune`
- `git checkout review/codex-r06`
- `git reset --hard`
- `git merge origin/feat/r06-next`
- `npm ci`
- `npm run build`
- `bash scripts/check-dist-consistency.sh`
- `bash scripts/verify.sh`

### 校验结果
- `npm ci`：通过
- `npm run build`：通过
- `bash scripts/check-dist-consistency.sh`：通过（`27/27`）
- `bash scripts/verify.sh`：通过（`12/12`）
  - `policy` gate：通过（`tests/e2e/test_policy.py`，`11 passed`）

### Findings（P0/P1/P2）
#### P0
- 无

#### P1
- 无

#### P2
- 无

### 结论
- **Go/No-Go**：`Go`
- 说明：目标提交 `5c14f69` 本次评审下构建与验证全绿，未发现新增 P0/P1/P2 问题。

---

## R07-c01 评审（基线 `d347991` → 目标 `0aa00a5`）
- **评审日期**：`2026-02-27`
- **评审轮次**：`R07`
- **评审批次**：`r07-c01`
- **评审分支**：`review/codex-r07`
- **代码审查范围**：`d347991..0aa00a5`
- **目标提交（SHA）**：`0aa00a5`

### Findings（按严重级别）
#### P0
- 无

#### P1
1. 新增 e2e 套件调用了不存在的 Python SDK 接口，导致 verify gate 必然失败，当前补丁不可放行。
   - `tests/e2e/test_element_map.py:52` 使用 `client.create_session(...)`
   - `sdk/python/agentmb/client.py:773` 仅暴露 `client.sessions`
   - `sdk/python/agentmb/client.py:818` 实际创建入口为 `client.sessions.create(...)`
   - 实跑证据：`bash scripts/verify.sh` 在 `element-map` gate 报 `AttributeError: 'BrowserClient' object has no attribute 'create_session'`，9 个用例全部 setup 阶段报错。

2. `element_id` 在文档与测试中被声明可直接用于 click/fill，但 SDK 与 CLI 主路径未提供对应入口，功能承诺与实现不一致。
   - 文档与示例声明：
     - `README.md:123`（声明 selector 动作支持 `--element-id`）
     - `README.md:165`（`sess.click(element_id=...)`）
   - SDK 实现仍只接受 `selector`：
     - `sdk/python/agentmb/client.py:76`（`Session.click(self, selector: str, ...)`）
     - `sdk/python/agentmb/client.py:84`（`Session.fill(self, selector: str, value: str, ...)`）
   - CLI `click`/`fill` 也未暴露 `--element-id`：
     - `src/cli/commands/actions.ts:73`
     - `src/cli/commands/actions.ts:82`
   - 实跑证据：`node dist/cli/index.js click sess_demo --element-id e3` 返回 `error: unknown option '--element-id'`。

### 必要测试验证
- `bash scripts/verify.sh`：**失败**（`12/13`）
  - 失败 Gate：`[12/13] element-map`
  - 失败用例文件：`tests/e2e/test_element_map.py`
  - 失败原因：9 个用例均在 fixture setup 阶段调用 `client.create_session(...)` 触发 `AttributeError`。
- 额外核验：
  - `node dist/cli/index.js click --help`（帮助输出无 `--element-id`）
  - `node dist/cli/index.js click sess_demo --element-id e3`（报 unknown option）

### 结论
- **Go/No-Go**：`No-Go`
- **是否可进入下一轮开发**：`否`
- 说明：当前提交存在 P1 级接口契约/验证链路问题，且 verify 非全绿（`12/13`）。需先修复上述 P1 后再进入下一轮。

---

## R07-c01 修复复评（基线 `d347991` → 目标 `9040294`）
- **评审日期**：`2026-02-27`
- **评审轮次**：`R07`
- **评审批次**：`r07-c01-fix-review`
- **评审分支**：`review/codex-r07`
- **代码审查范围**：`d347991..9040294`
- **目标提交（SHA）**：`9040294`

### Findings（按严重级别）
#### P0
- 无

#### P1
- 无

#### P2
1. README 的 Python SDK 示例仍使用不存在的 `client.create_session(...)`，与实际 SDK 入口不一致，可能误导集成方。
   - 示例位置：`README.md:155`
   - 实际入口：`sdk/python/agentmb/client.py:797`（`client.sessions`）与 `sdk/python/agentmb/client.py:842`（`sessions.create(...)`）

### 必要测试验证
- `python3 -m pytest tests/e2e/test_element_map.py -q`：失败（环境前置未满足）
  - 现象：`POST /api/v1/sessions` 返回 `503 Service Unavailable`
  - 说明：该测试文件要求 daemon 预先运行（文件头已注明）
- `bash scripts/verify.sh`：通过（`13/13`）
  - `element-map` gate：通过（`9 passed in 3.79s`）
  - 总结：`ALL GATES PASSED (13/13)`

### 结论
- **Go/No-Go**：`Go`
- **是否可进入下一轮开发**：`是`
- 说明：本次修复已消除上一轮阻断项（`element-map` gate 恢复为绿），未发现新增 P0/P1；仅剩 P2 文档示例一致性问题，不阻断下一轮开发。

---

## R07-c02 评审（基线 `9040294` → 目标 `7669e3b`）
- **评审日期**：`2026-02-27`
- **评审轮次**：`R07`
- **评审批次**：`r07-c02`
- **评审分支**：`review/codex-r07`
- **代码审查范围**：`9040294..7669e3b`
- **目标提交（SHA）**：`7669e3b`

### Findings（按严重级别）
#### P0
- 无

#### P1
1. `stale_ref` 保护在“新建并切换到的新页面”上失效，旧快照 `ref_id` 可在页面已变更后继续命中新页面元素，违反 T18 语义。
   - 导火线代码：
     - `src/browser/manager.ts:154`-`159`：仅在 `launchSession()` 的初始 page 绑定 `framenavigated` 来递增 `page_rev`
     - `src/browser/manager.ts:166`-`173`：`createPage()` 新建 page 时未绑定同等监听
   - 校验逻辑依赖点：
     - `src/daemon/routes/actions.ts:177`-`185`：`ref_id` 仅通过 `snapshot.page_rev !== current_page_rev` 判断是否 `409 stale_ref`
   - 复现实证（本地提权验证）：
     - 切换到 `new_page` 后连续两次 `navigate + snapshot_map`，输出 `page_rev_1=0 page_rev_2=0`（未递增）
     - 使用旧 `ref_id` 在新页面执行 `click`，输出 `click_status=ok text_after=new_clicked`（应为 `409 stale_ref`）

#### P2
1. CLI `scroll` 参数名与服务端契约不一致，`--dx/--dy` 实际不会生效（被服务端默认值覆盖）。
   - `src/cli/commands/actions.ts:469`-`470`：请求体发送 `dx/dy`
   - `src/daemon/routes/actions.ts:639`-`644`：服务端只读取 `delta_x/delta_y`

### 必要测试验证
- `python3 -m pytest tests/e2e/test_r07c02.py -q`：通过（`23 passed in 29.33s`）
  - 说明：首次在受限沙箱内执行时出现 `ConnectError: [Errno 1] Operation not permitted`（本地 socket 限制）；提权重跑后通过。
- `bash scripts/verify.sh`：通过（`14/14`）
  - 含 `r07c02` gate：`23 passed in 2.79s`

### 结论
- **Go/No-Go**：`No-Go`
- **是否可进入下一轮开发**：`否`
- 说明：尽管验证门禁全绿，但存在可复现的 P1（`stale_ref` 失效并可误操作新页面元素），需先修复后再进入下一轮。
