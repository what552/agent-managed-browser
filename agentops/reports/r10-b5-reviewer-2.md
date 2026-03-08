# R10-B5 Reviewer-2 Gate Summary

- **Reviewer**: Reviewer-2 (Claude Sonnet 4.6)
- **Round / Batch**: R10 / b5
- **Baseline SHA**: 37e4f8d (r10-c03 dev summary)
- **Target SHA**: 222fdee (feat(r10-c05): T11 extract-image + T13 allow-extensions + version 0.4.0)
- **Commits reviewed**: 373036e → daf3b42 (c04) + daf3b42 → 222fdee (c05)
- **Review date**: 2026-03-08

---

## Verify 结果

```
ALL GATES PASSED (35/35)
```

| # | Suite | Result |
|---|-------|--------|
| 1 | Build | PASS |
| 2 | Daemon start :19358 | PASS |
| 3 | smoke (15) | PASS |
| 4 | auth (11) | PASS |
| 5 | handoff (6) | PASS |
| 6 | cdp (8) | PASS |
| 7 | actions-v2 (10) | PASS |
| 8 | pages-frames (7) | PASS |
| 9 | network-cdp (8) | PASS |
| 10 | c05-fixes (10) | PASS |
| 11 | policy (11) | PASS |
| 12 | element-map (9) | PASS |
| 13–28 | r07–r09 historical suites | PASS |
| 29 | r10c01 (7) | PASS |
| 30 | r10c02 (16) | PASS |
| 31 | r10c03 (10, 2 skipped) | PASS |
| 32 | r10c04 (9, 1 skipped) | PASS |
| 33 | r10c05 (11) | PASS |
| 34 | r09-stability (20, 1 warning) | PASS |
| 35 | Daemon stop | PASS |

Total: 35/35 PASS。无 FAIL，warnings 均为历史已知告警（r09 stability suite）。

---

## 变更范围分析（37e4f8d..222fdee）

### C04: `feat(r10-c04)` — switch-engine + P1 docs

**新功能：**
- `PUT /api/v1/sessions/:id/switch-engine`：Chromium ↔ Chrome/Edge 热切换，携带 cookies + localStorage 迁移
- CLI `session switch-engine`：对应 CLI 命令，使用 `apiPut`
- P1 文档：`grant-permission`、profile 管理、eval await、fork、adopt（`skills/agentmb/SKILL.md` 增 79 行）

**代码评估：**
- switch-engine 实现分 5 步（export → create → inject cookies → inject localStorage initScript → close source），rollback 逻辑正确（新 session 启动失败时回滚，source 不受影响）
- localStorage 通过 `addInitScript` 延迟注入，属合理折衷（无法直接 evaluate 跨 origin）
- `VALID_CHANNELS` 校验完整（chromium/chrome/msedge）
- 审计日志写入完整（`action: 'switch_engine'`）
- 测试文件 `test_r10c04.py`（217 行，9 passed 1 skipped）：覆盖正常切换、cookie 迁移、rollback、400/404 错误场景

**细节观察（无阻断问题）：**
- `oldChannel` 取自 `sourceSession.browserChannel ?? 'chromium'`，与实际运行时 channel 一致，正确
- `crypto.randomBytes` 直接在 route 层使用，而非 `actionId()` helper，属可接受但轻微不一致（P2）

### C05: `feat(r10-c05)` — T11 extract-image + T13 allow-extensions + v0.4.0

**新功能：**
- `POST /api/v1/sessions/:id/extract-image`：使用 Playwright `locator.screenshot()` 精确提取元素像素数据，返回 base64 + 元数据
- `--allow-extensions` / `allow_extensions`：session 级别扩展开关，默认 `--disable-extensions`（secure-by-default）
- CLI `extract-image <session-id> <selector>`：自动保存文件
- version bump 0.3.2 → 0.4.0

**代码评估：**
- `extractImage` 实现简洁：`locator.waitFor({ state: 'visible', timeout: 5000 })` + `locator.screenshot()` + `locator.evaluate()` 提取元数据
- `(el as any)` 转型用于避免 Node.js DOM 类型冲突，注释已说明原因，可接受
- `src?: string` 条件返回：`imgSrc !== window.location.href` 用于过滤 blob/data URL 情况，逻辑稳健
- `allow_extensions` 在 session 创建响应中返回，状态可观测
- `verify.sh` TOTAL 计数更新正确（非 Windows: 33→35，Windows: 32→34）
- 测试文件 `test_r10c05.py`（195 行，11 passed）：覆盖 PNG/JPEG 格式验证、magic bytes 校验、400/422/404 错误路径、extensions 默认关闭与显式开启

---

## 风险分级

| 级别 | 项目 | 说明 |
|------|------|------|
| P2 | switch-engine audit log 使用 `crypto.randomBytes` 而非 `actionId()` | 轻微不一致，不影响功能 |
| P2 | localStorage 迁移为 initScript 延迟注入，首次导航后才生效 | 已知设计折衷，文档需说明 |

无 P0/P1 风险。

---

## Gate 结论

**Go**

- verify 35/35 全通过
- C04 switch-engine 实现正确，rollback 逻辑完善
- C05 extract-image 功能正确，安全默认（extensions disabled）
- 两批次代码质量良好，测试覆盖充分
- 无阻断性问题
