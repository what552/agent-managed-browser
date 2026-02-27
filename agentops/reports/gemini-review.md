# Gemini 评审报告

---

## R07-c02-fix 复评收口 (Gemini)
- **评审日期**: 2026-02-26
- **评审轮次**: R07
- **评审批次**: r07-c02-fix
- **目标 SHA**: `c7379e4`

### 结论: Go
本次复评确认了 r07-c02 遗留的 P1 风险（新页面 stale_ref 探测失效）及 P2 风险（CLI scroll 参数不一致）已完全修复。`src/browser/manager.ts` 现在会为所有通过 `createPage` 新创建的页面正确挂载 `framenavigated` 监听器，确保 `page_rev` 在导航时正常增长，从而使过期的 `ref_id` 能被准确识别为 409 stale_ref。CLI 层面的 `scroll` 参数名也已对齐后端 API（`delta_x/y`）。全量验证脚本 `scripts/verify.sh` (14/14 Gates) 100% 通过。

**定向复现验证 (Race Condition Check):**
- **验证目标**: 检查 `stale_ref` 是否存在偶发 500 错误（预期应为 409）。
- **验证方法**: 在隔离环境 (PORT 19638) 下循环执行 30 次 `test_stale_ref_after_new_page_navigation`。
- **验证命令**: `for i in {1..30}; do AGENTMB_PORT=19638 python3 -m pytest tests/e2e/test_r07c02.py::TestStaleRef::test_stale_ref_after_new_page_navigation -q; done`
- **验证结果**: **PASS=30, FAIL=0**。在当前并发/负载压力下，`stale_ref` 逻辑表现稳定，未观察到 500 漂移现象。

### P0 风险 (Must-Fix)
- **无**

### P1 风险 (Should-Fix)
- **无**（上一轮 P1 已关闭）

### P2 风险 (Minor)
- **无**

---

## R07-c02 交付评审 (Gemini)
- **评审日期**: 2026-02-26
- **评审轮次**: R07
- **评审批次**: r07-c02
- **目标 SHA**: `7669e3b`

### 结论: Go
本次评审（r07-c02）确认了 R07 迭代中关于“交互原语增强”与“快照版本化管理（Snapshot Map）”的核心能力已完整交付。系统现已支持双击、滚动、拖拽等复杂操作，并引入了 `ref_id` 机制配合 `page_rev` 计数器，实现了 409 stale_ref 过期引用自动检测，极大提升了 Agent 在动态页面上的操作稳健性。全量验证脚本 `verify.sh` 与 专项 E2E 测试 `test_r07c02.py` 均 100% 通过（37/37 总用例数）。

### P0 风险 (Must-Fix)
- **无**

### P1 风险 (Should-Fix)
1.  **无限循环风险**: `scrollUntil` 和 `loadMoreUntil` 缺乏全局超时保护。虽然设有 `max_scrolls/max_loads`，但在单步操作响应极慢的情况下，可能导致 Fastify 请求长期阻塞。建议增加单步超时或全局 Context 级联取消。
2.  **输入校验稳健性**: `src/daemon/routes/actions.ts` 中多处路由直接访问 `req.body` 且未对 `req.body` 整体做空值兼容，在某些极端空 Payload 请求下可能触发 500。

### P2 风险 (Minor)
1.  **快照内存 TTL**: `BrowserManager` 的快照存储仅实现了 LRU（容量为 5），但未实现基于时间的 TTL 清理。对于长期不活动的 Session，快照数据将持续驻留内存。

---

## R07-c01 复评收口 (Gemini)
- **评审日期**: 2026-02-26
- **评审轮次**: R07
- **评审批次**: r07-c01-fix
- **目标 SHA**: `9040294`

### 结论: Go
本次复评确认了上一轮提出的 P0 风险（测试脚本 API 故障）已完全修复。`test_element_map.py` 现已正确调用 `client.sessions.create()`。在隔离环境（PORT 19627）下的全量验证脚本 `scripts/verify.sh` 显示 13/13 Gates 全部通过（含 element-map 专项）。虽然 verify 结束后的独立 pytest 运行因 daemon 正常停止导致 503 报错，但 verify 过程中的日志已充分证明业务逻辑与新增功能（Element Map, Get/Assert, Wait Stable）的正确性。

