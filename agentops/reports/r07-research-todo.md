# Research TODO: agentmb <- xiaohongshu-mcp 可借鉴优化

## 目标
- 在不引入站点业务耦合的前提下，提炼 `xiaohongshu-mcp` 中可复用到 `agentmb` 的通用能力。
- 形成可实现、可验证、可发布的 `agentmb` 增强路线（P0/P1/P2）。

## 非目标
- 不把小红书业务动作（发帖、点赞、评论、xsec_token 语义）并入 `agentmb`。
- 不在 `agentmb` 引入站点特定选择器和平台术语。

## 研究问题
1. `agentmb` 如何在保持通用性的前提下，提升复杂页面自动化稳定性？
2. 哪些“业务层常见需求”可以抽成通用 runtime 原语？
3. 如何补齐 MCP 适配能力而不破坏现有 HTTP/CLI/SDK 架构？

## P0（优先落地）

### 1) 稳定性策略中间层（Stability Policy）
- 研究内容：
  - 抽象 `wait_dom_stable`、重试、抖动延时、遮挡检测为可选策略。
  - 以“action 参数 + 默认策略配置”方式接入现有 action 路由。
  - 增加 `Humanization Policy`（仿人策略）：
    - 打字节奏（字符间隔、突发输入上限）
    - 鼠标移动轨迹（直线/曲线、最小移动时间）
    - 滚动节奏（步长、停顿、回滚概率）
    - 动作间随机停顿（jitter）与最小动作间隔（cooldown）
    - 策略默认关闭，按站点/任务配置启用
- 参考来源：
  - `xiaohongshu/publish.go`
  - `xiaohongshu/feed_detail.go`
- 预期产出：
  - 设计文档：策略接口、默认值、禁用方式。
  - PoC：`click/fill/type` 三个 action 支持策略注入。
  - 配置规范：全局配置 + session 覆盖 + 单次 action 覆盖。
- 验收标准：
  - 在不启用策略时，现有 e2e 行为不变。
  - 启用策略后，目标页面 flaky 失败率下降（定义基线后量化）。
  - 仿人策略启用后，动作耗时增幅在可控范围内（需定义上限）。

### 2) 通用滚动采集原语（scroll_until / load_more_until）
- 研究内容：
  - 从“评论加载逻辑”提炼通用滚动终止条件：目标计数、停滞检测、最大尝试、结束标记。
  - 设计通用 API，避免绑定具体 DOM 结构。
- 参考来源：
  - `xiaohongshu/feed_detail.go`
- 预期产出：
  - 新 action 设计稿（请求/响应/错误模型）。
  - 最小实现 + e2e 用例。
- 验收标准：
  - 至少 2 个不同站点 demo 可复用同一接口。

### 3) MCP 适配层评估
- 研究内容：
  - 在 `agentmb` 上增加 MCP gateway（工具映射到现有 HTTP action）。
  - 工具注解支持：只读/破坏性提示、统一 panic/异常兜底。
- 参考来源：
  - `mcp_server.go`
- 预期产出：
  - 架构方案（独立进程 vs 内嵌路由）。
  - 最小工具集 PoC（session + navigate + click + extract + screenshot）。
- 验收标准：
  - MCP 客户端可稳定调用，且权限/鉴权模型清晰。

### 4) 快照引用式元素模型（Snapshot Ref Mode）
- 研究内容：
  - 新增 `snapshot_map` 能力，输出 `ref_id`（如 `e1/e2/e3`）与结构化元素快照。
  - 在 runtime 维护会话级 `ref table`（`ref_id -> 元素定位句柄/线索`），而非写入 DOM。
  - 动作层支持 `ref_id` 作为目标输入（与 `selector/element_id` 并存）。
  - 失效策略：导航/主文档重建/DOM 大变更后，旧 ref 返回 stale 错误并要求重建快照。
  - 增加 `page_rev`（页面版本号）用于防止旧快照误操作新页面。
  - 模式策略：默认 `snapshot`，保留 `dom` 作为可选 fallback（可配置关闭）。
