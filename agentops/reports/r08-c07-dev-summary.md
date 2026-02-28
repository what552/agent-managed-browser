# R08-C07 Dev Summary

**Branch**: feat/r08-builder
**Date**: 2026-02-28
**Author**: Claude Builder
**Gate result**: 24/24 PASS (verify.sh全绿)

---

## 目标

解决 R08-b2 评审中的 P1/P2 缺陷，实现全链路对齐。

---

## 变更清单

### [P1] run_steps 完整支持 ref_id 解析

**文件**: `src/daemon/routes/actions.ts`

新增 `resolveRefIdForStep()` 辅助函数，供 run_steps dispatch loop 内部使用（throw 而非 reply）：
- 格式校验：`snap_XXXXXX:eN` 格式；格式不合法 → 明确报错 `Invalid ref_id format`
- 快照查找：通过 BrowserManager `getSnapshot(sessionId, snapshotId)` 获取快照
- 失效检测：对比 `snapshot.page_rev` 与当前 `bm.getPageRev(sessionId)`，失效则报 `stale_ref: page changed`
- 快照不存在：报 `stale_ref: snapshot not found or expired`

所有 run_steps action case（click/fill/type/press/hover/scroll）均改用 `resolveRefIdForStep()` 并接受 `ref_id` 参数。

### [P1] auto_fallback frame 偏移补偿

**文件**: `src/daemon/routes/actions.ts`

auto_fallback 执行路径在 frame 内点击时，追加 frame 相对页面的偏移量：
```typescript
if (frame && target !== s.page) {
  const frameRect = await (target as Frame).evaluate<{x:number;y:number}>(
    '(() => { const el = window.frameElement; if (!el) return {x:0,y:0}; const r = el.getBoundingClientRect(); return {x: r.x, y: r.y}; })()'
  )
  cx += Math.round(frameRect.x)
  cy += Math.round(frameRect.y)
}
```
使用字符串表达式（非箭头函数）以兼容 TypeScript 的 `window` 变量检查。

### [P1] CLI 参数对齐

**文件**: `src/cli/commands/actions.ts`

| 命令 | 新增参数 |
|---|---|
| `fill` | `--fill-strategy <normal\|type>`, `--char-delay-ms <ms>` |
| `mouse-move` | x/y 改为可选，`--selector`, `--element-id`, `--ref-id`, `--steps <n>` |
| `scroll-until` | `--step-delay-ms <ms>` |

### [P2] CLI 新增命令

**文件**: `src/cli/commands/actions.ts`

| 命令 | 功能 |
|---|---|
| `find <sid> <type> <query>` | 语义查找元素（text/role/label/placeholder），支持 `--json` |
| `settings <sid>` | 返回 session 设置（viewport/headless/url），支持 `--json` |
| `cookie-delete <sid> <name>` | 删除指定 cookie，支持 `--domain/--path/--url` |
| `upload-url <sid> <url> [selector]` | 从 URL 摄取文件并上传到 file input |

---

## 测试

新增 `tests/e2e/test_r08c07.py`（19 个测试）：
- run_steps ref_id: click、fill、stale_ref 错误处理、invalid format 报错
- auto_fallback in frame: iframe 内元素点击
- CLI fill: `--fill-strategy type` 和默认 normal
- CLI mouse-move: 坐标、`--steps`、`--selector`
- CLI scroll-until: `--step-delay-ms`
- CLI find: text/role/json
- CLI settings: text/json
- CLI cookie-delete: 基本删除、带 `--domain`
- CLI upload-url: selector 模式

`scripts/verify.sh` TOTAL 23 → 24，新增 r08c07 suite gate。

---

## Gate 结果

```
ALL GATES PASSED (24/24)
```

各 suite：smoke(15) auth(11) handoff(6) cdp(8) actions-v2(10) pages-frames(7) network-cdp(8) c05-fixes(10) policy(11) element-map(9) r07c02(24) r07c03(22) r07c04(27+1skip) r08c01(15) r08c02(15) r08c03(16) r08c04(18) r08c05(28) r08c06(30) r08c06-modes(10) **r08c07(19)**
