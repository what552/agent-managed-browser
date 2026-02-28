# R08-C03 开发总结

**分支**: `feat/r08-next`
**日期**: 2026-02-28
**负责人**: Claude
**Port**: 19315 | **Data Dir**: `/tmp/agentmb-claude`
**范围**: R08-T03 + R08-T05

---

## 交付清单

| 任务 | 文件改动 | 状态 |
|---|---|---|
| T03 synthesized label (element-map + snapshot-map) | `src/browser/actions.ts` + Python SDK models | DONE |
| T05 --include-unlabeled CLI/API/SDK | `src/cli/commands/actions.ts`, `src/daemon/routes/actions.ts`, `sdk/python/agentmb/client.py` | DONE |

---

## 技术实现

### T03 — synthesized label (element-map + snapshot-map)

**问题**: icon-only 交互元素（仅有 SVG 的按钮等）在 element-map/snapshot-map 中 `text`/`name` 为空字符串，LLM 无法区分。

**实现**:
- `ElementInfo` interface 新增两个字段：
  - `label: string` — 合成的最优人类可读标签
  - `label_source: string` — 标签来源（`'aria-label' | 'title' | 'aria-labelledby' | 'svg-title' | 'text' | 'placeholder' | 'fallback' | 'none'`）
- `elementMap()` opts 新增 `include_unlabeled?: boolean`
- evaluate 回调中新增 `synthesizeLabel(el, cx, cy)` 内联函数，按优先级链计算 label：
  1. `aria-label` 属性
  2. `title` 属性
  3. `aria-labelledby` → 所有引用元素 textContent 拼接
  4. SVG `<title>` 或 `<desc>` 的 textContent（查询 `el.querySelector('svg > title/desc')`）
  5. `innerText` / `textContent` trimmed
  6. `placeholder` 属性
  7. 若 `include_unlabeled=true`：`[tag @ cx,cy]`（`label_source='fallback'`）
  8. 否则：`label=''`, `label_source='none'`
- Python SDK: `ElementInfo` + `SnapshotElement` models 新增 `label: str = ""` + `label_source: str = "none"` (Optional with defaults, backward-compatible)

### T05 — --include-unlabeled (snapshot-map + element-map)

**问题**: icon-only 元素无 accessible text，snapshot-map 限制未文档化，缺乏 fallback label 机制。

**实现**:
- **CLI**:
  - `element-map` description 新增限制说明；新增 `--include-unlabeled` 选项
  - `snapshot-map` description 重写，明确标注"Limitation: elements with no accessible text..."；新增 `--include-unlabeled` 选项
  - 输出行格式改为显示 `label`（优先于 `text`）并在旁附注 `[label_source]`
- **API** (`src/daemon/routes/actions.ts`):
  - `element_map` + `snapshot_map` 路由 Body 均新增 `include_unlabeled?: boolean`，默认 `false`，透传给 `elementMap()`
- **Python SDK** (`client.py`):
  - `Session.element_map()`: 新增 `include_unlabeled: bool = False`
  - `Session.snapshot_map()`: 新增 `include_unlabeled: bool = False`，docstring 说明限制
  - `AsyncSession.element_map()`: 同步更新
  - `AsyncSession.snapshot_map()`: 同步更新

---

## 向后兼容性

- `label` / `label_source` 字段带默认值（`"" / "none"`），已有代码无需修改
- 现有 `text` / `name` / `placeholder` 字段保持不变
- CLI 输出格式小变：label 列改用 `label` 字段，`[label_source]` 注记（仅当 source 非 none 时显示）
- `include_unlabeled` 默认 `false`，不改变现有行为

---

## 测试结果

### r08-c03 专项（16 tests）

