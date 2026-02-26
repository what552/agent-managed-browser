# Linux Baseline Verification Record

- **文档日期**：2026-02-26
- **分支**：`feat/r02-hardening`
- **目标平台**：Linux x86_64（Ubuntu 22.04 / Debian 12 为参考发行版）
- **状态**：macOS 通过；Linux 结构性验证通过（见下方）

---

## 1. 系统要求

| 依赖 | 版本 | 获取方式 |
|---|---|---|
| Node.js | 20 LTS (>=20.0.0) | `nvm install 20` |
| Python | 3.11+ | `apt-get install python3.11` |
| Playwright Chromium | 1.50+ (ms-playwright) | `npx playwright install chromium` |
| Xvfb *(仅 headed 模式)* | 任意 | `apt-get install xvfb` |

## 2. `--no-sandbox` 路径说明

Linux 服务器环境下，Chromium 默认需要 sandbox 权限（setuid sandbox），在容器/受限环境中通常不可用。

openclaw-browser 在 `src/browser/manager.ts` 中已硬编码以下参数：

```typescript
args: [
  '--no-sandbox',              // 禁用进程沙箱（Linux 容器必须）
  '--disable-setuid-sandbox',  // 禁用 setuid 沙箱
  '--disable-dev-shm-usage',   // 避免 /dev/shm OOM（小内存 VM）
  '--disable-accelerated-2d-canvas',
  '--no-first-run',
  '--no-zygote',
]
```

**安全权衡**：`--no-sandbox` 降低了 Chromium 进程间隔离级别。在 localhost-only daemon 场景下（`host: 127.0.0.1`，无外部网络暴露），该风险可接受。如需更高安全级别，应在 Docker + user namespace 或 gVisor 中运行。

## 3. 无头模式验证（headless — 不需要 DISPLAY）

```bash
# 克隆 & 安装
git clone <repo> && cd openclaw-browser
nvm use 20
npm install
npx playwright install chromium

# 构建
npm run build

# 启动 daemon（headless 默认）
node dist/daemon/index.js &

# 验证
curl http://127.0.0.1:19315/health
# → {"status":"ok","version":"0.1.0","uptime_s":2,"sessions_active":0}

# Python smoke tests
pip install httpx pydantic pytest pytest-asyncio
python3 -m pytest tests/e2e/test_smoke.py -q
# → 14 passed

# 或使用一键脚本
bash scripts/linux-verify.sh
```

## 4. 有头模式（headed — 需要 DISPLAY/Xvfb）

```bash
# 安装 Xvfb
apt-get install -y xvfb

# 启动虚拟显示（在后台）
Xvfb :99 -screen 0 1280x720x24 &
export DISPLAY=:99

# 创建 session 并切换 headed（会在虚拟显示中打开窗口）
node dist/cli/index.js session new --profile myprofile
node dist/cli/index.js login <session-id>
# → 浏览器在 Xvfb 虚拟显示器上打开
# → 可通过 VNC 连接 :99 进行可视化操作
```

## 5. 结构性验证结果（macOS 代理 Linux）

以下验证在 macOS 上完成，等价于 Linux headless 路径（均使用 `--no-sandbox`，无 DISPLAY 依赖）：

| 检查项 | 结果 |
|---|---|
| `--no-sandbox` 存在于 `src/browser/manager.ts` | ✅ |
| `--disable-dev-shm-usage` 存在（小内存 VM 保护） | ✅ |
| `npm run build` 通过（TypeScript 0 errors） | ✅ |
| `pytest test_smoke.py -q` 14/14 | ✅ |
| `pytest test_auth.py -q` 7/7 | ✅ |
| `pytest test_handoff.py -q` 5/5 | ✅ |
| daemon 启动 / 优雅退出 (SIGTERM) | ✅ |
| sessions.json 持久化跨重启 | ✅ |

## 6. 已知 Linux 差异项（R02 待确认）

| 差异 | 影响 | 缓解方案 |
|---|---|---|
| headed 模式需要 DISPLAY/Xvfb | 中 | 已有文档；Xvfb 命令在脚本末尾 |
| Chromium 路径因发行版不同而异 | 低 | `npx playwright install chromium` 固定路径 |
| /dev/shm 在某些 k8s pod 中不存在 | 中 | `--disable-dev-shm-usage` 已包含 |
| 容器中默认 root 运行需 `--no-sandbox` | 高 | 已硬编码；正确处理 |

## 7. 复现命令（一键）

```bash
bash scripts/linux-verify.sh
```

脚本涵盖：Node 版本检查 → build → daemon 启动 → pytest → `--no-sandbox` 代码路径确认 → 清理。

---

*下一步：Linux 实机验证应在 Ubuntu 22.04 / Debian 12 Docker 容器中执行，结果追加到本文档的「实机验证」节。*
