# R08-C04 开发总结

**分支**: `feat/r08-next`
**日期**: 2026-02-28
**负责人**: Claude
**Port**: 19315 | **Data Dir**: `/tmp/agentmb-claude`
**范围**: R08-R03 + R08-R04

---

## 交付清单

| 任务 | 文件改动 | 状态 |
|---|---|---|
| R08-R03 scroll_until/load_more_until e2e 覆盖 | `tests/e2e/test_r08c04.py` (新建) | DONE |
| R08-R04 drag ref_id 支持 | `src/daemon/routes/actions.ts` + Python SDK | DONE |
| R08-R04 AsyncSession drag/mouse_move/mouse_down/mouse_up | `sdk/python/agentmb/client.py` | DONE |
| R08-R04 AsyncSession.scroll_until scroll_selector parity | `sdk/python/agentmb/client.py` | DONE |
| R08-R04 CLI drag --source-ref-id/--target-ref-id | `src/cli/commands/actions.ts` | DONE |

---

## 技术实现

### R08-R03 — scroll_until / load_more_until e2e 覆盖

**背景**: 这两个原语（scroll_until / load_more_until）已在 r07-c02 完整实现（daemon路由、Python SDK、CLI），缺少专项 e2e 测试。

**实现**:
- `TestScrollUntil`（4 tests）：stop_text（stop_reason=`text_found`）、max_scrolls 限制（`max_scrolls`）、stall 检测（短页面 `stall`/`max_scrolls`）、result fields 验证
- `TestLoadMoreUntil`（3 tests）：max_loads 限制、item_count_reached 停止、result fields 验证

**发现的实际 stop_reason 值**（与直觉不同）:
- stop_text 触发 → `text_found`（不是 `stop_text`）
- item_count 触发 → `item_count_reached`（不是 `item_count`）
- 短页面 stall 可能先触发 `max_scrolls`（取决于 max_scrolls 阈值与 stall_ms 的竞争）

### R08-R04 — 低层输入原语完善

**背景**: drag/mouse/scroll_until 已实现，但有以下缺口：
1. `drag` 路由不支持 `source_ref_id`/`target_ref_id`（user 要求"selector+ref_id 优先"）
2. `AsyncSession` 缺少 `drag()`、`mouse_move()`、`mouse_down()`、`mouse_up()`
3. `AsyncSession.scroll_until()` 缺少 `scroll_selector` 参数（与 sync 版本不一致）
4. CLI `drag` 只支持位置参数 CSS selector，无 ref_id 选项

**实现**:

#### drag 路由（daemon）
旧版手动拼接 `source_element_id` → CSS selector，现在改为复用 `resolveTarget()` 工具函数，分别解析 source 与 target：
```typescript
const src = resolveTarget({ selector: source, element_id: source_element_id, ref_id: source_ref_id }, reply, s.id)
if (!src) return
const tgt = resolveTarget({ selector: target, element_id: target_element_id, ref_id: target_ref_id }, reply, s.id)
if (!tgt) return
```
- ref_id 会走完整的 snapshot freshness check（`page_rev` 比对 → 409 stale_ref）
- Body 类型扩展：`source_ref_id?: string; target_ref_id?: string`

#### Python SDK — drag sync
新增 `source_ref_id: Optional[str] = None` + `target_ref_id: Optional[str] = None` 参数

#### Python SDK — AsyncSession 补齐
新增：
- `async def drag(source?, target?, source_element_id?, target_element_id?, source_ref_id?, target_ref_id?, ...)` → `DragResult`
- `async def mouse_move(x, y, ...)` → `MouseResult`
- `async def mouse_down(x?, y?, button?, ...)` → `MouseResult`
- `async def mouse_up(button?, ...)` → `MouseResult`
- `async def scroll_until(scroll_selector?, ...)` — 补加 `scroll_selector` 参数与 sync 对齐

#### CLI drag
新增 `--source-ref-id` + `--target-ref-id` 选项；如果指定 ref_id，则不传位置参数中的 CSS selector：
```typescript
if (opts.sourceRefId) { body.source_ref_id = opts.sourceRefId } else { body.source = source }
if (opts.targetRefId) { body.target_ref_id = opts.targetRefId } else { body.target = target }
```

---

## 向后兼容性

- drag 路由新增字段均为可选，现有 `source`/`target`/`source_element_id`/`target_element_id` 路径不变
- AsyncSession 新增方法，不影响已有方法
- CLI `drag` 命令新增选项为 optional，positional args 仍可用

