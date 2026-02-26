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

## 4. all-open 三 pane（主进程所在）

当前 `all-open` 就是主进程窗口（不是镜像）：

- `all-open.0`：Claude（`feat/r01-mvp`）
- `all-open.1`：Codex（`review/codex-r01`）
- `all-open.2`：Gemini（`review/gemini-r01`）

```bash
# 查看 all-open 当前进程
tmux list-panes -t agentops:all-open -F '#P cmd=#{pane_current_command} path=#{pane_current_path}'
```

## 5. 各 pane 启动命令

```bash
# pane 0 (claude)
cd "/Users/guoyifei/programing/6. agent teams/bppool-claude" && claude

# pane 1 (codex)
cd "/Users/guoyifei/programing/6. agent teams/bppool-codex" && codex

# pane 2 (gemini)
cd "/Users/guoyifei/programing/6. agent teams/bppool-gemini" && gemini
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
