# R10 迭代规格说明书 (Detailed Spec)

> **目标**：实现资产级双引擎会话管理，打通逻辑登录态在不同浏览器引擎间的流转。
>
> **背景**：agentmb Managed Session 使用 Playwright 内置 Chrome for Testing，启动时携带
> `--use-mock-keychain` 标志，cookies 以 Playwright 内部固定 key 加密落盘。系统级 Chrome 使用
> `Chrome Safe Storage`（macOS Keychain）加密，两者 key 完全不同，导致 SQLite Cookies
> 文件无法跨引擎直接复制使用。R10 从架构层面解决这一根本矛盾。

---

## 1. 存储架构：双产区物理隔离 (R10-T01)

### 1.1 目录定义

| 产区 | 路径 | 适用引擎 | Cookie 加密 Key |
|------|------|----------|-----------------|
| Managed 产区 | `~/.agentmb/profiles/` | Playwright 内置 Chrome for Testing | Playwright mock keychain |
| Stable 产区 | `~/.agentmb/chrome-profiles/` | 系统 Chrome / msedge | macOS Chrome Safe Storage |

### 1.2 路由逻辑

`BrowserManager` 在创建 Session 时，根据 `browser_channel` 自动计算 `userDataDir`：

```
browser_channel = chromium (默认) → ~/.agentmb/profiles/<name>
browser_channel = chrome / msedge  → ~/.agentmb/chrome-profiles/<name>
```

**禁止跨产区读取**：系统 Chrome 不得以 `--user-data-dir` 指向 Managed 产区，反之亦然。
违反此约束会导致新版本 Chrome 升级 SQLite schema，使旧版 Playwright Chromium 无法再打开
该 profile（"Profile version too new" 错误）。

### 1.3 已知局限（后续迭代）

- 同名 profile 可在两个产区同时存在（如 `profiles/xhs` 和 `chrome-profiles/xhs`），
  `profile list / delete` 需加 `--zone managed|stable` 参数消歧义。
- 孤儿 profile 清理（无关联 session 的目录）留待 `profile prune` 命令实现。

---

## 2. 启动增强：Launcher 2.0 (R10-T02)

### 2.1 新增 `--profile` 参数

```bash
agentmb browser-launch --profile <name> [--port <p>] [--executable <path>]
```

行为：
- 自动拼接 `--user-data-dir=~/.agentmb/chrome-profiles/<name>`（Stable 产区）。
- 若目录不存在则自动创建。

**现有问题**：当前 `browser-launch` profile 硬编码为 `/tmp/agentmb-cdp-<port>`，重启后丢失，
无法持久化外部 Chrome 的登录态。

### 2.2 SingletonLock 前置检查

启动前执行 `fs.access` 检查 `<userDataDir>/SingletonLock`：
- 文件存在 → 检查持有进程是否存活
  - 进程存活 → 返回错误 `"Profile already in use by PID <n>"`，拒绝启动
  - 进程已死 → 自动清理 lock 文件后继续启动
- 文件不存在 → 正常启动

### 2.3 CLI 输出

```
Launching: /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
  Profile:        xhs-cdp  (~/.agentmb/chrome-profiles/xhs-cdp)
  Debugging port: 9222
  Waiting for browser to be ready... ready.

CDP URL: http://127.0.0.1:9222

Connect with:
  agentmb session new --launch-mode attach --cdp-url http://127.0.0.1:9222
```

---

## 3. 逻辑流转：全向会话克隆 (R10-T03)

### 背景

跨引擎传递登录态的正确路径是通过 **API 层**（明文 JSON），而非直接复制 SQLite 文件：

```
Managed Session (Chromium)
  → context.storageState()       # 导出明文 JSON（cookies + localStorage）
  → CDP Network.setCookie        # 注入目标引擎
  → 目标引擎用自己的 key 重新加密落盘
```

`fork` 和 `adopt` 均基于此机制，差异在于方向和意图。

