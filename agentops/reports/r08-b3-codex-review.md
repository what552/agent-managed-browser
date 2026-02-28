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

---

## R07-c02-fix 复评（基线 `7669e3b` → 目标 `c7379e4`，当前头 `0ef3f6a` 已包含）
- **评审日期**：`2026-02-27`
- **评审轮次**：`R07`
- **评审批次**：`r07-c02-fix-review`
- **评审分支**：`review/codex-r07`
- **代码审查范围**：`7669e3b..c7379e4`
- **目标提交（SHA）**：`c7379e4`

### Findings（按严重级别）
#### P0
- 无

#### P1
1. `stale_ref` 修复仍不稳定：在“新建 page 后切换并导航”的场景下，旧 `ref_id` 未稳定返回 `409 stale_ref`，独立 e2e 复跑出现 `500`。
   - 目标修复代码：
     - `src/browser/manager.ts:173`-`178`（`createPage()` 新增 `framenavigated` 监听）
   - `ref_id` 校验路径：
     - `src/daemon/routes/actions.ts:172`-`188`（snapshot + `page_rev` 校验后才应放行动作）
   - 实测失败证据：
     - `tests/e2e/test_r07c02.py::TestStaleRef::test_stale_ref_after_new_page_navigation` 失败
     - 断言位置：`tests/e2e/test_r07c02.py:196`
     - 实际错误：期望 `stale/409`，返回 `500 Internal Server Error`
     - daemon 日志显示点击阶段超时（`waiting for locator('[data-agentmb-eid=\"e1\"]')`），说明旧 `ref_id` 未被前置拦截为 `stale_ref`。

#### P2
- 无（`scroll` 参数名一致性已修复）
  - CLI 已改为发送 `delta_x` / `delta_y`：`src/cli/commands/actions.ts:469`-`470`
  - 与服务端契约一致：`src/daemon/routes/actions.ts:639`-`644`

### 必要测试验证
- `python3 -m pytest tests/e2e/test_r07c02.py -q`：**失败**（`1 failed, 23 passed in 40.65s`）
  - 失败用例：`tests/e2e/test_r07c02.py::TestStaleRef::test_stale_ref_after_new_page_navigation`
  - 失败原因：应返回 `409 stale_ref`，实返 `500`。
- `bash scripts/verify.sh`：通过（`14/14`）
  - `r07c02` gate：`24 passed in 4.00s`

### 结论
- **Go/No-Go**：`No-Go`
- **是否可进入下一轮开发**：`否`
- 说明：尽管 `verify` 全绿，但独立必测 `test_r07c02` 在关键 P1 场景仍出现 `500`，`stale_ref` 修复未达到稳定可放行状态。

### 补充验证（定向复现，不改代码不提交）
- **执行方式**：
  - 隔离环境：`PORT=19639`，`DATA=/tmp/agentmb-codex-race`
  - 先启动 daemon，再循环 30 次仅执行：
    - `tests/e2e/test_r07c02.py::TestStaleRef::test_stale_ref_after_new_page_navigation`
- **30 轮统计**：
  - `pass=30`
  - `fail=0`
  - `fail_500=0`
  - `fail_409=0`
  - `fail_other=0`
- **失败样例类型（409/500）**：
  - 无失败样例（30 轮均通过）
- **附加证据**：
  - daemon 日志中该测试对应 `click(ref_id=...)` 请求均返回 `statusCode=409`，未观察到 `500`。

### 补充验证（最终复核）
- `python3 -m pytest tests/e2e/test_r07c02.py -q`：通过（`24 passed in 31.02s`）
- `bash scripts/verify.sh`：通过（`14/14`，含 `r07c02: 24 passed`）

### 最终结论（覆盖本节上一版结论）
- **Go/No-Go**：`Go`
- **是否可进入下一轮开发**：`是`
- 说明：基于“完整 `test_r07c02` 通过 + `verify` 全绿 + 定向 30 轮复现无 500”的组合证据，`c7379e4` 在本轮复评下可放行。

---

## R07-c03 评审（基线 `c7379e4` → 目标 `3a48c57`，当前头 `70cb2a0` 已包含）
- **评审日期**：`2026-02-27`
- **评审轮次**：`R07`
- **评审批次**：`r07-c03`
- **评审分支**：`review/codex-r07`
- **代码审查范围**：`c7379e4..3a48c57`
- **目标提交（SHA）**：`3a48c57`

### Findings（按严重级别）
#### P0
- 无

#### P1
1. `Recipe` 文档声明支持 `AsyncSession`，但 `run()` 对 step 返回的协程不做 `await`，会把“未执行的协程对象”记为成功，导致异步流程静默失效。
   - 文档声明支持 `AsyncSession`：`sdk/python/agentmb/recipe.py:122`
   - 实现仅同步调用 step：`sdk/python/agentmb/recipe.py:161`-`185`（`data = fn(self._session)` 后直接记 `status='ok'`）
   - 复现实证：以 `async def` step 运行 `Recipe.run()`，输出 `status=ok` 且 `data_type=coroutine`，并出现 `RuntimeWarning: coroutine was never awaited`。

#### P2
1. MCP 适配器 PoC 使用逐行 JSON 读写而非 MCP 常用的消息分帧（stdio 内容长度帧），与严格 MCP host 的兼容性存在风险。
   - 发送端按换行输出 JSON：`adapters/mcp/agentmb_mcp.py:44`-`47`
   - 接收端按逐行读取并 `json.loads(line)`：`adapters/mcp/agentmb_mcp.py:249`-`260`

### 必要测试验证
- `python3 -m pytest tests/e2e/test_r07c03.py -q`：通过（`18 passed in 21.97s`）
  - 注：首次独立执行在未先构建 `dist` 的情况下出现 404（环境步骤问题）；在完成构建后复跑为全通过。
- `bash scripts/verify.sh`：通过（`15/15`）
  - `r07c03` gate：`18 passed in 14.09s`