### P0 风险 (Must-Fix)
- **无**（已关闭）

### P1 风险 (Should-Fix)
1.  **Shadow DOM 探测**: 维持上一轮意见，`elementMap` 对 Shadow DOM 内部元素的遮挡检测仍有优化空间。
2.  **SDK 方法重载**: Python SDK 的 `click` 和 `fill` 现已支持 `selector` 或 `element_id` 二选一，代码实现了参数互斥校验，接口一致性良好。

---

## R07-c01 交付评审 (Gemini)
- **评审日期**: 2026-02-26
- **评审轮次**: R07
- **评审批次**: r07-c01
- **目标 SHA**: `0aa00a5`

### 结论: No-Go (Conditional)
本次交付（r07-c01）初步实现了 R07 的核心能力：元素映射（Element Map）、读原语（Get/Assert）以及页面稳定性检测（Wait Stable）。然而，由于新引入的 E2E 测试脚本 `tests/e2e/test_element_map.py` 存在严重的 API 调用错误（P0），导致该模块的所有自动化验证均告失败。在修复测试脚本并确认功能逻辑通过全量验证前，不建议进入下一轮开发。

### P0 风险 (Must-Fix)
1.  **测试脚本 API 故障**: `tests/e2e/test_element_map.py` 错误地调用了不存在的 `client.create_session()` 方法，导致 `element-map` Gate 验证 100% 失败。需修正为 `client.sessions.create()`。

### P1 风险 (Should-Fix)
1.  **Shadow DOM 探测局限**: `elementMap` 在执行 `elementFromPoint` 探测遮挡时，无法准确处理 Shadow DOM 内部的元素，可能导致错误的 `overlay_blocked` 标记。
2.  **读原语超时开销**: `getProperty` 直接依赖 Playwright 默认的 5s 等待。对于频繁调用的读取操作，若元素缺失，累积的超时开销可能显著降低 Agent 响应速度。建议优化前置检查逻辑。

---

## R06-b3 交付评审 (Gemini)
- **评审日期**: 2026-02-26
- **评审轮次**: R06
- **评审批次**: r06-b3
- **目标 SHA**: `5c14f69`

### 结论: Go
本次评审（r06-b3）确认了上一轮（r06-b2）提出的策略覆盖（P1）及内存清理（P2）风险已全部闭环。`eval` 与 `extract` 路由现已纳入策略引擎管控。`PolicyEngine` 引入了基于 TTL 的懒清理机制（`maybeCleanupStaleDomains`），有效防止了长周期运行下的内存泄漏。此外，CLI 的 `pages close` 命令新增了交互式选择模式，显著提升了易用性。全量验证脚本（12/12 PASS）显示系统运行稳健。

### P0 风险 (Must-Fix)
- **无**

### P1 风险 (Should-Fix)
- **无**

### P2 风险 (Minor)
1.  **CLI 交互超时**: `pages close` 的交互式输入（readline）缺乏超时保护。若用户在命令行挂起，进程将持续阻塞。鉴于 CLI 属于本地工具，该风险评级为极低。

---

## R06-b2 交付评审 (Gemini)
- **评审日期**: 2026-02-26
- **评审轮次**: R06
- **评审批次**: r06-b2
- **目标 SHA**: `5b2edac`

### 结论: Go
本次评审（r06-b2）重点验证了“执行安全策略引擎（Policy Engine）”的实现。该引擎通过域名级隔离、抖动注入（Jitter）、滑动窗口限频（Rate Limit）及重试预算（Retry Budget）等手段，显著提升了 Agent 在社交媒体等高风控平台的自动化合规性。核心回归测试 `scripts/verify.sh` 全量通过（12/12 PASS），新增的 `test_policy.py` 覆盖了所有关键策略路径。

### P0 风险 (Must-Fix)
- **无**

