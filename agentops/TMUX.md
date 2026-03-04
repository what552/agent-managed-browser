# Tmux 协作指令速查

> 适用于当前项目的多 Agent 协作会话：`agentops`
> 协作分支/评审门禁规则见：`agentops/RULES.md`

## 0. 跨项目一键启动（推荐）

在任意 Git 仓库根目录执行：

```bash
./scripts/agentops_bootstrap.sh --round r02 --topic hardening
```

作用：

- 自动创建/切换三条分支：`feat/rXX-topic`、`review/codex-rXX`、`review/gemini-rXX`
- 自动创建三个 worktree：`../<repo>-claude`、`../<repo>-codex`、`../<repo>-gemini`
- 自动初始化缺失的 `agentops/` 文档骨架（可用 `--no-init-docs` 关闭）
- 自动启动 tmux 会话与 `all-open` 三 pane（可用 `--no-launch` 仅建结构不启动命令）

## 1. 会话与窗口约定

- 会话名：`agentops`
- 常用窗口：
  - `0: all-open`（主工作窗口，三 pane 都是主进程）
  - `4: dashboard`（HTML 实时看板服务）

## 2. 常用连接命令

```bash
# 进入会话
tmux attach -t agentops

# 查看会话
tmux list-sessions

# 查看窗口
tmux list-windows -t agentops
```

## 3. 快捷键（当前已配置）

- 前缀键：`Ctrl-a`（保留 `Ctrl-b` 也可用）
- 切窗口：`Ctrl-a` 后按 `0/4`
- 切 pane：`Ctrl-a` 后按方向键，或按 `o`
- 脱离会话：`Ctrl-a` 后按 `d`
- 已开启鼠标：可直接点击 pane/窗口切换

## 4) all-open-2 四 pane（主进程所在）

当前 `all-open-2` 就是主进程窗口（多角色并行）：

- `all-open-2.0`：Builder（`feat/rXX-builder`）
- `all-open-2.1`：Reviewer-1（`review/rXX-reviewer-1`）
- `all-open-2.2`：Researcher（`research/rXX-researcher`）
- `all-open-2.3`：Reviewer-2（`review/rXX-reviewer-2`）

```bash
# 查看 all-open-2 当前进程与标题
tmux list-panes -t agentops:all-open-2 -F '#P title=#{pane_title} path=#{pane_current_path}'
```

## 5) 各角色面板启动命令（示例）

```bash
# builder (pane 0)
cd "../bppool-claude" && <agent-command>

# reviewer-1 (pane 1)
cd "../bppool-codex" && <agent-command>

# researcher (pane 2)
cd "../bppool-codex-research" && <agent-command>

# reviewer-2 (pane 3)
cd "../bppool-gemini" && <agent-command>
```

## 6. 重启后恢复（推荐）

```bash
cd "/Users/guoyifei/programing/6. agent teams/bppool"
./scripts/restore_tmux.sh
tmux attach -t agentops
```

## 7. 诊断与抓取输出

```bash
# 查看所有窗口当前命令与路径
tmux list-windows -t agentops -F '#I:#W:#{pane_current_command}:#{pane_current_path}'

# 抓 all-open 某个 pane 最近输出（例如 Gemini: pane 2）
tmux capture-pane -pt agentops:all-open.2 -S -120 | tail -n 80
```

## 8. Claude 自动确认（无条件 Yes）

```bash
# 启动（当前默认盯 all-open.0，不再是旧的 claude-build）
./scripts/claude_auto_yes.sh start agentops all-open 0

# 或盯旧窗口名（如未来恢复 claude-build）
./scripts/claude_auto_yes.sh start

# 状态
./scripts/claude_auto_yes.sh status

# 停止
./scripts/claude_auto_yes.sh stop

# 日志
tail -f /tmp/claude_auto_yes.log
```

## 9. 任务 Prompt 模板（强制安全版）

下发 Builder / Reviewer 任务时，建议直接复用以下模板，避免端口串扰与误杀进程。

### 9.1 Reviewer 全量评审模板（串行）

```text
好的，老板。请执行 <批次> 补充评审（仅此任务）。
Baseline SHA=<...>；Target SHA=<...>；评审分支=<review/...>。

执行规范（必须）：
1) 先 git switch --detach <Target SHA>。
2) 只按本端口清理 daemon，禁止 pkill -f：
   PORT="$AGENTMB_PORT"
   lsof -tiTCP:${PORT} -sTCP:LISTEN | xargs kill 2>/dev/null || true
3) 运行全量门禁：
   AGENTMB_PORT=<19357|19358> AGENTMB_DATA_DIR=<对应目录> bash scripts/verify.sh
4) 验证后切回 <review/...>，只更新评审报告并 commit（不要 push）。

并发纪律（必须）：
- 先确认另一位 Reviewer 未在运行 verify.sh；Reviewer 全量门禁必须串行，不得并行。

产出：
- 报告需记录：端口/DataDir、端口定向清理命令、是否串行执行、verify.sh 结果、结论（Go/Conditional Go/No-Go）。
```

### 9.2 Builder 全量预检模板

```text
好的，老板。请执行 <批次> 开发预检（仅此任务）。
目标 SHA=<...>；分支=<feat/...>。

执行规范（必须）：
1) 仅按本端口清理 daemon，禁止 pkill -f：
   PORT="$AGENTMB_PORT"
   lsof -tiTCP:${PORT} -sTCP:LISTEN | xargs kill 2>/dev/null || true
2) 运行全量门禁：
   AGENTMB_PORT=19315 AGENTMB_DATA_DIR=/tmp/agentmb-builder bash scripts/verify.sh
3) 在开发总结中记录：清理命令、端口/DataDir、verify.sh 结果。
```