- 预期产出：
  - API 设计：`/snapshot_map`、ref 解析、stale 错误码、`page_rev` 字段。
  - PoC：`click/get/assert` 支持 `ref_id`。
  - 兼容策略：`selector | element_id | ref_id` 三路目标统一解析。
- 验收标准：
  - 常见登录页流程可在不注入 DOM 的情况下完成（snapshot -> ref action -> resnapshot）。
  - 页面变化后能稳定返回 stale ref 诊断，不出现静默误点。
  - 与现有 selector 路径兼容，不破坏历史调用。

### 5) 低层输入原语补齐（Mouse / Wheel / Drag）
- 研究内容：
  - 新增通用低层输入 API，覆盖：
    - `mouse.move(x,y,steps,duration_ms)`
    - `mouse.down(button)`
    - `mouse.up(button)`
    - `mouse.wheel(dy,dx)`
    - `drag(start,end)`（由 move/down/move/up 组合）
  - CLI 对齐：
    - `agentmb mouse-move <session-id> <x> <y>`
    - `agentmb mouse-down <session-id> [button]`
    - `agentmb mouse-up <session-id> [button]`
    - `agentmb mouse-wheel <session-id> <dy> [dx]`
  - SDK 对齐：Python/TS 同步提供方法，参数命名一致。
  - 支持三种目标输入：`selector | ref_id | absolute coordinates`。
- 预期产出：
  - 新路由：`/api/v1/sessions/:id/mouse/*` 与 `/drag`。
  - CLI/SDK 全链路支持与审计日志字段（button、dx/dy、duration_ms）。
  - e2e：拖拽组件、无限滚动、canvas 点击三类场景。
- 验收标准：
  - 不破坏现有 `click/hover/type` 路径。
  - 低层输入成功率在复杂前端（canvas/自定义组件）显著高于单纯 selector click。
  - 审计日志可完整回放关键输入序列。

### 6) 快照到坐标回放（Ref -> Box -> Input）
- 研究内容：
  - 在 `snapshot_map` 返回中强制包含元素包围盒（`x,y,width,height`）和可见性信息。
  - 低层输入支持 `ref_id` 自动解析到坐标中心点/偏移点。
  - 引入 `page_rev` + `bbox_hash` 校验，避免旧 ref 在新页面误触发。
  - 失效策略：`stale_ref` 时返回建议动作（`resnapshot` / `wait` / `fallback selector`）。
- 预期产出：
  - ref table 扩展字段：`frame_id`、`bbox`、`visibility`、`page_rev`。
  - `click_by_ref` 与 `mouse_by_ref` 两条执行链。
- 验收标准：
  - 在“无 DOM 注入”模式下，`e3 -> 登录按钮` 可稳定定位并触发动作。
  - 页面刷新或弹层改版后，旧 ref 不会静默误点。

### 7) 双轨执行器（高层动作优先，低层动作兜底）
- 研究内容：
  - 执行策略默认：
    - 第 1 路：`click/fill/type` 等高层 Playwright 动作。
    - 第 2 路：失败后自动降级到低层 `mouse/keyboard` 原语。
  - 每步记录“执行轨道”与失败原因（遮挡、不可见、stale、超时）。
  - 支持按域名/任务配置禁用兜底，防止过度拟人化。
- 预期产出：
  - `action_executor` 策略配置：`strict_high_level | auto_fallback | low_level_first`。
  - 错误返回新增 `suggested_fallback` 字段。
- 验收标准：
  - flaky 场景下整体成功率提升，同时平均耗时可控。
  - 调试时可清晰看到“为何从高层切到低层”。

### 8) 仿人节奏策略产品化（Humanization Pack）
- 研究内容：
  - 把“拟人”拆为可组合策略而非魔法开关：
    - 打字节奏 profile（steady / bursty / cautious）
    - 滚动 profile（short / mixed / feed）
    - 鼠标轨迹 profile（direct / curved / hesitant）
    - 操作冷却与随机停顿（含上下限）
  - 策略挂载位置：全局、session、单 action。