### 结论
- **Go/No-Go**：`No-Go`
- **是否可进入下一轮开发**：`否`
- 说明：尽管验证门禁全绿，但 `Recipe` 对异步 step 的行为与文档承诺不一致且会静默误报成功，属于 P1 语义缺陷，建议修复后再放行。

---

## R07-c03-fix 复评（基线 `3a48c57` → 目标 `4793181`，当前头 `37c7114` 已包含）
- **评审日期**：`2026-02-27`
- **评审轮次**：`R07`
- **评审批次**：`r07-c03-fix-review`
- **评审分支**：`review/codex-r07`
- **代码审查范围**：`3a48c57..4793181`
- **目标提交（SHA）**：`4793181`

### Findings（按严重级别）
#### P0
- 无

#### P1
- 无

#### P2
1. `Recipe.run()` 文档写明会抛出 `TypeError`，但实现已改为“记录 step error 并返回 `RecipeResult`”，文档与行为不一致。
   - 文档位置：`sdk/python/agentmb/recipe.py:200`-`203`
   - 实现位置：`sdk/python/agentmb/recipe.py:232`-`238`

### 重点验证
1. Recipe async step 正确 await（不再 coroutine 假成功）
   - `Recipe` 对 async step 不再静默成功：检测协程并转为 error（`sdk/python/agentmb/recipe.py:219`-`226`）
   - `AsyncRecipe` 新增并对 async step 执行 `await`（`sdk/python/agentmb/recipe.py:303`-`321`）
   - 运行证据：`tests/e2e/test_r07c03.py` 中 `T-RC-05/T-RC-06` 通过；额外脚本验证输出 `sync_ok False` 与 `async_ok True`。

2. MCP adapter I/O 协议兼容性改动
   - I/O 改为二进制 UTF-8 读写，避免 locale/CRLF 文本模式问题：
     - 输出：`adapters/mcp/agentmb_mcp.py:44`-`49`
     - 输入：`adapters/mcp/agentmb_mcp.py:251`-`260`
   - 运行证据：`initialize` + `tools/list` 请求可正常返回 JSON-RPC 响应。

3. annotated screenshot 转义与 storage restore 文档说明
   - Annotated screenshot：
     - label/颜色转义与净化已加入（`src/browser/actions.ts:220`-`235`）
     - e2e `T-AS-04`（特殊字符标签）通过。
   - storage restore：
     - 接口返回 `origins_skipped` 并附注释说明限制（`src/daemon/routes/state.ts:86`-`106`）
     - SDK 文档与模型同步补充（`sdk/python/agentmb/client.py:655`-`666`，`sdk/python/agentmb/models.py:435`-`445`）
     - e2e `T-SS-03`（origins 被跳过）通过。

### 必要测试验证
- `python3 -m pytest tests/e2e/test_r07c03.py -q`：通过（`18 passed in 21.97s`）
- `bash scripts/verify.sh`：通过（`15/15`）
  - `r07c03` gate：`18 passed in 14.09s`

### 结论
- **Go/No-Go**：`Go`
- **是否可进入下一轮开发**：`是`
- 说明：本次修复已覆盖上轮关键阻断点（Recipe async 假成功），并完成 MCP I/O 与转义/文档一致性补强；无新增 P0/P1。

---

## R07-c04 评审（范围 `main...3976d43`，目标 `3976d43`）
- **评审日期**：`2026-02-27`
- **评审轮次**：`R07`
- **评审批次**：`r07-c04`
- **评审分支**：`feat/r07-next`
- **代码审查范围**：`main...3976d43`
- **重点检查**：`interaction/browser_control/actions dual-track`、`CLI 映射`、`Python SDK 一致性`、`回归风险`

### Findings（按严重级别）
#### P0
- 无

#### P1
1. `bbox(ref_id=...)` 在 `interaction` 路由中存在 `ref_id -> snapshot element` 的索引偏移，导致 `e1` 解析成数组下标 `1`，单元素快照会直接 404，多元素快照会偏到错误元素。
   - `snapshot_map` 生成格式为 `...:eN`：`src/daemon/routes/actions.ts:804`
   - `bbox` 解析逻辑使用 `parseInt(...:eN)` 后直接 `snap.elements[elemIdx]`：`src/daemon/routes/interaction.ts:111`-`113`
   - 证据（定向重放）：
     - 输入：`ref=snap_demo:e1`
     - 解析：`elemIdx=1`
     - 取值：`snap.elements[1] -> null`（单元素场景）
   - 影响：会破坏 T20 声明的 `ref→bbox→input` 管线稳定性，属于功能性缺陷。

#### P2
1. `bbox` 的 `ref_id` 失效语义与主 action resolver 不一致：
   - 主 resolver 对失效 ref 返回 `409 stale_ref`（`src/daemon/routes/actions.ts:174`-`185`）
   - `interaction/bbox` 在 snapshot 缺失场景返回 `404`（`src/daemon/routes/interaction.ts:102`-`105`）
   - 影响：调用方针对 stale_ref 的统一恢复策略（重取 snapshot_map）难以复用。

### 复现步骤（bbox/ref_id 风险）
1. 阅读 `snapshot_map` 输出约定：`ref_id = ${snapshotId}:eN`（N 从 1 开始）。
2. 对照 `interaction/bbox` 代码路径：`elemIdx = parseInt(ref_id.split(':e')[1])`，随后直接访问 `snap.elements[elemIdx]`。
3. 以 `ref_id=e1` 的最小场景重放，`elemIdx=1`，对长度为 1 的 `elements` 会越界，导致 not found。

### 必要测试验证
- `python3 -m pytest tests/e2e/test_r07c04.py -q`：通过（`22 passed, 1 skipped`）
- `bash scripts/verify.sh`：通过（`16/16`）
  - 关键 gate：
    - `policy`：`11 passed`
    - `r07c02`：`24 passed`
    - `r07c03`：`22 passed`
    - `r07c04`：`22 passed, 1 skipped`

### 最小修复建议
1. 在 `interaction/bbox` 中将 `eN` 转为数组下标时改为 `N - 1`，并保留非法值防御（`N < 1` 返回 400）。
2. 将 snapshot 缺失场景统一为 `409 stale_ref`，与 actions resolver 语义一致。
3. 增加一条 e2e：`bbox(ref_id=e1)` 在单元素页面应返回 `found=true`（避免回归）。