### 3.1 `session fork`（分身）

**API**: `POST /api/v1/sessions/:id/fork`

**Request Body**:
```json
{
  "channel": "chrome | chromium",
  "profile": "xhs-cdp",
  "headed": true
}
```

**Response**:
```json
{
  "session_id": "sess_fork_xxx",
  "profile": "xhs-cdp",
  "channel": "chrome"
}
```

**逻辑**：
1. 调用源 session 的 `context.storageState()` 获取明文 JSON。
2. 按 `channel` 路由到对应产区，启动新 Session。
3. 注入状态（cookies + localStorage）。
4. 源 session 继续运行，两者独立。

**使用场景**：并发抓取多个页面，每个 Agent 持有独立 session。

**安全指引**：
- 并发分身适合**只读操作**（抓取、截图、数据提取）。
- 多实例同时执行**写操作**（发帖、点赞、修改账号信息）存在平台风控风险，且对同一资源写操作会产生数据竞争（如同时修改同一条草稿）。
- 写操作并发请确保各实例操作对象互不重叠。

**已知局限**：`context.storageState()` 不包含 **IndexedDB**。若目标网站将关键认证态存于
IndexedDB，fork 后新 session 可能行为异常，且无明显报错。后续迭代补充 IndexedDB 提取支持。

### 3.2 `session adopt`（收编）

**API**: `POST /api/v1/sessions/adopt`

**Request Body**:
```json
{
  "cdp_url": "http://127.0.0.1:9222",
  "profile": "xhs-cdp-import"
}
```

**Response**:
```json
{
  "session_id": "sess_adopted_xxx",
  "profile": "xhs-cdp-import",
  "channel": "chromium"
}
```

**逻辑**：
1. 通过 CDP 挂载外部浏览器。
2. 执行 `context.storageState()` 提取 cookies + localStorage。
3. **非侵入**：不对源浏览器执行任何导航或修改，保持其当前页面状态不变。
4. 启动新 Managed Session（Chromium），注入状态。
5. 输出提示：`✓ 状态已提取，新 session: <id>；源浏览器仍在运行，你可以安全关闭或继续操作。`

**使用场景**：人机接力。用户在系统 Chrome 中手动完成登录或滑块验证码后，由 Agent 接管后续自动化流程。

---

## 4. 运行时：环境热切换 (R10-T04)

### 4.1 原子切换协议

**API**: `PUT /api/v1/sessions/:id/switch-engine`

**Request Body**:
```json
{
  "target_channel": "chrome | chromium",
  "headed": true,
  "keep_source": false
}
```

**执行步骤**（严格顺序）：
1. 暂存所有 Page 的 URL 列表。
2. 调用 `context.storageState()` 暂存逻辑登录态。
3. **启动目标引擎**，等待 CDP 可连通（就绪确认）。
4. **就绪确认通过后**，关闭原引擎（除非 `keep_source=true`）。
5. 将暂存的 storageState 注入新引擎。
6. 按 URL 列表依次恢复页面。

**安全约束**：步骤 3 必须在步骤 4 之前完成。在新引擎成功启动并 CDP 可连通之前，不得关闭原引擎进程。

**故障回滚**：若步骤 3（目标引擎启动）失败，原引擎保持运行， session 状态不变，向调用方返回错误原因（如 `"target engine not found"` / `"port already in use"`）。

**已知局限**：切换后页面重新导航，页面内 in-memory 状态（表单数据、滚动位置、SPA 内部 state）不可恢复。

---

## 5. 资产管理：统一注册表 (R10-T05)

### 5.1 `profile list`

```bash
agentmb profile list
```

输出示例：
```
ZONE      NAME              SESSIONS   SIZE     LAST MODIFIED
managed   xhs-cdp-import    1 live     42 MB    2026-03-02
managed   default           0          8 MB     2026-02-28
stable    xhs-cdp           1 live     31 MB    2026-03-02
stable    xhs-attach        0          5 MB     2026-03-01
```

