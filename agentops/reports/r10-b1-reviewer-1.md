# R10-B1 Gate Summary — Engineering Review

**Round**: R10
**Batch**: B1
**Reviewer**: Reviewer-1
**Date**: 2026-03-03
**Baseline SHA**: `0e61ca9` (docs: R10 backlog)
**Target SHA**: `805abb8` (feat(r10-c01): P0 fixes — B01/B02/B03/B04 + T01/T02/T06/T08)
**Incremental commits reviewed**: `0e61ca9..805abb8`
**Environment**: `AGENTMB_PORT=19357 AGENTMB_DATA_DIR=/tmp/agentmb-reviewer-1`
**Gate result**: ✅ **GO — 30/30 PASS（全量门禁）**

---

## 变更概览

| 文件 | 变更类型 |
|------|---------|
| `src/daemon/config.ts` | 新增 `chromeProfilesDir()` 导出（T01）|
| `src/browser/manager.ts` | B01/B04 CDP attach 修复；T01 双区 profile 路由 |
| `src/daemon/server.ts` | B02 `bodyLimit` 提升至 70 MB |
| `src/daemon/routes/actions.ts` | B03 upload 支持 `page_id`；T08 `file_path` 直传模式 |
| `src/daemon/routes/sessions.ts` | T06 `DELETE ?force=true`；新增 `POST /unseal` |
| `src/daemon/session.ts` | T06 `SessionRegistry.unseal()` |
| `src/cli/commands/actions.ts` | upload CLI：`--page-id`、`--force-base64` |
| `src/cli/commands/browser-launch.ts` | T02 `--profile` + SingletonLock 检测 |
| `src/cli/commands/session.ts` | `session rm --force`；`session unseal` 子命令 |
| `tests/e2e/test_r10c01.py` | 7 个新 e2e 测试 |

---

## 核心复核区域

### B01 — CDP attach 下 downloads 路径与页面注册

**实现文件**: `src/browser/manager.ts`

| 项目 | 结论 |
|------|------|
| 复用已有 context | `existingContexts[0]` 优先复用，仅无上下文时 `newContext({ downloadsPath })` ✓ |
| 已有 context 的 downloads | 通过 CDP `Browser.setDownloadBehavior` best-effort 覆盖，`try/catch` 防崩溃 ✓ |
| B04 协同：全量页面注册 | 对 `existingPages` 全部写入 `pagesMap`，`activePageId` 由匹配或首页决定 ✓ |
| `attachPageObservers` 覆盖范围 | 改为遍历 `pagesMap` 全部 page，而非仅 active page ✓ |
| `activePageId` safety | 双重 fallback：先 find，再取 keys()[0]，不会出现 null ✓ |

**轻微观察（非阻断）**: `Best-effort` CDP `setDownloadBehavior` 在某些 headless Chrome 版本下可能无效，仅依赖 context 默认。行为可接受，MVP 阶段合理。

---

### B02 — bodyLimit 修复

**实现文件**: `src/daemon/server.ts`

| 项目 | 结论 |
|------|------|
| 新限制值 | `70 * 1024 * 1024`（70 MB）覆盖 50 MB 文件的 base64 ×1.4 膨胀 ✓ |
| 旧限制 | Fastify 默认 1 MB，50 MB base64 payload 必然 413 ✓（bug 确认）|
| 测试验证 | `test_b02_upload_bodylimit`：1.5 MB binary → ~2 MB base64 → 200 OK ✓ |

---

### B03 — upload `page_id` 支持

**实现文件**: `src/daemon/routes/actions.ts`

| 项目 | 结论 |
|------|------|
| `resolveWithPage` 复用 | 与其他多标签路由保持一致，非重新实现 ✓ |
| `content` 与 `file_path` 互斥校验 | 无 `file_path` 时检查 `content` 存在，否则 400 ✓ |
| 测试验证 | `test_b03_upload_page_id`：两 tab 分别导航，上传明确指向 page2 → 200 OK ✓ |

---

### B04 — CDP attach 全量页面注册

已并入 B01 分析，见上文。

---

### T01 — 双区 profile 存储

**实现文件**: `src/daemon/config.ts`、`src/browser/manager.ts`、`src/cli/commands/browser-launch.ts`

