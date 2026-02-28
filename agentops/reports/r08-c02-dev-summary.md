# R08-C02 开发总结

**分支**: `feat/r08-next`
**日期**: 2026-02-28
**负责人**: Claude
**范围**: R08-T02 + R08-T04 + R08-T07 + R08-T08 + R08-T09（P1 批次）

---

## 交付清单

| 任务 | 文件改动 | 状态 |
|---|---|---|
| T02 scroll 可观测性 | `src/browser/actions.ts` (scroll) + Python SDK models | DONE |
| T04 contenteditable click 诊断 | `src/browser/actions.ts` (click) | DONE |
| T07 download accept_downloads guard | `src/daemon/routes/actions.ts` | DONE |
| T08 download --element-id / --ref-id | `src/daemon/routes/actions.ts`, `src/cli/commands/actions.ts`, `sdk/python/agentmb/client.py` | DONE |
| T09 upload MIME 自动推断 | `src/browser/actions.ts`, `src/cli/commands/actions.ts`, `sdk/python/agentmb/client.py`, Python SDK models | DONE |

---

## 技术实现

### T02 — scroll 可观测性

**问题**: `agentmb scroll <session> body --dy 500` 在 SPA 页面静默成功但无视觉效果，无任何警告。

**实现**:
- `scroll()` 在 dispatch 前后各采样 `scrollTop`/`scrollLeft`（`el.evaluate`）。
- `moved = |after.scrollTop - before.scrollTop| + |after.scrollLeft - before.scrollLeft|`。
- `scrolled = moved > 0`；若 `scrolled=false`：
  - 用 `page.locator(selector).first().evaluate()` 查询 top-5 可滚动后代（overflow:auto|scroll + scrollHeight > clientHeight）。
  - 返回 `warning` 字符串 + `scrollable_hint: ScrollableHint[]`。
- 响应新字段：`{ scrolled: boolean, warning?: string, scrollable_hint?: ScrollableHint[], delta_x, delta_y }`。
- Python SDK 新增 `ScrollableHint` 和 `ScrollResult` 模型；`scroll()` 方法改为返回 `ScrollResult`。
- TypeScript 编译注意：evaluate 回调中访问 `getComputedStyle` 需通过 `(globalThis as any).getComputedStyle`（tsconfig 无 DOM lib）。

### T04 — contenteditable click 诊断修复

**问题**: `click(<p contenteditable>)` 抛出裸 500，无结构化错误信息。

**实现**:
- `click()` 在 `actions.ts` 此前无 try/catch（`press`/`type`/`hover` 已有）。
- 补加与其他动作一致的 try/catch → `ActionDiagnosticsError(collectDiagnostics(...))` → 由路由转换为 422。
- 实测：contenteditable 元素点击正常成功（`status: ok`）；找不到元素时返回 422 + 结构化 `{ error, url, title, readyState, elapsedMs }`，不再裸 500。

### T07 — download accept_downloads guard

**问题**: session 未开启 `accept_downloads=true` 时 download 静默失败或报无关错误。

**实现**:
- 下载路由首先调用 `server.browserManager?.getAcceptDownloads(s.id)`。
- 若返回 false（或 undefined）：`reply.code(422).send({ error: 'download_not_enabled', message: '... Create the session with accept_downloads=true ...' })`。
- CLI `download` 命令特殊处理该错误码，输出友好提示（含 `agentmb new-session --accept-downloads` 示例）。

### T08 — download --element-id / --ref-id

**问题**: download 命令只支持 CSS selector，多元素匹配时需手动 hack `data-agentmb-eid` 属性。

**实现**:
- 下载路由 Body 扩展：`{ selector?, element_id?, ref_id?, timeout_ms?, max_bytes?, ... }`。
- 使用 `resolveTarget(req.body, reply, s.id)` 统一解析（与 click/fill 一致）；支持 `ref_id` → snapshot store 验证（stale 返回 409）。
- CLI `download` 命令：`<selector>` 位置参数改为 `<selector-or-eid>`，新增 `--element-id` / `--ref-id` 选项。
- Python SDK `download()`（sync + async）：`selector: str` → `selector: Optional[str] = None`，新增 `element_id: Optional[str] = None`, `ref_id: Optional[str] = None`。

### T09 — upload MIME 自动推断

**问题**: `upload` 默认 `mime_type: application/octet-stream`，SPA 文件类型验证（如小红书）拒绝上传。

