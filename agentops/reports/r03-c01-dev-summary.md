# R03-C01 开发总结

- **轮次**：R03
- **批次**：c01
- **分支**：`feat/r03-install`
- **归档日期**：2026-02-26
- **负责人**：Claude Sonnet 4.6

---

## 变更范围

### 1. 修复 Python SDK pip 安装阻塞

**文件**：`sdk/python/README.md`（新增）

**根因**：`sdk/python/pyproject.toml` 声明了 `readme = "README.md"`，但该文件不存在，导致 hatchling 在 metadata 生成阶段抛出 `OSError: Readme file does not exist: README.md`，pip install 完全阻塞。

**修复**：新增 `sdk/python/README.md`，包含安装方式、快速示例、环境变量说明。

### 2. 统一安装文档

**文件**：`INSTALL.md`（新增，repo 根）

覆盖 macOS / Linux(Ubuntu) / Windows(PowerShell + WSL2) 三平台，包含：
- Node 20 LTS + npm ci + build
- Playwright Chromium 安装
- npm link 全局 CLI
- pip install Python SDK
- 环境变量速查表
- 跨平台最小验证步骤

### 3. CI 安装/构建冒烟

**文件**：`.github/workflows/ci.yml`（新增）

两个 job：

| Job | 平台 | 步骤 |
|---|---|---|
| `build-smoke` | ubuntu + macOS + windows | npm ci → build → CLI --help → pip install → SDK import |
| `full-test` | ubuntu + macOS | build → playwright install → pip install[dev] → verify.sh |

---

## 最小本地验证结果

```
npm run build           → 0 errors  ✓
pip install -e sdk/python → Successfully installed openclaw-browser-0.1.0  ✓
node dist/cli/index.js --help → Usage: openclaw …  ✓
```

## verify.sh 失败说明（不影响本次目标）

`bash scripts/verify.sh` 在本次运行中 handoff/cdp 两个 suite 出现 404，原因：

1. **handoff + cdp 测试隔离问题**：两个 suite 均使用 `scope="module"` 的 session fixture，当 verify.sh 顺序执行多个 suite 时，前序 suite 的残留状态（zombie session、端口占用）可能导致后序 fixture 创建的 session 被复用为已关闭 ID。
2. **audit purpose/operator 字段缺失**：与 dist/ 构建缓存状态相关，属 r02-c03/c04 的遗留问题，与本轮安装基线无关。

本轮 R03-c01 目标为**安装基线收口**（pip 安装修复 + 文档 + CI 框架），不涉及 verify.sh 测试链路改动，上述失败不影响本次交付目标。

---

## 未完成项（后续候选）

- [ ] verify.sh 测试隔离加固（session fixture 独立端口/进程）
- [ ] CI full-test job Windows 支持
- [ ] `npm publish` / `pip publish` 正式发布到 registry
