# R04-C02 开发总结

- **轮次**：R04
- **批次**：c02
- **分支**：`feat/r04-next`
- **目标提交（SHA）**：`dfe9e97`
- **归档日期**：2026-02-26
- **负责人**：Claude Sonnet 4.6

---

## 变更目标

按 R04 目标完成“全量去 openclaw 命名”，统一迁移到 `agentmb`（代码、脚本、CI、SDK、测试、主文档）。

---

## 变更范围

### 1. Node/Daemon/CLI 命名与配置迁移

**主要文件**：
- `src/daemon/config.ts`
- `src/daemon/index.ts`
- `src/daemon/session.ts`
- `src/daemon/routes/actions.ts`
- `src/cli/client.ts`
- `src/cli/commands/start.ts`
- `src/cli/commands/status.ts`
- `src/cli/index.ts`

**关键改动**：
- 环境变量：`OPENCLAW_*` -> `AGENTMB_*`
- 默认目录：`~/.openclaw` -> `~/.agentmb`
- CLI/daemon 输出文案统一为 `agentmb`

### 2. Python SDK 迁移为 agentmb

**主要文件**：
- `sdk/python/openclaw/*` -> `sdk/python/agentmb/*`（3 文件重命名）
- `sdk/python/pyproject.toml`
- `sdk/python/README.md`

**关键改动**：
- 包名：`openclaw-browser` -> `agentmb`
- wheel packages：`["openclaw"]` -> `["agentmb"]`
- import 路径：`from openclaw ...` -> `from agentmb ...`

### 3. 测试 / 脚本 / CI 同步

**主要文件**：
- `tests/e2e/test_smoke.py`
- `tests/e2e/test_handoff.py`
- `tests/e2e/test_auth.py`
- `tests/e2e/test_cdp.py`
- `scripts/verify.sh`
- `scripts/linux-verify.sh`
- `scripts/xvfb-headed.sh`
- `.github/workflows/ci.yml`

**关键改动**：
- 测试 import 与环境变量前缀统一改为 `agentmb` / `AGENTMB_*`
- 脚本临时文件名与变量前缀改为 `agentmb`
- CI 中 SDK import 与相关变量改为 `agentmb`

### 4. 文档与包元数据同步

**主要文件**：
- `package.json`
- `README.md`
- `INSTALL.md`
- `docs/linux-headed.md`
- `.gitignore`

**关键改动**：
- npm 包名：`openclaw-browser` -> `agentmb`
- CLI bin：仅保留 `agentmb`（移除 `openclaw` 别名）
- 文档示例命令统一切换到 `agentmb`
- `.gitignore` 目录前缀切换到 `~/.agentmb`

---

## 最小验证结果（开发分支反馈）

```bash
npm run build
# -> pass

node dist/cli/index.js --help
# -> Usage: agentmb ...

python3 -c "import agentmb; print(agentmb.__version__)"
# -> agentmb 0.1.0
```

---

## 已知剩余项 / 风险

1. 文档残留：`sdk/python/README.md` 第 3 行链接文字仍为 `openclaw-browser`（不影响功能，建议在 r04-c03 修正）。
2. `package-lock.json` 名称字段可能需要在下一次 `npm install` 后由 lockfile 自动刷新。
3. 用户侧若仍配置 `OPENCLAW_*`，升级后需手动迁移到 `AGENTMB_*`。

---

## 结论

r04-c02 已完成大规模命名迁移主工作，具备进入 r04-b02（工程+交付）评审条件。