### 结论
- **Go/No-Go**：`No-Go`
- **是否可进入下一轮开发**：`否`
- 说明：门禁测试虽通过，但 `bbox/ref_id` 的 P1 解析偏移会在真实 `ref→bbox` 流程中返回错误结果或 404，建议修复后再进入下一轮。

---

## R07-c04-fix 复评（目标 `f5b7bda`，feat/r07-next）
- **评审日期**：`2026-02-27`
- **评审轮次**：`R07`
- **评审批次**：`r07-c04-fix`
- **代码审查范围**：`3976d43..f5b7bda`
- **重点验证**：上轮 P1（`interaction/bbox` 的 `ref_id=eN` off-by-one）与 stale_ref 语义对齐

### Findings（按严重级别）
#### P0
- 无

#### P1
- 无

#### P2
- 无

### 复现与证据
1. 上轮 P1 `off-by-one` 修复确认
   - 修复前问题路径：`ref_id=e1` 被当作数组下标 `1` 访问。
   - 修复后实现：
     - `ref_id` 拆分后直接使用 `eid` 构造 selector，不再做数组索引：`src/daemon/routes/interaction.ts:104`-`130`
     - `eN` 输入校验新增：`src/daemon/routes/interaction.ts:106`-`110`
   - 回归测试证据（已纳入 `test_r07c04`）：
     - `T-BB-05`：`bbox(ref_id=e1)` 单元素页面应 `found=True`
     - `T-BB-06/07`：非法 `ref_id` 返回 `400`

2. stale_ref 语义对齐确认
   - snapshot 缺失改为 `409 stale_ref`：`src/daemon/routes/interaction.ts:114`-`117`
   - page_rev 不一致返回 `409 stale_ref` 且字段与 actions resolver 对齐：`src/daemon/routes/interaction.ts:118`-`127`
   - 回归测试证据（已纳入 `test_r07c04`）：
     - `T-BB-08`：missing snapshot -> `409 stale_ref`
     - `T-BB-09`：页面变化后旧 ref -> `409 stale_ref`

### 必要测试验证
- `python3 -m pytest tests/e2e/test_r07c04.py -q`：通过（`27 passed, 1 skipped`）
- `bash scripts/verify.sh`：通过（`16/16`）
  - `r07c04` gate：`27 passed, 1 skipped`

### 结论
- **Go/No-Go**：`Go`
- **是否可进入下一轮开发**：`是`
- 说明：上轮阻断项（P1 off-by-one + stale_ref 语义不一致）在代码与回归用例层面均已闭环，且全量门禁通过。

---

## 版本升级复评（`beb3511`，发布 `0.1.1`）
- **评审日期**：`2026-02-27`
- **评审类型**：版本升级复评
- **目标提交（SHA）**：`beb3511`
- **范围**：版本号与版本曝光面一致性（npm / Python SDK / CLI / health / MCP）

### Findings（按严重级别）
#### P0
- 无

#### P1
- 无

#### P2
- 无

### 指定验证执行结果
1. `npm run build`
   - 结果：通过（TypeScript 编译成功）。
2. `python3 -m pytest tests/e2e/test_smoke.py -q`
   - 结果：通过（`15 passed in 15.08s`）。
3. `bash scripts/verify.sh`
   - 结果：通过（`16/16` gate 全通过）。
   - 其中 `r07c04` gate：`27 passed, 1 skipped`。

### 版本一致性核验（npm / python / health）
- `package.json`（npm）：`0.1.1`
- `sdk/python/agentmb/__init__.py`（Python SDK）：`0.1.1`
- `GET /health`（daemon runtime）：`0.1.1`
- 结论：三端版本一致，均为 `0.1.1`。

### 结论
- **Go/No-Go**：`Go`
- **是否可进入下一轮开发**：`是`
- 说明：版本升级提交 `beb3511` 的编译、回归门禁和版本一致性检查均通过，满足放行条件。

---

## R08-c01 评审（claude 提交 `193246a`）
- **评审日期**：`2026-02-27`
- **评审轮次**：`R08`
- **评审批次**：`r08-c01`
- **目标提交（SHA）**：`193246a`
- **代码审查范围**：`193246a^..193246a`
- **重点范围**：
  1. `--element-id` parity（`press/type/hover`）
  2. `--ref-id` 贯通（CLI/daemon/sdk）
  3. `verify + e2e` 新增用例

### Findings（按严重级别）
#### P0
- 无

#### P1
- 无

#### P2
- 无

### 代码审查证据
1. `--element-id` parity 已补齐到 `press/type/hover`
   - CLI 增加目标标识选项并透传：`src/cli/commands/actions.ts:132`-`215`
   - daemon route body 类型支持 `ref_id`/`element_id`：`src/daemon/routes/actions.ts:328`-`401`
   - Python SDK sync/async 方法签名支持 `selector|element_id|ref_id`：`sdk/python/agentmb/client.py:190`-`221`、`sdk/python/agentmb/client.py:964`-`995`

2. `--ref-id` 已贯通到核心命令链路
   - CLI 覆盖 click/fill/press/type/hover/get/assert/bbox：`src/cli/commands/actions.ts:73`-`886`
   - daemon 侧通过既有 `resolveTarget` 统一解析 `ref_id`：`src/daemon/routes/actions.ts:154`-`194`
   - SDK 支持以 `ref_id` 调用对应接口：`sdk/python/agentmb/client.py:190`-`221`、`sdk/python/agentmb/client.py:964`-`995`

3. 新增 e2e 与 verify gate
   - 新增 `tests/e2e/test_r08c01.py`，覆盖 element_id/ref_id 及 stale_ref：`tests/e2e/test_r08c01.py:1`-`230`
   - `scripts/verify.sh` 新增 `r08c01` gate（总门数 17）：`scripts/verify.sh:20`-`116`

