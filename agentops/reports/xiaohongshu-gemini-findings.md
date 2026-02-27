# Xiaohongshu Regression Findings (Gemini)

Date: 2026-02-27  
Context: Gemini 在小红书场景下对 `agentmb` 的实测反馈，供 Codex/Claude 复现与修复。

## Issue 1: 虚假的 500 错误与响应同步失效（Client-Daemon Synchronization）

- 现象：
  - CLI 或 Python SDK 报 `500 Internal Server Error`。
  - 但 `agentmb logs` 显示后端动作已执行成功（`status=ok`）。
- 推测根因：
  - Daemon 端动作执行耗时叠加（例如安全策略 throttle + 后续稳定性检查）超过客户端超时。
  - 动作本身完成后，在后处理阶段（如稳定性检查、快照生成）异常，导致响应链路失败。
- 复现建议：
  - 在 `safe` policy 下连续执行 `fill -> click -> wait-stable`，同时降低客户端 read timeout。
  - 对照 `agentmb logs` 与 CLI/SDK 返回值，检查“后端成功但客户端 500”是否出现。
- 修复建议：
  - 后端改为更清晰的“动作已触发”与“后处理完成”状态表达（必要时异步化后处理）。
  - 客户端支持更长 timeout + 可配置重试。

## Issue 2: ElementMap ID 在高动态页面下易失效（ID Volatility in SPA）

- 现象：
  - 在 SPA（如小红书）中，`element-map` 生成的 `e1/e2` 在短时间或一次交互后失效。
- 推测根因：
  - `element-map` 是静态快照式 DOM 映射，页面异步更新后映射可能与当前真实 DOM 不一致。
- 复现建议：
  - 先 `element-map`，再触发弹窗/滚动/异步加载后使用旧 `element_id` 操作。
  - 记录失效比例与错误码分布。
- 修复建议：
  - 文档明确：动态页面优先 `snapshot-map` + `ref_id`。
  - 找不到元素时可评估后端小范围重扫策略（谨慎，避免误点）。

## Issue 3: Safety Policy 与执行链冲突

- 现象：
  - 日志频繁出现 `throttle`，链式操作（例如 `fill` 紧跟 `click`）触发客户端超时。
- 推测根因：
  - `safe` 策略引入阻塞式节流/抖动，客户端未感知“正在节流等待”状态。
- 复现建议：
  - 在 `safe` 下跑高频链式动作，并对比 `permissive/disabled` 三种 profile 的耗时与失败率。
- 修复建议：
  - 返回体追加节流相关字段（例如 `throttled_ms`）提升可观测性。
  - 为测试场景提供明确的低延迟配置路径（如 `permissive` 或 `disabled`）。

## Issue 4: CLI 参数与后端 API 字段不一致

- 现象：
  - 帮助信息提示参数存在，但执行报 `unknown option`（示例：`scroll` 参数命名）。
- 推测根因：
  - CLI 参数命名、内部映射、后端字段名存在偏差或文档滞后。
- 复现建议：
  - 用 `agentmb <command> --help` 与真实执行逐一对照，建立参数一致性清单。
- 修复建议：
  - 统一参数命名规范并补自动化校验（CLI help -> handler mapping -> API schema）。
  - 错误返回增加结构化字段，避免仅看到泛化 `500`。

## 建议给开发执行的任务描述

> 请检查 `agent-managed-browser` 的后端 actions 路由与 CLI 映射。重点解决：  
> 1) 动作执行成功但返回 500 的同步问题；  
> 2) `snapshot-map/ref_id` 在 click 链路中的健壮性；  
> 3) CLI 参数与 API 字段对齐；  
> 4) `wait-stable` 在复杂 SPA 场景下的超时与退化策略。  

## 备注

- 本文档为问题记录与复现输入，不代表最终 root cause 结论。
- 建议后续由 Codex/Claude 各自补一轮最小可复现实验日志并链接到该文档。