- 预期产出：
  - `policy.humanization` 配置模型与默认值。
  - dry-run 预览：输出将要使用的节奏参数（便于调试）。
- 验收标准：
  - 策略关闭时行为与当前版本一致。
  - 策略开启时可重复（同 seed）与可随机（不同 seed）两种模式都可用。

## P1（次优先）

### 5) Cookies & Storage 管理能力
- 研究内容：
  - 增加 session 级 cookie API：
    - `list/get/set/delete/clear/import/export`
    - 支持按 domain/path/name 过滤
  - 增加 storage API：
    - `localStorage/sessionStorage` 的 `get/set/remove/clear`
    - 支持按 origin 操作
  - 保留 profile 持久化，同时提供显式状态读写接口，便于 agent 可控恢复登录态。
  - 定义安全边界与敏感信息处理策略（日志脱敏、危险操作确认）。
- 参考来源：
  - `cookies/cookies.go`
- 预期产出：
  - API 草案 + CLI/SDK 方法。
  - 安全评审清单（日志脱敏、权限控制）。
- 验收标准：
  - 可完成跨环境登录态迁移（import/export）最小流程演示。
  - 可通过统一命令读写指定 origin 的 storage。

### 6) 错误恢复建议增强
- 研究内容：
  - 在现有结构化诊断基础上增加“下一步建议”（例如切 headed、重试条件）。
  - 保持错误结构稳定，避免破坏 SDK 兼容性。
- 参考来源：
  - `src/browser/actions.ts`
  - `src/daemon/routes/actions.ts`
- 预期产出：
  - 错误码/建议文案规范。
  - 2-3 个高频失败场景实现。
- 验收标准：
  - CLI/SDK 用户可直接据建议修复常见失败。

### 7) 通用参数校验层（Validator / Preflight）
- 研究内容：
  - 抽象常见前置校验：字符串长度、时间窗口、文件存在性、参数互斥/依赖。
  - 提供统一错误码和错误文案模板，避免业务层重复校验逻辑。
- 参考来源：
  - `service.go`（标题长度、定时范围、文件校验模式）
- 预期产出：
  - `preflight` 规范文档。
  - 最小实现：供 action 路由复用的校验模块。
- 验收标准：
  - 2 个以上 action 使用统一 preflight。
  - 非法参数返回一致的结构化错误。

### 8) 资源输入管线（Asset Ingestion Pipeline）
- 研究内容：
  - 将“远程 URL 资源下载 -> 本地缓存/校验 -> 上传动作”抽象成通用管线。
  - 支持路径、大小、MIME、超时、重试等策略配置。
- 参考来源：
  - `pkg/downloader/*`（图片处理思路）
- 预期产出：
  - API 设计：ingest 请求/响应与失败分类。
  - SDK 封装：上传前自动走 ingestion（可关闭）。
- 验收标准：
  - 同一 ingestion 可复用于至少两类上传场景。
  - 对 URL 失效/格式错误有可诊断错误返回。

### 9) MCP/HTTP 共享 Handler 契约
- 研究内容：
  - 设计“单一业务逻辑，多协议适配”的 handler 结构。
  - 明确参数模型、错误模型、审计字段在 HTTP 与 MCP 间的一致性约束。
- 参考来源：
  - `mcp_server.go` + `handlers_api.go`（双协议形态）
- 预期产出：
  - handler 分层规范（core usecase / transport adapter）。
  - 迁移指南：新增能力默认同时暴露 HTTP 与 MCP（可显式豁免）。
- 验收标准：
  - 新增一个示例 action，HTTP 与 MCP 共享同一核心逻辑。
  - 双协议返回结构一致且测试覆盖。

### 10) 语义元素定位层（Semantic Locators）
- 研究内容：
  - 在 selector 之外新增语义查找能力：
    - `role/name`、`label`、`placeholder`、`text`、`testid`
    - 支持模糊匹配与多候选返回（含 score）
  - 新增 `find` / `find_all` 接口，输出结构化元素信息（含 ref_id 或 selector 建议）。
  - 与快照引用式模型打通：语义查找结果可直接用于 action。