### 测试结果
1. 指定新增用例
   - `python3 -m pytest tests/e2e/test_r08c01.py -q`
   - 结果：`15 passed in 30.21s`

2. 全量门禁
   - `bash scripts/verify.sh`
   - 结果：`ALL GATES PASSED (17/17)`
   - 关键新增 gate：`r08c01 = 15 passed in 2.98s`

### 结论
- **Go/No-Go**：`Go`
- **是否可进入下一轮开发**：`是`
- 说明：本次目标范围内的 CLI/daemon/sdk 贯通与回归测试均通过，未发现 P0/P1/P2 阻断问题。

---

## R08-c02 评审（claude 提交 `17d1e1b`）
- **评审日期**：`2026-02-27`
- **评审轮次**：`R08`
- **评审批次**：`r08-c02`
- **目标提交（SHA）**：`17d1e1b`
- **重点验证范围**：
  1. T02 `scroll observability`
  2. T04 `click diagnostics/contenteditable`
  3. T07 `download accept_downloads guard`
  4. T08 `download --element-id/--ref-id`
  5. T09 `upload MIME inference`

### Findings（按严重级别）
#### P0
- 无

#### P1
- 无

#### P2
- 无

### 关键审查证据
1. T02 `scroll observability`
   - `scroll` 返回结构新增 `scrolled` / `warning` / `scrollable_hint`，并在未滚动时给出提示：`src/browser/actions.ts:802`-`889`
   - SDK 模型与方法返回同步为 `ScrollResult`：`sdk/python/agentmb/models.py:33`-`53`，`sdk/python/agentmb/client.py:512`-`523`

2. T04 `click diagnostics/contenteditable`
   - `Actions.click` 补充 try/catch，失败时抛 `ActionDiagnosticsError`，由路由返回 422 诊断信息而非 opaque 500：`src/browser/actions.ts:74`-`91`

3. T07 `download accept_downloads guard`
   - daemon download 路由在未开启 `accept_downloads` 时返回 `422 download_not_enabled`：`src/daemon/routes/actions.ts:486`-`508`

4. T08 `download --element-id/--ref-id`
   - CLI `download` 支持 `--element-id/--ref-id` 并透传：`src/cli/commands/actions.ts:267`-`305`
   - daemon download body 支持 `selector|element_id|ref_id` 并统一走 `resolveTarget`：`src/daemon/routes/actions.ts:491`-`513`
   - Python SDK `download` 支持 `selector|element_id|ref_id`：`sdk/python/agentmb/client.py:257`-`266`、`sdk/python/agentmb/client.py:1038`-`1047`

5. T09 `upload MIME inference`
   - CLI 按扩展名推断 MIME，可被显式 `--mime-type` 覆盖：`src/cli/commands/actions.ts:10`-`35`、`254`-`273`
   - Python SDK sync/async 在未传 `mime_type` 时自动 `mimetypes.guess_type`：`sdk/python/agentmb/client.py:241`-`253`、`1022`-`1036`
   - upload 响应回传 `mime_type`：`src/browser/actions.ts:452`-`468`，`sdk/python/agentmb/models.py:132`-`138`

### 测试结果
1. 关键新增用例
   - `python3 -m pytest tests/e2e/test_r08c02.py -q`
   - 结果：`15 passed in 24.07s`

2. 全量回归
   - `bash scripts/verify.sh`
   - 结果：`ALL GATES PASSED (18/18)`
   - 新增 gate：`r08c02 = 15 passed in 8.19s`

### 结论
- **Go/No-Go**：`Go`
- **是否可进入下一轮开发**：`是`
- 说明：T02/T04/T07/T08/T09 的代码与回归证据一致，未发现阻断级问题，可放行。

---

## R08-c03 评审（claude 提交 `49fd32d`）
- **评审日期**：`2026-02-28`
- **评审轮次**：`R08`
- **评审批次**：`r08-c03`
- **目标提交（SHA）**：`49fd32d`
- **评审范围**：T03（synthesized label）+ T05（`--include-unlabeled` + docs）
- **端口隔离执行环境**：`AGENTMB_PORT=19357`，`AGENTMB_DATA_DIR=/tmp/agentmb-codex`

### Findings（按严重级别）
#### P0
- 无

#### P1
- 无

#### P2
- 无

### 代码一致性核对（CLI/API/SDK/README）
1. API 侧支持 `include_unlabeled` 并透传到 element/snapshot map：
   - `src/daemon/routes/actions.ts:535`-`541`
   - `src/daemon/routes/actions.ts:809`-`816`
2. 核心标签合成链路与 fallback 逻辑完整：
   - `src/browser/actions.ts:497`-`573`
   - 优先级：`aria-label > title > aria-labelledby > svg-title > text > placeholder`
   - `include_unlabeled=true` 时 fallback：`[tag @ x,y]`，`label_source='fallback'`
3. CLI 暴露 `--include-unlabeled` 且输出 `label_source`：
   - `src/cli/commands/actions.ts:368`-`389`
   - `src/cli/commands/actions.ts:457`-`480`
4. Python SDK 参数与模型字段同步：
   - `sdk/python/agentmb/client.py:334`-`367`（`element_map`）
   - `sdk/python/agentmb/client.py:456`-`483`（`snapshot_map`）
   - `sdk/python/agentmb/models.py:258`-`273`、`324`-`340`（`label`/`label_source`）
5. README 对三种 targeting 模式和 map/snapshot 用法描述一致：
   - `README.md:116`-`149`

### 定向复现证据（icon-only + include_unlabeled）
在 `19357` 端口启动 daemon 后，构造一个 icon-only button + 一个 `aria-label="Save"` button 页面，调用 API：
1. `element_map` 默认：
   - `('e1', '', 'none')`
   - `('e2', 'Save', 'aria-label')`
2. `element_map` with `include_unlabeled=true`：
   - `('e1', '[button @ 24,19]', 'fallback')`
   - `('e2', 'Save', 'aria-label')`
3. `snapshot_map` with `include_unlabeled=true`：
   - `('snap_d41a004c:e1', '[button @ 24,19]', 'fallback')`
   - `('snap_d41a004c:e2', 'Save', 'aria-label')`