### P1 风险 (Should-Fix)
1.  **策略覆盖完整性**: `extract` 和 `evaluate` 路由目前跳过了策略检查（src/daemon/routes/actions.ts）。虽然这些是读取类动作，但在某些严苛风控环境下，高频脚本注入（evaluate）也是被监测的指标。建议在 R06 结束前统一挂载 `applyPolicy`。

### P2 风险 (Minor)
1.  **策略引擎内存管理**: `PolicyEngine` 中的 `actionWindow` 仅在 `clearSession` 时清理。对于访问海量域名的长周期会话，其内存占用会持续增长。建议为域名级状态引入 TTL 或 LRU 机制。

---

## R06-b1 交付评审 (Gemini)
- **评审日期**: 2026-02-26
- **评审轮次**: R06
- **评审批次**: r06-b1
- **目标 SHA**: `9a59a90`

### 结论: Go
本次评审（r06-b1）确认了 R06 关于“高级自动化 CLI 补全”的交付目标已圆满达成。通过新增 `pages`, `route`, `trace` 子命令，CLI 现已完整覆盖了 R05 引入的所有高级功能。自动化验证脚本 `scripts/check-dist-consistency.sh` (27/27 PASS) 确保了分发包的二进制一致性。核心回归测试 `scripts/verify.sh` (11/11 PASS) 证明系统运行稳定。

### P0 风险 (Must-Fix)
- **无**

### P1 风险 (Should-Fix)
- **无**

### P2 风险 (Minor)
1.  **CLI 语义一致性**: `pages close` 目前仅支持 `page_id` 传参，若未来引入更复杂的页面嵌套模型，建议考虑在 CLI 层增加更友好的选择器支持。

---

## R05-b4 最终验收 (Gemini)
- **评审日期**: 2026-02-26
- **评审轮次**: R05
- **评审批次**: r05-b4
- **目标 SHA**: `b7d2a91`

### 结论: Go
本次验收（r05-b4）确认了上一轮（r05-b3）遗留的 2 项 P1 风险（旧测试用例回归故障）已通过 c06 补丁彻底修复。`test_cdp.py` 已对齐 R05 的审计 operator 自动推断逻辑，`test_actions_v2.py` 已对齐会话级下载安全开关。全量验证脚本 `scripts/verify.sh` 11/11 项 Gate 100% 通过。R05 迭代完整交付了多页面管理、iFrame 穿透、网络请求 Mock 及 Trace 录制等高级自动化功能，代码与测试表现稳健，正式准予交付。

### P0 风险 (Must-Fix)
- **无**

### P1 风险 (Should-Fix)
- **无**（上一轮 P1 已全部关闭）

### P2 风险 (Minor)
1.  **Async SDK I/O**: Python Async SDK 的 `upload` 方法仍保留同步文件读取，在极高并发场景下可能存在 Event Loop 延迟风险。

---

## R05-b3 最终评审 (Gemini)
- **评审日期**: 2026-02-26
- **评审轮次**: R05
- **评审批次**: r05-b3
- **目标 SHA**: `5e1ac3e`

### 结论: Conditional Go
本次评审（r05-b3）确认了 R05 “高级自动化能力”已完整交付。通过 c05 补丁，解决了 frame 选错时的 422 诊断反馈、会话级 `acceptDownloads` 控制以及关闭末页的 409 保护。全量测试显示 R05 专项用例（多页面、iFrame、Mock、Trace）全部通过。`verify.sh` 中出现的 2 项失败（CDP 审计、旧下载测试）均系由于 R05 引入的默认审计标识（`agentmb-daemon`）及下载安全策略变更，导致旧测试用例预期值不匹配，非业务逻辑故障。建议在 R05 合并前同步更新 legacy 测试用例。

### P0 风险 (Must-Fix)
- **无**

### P1 风险 (Should-Fix)
1.  **旧测试回归故障**: `tests/e2e/test_cdp.py` 和 `test_actions_v2.py` 尚未对齐 R05 的审计 operator 默认值及下载开关逻辑，需同步更新以通过全量 Gate 验证。

### P2 风险 (Minor)
1.  **代码残留**: `src/browser/actions.ts` 中部分类型定义可进一步抽取至 shared types 以减少重复导入。