### 5.2 `profile delete`

```bash
agentmb profile delete --name <name> [--zone managed|stable] [--force]
```

**销毁保护逻辑**：
- 执行前查询 session 注册表，检查是否存在关联的 Live Session。
- 若存在 Live Session：拒绝执行，返回 `423 Locked`，并列出占用的 session ID。
- 若无 Live Session：删除磁盘目录并从注册表移除记录。
- `--force` 标志：强制删除，即使存在 Live Session（会导致该 session 变为 zombie）。

### 5.3 后续迭代：`profile prune`

清理两个产区中无任何 session 关联的孤儿 profile 目录，释放磁盘空间。

---

## 6. 会话治理：Seal 保护与强制清理 (R10-T06)

### 6.1 现有问题

`session seal` 后无解锁路径，`session rm` 遇到 sealed session 返回
`"Session is sealed and cannot be deleted"` 但无 `unseal` 命令，只能通过 daemon REST API 绕过。

### 6.2 `session unseal`

```bash
agentmb session unseal <session-id>
```

解除 seal 保护，使 session 重新可被 `rm` 删除。

### 6.3 `session rm --force`

```bash
agentmb session rm --force <session-id>
```

忽略 seal 保护，直接删除。适用于批量清理大量 sealed zombie session 的场景。

### 6.4 批量清理建议

```bash
# 清理所有 zombie session（含 sealed）
agentmb session list | grep zombie | awk '{print $1}' | xargs -I{} agentmb session rm --force {}
```

---

## 7. 权限管理：运行时动态授权 (R10-T07)

### 7.1 `session grant-permission`

```bash
agentmb session grant-permission <session-id> <permission...> [--origin <url>]
```

**支持权限**：`camera`, `microphone`, `notifications`, `geolocation`, `clipboard-read`, `clipboard-write` 等。

**逻辑**：
- 调用 `browserContext.grantPermissions(permissions, { origin })`。
- 赋予 Agent 动态开启摄像头/麦克风或读取剪贴板的能力，无需手动干预。

---

## 8. 已知 Bug：`upload` 命令实际限制 ~767KB (R10-B02)

### 8.1 现象

`agentmb upload` 上传超过约 767KB 的文件时，返回 `Payload Too Large` 错误，无法上传。
README 未提及任何大小限制，用户无从预知。

### 8.2 根因

**应用层设计上限是 50MB**（`routes/actions.js` 第 662 行）：

```js
if (approxBytes > 50 * 1024 * 1024) {
    return reply.code(413).send({ error: 'File too large: maximum upload size is 50 MB' });
}
```

但 fastify 服务器初始化时未配置 `bodyLimit`，沿用默认值 **1MB**。文件以 base64 编码塞入 JSON body（体积膨胀 ×1.33），因此 ~767KB 原始文件 base64 后恰好触碰 1MB 上限，HTTP 层直接返回 413，应用层的 50MB 检查从未执行。

```
server.js 第 16 行：
fastify({ logger: { ... } })   ← 缺少 bodyLimit，默认 1MB
```

### 8.3 快速修复

fastify 初始化时对齐应用层意图：

```typescript
fastify({ bodyLimit: 70 * 1024 * 1024 })  // 50MB × 1.4，覆盖 base64 膨胀
```

### 8.4 彻底修复：`upload` 直传模式 (R10-T08)

**根本问题**：当前 `upload` 架构强制文件经由 HTTP 传输，整个文件在内存中存在两份副本（base64 + 解码），与文件大小线性相关。

```
当前链路：
CLI 读文件 → base64 → JSON body → HTTP POST → daemon 解码 → Playwright setInputFiles
```

**改进方案**：CLI 仅传递本地文件路径，daemon 直接调用 `page.setInputFiles(path)`，绕过 HTTP 传输：

```
直传链路：
CLI 传路径字符串 → HTTP POST (tiny payload) → daemon setInputFiles(path) → 无大小限制
```

**API**：

