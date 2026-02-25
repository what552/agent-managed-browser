# 协作待办（TODO）

> 用途：追踪当前迭代可执行事项，明确优先级、负责人、截止时间和状态。

## 状态定义
- `TODO`：待开始
- `IN_PROGRESS`：进行中
- `BLOCKED`：受阻
- `DONE`：已完成

## 当前迭代待办
| ID | 任务 | 优先级 | 负责人 | 截止日期 | 状态 | 备注 |
|---|---|---|---|---|---|---|
| T-001 | 完善 `TASK.md` 中 KPI 与验收细则 | P0 | `<Owner>` | `<YYYY-MM-DD>` | TODO | `<依赖/说明>` |
| T-002 | 补齐 `ARCHITECTURE.md` 模块图与数据流 | P0 | `<Owner>` | `<YYYY-MM-DD>` | TODO | `<依赖/说明>` |
| T-003 | 完成首轮模型评审并生成报告 | P1 | `<Owner>` | `<YYYY-MM-DD>` | TODO | `<依赖/说明>` |

## R02 定稿待办（openclaw-browser）

### R02-c01（P0 首批）
| ID | 任务 | 优先级 | 负责人 | 状态 | 验收标准 |
|---|---|---|---|---|---|
| R02-T01 | 修复 `session rm` 假成功问题（`apiDelete` 请求头导致 DELETE 400） | P0 | Claude | TODO | `openclaw session rm <id>` 实际删除成功，返回码与提示一致 |
| R02-T02 | 实现登录接管闭环（headed 可视化接管 → 用户登录 → 恢复自动化） | P0 | Claude | TODO | 提供可执行命令/流程；登录后可继续 `navigate/extract` |
| R02-T03 | 增加登录接管与鉴权测试（含 API token 正/反向） | P0 | Claude | TODO | 新增测试可在 CI/本地稳定通过 |

### R02-c02（P0 收口 + 基线）
| ID | 任务 | 优先级 | 负责人 | 状态 | 验收标准 |
|---|---|---|---|---|---|
| R02-T04 | 固化回归门禁（build + daemon + smoke pytest） | P0 | Claude | TODO | 标准脚本一键执行并输出明确 pass/fail |
| R02-T05 | Linux 运行基线验证（含 `--no-sandbox`） | P0 | Claude | TODO | Linux 环境完成端到端最小链路并有记录 |
| R02-T06 | Node 版本基线收敛到 20 LTS | P0 | Claude | TODO | 版本要求与文档一致，构建测试通过 |

### R02 P1（可并行）
| ID | 任务 | 优先级 | 负责人 | 状态 | 验收标准 |
|---|---|---|---|---|---|
| R02-T07 | Linux headed 场景 Xvfb 自动化脚本 | P1 | Claude | TODO | 文档化脚本可复现 headed 流程 |
| R02-T08 | CDP 直通端点（`/api/v1/sessions/:id/cdp`） | P1 | Claude | TODO | 端点可用并有最小测试 |
| R02-T09 | npm/pip 发布流程 dry-run 与交付文档补齐 | P1 | Gemini | TODO | 发布流程文档完整且可演练 |
| R02-T10 | 审计字段增强（`purpose/operator`） | P1 | Claude | TODO | 审计日志新增字段并兼容现有读取 |

## 阻塞项（Blockers）
| ID | 阻塞描述 | 影响任务 | 需要支持 | 预计解除时间 |
|---|---|---|---|---|
| B-001 | `<阻塞描述>` | `<任务ID>` | `<需要谁支持>` | `<YYYY-MM-DD>` |

## 完成记录（Done Log）
| 日期 | 任务ID | 完成内容 | 完成人 |
|---|---|---|---|
| `<YYYY-MM-DD>` | `<T-XXX>` | `<简述>` | `<Name>` |