---

## R05-b2 交付评审 (Gemini)
- **评审日期**: 2026-02-26
- **评审轮次**: R05
- **评审批次**: r05-b2
- **目标 SHA**: `dd6fbed`

### 结论: Go
本次评审（r05-b2）确认了上一轮（r05-b1）提出的所有 P1 风险已通过在 `src/browser/actions.ts` 和 `src/daemon/routes/actions.ts` 中引入 50MB 硬限制（`maxBytes`/`approxBytes`）得到有效缓解。此外，dd6fbed 完整交付了 R05 的核心增量：多页面管理（T03）、iFrame 支持（T04）、网络拦截（T07）以及追踪导出（T08）。接口定义严谨，`resolveFrame` 逻辑优雅地兼容了 Page 与 Frame 的动作 surface，系统已具备处理复杂企业级 Web 应用的能力。

### P0 风险 (Must-Fix)
- **无**

### P1 风险 (Should-Fix)
1.  **Async SDK 阻塞**: `sdk/python/agentmb/client.py` 中的 `AsyncSession.upload` 仍在使用同步 IO 读取文件。虽有 50MB 限制，但在高并发场景下可能导致 Event Loop 延迟，建议后续使用 `to_thread` 优化。

### P2 风险 (Minor)
1.  **全局下载开关**: `acceptDownloads: true` 仍为全局默认，建议后续在会话创建接口中开放该配置。

---

## R04-b4 补测收口 (Gemini)
- **评审日期**: 2026-02-26
- **评审轮次**: R04
- **评审批次**: r04-b4
- **目标 SHA**: `1295e4d`

### 结论: Go
本次补测（r04-b4）通过在隔离环境（AGENTMB_PORT=19525, AGENTMB_DATA_DIR=/tmp/agentmb-r04-b4-gemini）下运行全量验证脚本，确认了品牌重塑与命名迁移后的系统稳定性。所有 7 项 Gate 验证（Build, Daemon Start, Smoke, Auth, Handoff, CDP, Daemon Stop）均 100% 通过。测试结果证明了在完全隔离的数据目录和端口环境下，新版本的初始化逻辑、权限校验及核心浏览器操作功能均表现正常，具备生产交付条件。

### P0 风险 (Must-Fix)
- **无**

### P1 风险 (Should-Fix)
- **无**

---

## R04-b3 交付评审 (Gemini)
- **评审日期**: 2026-02-26
- **评审轮次**: R04
- **评审批次**: r04-b3
- **目标 SHA**: `f3a7901`

### 结论: Go
本次交付（r04-c04）完美闭环了上一轮评审指出的所有残留问题。通过修复 `src/daemon/server.ts` 中的注释残留、在 `package-lock.json` 中彻底移除旧包名，以及在文档中补齐关键的迁移指南（~/.openclaw -> ~/.agentmb），品牌重塑与命名迁移工作已圆满完成。此外，CI 中新增的 `npm pack` 验证逻辑增强了二进制交付的质量信心。

### P0 风险 (Must-Fix)
- **无**

### P1 风险 (Should-Fix)
- **无**

---

## R04-b2 交付评审 (Gemini)
- **评审日期**: 2026-02-26
- **评审轮次**: R04
- **评审批次**: r04-b2
- **目标 SHA**: `b3c3b37`

### 结论: Go
本次交付（r04-c02 + c03）彻底完成了从 `openclaw` 到 `agentmb` 的品牌重塑与命名迁移。变更范围覆盖了核心配置、环境变量、CLI 语义、Python SDK 包名以及所有相关文档与 CI 脚本。迁移逻辑清晰，向下兼容性通过 alias 移除明确界定了新版本的开始。

### P0 风险 (Must-Fix)
- **无**

### P1 风险 (Should-Fix)
1.  **代码注释残留**: `src/daemon/server.ts` 第 20 行注释仍引用了旧环境变量名 `OPENCLAW_API_TOKEN`，建议在后续文档清理中修正为 `AGENTMB_API_TOKEN` 以保持一致。
2.  **数据目录迁移提示**: 虽然系统已切换为 `~/.agentmb`，但对于从旧版本（~/.openclaw）平滑迁移的用户，缺少对旧配置目录的自动检测或迁移建议。建议在后续迭代中增加对旧目录的友好提示。