- 预期产出：
  - API 设计：请求参数、候选排序、歧义处理。
  - CLI：`agentmb find <session-id> --role button --name 登录`（示例）。
  - SDK：统一 `find()` 返回模型。
- 验收标准：
  - 在至少 3 类常见页面（登录页/后台表单/电商详情）上，语义定位成功率高于纯 CSS selector 基线。
  - 歧义场景返回可解释候选而非直接失败。

### 11) 浏览器设置能力（Browser Settings API）
- 研究内容：
  - 增加会话级浏览器设置接口：
    - `userAgent`、`viewport`、`locale`、`timezone`
    - `geolocation`、`extraHeaders`、`proxy`
  - 区分“创建时生效”与“运行时可变”参数，定义重启策略与兼容行为。
  - CLI/SDK 对齐：`session new` 参数扩展 + `session settings get/set`。
- 预期产出：
  - settings 模型与校验规则（含非法值错误码）。
  - 最小实现：支持 `ua/viewport/locale/timezone`。
- 验收标准：
  - 可稳定复现同一站点在不同区域/设备配置下的行为差异。
  - 设置变更有明确生效反馈（即时/需重启）。

### 12) Profile 生命周期管理（刷新/重置/克隆）
- 研究内容：
  - 增加 profile 管理命令/API：
    - `list`（列出现有 profile 与最近使用时间）
    - `reset`（清空指定 profile 的 cookies/storage/cache）
    - `delete`（删除指定 profile 目录）
    - `clone`（从已有 profile 复制新 profile）
  - 安全机制：
    - `reset/delete` 默认二次确认
    - 支持 `--force` 与审计日志记录
  - 与 session 行为约束：
    - profile 正在被 live session 占用时禁止 destructive 操作，或要求先停会话。
- 预期产出：
  - CLI：`agentmb profile list|reset|delete|clone`
  - API：`/api/v1/profiles/*` 与 SDK 对应方法
  - 文档：数据目录结构与恢复流程说明
- 验收标准：
  - 可稳定执行“重置登录态后重新登录”完整流程。
  - destructive 操作不会误删正在使用中的 profile。

## P2（可选）

### 13) 任务级编排层（Recipe）
- 研究内容：
  - 在原子 action 之上提供可恢复、可审计的流程编排能力。
  - 评估是否先在 SDK 层实现，再下沉 daemon。
- 预期产出：
  - MVP 规格（step、checkpoint、resume）。
  - 一条端到端示例流程。
- 验收标准：
  - 对复杂自动化流程显著减少业务层重复代码。

## 实施建议（顺序）
1. P0-4 快照引用式元素模型（先把 ref/page_rev 框架打稳）
2. P0-5 低层输入原语（mouse/wheel/drag）
3. P0-6 快照到坐标回放（ref -> box -> input）
4. P0-7 双轨执行器（高层优先 + 低层兜底）
5. P0-8 仿人节奏策略产品化
6. P0-1 稳定性策略中间层（与 7/8 合并收口）
7. P0-2 通用滚动采集原语
8. P0-3 MCP 适配层
9. P1-10 语义元素定位层
10. P1-11 浏览器设置能力
11. P1-12 Profile 生命周期管理
12. P1-5 Cookies & Storage 管理能力
13. P1-6 错误恢复建议
14. P1-7 参数校验层
15. P1-8 资源输入管线
16. P1-9 MCP/HTTP 共享契约
17. P2-13 编排层

## 风险与约束
- 风险：策略过多导致 API 复杂度上升。
- 风险：MCP 适配层引入额外维护面。
- 约束：必须保持 `agentmb`“通用 runtime”定位，禁止站点业务侵入。

## 里程碑建议
- M1（1 周）：完成 P0-1 设计 + PoC + 基线测试。
- M2（1 周）：完成 P0-2 实现 + e2e。
- M3（1 周）：完成 P0-3 PoC，决定正式架构。