---

## 测试结果

### r08-c04 专项（18 tests）

```
tests/e2e/test_r08c04.py::TestScrollUntil::test_scroll_until_stop_text          PASSED
tests/e2e/test_r08c04.py::TestScrollUntil::test_scroll_until_max_scrolls_stops  PASSED
tests/e2e/test_r08c04.py::TestScrollUntil::test_scroll_until_stall_detection    PASSED
tests/e2e/test_r08c04.py::TestScrollUntil::test_scroll_until_result_fields      PASSED
tests/e2e/test_r08c04.py::TestLoadMoreUntil::test_load_more_until_max_loads     PASSED
tests/e2e/test_r08c04.py::TestLoadMoreUntil::test_load_more_until_item_count    PASSED
tests/e2e/test_r08c04.py::TestLoadMoreUntil::test_load_more_until_result_fields PASSED
tests/e2e/test_r08c04.py::TestDrag::test_drag_css_selectors                     PASSED
tests/e2e/test_r08c04.py::TestDrag::test_drag_with_source_ref_id                PASSED
tests/e2e/test_r08c04.py::TestDrag::test_drag_result_fields                     PASSED
tests/e2e/test_r08c04.py::TestMousePrimitives::test_mouse_move                  PASSED
tests/e2e/test_r08c04.py::TestMousePrimitives::test_mouse_down_up               PASSED
tests/e2e/test_r08c04.py::TestMousePrimitives::test_mouse_move_then_click_sequence PASSED
tests/e2e/test_r08c04.py::TestMousePrimitives::test_mouse_result_fields         PASSED
tests/e2e/test_r08c04.py::TestAsyncMouseDrag::test_async_drag                   PASSED
tests/e2e/test_r08c04.py::TestAsyncMouseDrag::test_async_mouse_move             PASSED
tests/e2e/test_r08c04.py::TestAsyncMouseDrag::test_async_mouse_down_up          PASSED
tests/e2e/test_r08c04.py::TestAsyncMouseDrag::test_async_scroll_until_with_scroll_selector PASSED
18 passed in 17.71s
```

### 全量回归 verify.sh (20/20)

```
[1/20]  Build                  PASS
[2/20]  Daemon start           PASS
[3/20]  smoke       (15)       PASS
[4/20]  auth        (11)       PASS
[5/20]  handoff     (6)        PASS
[6/20]  cdp         (8)        PASS
[7/20]  actions-v2  (10)       PASS
[8/20]  pages-frames (7)       PASS
[9/20]  network-cdp (8)        PASS
[10/20] c05-fixes   (10)       PASS
[11/20] policy      (11)       PASS
[12/20] element-map (9)        PASS
[13/20] r07c02      (24)       PASS
[14/20] r07c03      (22)       PASS
[15/20] r07c04      (27+1skip) PASS
[16/20] r08c01      (15)       PASS
[17/20] r08c02      (15)       PASS
[18/20] r08c03      (16)       PASS
[19/20] r08c04      (18)       PASS
[20/20] Daemon stop            PASS
ALL GATES PASSED (20/20)
```

**测试命令**: `AGENTMB_PORT=19315 AGENTMB_DATA_DIR=/tmp/agentmb-claude bash scripts/verify.sh`

---

## 改动文件汇总

| 文件 | 改动类型 |
|---|---|
| `src/daemon/routes/actions.ts` | R08-R04: drag 路由 Body 新增 `source_ref_id`/`target_ref_id`；改用 `resolveTarget()` 分别解析 source/target |
| `src/cli/commands/actions.ts` | R08-R04: drag 命令新增 `--source-ref-id`/`--target-ref-id` 选项；更新 description |
| `sdk/python/agentmb/client.py` | R08-R04: `Session.drag()` 新增 source_ref_id/target_ref_id；`AsyncSession` 新增 drag/mouse_move/mouse_down/mouse_up；`AsyncSession.scroll_until()` 补 scroll_selector |
| `tests/e2e/test_r08c04.py` | 18 个 e2e 测试（新建）：scroll_until/load_more_until/drag/mouse 原语 |
| `scripts/verify.sh` | TOTAL 19→20；新增 r08c04 suite |
| `agentops/TODO.md` | R08-R03/R08-R04 TODO→DONE；分批建议补 r08-c04；Done Log 补 2 条记录 |