---

## R03-b1 交付评审 (Gemini)
- **评审日期**: 2026-02-26
- **评审轮次**: R03
- **评审批次**: r03-b1
- **目标 SHA**: `7a9b1c3`

### 结论: Go
本次交付（r03-c01）高质量地完成了“安装与分发基线”收口。修复了 Python SDK 因缺少 README.md 导致的 pip 安装阻塞问题，并提供了覆盖三大主流平台（macOS/Linux/Windows）的详细安装指南。新增的 CI 工作流实现了多平台构建冒烟验证，显著提升了项目的工程化成熟度。

### P0 风险 (Must-Fix)
- **无**

### P1 风险 (Should-Fix)
1.  **测试隔离性问题**: `verify.sh` 在连续运行多个测试套件时，存在 Session Fixture 状态残留导致 404 的风险。虽然不影响本批次的安装交付目标，但建议在 R03 结束前通过增加测试容器化或端口随机化来加固。
2.  **Windows 全量测试缺失**: 当前 CI 的 `full-test` job 仅覆盖了 Ubuntu 和 macOS，建议后续补齐 Windows 环境下的完整 Playwright 链路验证。
3.  **Hatchling 构建缓存**: 建议在 `ci.yml` 中为 Python 环境增加 pip 缓存，以加速构建过程。

---

## R02-b3 交付评审 (Gemini)
- **评审日期**: 2026-02-26
- **评审轮次**: R02
- **评审批次**: r02-b3
- **目标 SHA**: `9630dc3`

### 结论: Go
本次交付（r02-c04）完美解决了上一轮评审中关于“CDP 审计缺失”与“验证脚本不一致”的 P1 风险点。通过引入 CDP 专属审计路径、补齐 42.8% (4/11) 的鉴权测试用例，以及重构 `verify.sh` 变量化计数，项目的交付质量达到了 R02 阶段的最佳状态。

### P0 风险 (Must-Fix)
- **无**

### P1 风险 (Should-Fix)
1.  **AuditLogger 注入方式**: 当前在 `sessions.ts` 中使用 `(server as any).auditLogger` 进行强制类型转换，虽能工作，但破坏了类型安全。建议后续定义专门的 Fastify Decorator 接口。
2.  **CDP 错误脱敏**: 在 `cdp_send` 失败时，审计日志直接记录了 `err.message`。若 CDP 返回的消息包含敏感路径或调试信息，可能存在审计泄漏风险，建议在生产环境增加简单的错误类型归类。

---

## R02-b2 交付评审 (Gemini)
- **评审日期**: 2026-02-26
- **评审轮次**: R02
- **评审批次**: r02-b2
- **目标 SHA**: `d1d735d`

### 结论: Go
本次交付（r02-c03）在 R02-b1 的基础上实现了关键的系统加固，特别是 Linux 环境下的 headed 模式支持与 CDP 直通能力的引入。文档体系完备，自动化脚本（verify.sh/xvfb-headed.sh）显著提升了交付的可靠性和可操作性。系统已具备在无显存 Linux 服务器上进行人工接管操作的能力。

### P0 风险 (Must-Fix)
- **无**

### P1 风险 (Should-Fix)
1.  **CDP 直通受限于 HTTP**: 当前 CDP 能力通过 HTTP Relay 实现，不支持 WebSocket 升级。对于需要实时监听 CDP 事件（如 Network.requestPaused）的场景会有局限。建议在后续迭代中引入原生 WebSocket 支持。
2.  **Linux CI 实机验证缺失**: 虽然提供了完善的 Xvfb 脚本，但尚未在 GitHub Actions 等 CI 环境中完成实机集成验证。
3.  **审计日志 operator 自动化**: 目前 `operator` 字段需调用方显式传入，建议 Daemon 在无法获取显式传入值时，根据 API Token 或 Session 创建信息自动填充。