```bash
agentmb upload <session-id> <selector> <file>   # 自动使用直传（本机 daemon）
agentmb upload <session-id> <selector> <file> --force-base64  # 兜底：远程 daemon
```

**适用范围**：daemon 与 CLI 在同一台机器时（本地使用的标准场景），文件路径对 daemon 进程可见，直传无限制。远程 daemon 场景保留 base64 模式作为兜底。

---

## 9. 已知 Bug：Attach 模式下载路径劫持 (R10-B01)

### 9.1 现象

在 `--launch-mode attach` 模式下，用户在外部 Chrome 中触发文件下载（如从 Lovart 下载生成图片），
文件不会保存到 `~/Downloads`，而是被存入 Playwright 临时目录：

```
/var/folders/.../playwright-artifacts-<random>/<uuid>
```

文件名为随机 UUID，无扩展名。Chrome 下载记录中显示该文件，但点击"在文件夹中显示"无响应，
用户无法在 Finder 中找到。

### 9.2 根因

Playwright 在通过 CDP 接管浏览器时，会在协议层拦截 `Browser.downloadWillBegin` 事件，
将下载行为重定向至自己管理的临时 artifact 目录，**绕过** Chrome 原生的下载逻辑。

```
用户点击下载
  → Chrome 触发 CDP download 事件
  → Playwright CDP 层拦截（优先于 Chrome 自身处理）
  → 存入 /var/folders/.../playwright-artifacts-xxx/<uuid>
  → Chrome 原生"保存至 ~/Downloads"逻辑被跳过
```

**影响范围**：仅 `attach` 模式受影响。Managed Session（daemon 启动）的下载行为由 agentmb
完全控制，不存在此问题。

### 9.3 修复方案

在 `attach` 模式创建 BrowserContext 时，显式将 `downloadsPath` 设为用户 Downloads 目录：

```typescript
// attach 模式 BrowserContext 创建时
const context = await browser.newContext({
  downloadsPath: path.join(os.homedir(), 'Downloads'),
});
```

或对 attach 模式完全不拦截下载事件，保留 Chrome 原生下载行为。

---

## 10. 功能增强：`eval` 顶层 Await 支持 (R10-T12)

### 10.1 现象 (Issue #5)

直接执行 `agentmb eval <id> "await fetch(...)"` 会触发 `ReferenceError: await is not defined`。

### 10.2 修复逻辑

在 Daemon 执行 `page.evaluate()` 前，对用户输入的字符串进行自动包裹。为了兼容性，建议通过正则表达式判断是否包含顶级 `await`：

```typescript
const wrapped = expression.trim().includes('await') 
  ? `(async () => { return (${expression}); })()` 
  : expression;
```

---

## 11. 已知 Bug：CDP 初始页面枚举缺失 (R10-B04)

### 11.1 现象 (Issue #7)

在 `--launch-mode attach` 模式下，`agentmb pages list` 无法显示 attach 之前已经存在的标签页。

### 11.2 修复逻辑

在 `connectOverCDP()` 后，主动遍历 `browser.contexts()`，并将所有 pre-existing 的 `page` 注册到 session 的内部 tracking 列表中，确保与原生状态一致。

---

## 12. 已知 Bug：`upload` 命令缺失 `--page-id` (R10-B03)

### 12.1 现象 (Issue #6)

`upload` 命令不支持 `--page-id` 标志，导致在多标签页工作流中必须先显式切换页面，破坏了 API 的一致性。

### 12.2 修复逻辑

在 `src/cli/commands/actions.ts` 及 API 路由中，为 `upload` 动作补齐 `--page-id` 参数的解析与透传。

---

## 13. 功能增强：Managed 模式扩展开关 (R10-T13)

### 13.1 背景 (Issue #8)

当前 `agentmb session new --headed` 使用 Playwright 默认参数启动 managed 浏览器，默认携带
`--disable-extensions`。这会导致 Side Panel / 扩展自动化场景在 managed 模式下无法执行。

