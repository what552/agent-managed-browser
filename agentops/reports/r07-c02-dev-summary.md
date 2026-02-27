# r07-c02 设计与实现总结

**Branch**: `feat/r07-next`
**Baseline**: `9040294` (r07-c01-fix)
**Date**: 2026-02-27
**Scope**: T03 / T04 / T08 (已有任务) + T13 / T14 / T18 (本轮新增任务)

---

## 一、研究背景

### 1.1 r07-c01 交付物回顾

r07-c01 实现了三端（API/CLI/SDK）的基础定位与读写能力：

| 能力 | 实现机制 | 生命周期 |
|---|---|---|
| `element_map` | `page.evaluate()` 向 DOM 注入 `data-agentmb-eid="eN"` 属性 | 直至下次 scan 或导航 |
| `element_id` (如 `e3`) | resolveTarget → `[data-agentmb-eid="e3"]` CSS 选择器 | DOM 属性存在期间有效 |
| `get / assert` | Playwright locator API | 当次调用有效 |
| `wait_page_stable` | networkidle + MutationObserver + overlay 轮询 | 单次等待 |

### 1.2 残留问题

**问题 A：element_id 失效无感知**
- 若 Agent 持有 `e3`，页面发生局部 DOM 重建后 `[data-agentmb-eid="e3"]` 可能匹配错误元素或匹配零个元素
- 失败时 Playwright 抛出超时错误（422 ActionDiagnosticsError），Agent 无法区分"元素 ID 过期"与"元素真的消失"

**问题 B：交互原语缺口**
- 缺少 `dblclick`, `focus`, `check/uncheck`, `scroll`, `drag` 等 (T03)
- 缺少 `back/forward/reload`, `wait_text/wait_function` 等 (T04)

**问题 C：滚动加载无原生支持** (T08)
- 需要反复 scroll + element_map 的业务逻辑完全暴露在 Agent 侧

---

## 二、snapshot_map / ref_id / page_rev 设计

### 2.1 核心概念

```
page_rev
  └── 整型计数器，随主框架导航自动递增，存储在 BrowserManager
      初始值 0，每次 framenavigated (main frame) +1

snapshot_map
  └── 在服务端保存一次 element_map 的结果 + 当时的 page_rev
      返回 snapshot_id (snap_XXXXXX) 和带 ref_id 的元素列表
      最多保留 MAX_SNAPSHOTS_PER_SESSION=5 个 (LRU)
      导航时自动清除（page_rev 变化）

ref_id
  └── 格式: "snap_XXXXXX:eN"
      由 snapshot_map 生成，绑定到特定 page_rev
      行动路由接收 ref_id 后：
        1. 解析 snapshotId + eid
        2. 检查 snapshot 是否存在（快照不存在 → 409）
        3. 检查 snapshot.page_rev === session.page_rev（页面变了 → 409 stale_ref）
        4. 通过 eid → [data-agentmb-eid="eN"] 执行动作
```

### 2.2 selector | element_id | ref_id 兼容策略

优先级（高 → 低）：

| 输入字段 | 解析方式 | 错误 |
|---|---|---|
| `ref_id` | 解析快照 → 检查 page_rev → `[data-agentmb-eid="eN"]` | 409 stale_ref |
| `element_id` | 直接 `[data-agentmb-eid="eN"]` | 422 if not found |
| `selector` | 原样传给 Playwright | 422 if not found |
| 三者均无 | 400 Bad Request | — |

```typescript
// 升级后的 resolveTarget (src/daemon/routes/actions.ts)
async function resolveTarget(
  input: { selector?: string; element_id?: string; ref_id?: string },
  session: ReadySession,
  reply: FastifyReply,
): Promise<string | null>
```

### 2.3 ref 生命周期

```
创建:   POST /snapshot_map → 生成 snapshot_id，存入 sessionSnapshots
有效:   session.pageRev === snapshot.pageRev
失效:   page 发生主框架导航 (framenavigated) → pageRev++ → snapshot 自动作废
清除:   session 关闭时全部清除；每 session 最多保留 5 个快照（LRU）
```

### 2.4 stale_ref 错误模型

