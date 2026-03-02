# R10 迭代规格说明书 (Detailed Spec)

> 目标：实现资产级双引擎会话管理，打通逻辑登录态在不同浏览器引擎间的流转。

## 1. 存储架构：双产区物理隔离 (R10-T01)

### 1.1 目录定义
- **Managed 产区**：`~/.agentmb/profiles/`
  - 仅供内置 Bundled Chromium 使用。
- **Stable 产区**：`~/.agentmb/chrome-profiles/`
  - 供系统级 Chrome (browser-launch / channel chrome) 使用。

### 1.2 路由逻辑
- 当 Session 启动时，`BrowserManager` 必须根据 `browser_channel` 自动计算 `userDataDir`。
- 禁止跨产区读取文件夹，以防止数据库降级损坏。

## 2. 启动增强：Launcher 2.0 (R10-T02)

### 2.1 指令规格
`agentmb browser-launch --profile <name> [--port <p>]`

### 2.2 自动化行为
- 自动拼接 `--user-data-dir="~/.agentmb/chrome-profiles/<name>"`。
- 启动前执行 `fs.access` 检查 `SingletonLock`，若存在则提示“Profile in use”。

## 3. 逻辑流转：全向会话克隆 (R10-T03)

### 3.1 `session fork` (分身)
- **API**: `POST /api/v1/sessions/:id/fork`
- **逻辑**: 调用 `context.storageState()` -> 获取 JSON -> 启动新 Session (可选不同引擎) -> 注入状态。

### 3.2 `session adopt` (收编)
- **API**: `POST /api/v1/sessions/adopt`
- **逻辑**: 从现有 CDP 连接中提取 Cookies/Storage -> 创建新的 Managed Session。

## 4. 运行时：环境热切换 (R10-T04)

### 4.1 `switch-engine` 协议
- **API**: `PUT /api/v1/sessions/:id/switch-engine`
- **Body**: `{ target_channel: 'chrome' | 'chromium', headed?: boolean }`
- **步骤**:
  1. 暂存所有 Page 的 URL 列表。
  2. 暂存当前逻辑登录态 (storageState)。
  3. 关闭旧引擎，拉起新引擎。
  4. 恢复 URL 并在每个 Page 注入状态。

## 5. 资产管理：统一注册表 (R10-T05)

### 5.1 管理指令
- `agentmb profile list`: 格式化输出两个产区的所有目录。
- `agentmb profile delete --name <n>`: 联动清理磁盘。

---
**Orchestrator 签发日期**: 2026-03-02