```
tests/e2e/test_r08c03.py::TestSynthesizedLabelElementMap::test_label_from_aria_label             PASSED
tests/e2e/test_r08c03.py::TestSynthesizedLabelElementMap::test_label_from_title                  PASSED
tests/e2e/test_r08c03.py::TestSynthesizedLabelElementMap::test_label_from_aria_labelledby        PASSED
tests/e2e/test_r08c03.py::TestSynthesizedLabelElementMap::test_label_from_svg_title              PASSED
tests/e2e/test_r08c03.py::TestSynthesizedLabelElementMap::test_label_from_text                   PASSED
tests/e2e/test_r08c03.py::TestSynthesizedLabelElementMap::test_label_from_placeholder            PASSED
tests/e2e/test_r08c03.py::TestSynthesizedLabelElementMap::test_label_empty_for_bare_icon_button  PASSED
tests/e2e/test_r08c03.py::TestSynthesizedLabelElementMap::test_all_elements_have_label_field     PASSED
tests/e2e/test_r08c03.py::TestIncludeUnlabeledElementMap::test_include_unlabeled_gives_fallback_label  PASSED
tests/e2e/test_r08c03.py::TestIncludeUnlabeledElementMap::test_include_unlabeled_false_gives_empty     PASSED
tests/e2e/test_r08c03.py::TestIncludeUnlabeledElementMap::test_labeled_elements_unaffected_by_flag     PASSED
tests/e2e/test_r08c03.py::TestSynthesizedLabelSnapshotMap::test_snapshot_map_has_label_fields          PASSED
tests/e2e/test_r08c03.py::TestSynthesizedLabelSnapshotMap::test_snapshot_map_aria_label_wins           PASSED
tests/e2e/test_r08c03.py::TestSynthesizedLabelSnapshotMap::test_snapshot_map_include_unlabeled         PASSED
tests/e2e/test_r08c03.py::TestSynthesizedLabelSnapshotMap::test_snapshot_map_ref_id_still_works        PASSED
tests/e2e/test_r08c03.py::TestSynthesizedLabelSnapshotMap::test_snapshot_map_svg_title_source          PASSED
16 passed in 3.52s
```

### 全量回归 verify.sh (19/19)

```
[1/19]  Build                  PASS
[2/19]  Daemon start           PASS
[3/19]  smoke       (15)       PASS
[4/19]  auth        (11)       PASS
[5/19]  handoff     (6)        PASS
[6/19]  cdp         (8)        PASS
[7/19]  actions-v2  (10)       PASS
[8/19]  pages-frames (7)       PASS
[9/19]  network-cdp (8)        PASS
[10/19] c05-fixes   (10)       PASS
[11/19] policy      (11)       PASS
[12/19] element-map (9)        PASS
[13/19] r07c02      (24)       PASS
[14/19] r07c03      (22)       PASS
[15/19] r07c04      (27+1skip) PASS
[16/19] r08c01      (15)       PASS
[17/19] r08c02      (15)       PASS
[18/19] r08c03      (16)       PASS
[19/19] Daemon stop            PASS
ALL GATES PASSED (19/19)
```

**测试命令**: `AGENTMB_PORT=19315 AGENTMB_DATA_DIR=/tmp/agentmb-claude bash scripts/verify.sh`

---

## 改动文件汇总

| 文件 | 改动类型 |
|---|---|
| `src/browser/actions.ts` | T03: `ElementInfo` 新增 `label`/`label_source`；`elementMap()` 新增 `include_unlabeled` 参数 + `synthesizeLabel()` 函数 |
| `src/daemon/routes/actions.ts` | T05: `element_map` + `snapshot_map` 路由接受 `include_unlabeled` 参数 |
| `src/cli/commands/actions.ts` | T05: `element-map` + `snapshot-map` 命令增加 `--include-unlabeled` 旗标；更新 description；输出列改用 label |
| `sdk/python/agentmb/models.py` | T03: `ElementInfo` + `SnapshotElement` 新增 `label` + `label_source` 字段（默认值兼容旧客户端） |
| `sdk/python/agentmb/client.py` | T05: `element_map`/`snapshot_map`（sync+async）新增 `include_unlabeled` 参数 |
| `tests/e2e/test_r08c03.py` | 16 个 e2e 测试（新建） |
| `scripts/verify.sh` | TOTAL 18→19，新增 r08c03 suite |
| `agentops/TODO.md` | T03/T05 TODO→DONE；Done Log 补 2 条记录 |