```
HTTP 409 Conflict
{
  "error": "stale_ref",
  "ref_id": "snap_abc123:e5",
  "snapshot_page_rev": 3,
  "current_page_rev": 5,
  "url": "https://example.com/new-page",
  "message": "Page has navigated since snapshot; call snapshot_map again"
}
```

**Agent 恢复模式：**
```python
try:
    sess.click(ref_id='snap_abc123:e5')
except agentmb.StaleRefError as e:
    snap = sess.snapshot_map()
    btn = next(e for e in snap.elements if 'Submit' in e.text)
    sess.click(ref_id=btn.ref_id)
```

### 2.5 新增任务定义

| Task | 内容 | 优先级 |
|---|---|---|
| **R07-T13** | `snapshot_map` — 服务端快照 + page_rev 追踪 | P1 |
| **R07-T14** | `ref_id` 输入支持 — 升级 resolveTarget，三端对齐 | P1 |
| **R07-T18** | `stale_ref` 错误模型 — 409 响应 + Python SDK StaleRefError + CLI 提示 | P1 |

T15/T16/T17 预留给后续 R07 规划（不在本轮）。

---

## 三、T03/T04/T08 实现规划

### 3.1 T03 — 交互原语扩展

| 动作 | 路由 | Playwright API | 是否接受 element_id/ref_id |
|---|---|---|---|
| `dblclick` | POST `/dblclick` | `locator.dblclick()` | ✓ |
| `focus` | POST `/focus` | `locator.focus()` | ✓ |
| `check` | POST `/check` | `locator.check()` | ✓ |
| `uncheck` | POST `/uncheck` | `locator.uncheck()` | ✓ |
| `scroll` | POST `/scroll` | `locator.evaluate(el => el.scrollBy(x,y))` | ✓ (selector/eid/ref) |
| `scroll_into_view` | POST `/scroll_into_view` | `locator.scrollIntoViewIfNeeded()` | ✓ |
| `drag` | POST `/drag` | `page.dragAndDrop(src, target)` | src+target 均支持 |

低层鼠标/键盘（T03 额外项，action 在 Page 级而非 Actionable）：
- `mouse_move` / `mouse_down` / `mouse_up` — `page.mouse.*`
- `key_down` / `key_up` — `page.keyboard.*`

### 3.2 T04 — Wait / 导航控制增强

| 动作 | 路由 | Playwright API |
|---|---|---|
| `back` | POST `/back` | `page.goBack({ timeout })` |
| `forward` | POST `/forward` | `page.goForward({ timeout })` |
| `reload` | POST `/reload` | `page.reload({ waitUntil, timeout })` |
| `wait_text` | POST `/wait_text` | `page.getByText(text).waitFor({ state:'visible', timeout })` |
| `wait_load_state` | POST `/wait_load_state` | `page.waitForLoadState(state, { timeout })` |
| `wait_function` | POST `/wait_function` | `page.waitForFunction(expr, {}, { timeout })` |

### 3.3 T08 — 通用滚动原语

```
scroll_until:
  参数: { direction, scroll_selector?, stop_selector?, stop_text?, max_scrolls?, stall_ms? }
  逻辑:
    loop(max_scrolls):
      1. 执行一次滚动 (wheel event on scroll_selector or window)
      2. 等待 stall_ms
      3. 检查 stop_selector 出现 或 stop_text 存在
      4. 若无变化超过 stall_ms → stall 停止
  返回: { status, scrolls_performed, stop_reason, duration_ms }

load_more_until:
  参数: { load_more_selector, content_selector, item_count?, stop_text?, max_loads?, stall_ms? }
  逻辑:
    loop(max_loads):
      1. count = locator(content_selector).count()
      2. 若 count >= item_count 或 stop_text 已在页面 → 停止
      3. click(load_more_selector)
      4. 等待 stall_ms；若 count 未变 → stall 停止
  返回: { status, loads_performed, final_count, stop_reason, duration_ms }
```

---

## 四、三端对齐原则

- **命名约束**: 统一使用 `snake_case` (API/SDK) 和 `kebab-case` (CLI)
- **element_id / ref_id**: 所有动作路由均支持 selector | element_id | ref_id 三种输入
- **README 示例**: 统一使用 `client.sessions.create()`（修正 r07-c01 中的旧写法残留）
- **CLI 命令**: 新命令统一命名 `agentmb <verb>-<noun>` 形式
- **SDK**: Sync + Async 镜像实现，类型完整导出

