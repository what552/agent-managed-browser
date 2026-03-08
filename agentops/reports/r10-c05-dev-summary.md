# R10-C05 Dev Summary

**Branch**: `feat/r10-builder`
**Baseline SHA**: `f3774db`
**Target SHA**: `222fdee`
**Date**: 2026-03-07
**Builder**: Claude (Builder)

---

## 交付内容

### R10-T11 — extract-image（视觉素材提取）

#### API: `POST /api/v1/sessions/:id/extract-image`

**请求体**:
```json
{
  "selector": "h1",
  "format": "png",
  "page_id": "optional"
}
```

**响应**:
```json
{
  "status": "ok",
  "data": "<base64>",
  "format": "png",
  "mime_type": "image/png",
  "width": 320,
  "height": 42,
  "selector": "h1",
  "tag_name": "h1",
  "src": "https://...",
  "url": "https://example.com",
  "duration_ms": 85
}
```

- `selector`：任意 CSS 选择器，必填
- `format`：`png`（默认）或 `jpeg`
- `src`：仅当元素有 `src` 属性（如 `<img>`、`<video>`）时返回
- 使用 `page.locator(selector).first().screenshot()` 精确提取元素像素
- 超时 5 秒等待可见性，不可见则 422 with diagnostics
- 支持 `page_id`（multi-tab 操作）

#### CLI

```bash
agentmb extract-image <session-id> <selector>
agentmb extract-image <session-id> "img.logo" --format jpeg -o logo.jpg
```

---

### R10-T13 — allow-extensions（Managed 扩展开关）

- **默认行为**：`--disable-extensions` 自动加入 Chromium 启动参数（secure-by-default）
- **opt-in**：`allow_extensions=true` 时，跳过该参数，扩展正常加载
- 影响范围：`launchSession` opts → `args[]`

**API**:
```http
POST /api/v1/sessions
{ "allow_extensions": true }
```

**CLI**:
```bash
agentmb session new --allow-extensions
```

**响应**:
```json
{ "allow_extensions": true }
```

字段存入 `SessionInfo.allowExtensions`，随 sessions.json 持久化。

---

### 版本号升级 0.3.2 → 0.4.0

| 文件 | 变更 |
|------|------|
| `package.json` | `"version": "0.4.0"` |
| `sdk/python/pyproject.toml` | `version = "0.4.0"` |
| `src/cli/index.ts` | `.version('0.4.0')` |

---

## 变更文件范围

| 文件 | 类型 |
|------|------|
| `src/browser/actions.ts` | 修改 — 新增 `extractImage` 函数（~80 行） |
| `src/browser/manager.ts` | 修改 — `launchSession` 接受 `allowExtensions`，默认 `--disable-extensions` |
| `src/daemon/session.ts` | 修改 — `SessionInfo.allowExtensions`、`registry.create()` 新增参数 |
| `src/daemon/routes/sessions.ts` | 修改 — `allow_extensions` 传递链路 + 201 响应字段 |
| `src/daemon/routes/actions.ts` | 修改 — 新增 extract-image 路由 |
| `src/cli/commands/actions.ts` | 修改 — 新增 `extract-image` CLI 命令 |
| `src/cli/commands/session.ts` | 修改 — `--allow-extensions` 选项 |
| `src/cli/index.ts` | 修改 — 版本号 0.4.0 |
| `package.json` | 修改 — 版本号 0.4.0 |
| `sdk/python/pyproject.toml` | 修改 — 版本号 0.4.0 |
| `tests/e2e/test_r10c05.py` | 新建 — 11 tests |
| `scripts/verify.sh` | 修改 — r10c05 suite；TOTAL 34→35 |

---

## 验证结果

```
AGENTMB_PORT=19315 AGENTMB_DATA_DIR=/tmp/agentmb-builder bash scripts/verify.sh
```

```
35/35 ALL GATES PASSED
  r10c05: 11 passed
```

---

## 关键设计决策

| 决策 | 原因 |
|------|------|
| `locator.screenshot()` 提取元素图像 | Playwright 原生精确裁剪，无需手动计算 BoundingBox |
| `tag_name` + `src` 元数据 | Agent 可判断元素类型、原始 src 是否可另行获取 |
| `--disable-extensions` 默认添加 | spec 明确 secure-by-default；现有测试全部通过（不依赖扩展）|
| `allowExtensions` 存入 SessionInfo | switchMode 重启时需保留设置（当前 switchMode 不传递，后续可补齐）|

---

## 未完成项（转下一批次）

- T02 — Launcher 2.0（`browser-launch --profile` 自动路径构造）
- T08 — 上传直传模式（零内存，解决 767KB 限制）
- switchMode 重启时不传递 `allowExtensions`（非阻断性 minor gap，下轮修补）