### 必要回归结果
1. 专项用例：
   - `AGENTMB_PORT=19357 AGENTMB_DATA_DIR=/tmp/agentmb-codex python3 -m pytest tests/e2e/test_r08c03.py -q`
   - 结果：`16 passed`
2. verify 门禁：
   - `AGENTMB_PORT=19357 AGENTMB_DATA_DIR=/tmp/agentmb-codex bash scripts/verify.sh`
   - 结果：`ALL GATES PASSED (19/19)`
   - 关键新增 gate：`r08c03 = 16 passed`

### 结论
- **Go/No-Go**：`Go`
- **是否可进入下一轮开发**：`是`
- 说明：T03/T05 目标行为、接口一致性与回归门禁均通过，未发现 P0/P1/P2 阻断项。

---

## R08-c04 评审（claude 提交 `ddfb597`）
- **评审日期**：`2026-02-28`
- **评审轮次**：`R08`
- **评审批次**：`r08-c04`
- **目标提交（SHA）**：`ddfb597`
- **评审范围**：R08-R03 / R08-R04（`scroll_until` / `load_more_until` + `mouse` / `drag` primitives）
- **端口隔离执行环境**：`AGENTMB_PORT=19357`，`AGENTMB_DATA_DIR=/tmp/agentmb-codex`

### Findings（按严重级别）
#### P0
- 无

#### P1
- 无

#### P2
1. README 与 CLI/API/SDK 在 `drag ref_id` 能力上存在文档不一致（非阻断）
   - 现状：CLI/API/SDK 已支持 `source_ref_id`/`target_ref_id`
     - `src/cli/commands/actions.ts:592`-`599`
     - `src/daemon/routes/actions.ts:686`-`691`
     - `sdk/python/agentmb/client.py:553`-`561`、`1288`-`1296`
   - 但 README 仍描述 drag 为 selectors-only：
     - `README.md:268`
   - 风险：用户按文档无法发现 `--source-ref-id/--target-ref-id` 能力，影响可用性与自助排障效率。

### 代码一致性核对（CLI/API/SDK/README）
1. CLI：`drag` 新增 `--source-ref-id/--target-ref-id` 并正确组包。
2. API：`/drag` route 新增 `source_ref_id/target_ref_id`，且通过 `resolveTarget()` 复用 stale_ref 语义。
3. SDK：
   - `Session.drag()` 新增 `source_ref_id/target_ref_id`
   - `AsyncSession` 新增 `drag/mouse_move/mouse_down/mouse_up`
   - `AsyncSession.scroll_until()` 新增 `scroll_selector`，与 sync 侧参数对齐。
4. README：存在上述 P2 文档偏差；其余 `scroll-until/load-more-until/mouse` 说明与实现一致。

### 必要回归结果
1. 专项用例：
   - `AGENTMB_PORT=19357 AGENTMB_DATA_DIR=/tmp/agentmb-codex python3 -m pytest tests/e2e/test_r08c04.py -q`
   - 结果：`18 passed`
2. verify 门禁：
   - `AGENTMB_PORT=19357 AGENTMB_DATA_DIR=/tmp/agentmb-codex bash scripts/verify.sh`
   - 结果：`ALL GATES PASSED (20/20)`
   - 关键 gate：`r08c04 = 18 passed`

### 结论
- **Go/No-Go**：`Go`
- **是否可进入下一轮开发**：`是`
- 说明：功能与回归验证通过；仅存在一项文档一致性 P2，建议后续补充 README 的 drag ref_id 用法说明。

---

## R08-c05 评审（claude 提交 `41debd2`）
- **评审日期**：`2026-02-28`
- **评审轮次**：`R08`
- **评审批次**：`r08-c05`
- **目标提交（SHA）**：`41debd2`
- **评审范围**：R08-R12 / R08-R05 / R08-R06 / R08-R02 / R08-R09
- **端口隔离执行环境**：`AGENTMB_PORT=19357`，`AGENTMB_DATA_DIR=/tmp/agentmb-codex`

### Findings（按严重级别）
#### P0
- 无

#### P1
1. `wait_dom_stable_ms` 的 timeout 传参位置错误，稳定性等待可能不按预期生效
   - 代码现状：`page.waitForFunction('document.readyState === "complete"', { timeout: opts.wait_dom_stable_ms })`
   - 位置：`src/daemon/routes/actions.ts:177`
   - 风险：该调用把 `{ timeout: ... }` 作为 `arg` 传入而非 options，`wait_dom_stable_ms` 约束可能失效；在慢页场景下稳定性策略行为与接口语义不一致。

2. `executor='auto_fallback'` 在 frame 目标场景回退路径使用了错误上下文
   - 代码现状：高层点击使用 `target`（支持 frame），但 fallback bbox 固定走 `s.page.locator(selector)`。
   - 位置：`src/daemon/routes/actions.ts:297`、`src/daemon/routes/actions.ts:301`、`src/daemon/routes/actions.ts:308`
   - 风险：当 `frame` 指向 iframe 且高层点击失败时，低层 fallback 可能无法定位到 iframe 内元素，导致 dual-track 在关键场景退化为单轨失败。

#### P2
1. CLI/README 与 API/SDK 在新增能力上的可见性不一致（非阻断）
   - `click/fill` 新增 `executor/stability` 仅在 API/SDK 暴露，CLI 暂无对应参数：
     - `src/daemon/routes/actions.ts:286`-`287`、`337`
     - `sdk/python/agentmb/client.py:77`-`95`、`97`-`113`
     - `src/cli/commands/actions.ts:100`-`124`
   - `mouse_move` 新增 `ref_id/element_id/selector` 仅在 API/SDK 暴露，CLI 仍仅坐标模式：
     - `src/daemon/routes/actions.ts:776`-`789`
     - `sdk/python/agentmb/client.py:577`-`588`
     - `src/cli/commands/actions.ts:608`-`613`
   - README 未覆盖上述新增参数能力（仍是旧描述）：
     - `README.md:259`-`261`、`289`