---

## R02-b1 增量评审 (Gemini)
- **评审日期**: 2026-02-26
- **评审轮次**: R02
- **评审批次**: r02-b1
- **目标 SHA**: `45e94dd`

### 结论: Go
本次交付质量很高，专注于提升交付能力与合规性。通过增加专门的“登录辅助”流程，显著降低了在真人登录场景下的合规风险。同时，修复了核心功能的 bug 并大幅提升了测试覆盖率，为 R02 的稳定交付奠定了坚实基础。

### P0 风险 (Must-Fix)
- **无**

### P1 风险 (Should-Fix)
1.  **核心安全特性尚未实现**: R02 的一个核心 P0 目标——Profile 加密，在此次提交中没有体现。虽然本次交付的功能完善，但从 R02 整体目标来看，加密特性仍是保障交付质量和用户数据安全的关键，建议作为下一批次的最高优先级。

---

## R01-b3 增量评审 (Gemini)
- **评审日期**: 2026-02-26
- **评审轮次**: R01
- **评审批次**: r01-b3
- **目标 SHA**: `3b9aa87`

### 结论: Go
此次交付是一次高质量的快速修复。代码变更专注于提升 CLI 和 Daemon 交互的健壮性与一致性，修复了多个潜在的边界情况和错误处理逻辑。所有修改都精准且必要，进一步提升了系统的可靠性。

### P0 风险 (Must-Fix)
- **无**

### P1 风险 (Should-Fix)
- **无**

---

## R01-b2 增量评审 (Gemini)
- **评审日期**: 2026-02-26
- **评审轮次**: R01
- **评审批次**: r01-b2
- **目标 SHA**: `74afaa3`

### 结论: Go
本次增量交付质量极高。不仅完整实现了 M4 里程碑的 Python SDK 及 E2E 测试，还系统性地修复了上一轮评审中指出的全部3个 P1 风险点。项目当前状态稳健，功能完善，超出 MVP 预期。

### P0 风险 (Must-Fix)
- **无**

### P1 风险 (Should-Fix)
- **无**。上一轮的 P1 已全部关闭。

---

## R01 交付评审 (Gemini)
- **评审日期**: 2026-02-25
- **评审轮次**: R01
- **目标分支**: `feat/r01-mvp`
- **目标 SHA**: `7cb239f`

### 结论: Go
本次交付高质量地实现了“常驻会话”核心架构，完全采纳并解决了上次评审中所有的 P0 级架构风险。代码结构清晰，功能完备，为后续开发打下了坚实的基础。

### P0 风险 (Must-Fix)
- **无**

### P1 风险 (Should-Fix)
1.  **提取能力较弱**: **[已在 74afaa3 修复]** 当前版本仅提供 `eval` 作为内容提取的手段。
2.  **API 无认证**: **[已在 74afaa3 修复]** Daemon 的 API 目前无任何认证机制。
3.  **Session 状态非持久化**: **[已在 74afaa3 修复]** 如果 Daemon 进程异常崩溃，所有活跃的 `session_id` 都会丢失。

---

## 初始设计方案评审 (Gemini)
- **评审日期**: 2026-02-25

### P0 架构风险
1.  **配置锁无处理机制（Stale Lock）**: **[已在 7cb239f 修复]** 进程崩溃将导致 Profile 永久锁定。
2.  **CLI 接口与核心目标冲突**: **[已在 7cb239f 修复]** “CLI-first”的短生命周期进程无法实现高效的状态复用。
3.  **指令语义重叠**: **[已在 7cb239f 修复]** `open --extract` 和 `extract` 功能重叠，造成使用混乱。

### P1 可优化点
1.  **优先实现 Daemon 模式**: **[已在 7cb239f 实现]** 建议作为核心架构，从根本上解决状态与性能问题。
2.  **提取接口粒度过粗**: **[已在 74afaa3 优化]** `extract` 命令应支持 CSS 选择器。
3.  **会话管理概念缺失**: **[已在 7cb239f 实现]** 建议引入 `session` ID 作为一级概念。