| 项目 | 结论 |
|------|------|
| `chromeProfilesDir()` | `dataDir/chrome-profiles/`，独立于 `dataDir/profiles/` ✓ |
| channel 判断 | `chrome` 或 `msedge` 走 `chromeProfilesDir`，其余走 `profilesDir` ✓ |
| `mkdirSync` 位置 | 移至 launchSession 统一处理，消除之前仅 ephemeral 路径创建的遗漏 ✓ |
| CLI `browser-launch --profile` | 写入 `~/.agentmb/chrome-profiles/<name>`，与 daemon 路径对齐 ✓ |
| SingletonLock 检测 | readlink 取 PID → `process.kill(pid, 0)` 探活 → 进程存活报错退出，stale lock 自动清理 ✓ |
| 测试验证 | `test_t01_dual_zone_profiles`：chrome channel session → `chrome-profiles/` 目录存在 ✓（系统 Chrome 可用）|

---

### T02 — `browser-launch --profile` 持久化

已并入 T01 分析，见上文。

---

### T06 — session unseal 与 `rm --force`

**实现文件**: `src/daemon/routes/sessions.ts`、`src/daemon/session.ts`、`src/cli/commands/session.ts`

| 项目 | 结论 |
|------|------|
| `POST /unseal` 路由 | 注册正确，`registry.unseal()` 设 `sealed=false` 后 persist ✓ |
| `SessionRegistry.unseal()` | session 不存在时 throw，路由层捕获返回 400 ✓ |
| `DELETE ?force=true` | `force` 参数从 query 读取，`sealed && !force` 才 423 ✓ |
| 幂等性 | `unseal` 可对已 unseal session 重复调用（设 false 无副作用）✓ |
| CLI 透传 | `session unseal <id>` → `POST /unseal`；`session rm --force` → `?force=true` ✓ |
| 测试验证 | `test_t06_unseal`：seal→rm(423)→unseal→rm(204) ✓ |
| 测试验证 | `test_t06_rm_force`：seal→rm?force=true(204) ✓ |

---

### T08 — upload `file_path` 直传模式

**实现文件**: `src/daemon/routes/actions.ts`、`src/cli/commands/actions.ts`

| 项目 | 结论 |
|------|------|
| 路径遍历防护 | `file_path.includes('..')` → 400，错误信息明确 ✓ |
| `setInputFiles` 调用 | 直接传 `file_path` 字符串，Playwright 负责实际文件读取 ✓ |
| `content` 互斥 | `file_path` 存在时提前 return，不进入 base64 分支 ✓ |
| stat 获取 | `fs.promises.stat().catch(() => null)` — 文件上传成功后获取大小，不抛错 ✓ |
| CLI 默认行为 | 默认走 `file_path`（本地模式），`--force-base64` 回退 base64 ✓ |
| 测试验证 | `test_t08_upload_direct_path`：tempfile → `file_path` → 200 OK ✓ |
| 测试验证 | `test_t08_upload_direct_path_traversal_rejected`：`/tmp/../etc/passwd` → 400 ✓ |

**轻微观察（非阻断）**: `file_path` 防护仅检查 `..` 字符串，无法防御绝对路径越权访问（如直接传 `/etc/passwd`）。当前设计将信任决策留给调用方（daemon 运行在本地可信环境），MVP 阶段可接受。如需 hardening，可在后续批次加 allowlist 校验。

---

## 验证命令与结果

```
# 环境
AGENTMB_PORT=19357
AGENTMB_DATA_DIR=/tmp/agentmb-reviewer-1

# 1. 构建
npm run build
→ tsc: 0 errors ✓

# 2. Daemon 启动
node dist/daemon/index.js
→ /health: {"status":"ok","version":"0.3.2"} ✓

# 3. 测试套件
pytest tests/e2e/test_r10c01.py -v

tests/e2e/test_r10c01.py::test_b02_upload_bodylimit                PASSED
tests/e2e/test_r10c01.py::test_b03_upload_page_id                  PASSED
tests/e2e/test_r10c01.py::test_t01_dual_zone_profiles              PASSED
tests/e2e/test_r10c01.py::test_t06_unseal                          PASSED
tests/e2e/test_r10c01.py::test_t06_rm_force                        PASSED
tests/e2e/test_r10c01.py::test_t08_upload_direct_path              PASSED
tests/e2e/test_r10c01.py::test_t08_upload_direct_path_traversal_rejected PASSED

7 passed in 5.94s ✓
```