### 重点核对结论（你指定的 5 项）
1. page_rev / stale suggestions：
   - `GET /api/v1/sessions/:id/page_rev` 已新增：`src/daemon/routes/actions.ts:922`-`927`
   - stale_ref 409 响应新增 `suggestions`：`src/daemon/routes/actions.ts:217`-`233`
2. Ref->Box->Input：
   - `mouse_move` 已支持 `ref_id/element_id/selector -> bbox center`：`src/daemon/routes/actions.ts:775`-`790`
3. dual-track executor：
   - `click` 支持 `executor='auto_fallback'` 并返回 `executed_via`：`src/daemon/routes/actions.ts:276`-`315`
4. stability 参数：
   - `click/fill` 接收 `stability`，并在前后执行等待：`src/daemon/routes/actions.ts:299`、`313`、`348`-`350`
5. preflight 校验：
   - `timeout_ms` 范围与 `fill value` 长度校验已落地：`src/daemon/routes/actions.ts:150`-`164`、`293`、`342`

### 必要回归结果
1. 专项用例：
   - `AGENTMB_PORT=19357 AGENTMB_DATA_DIR=/tmp/agentmb-codex python3 -m pytest tests/e2e/test_r08c05.py -q`
   - 结果：`24 passed`
2. verify 门禁：
   - `AGENTMB_PORT=19357 AGENTMB_DATA_DIR=/tmp/agentmb-codex bash scripts/verify.sh`
   - 结果：`ALL GATES PASSED (21/21)`
   - 关键新增 gate：`r08c05 = 24 passed`

### 结论
- **Go/No-Go**：`No-Go`
- **是否可进入下一轮开发**：`否`
- 说明：虽然回归门禁全绿，但存在 2 个 P1（stability timeout 语义与 dual-track frame fallback 一致性）会在真实复杂页面场景产生行为偏差，建议先修复再放行。

---

## R08-c06 评审（claude 提交 `a1cba3c`）
- **评审日期**：`2026-02-28`
- **评审轮次**：`R08`
- **评审批次**：`r08-c06`
- **目标提交（SHA）**：`a1cba3c`
- **评审范围**：R08-R01/R08-R08/R08-R10/R08-R13/R08-R14/R08-R15/R08-R11/R08-R16/R08-R17/R08-R18
- **端口隔离执行环境**：`AGENTMB_PORT=19357`，`AGENTMB_DATA_DIR=/tmp/agentmb-codex`

### Findings（按严重级别）
#### P0
- 无

#### P1
1. `run_steps` 的 `click` 分支对 `ref_id` 校验与实际解析不一致，`ref_id` 路径会落到无效 selector
   - 代码允许 `ref_id` 通过前置校验：
     - `src/daemon/routes/actions.ts:1073`
   - 但真正构造 selector 时只处理 `element_id/selector`，忽略 `ref_id`：
     - `src/daemon/routes/actions.ts:1074`-`1075`
   - 风险：批处理步骤传 `{"action":"click","params":{"ref_id":"snap_xxx:e1"}}` 时会触发运行时错误（而不是按 `ref_id` 正常定位），与 R08-R18 的批处理语义不一致。

#### P2
1. README/CLI/SDK 暴露面不一致（非阻断）
   - SDK 已暴露 R08-c06 新能力（`find/get_settings/delete_cookie/upload_url/run_steps` 等）：
     - `sdk/python/agentmb/client.py:874`-`939`
   - CLI 当前未提供对应命令入口，且现有命令未覆盖新增参数（如 `fill_strategy/char_delay_ms`、`mouse_move steps`、`scroll_until step_delay_ms`）：
     - `src/cli/commands/actions.ts:99`-`126`
     - `src/cli/commands/actions.ts:727`-`746`
   - README 仍以旧命令表述为主，未同步上述新能力：
     - `README.md:255`-`292`

### 核对结论（README / CLI / SDK）
1. API 与 SDK 在本批新增能力上总体对齐（语义查询、会话 settings、profile 生命周期、cookie 删除、upload_url、run_steps 均有对应）。
2. CLI 与 README 对 R08-c06 新能力暴露不足，存在 discoverability 缺口（见 P2）。

### 必要回归结果
1. 专项用例：
   - `AGENTMB_PORT=19357 AGENTMB_DATA_DIR=/tmp/agentmb-codex python3 -m pytest tests/e2e/test_r08c06.py -q`
   - 结果：`30 passed`
2. verify 门禁：
   - `AGENTMB_PORT=19357 AGENTMB_DATA_DIR=/tmp/agentmb-codex bash scripts/verify.sh`
   - 结果：`ALL GATES PASSED (22/22)`
   - 关键新增 gate：`r08c06 = 30 passed`

### 结论
- **Go/No-Go**：`No-Go`
- **是否可进入下一轮开发**：`否`
- 说明：回归门禁虽通过，但 `run_steps` 中 `click+ref_id` 的实现缺陷属于功能正确性 P1，建议先修复再放行。

---

## R08-b2 增量评审（基线 `a1cba3c` → 目标 `fdba711`）
- **评审日期**：`2026-02-28`
- **评审轮次**：`R08`
- **评审批次**：`r08-b2`
- **评审分支**：`review/r08-reviewer-1`
- **基线提交（No-Go SHA）**：`a1cba3c`
- **目标提交（SHA）**：`fdba711`
- **代码审查范围**：`a1cba3c..fdba711`（4 commits: 524bf17、3db695e、c19eb66、fdba711）
- **端口隔离执行环境**：`AGENTMB_PORT=19357`，`AGENTMB_DATA_DIR=/tmp/agentmb-codex`

### 增量概览

| 提交 | 内容 |
|---|---|
| `524bf17` | docs(readme): full r08 feature coverage |
| `3db695e` | docs(readme): add Chromium stable + CDP mentions |
| `c19eb66` | feat(r08-c06-fix): three browser running modes + session seal + browser-launch helper |
| `fdba711` | feat(policy): align POLICY_PROFILES to agentmb-time-strategy R08 spec |

