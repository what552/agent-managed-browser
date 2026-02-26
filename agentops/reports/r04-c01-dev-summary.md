# R04-C01 开发总结

- **轮次**：R04
- **批次**：c01
- **分支**：`feat/r04-next`
- **目标提交（SHA）**：`d3df6bd`
- **归档日期**：2026-02-26
- **负责人**：Claude Sonnet 4.6

---

## 变更目标

将 CLI 命令面从 `openclaw` 切换到 `agentmb`，但保留旧命令别名以保证过渡期兼容。

---

## 变更范围

### 1. CLI 主命令切换到 agentmb

**文件**：`src/cli/index.ts`

- `program.name('openclaw')` -> `program.name('agentmb')`
- CLI 描述文案切换为 `agentmb`
- `start` / `stop` 子命令描述同步切换

### 2. npm bin 暴露新旧双入口（兼容期）

**文件**：`package.json`

- 新增：`"agentmb": "./dist/cli/index.js"`
- 保留：`"openclaw": "./dist/cli/index.js"`

### 3. 用户文档示例切换到 agentmb

**文件**：`README.md`、`INSTALL.md`

- 快速上手命令改为 `agentmb start/status/session/...`
- 安装/验证步骤中的 CLI 调用统一为 `agentmb`

---

## 最小验证结果

```bash
npm run build
# -> 0 errors

node dist/cli/index.js --help
# -> Usage: agentmb [options] [command]
```

---

## 交付结论

- r04-c01 达成“CLI 表层命名切换”目标。
- Python SDK 包名与环境变量前缀在本批次未改动，留待 r04-c02 完成全量迁移。

---

## 后续项（已在 r04-c02 处理）

- [ ] 去掉 `openclaw` CLI 兼容别名
- [ ] 全仓环境变量与默认目录前缀迁移
- [ ] Python SDK 包目录与 import 路径迁移
