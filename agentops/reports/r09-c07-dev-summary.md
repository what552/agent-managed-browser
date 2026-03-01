# R09-C07 开发归档

**分支**：`feat/r09-builder`
**Commit**：`29c0666` `feat(r09-c07): symlink guard, navigate timeout, page leak, SDK version check`
**日期**：2026-03-01
**验证结果**：30/30 ALL GATES PASSED

---

## 背景

本批次依据以下研究报告：
- `agentops/reports/r09-stability-research.md`（稳定性研究：内存泄露、并发竞态、极端延迟）
- `agentops/reports/r09-destructive-test.md`（破坏性测试：Symlink 穿透、版本兼容、README 文档陷阱）

同时将 Reviewer-1 编写的 `test_r09_stability.py`（20 个测试）整合进标准 verify.sh 门控。

---

## 实现清单

### P0-1 — Symlink 路径穿透漏洞修复

**文件**：`src/daemon/routes/sessions.ts`、`src/daemon/routes/actions.ts`、`src/browser/manager.ts`

**根因**：`path.resolve()` 只做字符串规范化，不跟随磁盘上的符号链接。攻击者在 `allow_dir` 内创建指向任意外部目录的 symlink，`startsWith` 检查通过，但 `readdir` 读取的是 symlink 指向的目标。

**修复**：
1. `handleLs`（sessions.ts）：将 `path.resolve(reqPath)` 改为 `fs.promises.realpath(reqPath)`，捕获路径不存在时返回 404。
2. `navigate` file:// guard（actions.ts）：同样改为 `fs.promises.realpath(filePath)`。
3. `launchSession`（manager.ts）：`allowDirs` 存储时也用 `realpath`，解决 macOS `/var` → `/private/var` 差异（原 `path.resolve()` 不跟随此 symlink）。

**额外副效**：修复后，macOS 环境下 `handleLs` 返回的 `path` 字段变为 realpath（`/private/var/...`）。同步更新 `test_r09c04.py` 和 `test_r09c06.py` 中的路径断言为 `os.path.realpath(tmpdir)`。

---

### P0-2 — Navigate 超时级联崩溃修复

**文件**：`src/browser/manager.ts`、`src/browser/actions.ts`、`src/daemon/routes/actions.ts`

**根因**：
1. `delay_ms` 无上界（最大可达 999999ms = 16.7 分钟），导航超时（30s）后 pending timer 仍运行
2. Timer 触发时 `route.fulfill()` 在已销毁的 request context 上抛出异常，无 try/catch
3. Async handler 中的 unhandled rejection 在 Node.js 20 下终止进程（或崩溃 browser manager）
4. `navigate` 无可配置超时参数，调用方无法提前中断

**修复**：

| 修复点 | 代码位置 | 变更 |
|--------|---------|------|
| delay_ms 上界 | manager.ts addRoute handler | `Math.min(delay_ms, 60_000)` （60s，高于 Playwright 默认 30s 形成安全间隔）|
| route.fulfill 保护 | manager.ts addRoute handler | `try { await route.fulfill(...) } catch { /* ignore */ }` |
| navigate timeout_ms 参数 | browser/actions.ts `navigate()` | 新增 `timeoutMs = 30_000`，传给 `page.goto({ timeout })` |
| navigate 路由接受 timeout_ms | daemon/routes/actions.ts navigate 路由 | Body 增加 `timeout_ms?`，pfRange 验证 `[0, 60_000]`，透传给 Actions.navigate |

**稳定性测试验证**：`test_r09_stability.py::TestNetworkDelayFallback::test_large_delay_ms_navigate_timeout_returns_error`（delay=35000ms）：导航 30s 超时后 daemon 仍健康（之前触发级联崩溃导致 9 个后续测试全部以 503 失败）。

---

### P1-1 — Page 关闭后内存泄露修复

**文件**：`src/browser/manager.ts`

**根因**：`closePage()` 调用 `page.close()` 后，附着在 Page 上的事件监听器闭包等待 GC 释放，高频 create+close 下 heap 线性增长。

**修复**：在 `page.close()` 前调用 `page.removeAllListeners()`，立即释放所有监听器闭包。

```typescript
// R09-C07-P1
page.removeAllListeners()
await page.close()
state.pages.delete(pageId)
```

**稳定性测试验证**：
- `test_page_create_close_cycle_cleans_pages_map`：10 次 create+close，最终 1 页 ✓
- `test_rapid_page_cycle_50_rounds`：50 次循环，最终 1 页 ✓（之前为 51 页）

---

### P1-2 — SDK 强版本校验

**文件**：`sdk/python/agentmb/client.py`、`sdk/python/agentmb/__init__.py`

新增 `VersionMismatchError(RuntimeError)` 异常类，携带 `sdk_version` 和 `daemon_version` 属性。

新增 `check_daemon_version(strict=True)` 方法（同步 + 异步版本）：
- `strict=True`（默认）：版本不匹配时抛出 `VersionMismatchError`
- `strict=False`：版本不匹配时发出 `warnings.warn`，返回 `False`；匹配时返回 `True`

`VersionMismatchError` 已导出至 `agentmb.__init__.__all__`。

---

### P2 — README CLI 表格补齐

**文件**：`README.md`

**修复**：补充文档研究中发现的 4 个缺失 CLI 命令：

| 命令 | 新增位置 |
|------|---------|
| `agentmb find <sess> <type> <query>` | Semantic Find 章节增加 CLI 代码块 |
| `agentmb settings <sess>` | Browser Environment and Controls 章节增加 CLI 一行 |
| `agentmb cookie-delete <sess> <name>` | Session State 表格新增一行 |
| `agentmb upload-url <sess> <url> <sel>` | upload from URL 改为 CLI + API/SDK 双标注 |

---

### test_r09_stability.py 整合

将 Reviewer-1 编写的稳定性测试（main 分支）复制至当前分支，作为独立 verify.sh gate。

**测试结构**（20 个测试）：

| 方向 | 测试数 | 状态 |
|------|--------|------|
| Direction 1: Memory leak | 5 | ✅ 全绿 |
| Direction 2: Concurrency races | 6 | ✅ 全绿 |
| Direction 3: Network delay fallback | 8 | ✅ 全绿（原 7 失败，级联修复） |
| Combined stress | 1 | ✅ 全绿（原级联失败） |

运行时间：~112s（含多个 30s 导航超时场景）

---

## 验证

```
30/30 ALL GATES PASSED
```

新增 gates：
- `[28/30] r09c07... PASS  (11 passed, 1 warning in 13.95s)`
- `[29/30] r09-stability... PASS  (20 passed, 1 warning in 111.53s)`

scripts/verify.sh: `TOTAL=28 → 30`

---

## 关键设计决策

| 决策 | 原因 |
|------|------|
| delay_ms cap=60000 而非 30000 | 30000 与 Playwright 默认超时相同，会导致竞态；60000 有清晰间隔 |
| allowDirs 存储时 realpath | path.resolve 只做字符串，不跟随磁盘 symlink；macOS /var→/private/var 需要 realpath |
| VersionMismatchError 不在 __init__ 中自动检查 | 避免网络调用阻塞导入；用户显式调用 check_daemon_version() |
| test_r09_stability.py 整合为独立 gate | 20 个测试运行时间长（>2min），与 c07 分开使 CI 输出可读 |