### 13.2 CLI 方案

```bash
agentmb session new [--headed] [--profile <name>] [--allow-extensions]
```

默认行为不变（安全默认）：
- 未传 `--allow-extensions`：继续禁用扩展。
- 传入 `--allow-extensions`：显式允许扩展能力，仅对当前 session 生效。

可选后续（nice-to-have）：

```bash
agentmb session new --allow-extensions --extension-dir <path>
```

用于自动加载本地 unpacked extension。

### 13.3 Runtime 行为

当 `allow_extensions=true` 时，`launchPersistentContext(...)` 增加：

```ts
ignoreDefaultArgs: ['--disable-extensions']
```

如传 `extension_dir`（后续项），额外追加启动参数：
- `--disable-extensions-except=<abs_path>`
- `--load-extension=<abs_path>`

### 13.4 安全与约束

- 保持 secure-by-default：扩展能力必须显式开启。
- `extension_dir` 必须为本地绝对路径且通过路径校验（不存在/非法路径返回 400）。
- 对启用扩展的 session 写审计字段（建议记录 `allow_extensions=true`）。

### 13.5 验收标准

1. 默认 `session new --headed` 仍为禁用扩展行为（无兼容性回归）。
2. `session new --allow-extensions --headed` 可正常创建 session，且不再携带 `--disable-extensions`。
3. Side Panel 扩展测试流程在 managed 模式可执行（至少 1 条 e2e smoke）。
4. 非法 `--extension-dir`（后续项）返回结构化 400 错误。

---

## 附录：R10 解决的根本问题对照表

| 痛点 | 根因 | R10 方案 |
|------|------|----------|
| 直接复制 SQLite Cookies 文件跨引擎失效 | Keychain key 不同（mock vs Chrome Safe Storage） | T01 双产区隔离 + T03 API 层传递 |
| `browser-launch` profile 重启丢失 | 硬编码 `/tmp/agentmb-cdp-<port>` | T02 `--profile` 参数 + Stable 产区 |
| profile 被占用时无提示直接报错 | 无 SingletonLock 前置检查 | T02 启动前检查 |
| 跨引擎迁移需要手动三步操作 | 无封装命令 | T03 `fork` / `adopt` |
| 引擎切换无工具，且切换失败丢失 session | 无原子切换保证 | T04 原子切换 +故障回滚 |
| 无法列出和管理 profile | 无管理命令 | T05 `profile list/delete` |
| Sealed session 无法删除 | 无 `unseal` / `--force` | T06 |
| 无法动态授予媒体/通知权限 | 无原生封装指令 | T07 `grant-permission` |
| `upload` 实际限制 ~767KB（设计意图 50MB） | fastify 未配置 bodyLimit，默认 1MB | R10-B02 快速修复 + T08 直传 |
| Attach 模式下载被劫持至 Playwright 临时目录 | Playwright CDP 层拦截 download 事件 | R10-B01 修复 |
| `eval` 无法直接执行 `await` 代码 | Playwright evaluate 默认非异步上下文 | T12 自动 async IIFE 封装 |
| `upload` 无法定向到指定 Page | CLI/API 缺失参数透传 | B03 补齐 `--page-id` |
| CDP attach 漏掉已有标签页 | 缺少初始枚举注册逻辑 | B04 遍历 contexts 注册 |
| managed 模式无法做扩展/Side Panel 自动化 | Playwright 默认 `--disable-extensions` | T13 `--allow-extensions` 显式开启（默认仍禁用） |

---

**Orchestrator 签发日期**：2026-03-02
**参与审查**：实机验证（XHS 登录态迁移全流程）、Bug 分析（switch-engine 回滚、adopt 语义、IndexedDB 盲区、attach 下载劫持、upload bodyLimit 穿透）、权限缺口补齐（T07）、上传直传架构（T08）、`eval` 异步增强（T12）、CDP 枚举修复（B04）、`upload` 页面定向（B03）