变更文件：`README.md`、`src/browser/manager.ts`、`src/cli/commands/browser-launch.ts`、`src/cli/commands/session.ts`、`src/cli/index.ts`、`src/daemon/index.ts`、`src/daemon/routes/sessions.ts`、`src/daemon/session.ts`、`src/policy/types.ts`、`sdk/python/agentmb/client.py`、`sdk/python/agentmb/models.py`、`tests/e2e/test_r08c06_modes.py`、`scripts/verify.sh`（注：**`src/daemon/routes/actions.ts` 不在增量中**）

### 三项核查结论

#### 1. [P1 复核] run_steps click ref_id — **未修复**
- 增量范围 `a1cba3c..fdba711` 中 `src/daemon/routes/actions.ts` **没有被修改**。
- r08-c06 No-Go 指出的缺陷代码仍然存在（`fdba711`）：
  ```typescript
  // src/daemon/routes/actions.ts:1072-1076
  case 'click': {
    if (!params.selector && !params.element_id && !params.ref_id) throw new Error(...)  // 接受 ref_id
    const sel = params.element_id ? `[data-agentmb-eid="..."]` : params.selector as string  // 忽略 ref_id
    result = await Actions.click(s.page, sel, ...)  // sel = undefined → 运行时错误
    break
  }
  ```
- 当 `run_steps` 步骤传入 `{"action":"click","params":{"ref_id":"snap_xxx:e1"}}` 时：校验通过 → `sel = undefined` → `Actions.click(s.page, undefined, ...)` → 运行时抛出 Playwright 错误。
- **结论：P1 未修复，阻断放行。**

#### 2. [P1 复核] click auto_fallback frame 偏移 — **已修复**
- r08-c05 No-Go 描述：fallback bbox 固定走 `s.page.locator(selector)`（忽略 frame context）。
- a1cba3c 已在 run_steps 之前的批次中修复为 `target.locator(selector).boundingBox()`，r08-c06 评审（a1cba3c）未将此项列为 P1，说明修复已落地。
- fdba711 对应代码（`actions.ts:327-334`，未被本次增量修改）：
  ```typescript
  const bbox = await target.locator(selector).boundingBox()  // ✓ 使用 target 而非 s.page
  const cx = Math.round(bbox.x + bbox.width / 2)
  const cy = Math.round(bbox.y + bbox.height / 2)
  await s.page.mouse.click(cx, cy)
  ```
- **结论：frame 偏移问题已修复，此项通过。**

#### 3. [策略对齐] POLICY_PROFILES vs agentmb-time-strategy R08 — **已对齐**

对照 researcher 设计文档 (`agentmb-time-strategy.md`)：

| 策略项 | researcher 文档 | fdba711 实现 | 对齐 |
|---|---|---|---|
| `permissive.domainMinIntervalMs` | 50ms | 50ms | ✓ |
| `permissive.jitterMs` | [0, 50] | [0, 50] | ✓ |
| `permissive.maxActionsPerMinute` | 200 | 200 | ✓ |
| `permissive.allowSensitiveActions` | 允许 | true | ✓ |
| `safe.domainMinIntervalMs` | 200ms | 200ms | ✓ |
| `safe.jitterMs` | [100, 300] | [100, 300] | ✓ |
| `safe.maxActionsPerMinute` | 60 | 60 | ✓ |
| `safe.allowSensitiveActions` | 强制拦截 | false | ✓ |

- **结论：POLICY_PROFILES 与 researcher 设计完全对齐。**

### 新增功能核查（c19eb66 — 三模式实现）

| 功能 | 实现路径 | 评估 |
|---|---|---|
| Pure Sandbox (ephemeral) | `manager.ts:sessionEphemeralDirs` + `os.tmpdir()` + `rmSync` on close | ✓ 完整 |
| Managed Stable Chrome (channel/path) | `launchPersistentContext` 接收 `channel`/`executablePath` | ✓ 完整 |
| CDP Attach (connectOverCDP) | `attachCdpSession()` + `sessionCdpBrowsers` + disconnect-only close | ✓ 完整 |
| Preflight validation | `browser_channel ⊕ executable_path`、`launch_mode=attach → cdp_url required`、URL 格式 | ✓ 完整 |
| Session Seal | `registry.seal()` + DELETE 423 guard | ✓ 完整 |
| `shutdownAll()` | CDP disconnect → ephemeral cleanup → registry shutdown | ✓ 完整 |

### 执行记录

```
git checkout review/r08-reviewer-1          # 已在评审分支
git merge --no-edit fdba711                 # Already up to date
npm run build                               # PASS (tsc 无报错)
AGENTMB_PORT=19357 AGENTMB_DATA_DIR=/tmp/agentmb-codex bash scripts/verify.sh
# → ALL GATES PASSED (23/23)
# → r08c06-modes: 10 passed
```

### Findings（P0/P1/P2）

#### P0
- 无

#### P1
1. `run_steps` click 分支 `ref_id` 仍未解析（r08-c06 No-Go P1 未修复）
   - 文件：`src/daemon/routes/actions.ts:1073-1075`
   - `a1cba3c..fdba711` 增量未涉及此文件
   - 复现：`run_steps` 步骤传 `{"action":"click","params":{"ref_id":"snap_xxx:e1"}}` → `sel=undefined` → 运行时错误

#### P2
1. CLI 对 R08-c06 新能力（`find`、`get_settings`、`delete_cookie`、`upload_url`、`run_steps`、`fill_strategy`、`char_delay_ms`）仍无对应命令入口（延续 r08-c06 P2，非新增）

### 结论
- **Go/No-Go**：`No-Go`
- **是否可进入下一轮开发**：`否`
- 说明：三项核查中，POLICY_PROFILES 对齐（通过）、auto_fallback frame 偏移（已修复通过）、run_steps click ref_id（未修复，P1 阻断）。`src/daemon/routes/actions.ts` 的 `run_steps` click 分支需补充 `ref_id` 解析逻辑（参照 `resolveTarget` 函数），修复后再复评。

---

