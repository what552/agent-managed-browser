# 项目上下文（CONTEXT）

> 用途：沉淀工程约束与协作规则，确保不同 Agent/成员在一致上下文中执行。

## 1) 技术栈（Tech Stack）
- **语言与运行时**：`<例如：TypeScript + Node.js 20>`
- **前端**：`<例如：React / Vue / Next.js>`
- **后端**：`<例如：FastAPI / NestJS / Go>`
- **数据层**：`<例如：PostgreSQL / Redis / Vector DB>`
- **基础设施**：`<例如：Docker / Kubernetes / Serverless>`
- **CI/CD**：`<例如：GitHub Actions / GitLab CI>`

## 2) 代码规范（Code Standards）
- **风格规范**：`<例如：ESLint + Prettier / Black + Ruff>`
- **分支策略**：`<例如：trunk-based / GitFlow>`
- **提交规范**：`<例如：Conventional Commits>`
- **评审规则**：
  - 至少 1 名 Reviewer
  - 关键改动需附测试或验证步骤
  - 禁止将凭证、密钥写入仓库

## 3) 目录规范（Directory Conventions）
```text
<repo-root>/
  agentops/                 # 协作文档与治理
    reports/                # 跨模型/跨角色评审报告
  src/                      # 业务源码（按模块拆分）
  tests/                    # 测试代码
  scripts/                  # 自动化脚本
  docs/                     # 对外/对内补充文档
```

## 4) 环境变量规范（Environment Variables）
- **命名规则**：全大写 + 下划线，例如：`SERVICE_API_KEY`
- **分层配置**：
  - 本地：`.env.local`
  - 测试：`.env.test`
  - 生产：由 CI/CD 密钥管理注入
- **安全要求**：
  - `.env*` 默认加入 `.gitignore`
  - 密钥轮转周期与权限最小化
  - 日志与报错中自动脱敏

## 5) Agent 协作边界（Agent Collaboration Boundaries）
- **任务分解边界**：每个 Agent 只处理一个明确子任务（输入、输出、验收标准清晰）。
- **变更边界**：禁止跨模块“顺手修复”无关问题；必要时单独建任务。
- **决策边界**：架构/规范变更必须先记录到 `DECISIONS.md` 再实施。
- **交付边界**：每次交付需包含“变更说明 + 验证结果 + 风险提示”。
- **冲突处理**：若多 Agent 结论冲突，以 `TASK.md` 验收标准和 `DECISIONS.md` 为准。

## 6) 术语与约定（Glossary）
- **P0/P1**：优先级分层，P0 为必须交付。
- **Blocker**：阻塞发布或主流程不可用的问题。
- **DoD（Definition of Done）**：功能、质量、文档三项均满足验收要求。