---

## 五、文件变更范围

| 文件 | 变更内容 |
|---|---|
| `src/browser/manager.ts` | 新增 sessionPageRevs + sessionSnapshots；launchSession 注册 framenavigated 监听 |
| `src/browser/actions.ts` | +7 T03 actions, +6 T04 actions, +2 T08 actions, +1 T13 snapshotMap |
| `src/daemon/routes/actions.ts` | resolveTarget 升级为 async (ref_id 检查); +16 新路由; +1 /snapshot_map |
| `sdk/python/agentmb/models.py` | +SnapshotMapResult, +ScrollUntilResult, +LoadMoreResult, +StaleRefError |
| `sdk/python/agentmb/client.py` | +16 Session/AsyncSession 方法 |
| `sdk/python/agentmb/__init__.py` | 新增导出 |
| `src/cli/commands/actions.ts` | +16 CLI 命令 |
| `tests/e2e/test_r07c02.py` | 新 e2e 套件 |
| `scripts/verify.sh` | TOTAL 13→14; +r07c02 suite |
| `README.md` | 新增 T03/T04/T08/T13/T14 章节；README 示例统一 client.sessions.create |
| `agentops/TODO.md` | 标记 T03/T04/T08 DONE；新增 T13/T14/T18 条目 |

---

## 六、设计结论与实施决策

1. **snapshot_map 值得实现**：server-side page_rev 追踪代价低（整型计数器 + 小型内存 Map），但给 Agent 提供高价值的"我的理解是否过时"检测。
2. **ref_id 作为 element_id 的上层**：两者共存，ref_id 通过 snapshot 提供生命周期保证，element_id 保持轻量免服务器状态模式。
3. **stale_ref 409 而非 422**：语义更准确（Conflict，不是 Unprocessable）；Agent 代码可精确 catch。
4. **T03/T04/T08 是 r07-c02 P0 核心**：交互原语缺口直接限制 Agent 能力；snapshot/ref (T13/T14/T18) 为 P1，与 T03-T08 同批交付但独立功能。
5. **resolveTarget 升级为 async**：因为 ref_id 解析需要查 snapshot store（同步 Map 访问，实质上是同步但签名改为 async 保证未来可扩展）。
6. **最大快照数 5/session**：内存有界；导航时清空；session 关闭时清空。

---

## 七、验证结果

**verify.sh — 14/14 PASS**

```
[1/14]  Build (npm run build)        PASS
[2/14]  Daemon start                 PASS
[3/14]  smoke         (15 passed)    PASS
[4/14]  auth          (11 passed)    PASS
[5/14]  handoff       (6 passed)     PASS
[6/14]  cdp           (8 passed)     PASS
[7/14]  actions-v2    (10 passed)    PASS
[8/14]  pages-frames  (7 passed)     PASS
[9/14]  network-cdp   (8 passed)     PASS
[10/14] c05-fixes     (10 passed)    PASS
[11/14] policy        (11 passed)    PASS
[12/14] element-map   (9 passed)     PASS
[13/14] r07c02        (23 passed)    PASS
[14/14] Daemon stop                  PASS
```

**r07c02 套件明细 (23 tests)**：

- T-SM-01..04: snapshot_map 基础 + ref_id 格式 + scope + page_rev 递增 ✓
- T-RI-01..02: ref_id 用于 click/fill ✓
- T-SR-01: stale_ref 409 on navigation ✓
- T-T03-01..07: dblclick/focus/check-uncheck/scroll_into_view/key_down-up/mouse_move/mouse_down-up ✓
- T-T04-01..05: back-forward/reload/wait_text/wait_load_state/wait_function ✓
- T-T08-01..04: scroll_until (stop_selector/stop_text/max_scrolls) + load_more_until (item_count_reached) ✓

**三次失败修复记录**：
1. stop_reason 值不符：实际为 `selector_found` / `text_found` / `item_count_reached`（非测试预期的 `stop_selector` / `stop_text` / `item_count`）→ 更新测试断言
2. `Session.click/fill` 未支持 `ref_id` 参数 → 补充 ref_id 分支
3. `AsyncSession.click/fill` 同上 → 补充 ref_id 分支