## R08-b3 增量评审（基线 `fdba711` → 目标 `4b16fa3`）
- **评审日期**：`2026-02-28`
- **评审轮次**：`R08`
- **评审批次**：`r08-b3`
- **评审分支**：`review/r08-reviewer-1`
- **基线提交（No-Go SHA）**：`fdba711`
- **目标提交（SHA）**：`4b16fa3`
- **代码审查范围**：`fdba711..4b16fa3`（单次提交 `feat(r08-c07)`）
- **端口隔离执行环境**：`AGENTMB_PORT=19357`，`AGENTMB_DATA_DIR=/tmp/agentmb-codex`

### 增量概览

| 文件 | 变更 |
|---|---|
| `src/daemon/routes/actions.ts` | `resolveRefIdForStep()` 新增 + run_steps 全部 action 切换使用 + auto_fallback frame 偏移补偿 |
| `src/cli/commands/actions.ts` | `fill --fill-strategy/--char-delay-ms`；`mouse-move` 支持 selector/element-id/ref-id/--steps；`scroll-until --step-delay-ms`；`find`/`settings`/`cookie-delete`/`run-steps` 新命令 |
| `scripts/verify.sh` | TOTAL 23→24；新增 `r08c07` gate |
| `tests/e2e/test_r08c07.py` | 19 个 e2e 用例 |
| `agentops/reports/r08-c07-dev-summary.md` | 开发总结归档 |

### 两项 P1 复核结论

#### 1. [P1 修复] run_steps 全系列 action 对 ref_id 的完整支持 — **已修复 ✓**

新增 `resolveRefIdForStep()` 函数（`actions.ts:1059-1083`），独立于 HTTP reply 的纯函数版本：
- 从 `BrowserManager.getSnapshot()` 拉取 snapshot，校验 `page_rev` 一致性（stale_ref 检测）
- 返回 `[data-agentmb-eid="${eid}"]`，与 `resolveTarget()` 的主路径语义一致
- `run_steps` 的所有元素定位 action（`click`/`fill`/`type`/`press`/`hover`/`scroll`）均切换为 `resolveRefIdForStep(params, s.id)`
- stale_ref 场景抛出带明确提示的 Error，被 step 循环捕获后填入 `results[i].error` 并按 `stop_on_error` 策略处理

关键路径（`actions.ts`）：

```typescript
// 1059-1083
function resolveRefIdForStep(params, sessionId): string {
  if (params.ref_id) {
    // snapshot 存在性检查 → page_rev 一致性检查 → 返回 eid selector
    return `[data-agentmb-eid="${eid}"]`
  }
  if (params.element_id) return `[data-agentmb-eid="${params.element_id}"]`
  return params.selector as string
}
// 1107-1108
case 'click': {
  const sel = resolveRefIdForStep(params, s.id)  // ← 修复核心
  result = await Actions.click(s.page, sel, ...)
```

**结论：P1 完整修复，ref_id 路径在 run_steps 所有 action 分支均正确解析。**

#### 2. [P1 修复] auto_fallback frame 场景点击精度补偿 — **已补强 ✓**

r08-b2 评审确认 a1cba3c 已将 `s.page.locator` 改为 `target.locator`（解决了 fallback 定位到 frame 内元素的问题）。本次增量进一步补充 frame offset 补偿（`actions.ts:335-344`）：

```typescript
if (frame && target !== s.page) {
  const frameRect = await (target as Frame).evaluate<{x:number;y:number}>(
    '(() => { const el = window.frameElement; ... el.getBoundingClientRect(); return {x,y} })()'
  )
  cx += Math.round(frameRect.x)
  cy += Math.round(frameRect.y)
}
```

- `Frame` 类型已正确导入（`actions.ts:7`：`import { BrowserContext, Page, Frame } from 'playwright-core'`）
- `best-effort` 设计：frame offset 获取失败时静默降级，不影响主流程
- 适用条件：`frame && target !== s.page`，主页面场景（`frame=null`）不触发，无副作用

**结论：P1 已修复且做了 best-effort 降级保护，frame 内元素 auto_fallback 精度补偿完整。**

### CLI 补齐核查（r08-c06 P2 对应修复）

| 能力 | 修复前 | 修复后 |
|---|---|---|
| `fill --fill-strategy/--char-delay-ms` | 缺失 | ✓ CLI 透传 `fill_strategy/char_delay_ms` |
| `mouse-move` selector/ref-id/steps | 仅坐标 | ✓ 支持 `--selector/--element-id/--ref-id/--steps` |
| `scroll-until --step-delay-ms` | 缺失 | ✓ CLI 透传 `step_delay_ms` |
| `find` 语义搜索命令 | 缺失 | ✓ 新命令 `find <session> <query-type> <query>` |
| `settings` 会话设置命令 | 缺失 | ✓ 新命令 `settings <session>` |
| `cookie-delete` 命令 | 缺失 | ✓ 新命令 `cookie-delete <session> <name>` |
| `run-steps` 批处理命令 | 缺失 | ✓ 新命令 `run-steps <session> <steps-json>` |

r08-c06 P2（CLI 暴露面不足）已全部补齐。

### 执行记录

```
git checkout review/r08-reviewer-1          # 已在评审分支
git merge --no-edit 4b16fa3                 # Already up to date
npm run build                               # PASS (tsc 无报错)
AGENTMB_PORT=19357 AGENTMB_DATA_DIR=/tmp/agentmb-codex bash scripts/verify.sh
# → ALL GATES PASSED (24/24)
# → r08c07: 19 passed
```

### Findings（P0/P1/P2）

#### P0
- 无

#### P1
- 无（r08-b2 两项 P1 均已修复）

#### P2
- 无（r08-c06 P2 CLI 暴露面不足已在本批补齐）

### 结论
- **Go/No-Go**：`Go`
- **是否可进入下一轮开发**：`是`
- 说明：两项 P1 均已修复（`run_steps` 全系列 ref_id 解析 + auto_fallback frame offset 补偿），CLI 补齐覆盖 r08-c06 P2，构建通过，verify 门禁 24/24 全绿，满足放行条件。
