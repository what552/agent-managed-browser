# Codex 评审报告

## R05-b2 工程评审
- **评审日期**：`2026-02-26`
- **评审轮次**：`R05`
- **评审批次**：`r05-b2`
- **目标开发分支**：`origin/feat/r05-next`
- **目标提交（SHA）**：`dd6fbed`
- **评审分支**：`review/codex-r05`
- **评审范围**：`origin/main..origin/feat/r05-next`（含 `c01/c02/c03/c04`，重点复核 `r05-b1` P1/P2）
- **评审人**：`Codex`

## 总体结论
- **Gate**：`No-Go`
- **一句话结论**：`r05-b1 的 P1 已基本关闭，但本范围内存在 1 条新的 P1（frame 失配静默回退主页面执行），且 r05-b1 的 1 条 P2（acceptDownloads 默认开启）仍未关闭。`

## r05-b1 关闭性复核
| 条目 | 结论 | 证据 |
|---|---|---|
| P1-1: CLI 缺 `wait_for_response` | 已关闭 | `src/cli/commands/actions.ts:171` 新增 `wait-response` |
| P1-2: upload/download 内存放大风险 | 基本关闭（降级） | `src/daemon/routes/actions.ts:284`（upload 50MB guard），`src/browser/actions.ts:397`（download `maxBytes`） |
| P2-1: Async SDK 上传同步 I/O | 已关闭 | `sdk/python/agentmb/client.py:451-459` 使用 `asyncio.to_thread` |
| P2-2: 未使用导入 | 已关闭 | `src/browser/actions.ts` 已移除 `path/os` |
| P2-3: `acceptDownloads: true` 默认开启 | 未关闭 | `src/browser/manager.ts:61` 仍为全局默认开启 |

## Findings（P0/P1/P2）

### P0
- 无

### P1
1. `frame` 选择失败会静默回退到主页面执行动作，可能在错误上下文中点击/填表。
   - 位置：`src/daemon/routes/actions.ts:20-27`
   - 影响：当调用方传错 frame（name/url/nth）时，不会报错，而是对主页面执行，存在误操作风险。
   - 建议：当请求显式携带 `frame` 且未解析到目标 frame 时，返回 `422`（含 diagnostics），禁止回退主页面。

### P2
1. `acceptDownloads` 仍为全局默认开启，r05-b1 遗留项未收口。
   - 位置：`src/browser/manager.ts:61`
   - 影响：所有会话默认具备下载能力，安全边界过宽。
   - 建议：改为会话级显式开关（默认关闭）或至少补充强制策略与文档约束。
2. 允许关闭最后一个 page，但未建立替代 active page，后续动作可落到已关闭 page 引用。
   - 位置：`src/browser/manager.ts:119-133`，`src/daemon/routes/sessions.ts:177-186`
   - 影响：会话仍存活但可能进入“无可用页面”状态，行为不稳定且错误语义不清晰。
   - 建议：禁止关闭最后一个 page（返回 `409`），或自动新建并切换到新 page。

## 验证说明
- 本次结论基于 `dd6fbed` 代码静态评审与变更对比（`origin/main..origin/feat/r05-next`）。
- 受当前执行环境限制，未在本工作区直接完成针对 `dd6fbed` 的端到端联网回归执行。静态证据已在上述文件行号列出。
