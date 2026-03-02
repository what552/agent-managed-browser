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

**故障回滚**：若步骤 3（目标引擎启动）失败，原引擎保持运行，session 状态不变，向调用方返回错误原因（如 `"target engine not found"` / `"port already in use"`）。

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

## 附录：R10 解决的根本问题对照表

| 痛点 | 根因 | R10 方案 |
|------|------|----------|
| 直接复制 SQLite Cookies 文件跨引擎失效 | Keychain key 不同（mock vs Chrome Safe Storage） | T01 双产区隔离 + T03 API 层传递 |
| `browser-launch` profile 重启丢失 | 硬编码 `/tmp/agentmb-cdp-<port>` | T02 `--profile` 参数 + Stable 产区 |
| profile 被占用时无提示直接报错 | 无 SingletonLock 前置检查 | T02 启动前检查 |
| 跨引擎迁移需要手动三步操作 | 无封装命令 | T03 `fork` / `adopt` |
| 引擎切换无工具，且切换失败丢失 session | 无原子切换保证 | T04 原子切换 + 故障回滚 |
| 无法列出和管理 profile | 无管理命令 | T05 `profile list/delete` |
| Sealed session 无法删除 | 无 `unseal` / `--force` | T06 |

---

**Orchestrator 签发日期**：2026-03-02
**参与审查**：实机验证（XHS 登录态迁移全流程）、Bug 分析（switch-engine 回滚、adopt 语义、IndexedDB 盲区）
