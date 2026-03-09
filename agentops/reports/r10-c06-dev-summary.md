# R10-C06 Dev Summary

**Branch**: `feat/r10-builder`
**Baseline SHA**: `472046d`（r10-c05 docs commit）
**Target SHA**: `6169223`
**Date**: 2026-03-09
**Builder**: Claude (Builder)

---

## 交付内容

### Issue #9 — CDP attach 模式 pages list 漏 tab（方案 A：CDP /json reconciliation）

#### 根因（已定位）

| 层级 | 位置 | 问题 |
|------|------|------|
| Playwright 内部 | `crBrowser.js:141` `_waitForAllPagesToBeInitialized()` | 只等待**已加入 `_crPages` 的 pages**；若某些 tab 的 `Target.attachedToTarget` 事件在 `setAutoAttach` 命令 resolve 后才到达（flatten 模式异步竞态），它们不被等待 |
| agentmb | `manager.ts:439` `attachCdpSession()` | 一次性 `ctx.pages()` 快照建 pagesMap，无后续 live reconciliation；漏检的 tab 永远不补 |

#### 修复方案

在 `attachCdpSession()` 中，`pagesMap` 初始建立后，立即从 CDP `/json` 获取 Chrome 所有 `type=page` targets 数量（ground truth）。若 ground truth 数量大于 pagesMap 当前大小，则注册临时 `ctx.on('page', onLateAttach)` 监听器，等待最多 2000ms 让 Playwright 处理延迟到达的 `Target.attachedToTarget` 事件。收到的新 page 直接加入 pagesMap。最终 pagesMap 作为 session 的 pages 快照。

整个 reconciliation 块包裹在 `try/catch` 中——若 `/json` 端点不可达（错误 cdpUrl、非标准 Chrome），静默跳过，不影响现有功能。

---

## 变更文件范围

| 文件 | 类型 | 说明 |
|------|------|------|
| `src/browser/manager.ts` | 修改 | `attachCdpSession()`：reconciliation 块（~30 行）+ active page fallback 修正 |
| `tests/e2e/test_r10c06.py` | 新建 | 5 tests |
| `scripts/verify.sh` | 修改 | TOTAL 35→36，加 r10c06 suite |

---

## 关键代码（manager.ts）

```typescript
// R10-C06: reconcile pagesMap against CDP /json ground truth.
try {
  const cdpBase = cdpUrl.replace(/^ws(s?):\/\//, 'http$1://').split('/json')[0]
  const cdpTargets: Array<{ type: string }> = await fetch(`${cdpBase}/json`)
    .then((r) => r.json() as Promise<Array<{ type: string }>>)
    .catch(() => [])
  const cdpPageCount = cdpTargets.filter((t) => t.type === 'page').length
  if (cdpPageCount > pagesMap.size) {
    await new Promise<void>((resolve) => {
      const deadline = setTimeout(() => {
        ctx.off('page', onLateAttach)
        resolve()
      }, 2000)
      const onLateAttach = (lateP: Page) => {
        const alreadyIn = Array.from(pagesMap.values()).includes(lateP)
        if (!alreadyIn) pagesMap.set(this.newPageId(), lateP)
        if (pagesMap.size >= cdpPageCount) {
          clearTimeout(deadline)
          ctx.off('page', onLateAttach)
          resolve()
        }
      }
      ctx.on('page', onLateAttach)
    })
  }
} catch { /* reconciliation is best-effort; proceed with what we have */ }
```

---

## 验证结果

```
AGENTMB_PORT=19315 AGENTMB_DATA_DIR=/tmp/agentmb-builder bash scripts/verify.sh
```

```
36/36 ALL GATES PASSED
  r10c06: 5 passed
```

---

## 测试覆盖（test_r10c06.py）

| 测试 | 验证点 |
|------|--------|
| `test_pages_list_aligns_with_cdp_json` | attach 后所有 CDP `/json` type=page URL 均出现在 agentmb pages list 中 |
| `test_multiple_tabs_all_visible_after_attach` | attach 前通过 CDP 打开 3 个 tab，attach 后全部可见 |
| `test_no_duplicate_pages_after_reconciliation` | reconciliation 不引入重复 page_id 或重复 URL |
| `test_managed_session_unaffected_by_reconciliation_code` | 托管模式（非 attach）不受影响（回归守护） |
| `test_attach_unreachable_cdp_url_returns_http_error` | 无效 cdpUrl → HTTP 错误，daemon 不 crash |

---

## 关键设计决策

| 决策 | 原因 |
|------|------|
| 用 CDP `/json` 而非 Playwright 内部 API | Playwright `_crPages` 是私有 API，稳定性无保证 |
| 等待 `ctx.on('page', ...)` 而非轮询 | 避免固定延迟；让 Playwright 自然触发事件，只在需要时等待 |
| 2000ms 超时 | 足够覆盖正常 Chrome attach 的 event 延迟；不至于阻塞 daemon 过长 |
| try/catch 包裹 reconciliation | 非标准 CDP 端点或网络问题不应破坏现有 attach 功能 |
| `chrome://newtab/` → `chrome://new-tab-page/` URL 规范化（仅测试层） | CDP 和 Playwright 对 new-tab URL 的表示不同，测试层统一规范 |

---

## 已知局限（未解决，转下轮）

- **Discarded tabs**：Chrome 内存优化丢弃（discard）的 tab 在 CDP 中可见但 Playwright 无法 attach，reconciliation 等待超时后仍不可见。这是 Playwright + Chrome 的硬限制，需要在 `pages list` 返回值中增加 `discarded: true` 标记来区分。
- **新标签追踪的竞态**（newly opened tabs）：reconciliation 块中的 `onLateAttach` 监听器和后续 `autoTrackNewPages` 的监听器之间有极小的竞态窗口（reconciliation resolve 到 `autoTrackNewPages` 注册之间）。目前 `autoTrackNewPages` 有重复检查，实际影响可忽略。