**实现**:
- CLI：模块级 `EXT_TO_MIME` 表（30+ 常见扩展名）+ `inferMime(filePath)` helper。`--mime-type` 移除默认值；实际 MIME = `opts.mimeType ?? inferMime(file) ?? 'application/octet-stream'`。
- `uploadFile()` 返回值新增 `mime_type: string` 字段（便于调用方验证实际使用 MIME）。
- Python SDK：`upload()`/`async_upload()` 改为 `mime_type: Optional[str] = None`，使用 `mimetypes.guess_type(file_path)[0]` 推断，回退 `application/octet-stream`。
- `UploadResult` 模型新增 `mime_type: str = "application/octet-stream"` 字段。

---

## 测试结果

### r08-c02 专项（15 tests）

```
tests/e2e/test_r08c02.py::TestScrollObservability::test_scroll_real_container_returns_scroll_result PASSED
tests/e2e/test_r08c02.py::TestScrollObservability::test_scroll_non_scrollable_returns_warning       PASSED
tests/e2e/test_r08c02.py::TestScrollObservability::test_scroll_noop_includes_hint_list              PASSED
tests/e2e/test_r08c02.py::TestScrollObservability::test_scroll_result_fields                        PASSED
tests/e2e/test_r08c02.py::TestContenteditableClick::test_click_contenteditable_succeeds             PASSED
tests/e2e/test_r08c02.py::TestContenteditableClick::test_click_contenteditable_div                  PASSED
tests/e2e/test_r08c02.py::TestContenteditableClick::test_click_bad_selector_returns_422             PASSED
tests/e2e/test_r08c02.py::TestDownloadGuard::test_download_without_flag_returns_422                 PASSED
tests/e2e/test_r08c02.py::TestDownloadGuard::test_download_with_flag_passes_guard                   PASSED
tests/e2e/test_r08c02.py::TestDownloadElementId::test_download_element_id_accepted                  PASSED
tests/e2e/test_r08c02.py::TestDownloadElementId::test_download_ref_id_accepted                      PASSED
tests/e2e/test_r08c02.py::TestUploadMimeInference::test_upload_png_infers_mime                      PASSED
tests/e2e/test_r08c02.py::TestUploadMimeInference::test_upload_jpg_infers_mime                      PASSED
tests/e2e/test_r08c02.py::TestUploadMimeInference::test_upload_explicit_mime_overrides               PASSED
tests/e2e/test_r08c02.py::TestUploadMimeInference::test_upload_unknown_ext_fallback                  PASSED
15 passed in 8.44s
```

### 全量回归 verify.sh (18/18)

```
[1/18]  Build                  PASS
[2/18]  Daemon start           PASS
[3/18]  smoke       (15)       PASS
[4/18]  auth        (11)       PASS
[5/18]  handoff     (6)        PASS
[6/18]  cdp         (8)        PASS
[7/18]  actions-v2  (10)       PASS
[8/18]  pages-frames (7)       PASS
[9/18]  network-cdp (8)        PASS
[10/18] c05-fixes   (10)       PASS
[11/18] policy      (11)       PASS
[12/18] element-map (9)        PASS
[13/18] r07c02      (24)       PASS
[14/18] r07c03      (22)       PASS
[15/18] r07c04      (27+1skip) PASS
[16/18] r08c01      (15)       PASS
[17/18] r08c02      (15)       PASS
[18/18] Daemon stop            PASS
ALL GATES PASSED (18/18)
```

---

## 改动文件汇总

| 文件 | 改动类型 |
|---|---|
| `src/browser/actions.ts` | T02 scroll 新字段 + before/after 检测；T04 click try/catch；T09 uploadFile 返回 mime_type |
| `src/daemon/routes/actions.ts` | T07 download guard；T08 download resolveTarget + 扩展 body |
| `src/cli/commands/actions.ts` | T08 download --element-id/--ref-id；T09 EXT_TO_MIME + inferMime |
| `sdk/python/agentmb/client.py` | T08 download element_id/ref_id；T09 upload MIME 推断；scroll → ScrollResult |
| `sdk/python/agentmb/models.py` | ScrollableHint + ScrollResult 新模型；UploadResult 增加 mime_type |
| `tests/e2e/test_r08c02.py` | 15 个 e2e 测试（新建） |
| `scripts/verify.sh` | TOTAL 17→18，新增 r08c02 suite |
| `agentops/TODO.md` | T02/T04/T07/T08 TODO→DONE；T09 新增并标 DONE；Done Log 补 7 条记录 |