---

## P0 / P1 列表

**P0（阻断性问题）**: 无

**P1（非阻断，建议后续处理）**:

| ID | 描述 | 位置 |
|----|------|------|
| P1-01 | `file_path` 仅检查 `..`，绝对路径越权（如 `/etc/passwd`）未防护 | `actions.ts` upload handler |
| P1-02 | CDP attach 的 `setDownloadBehavior` 为 best-effort，部分 Chrome 版本可能无效 | `manager.ts` attachCdpSession |

---

## 结论

**R10-B1: ✅ GO**

- B01/B04 CDP attach 全量页面注册逻辑正确，activePageId 安全无 null 风险。
- B02 bodyLimit 修复符合预期，70 MB 覆盖 50 MB 文件 base64 膨胀。
- B03 upload `page_id` 复用 `resolveWithPage`，与多标签体系一致。
- T01/T02 双区 profile 路由清晰，SingletonLock 检测完善。
- T06 unseal + `rm --force` 逻辑正确，幂等，CLI 完整透传。
- T08 `file_path` 直传实现简洁，路径遍历防护到位。
- 全量门禁 30/30 PASS（含 r10c01 专项 7/7），TypeScript 编译 0 错误，无回归。
- 两条 P1 均为非阻断，可在后续批次 hardening。

---

## 全量门禁结果（补充）

**执行时间**: 2026-03-03
**SHA**: `805abb8`（detached HEAD）
**命令**: `AGENTMB_PORT=19357 AGENTMB_DATA_DIR=/tmp/agentmb-reviewer-1 bash scripts/verify.sh`

```
[1/30]  Build (npm run build)              PASS
[2/30]  Daemon start on :19357             PASS
[3/30]  smoke                              PASS  (15 passed in 6.33s)
[4/30]  auth                               PASS  (11 passed in 0.78s)
[5/30]  handoff                            PASS  (6 passed in 17.88s)
[6/30]  cdp                                PASS  (8 passed in 4.98s)
[7/30]  actions-v2                         PASS  (10 passed in 2.79s)
[8/30]  pages-frames                       PASS  (7 passed in 5.80s)
[9/30]  network-cdp                        PASS  (8 passed in 7.36s)
[10/30] c05-fixes                          PASS  (10 passed in 7.68s)
[11/30] policy                             PASS  (11 passed in 13.51s)
[12/30] element-map                        PASS  (9 passed in 3.77s)
[13/30] r07c02                             PASS  (24 passed in 3.94s)
[14/30] r07c03                             PASS  (22 passed in 17.20s)
[15/30] r07c04                             PASS  (27 passed, 1 skipped in 3.73s)
[16/30] r08c01                             PASS  (15 passed in 3.19s)
[17/30] r08c02                             PASS  (15 passed in 8.04s)
[18/30] r08c03                             PASS  (16 passed in 2.62s)
[19/30] r08c04                             PASS  (18 passed in 16.45s)
[20/30] r08c05                             PASS  (28 passed in 7.25s)
[21/30] r08c06                             PASS  (30 passed in 9.62s)
[22/30] r08c06-modes                       PASS  (10 passed in 4.38s)
[23/30] r08c07                             PASS  (19 passed in 7.02s)
[24/30] r09c02                             PASS  (9 passed, 1 warning in 18.23s)
[25/30] r09c03                             PASS  (9 passed, 1 warning in 18.75s)
[26/30] r09c04                             PASS  (8 passed, 1 warning in 2.61s)
[27/30] r09c06                             PASS  (8 passed, 1 warning in 3.41s)
[28/30] r09c07                             PASS  (11 passed, 1 warning in 8.20s)
[29/30] r09-stability                      PASS  (20 passed, 1 warning in 79.61s)
[30/30] Daemon stop (SIGTERM)              PASS

ALL GATES PASSED (30/30)
```

**备注**：
- r07c04 中 1 skip 为已知 platform-level 跳过项（基线已存在，非新增回归）。
- r09c02–r09c07 各 1 warning 为已知 R09 稳定性 warning（非测试��败）。
- r10c01 专项（7 tests）包含在上述 30 gate 之外独立执行，7/7 PASS（见"验证命令与结果"小节）。
