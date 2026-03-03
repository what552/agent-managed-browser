# R10-C01 Dev Summary

**Branch**: `feat/r10-builder`
**Commit**: `feat(r10-c01): P0 fixes — B01/B02/B03/B04 + T01/T02/T06/T08`
**Hash**: `805abb8`
**Date**: 2026-03-03

---

## 任务完成情况

| ID | 标题 | 状态 |
|----|------|------|
| B02 | Fastify bodyLimit 修复（upload 413 漏洞） | DONE |
| B04 | attachCdpSession 枚举已有标签页 | DONE |
| B01 | Attach 模式下载路径修复 | DONE |
| B03 | upload 路由补齐 page_id | DONE |
| T01 | 双产区物理隔离（chrome-profiles/ vs profiles/） | DONE |
| T02 | browser-launch --profile 持久化 + SingletonLock | DONE |
| T06 | session unseal + rm --force | DONE |
| T08 | upload 直传模式（file_path → setInputFiles） | DONE |

---

## 修改文件清单

### `src/daemon/server.ts`
- **B02**: 在 `Fastify({})` 构造函数中加入 `bodyLimit: 70 * 1024 * 1024`（70MB）
  修复 base64 上传实际上限仅 ~767KB 的漏洞

### `src/daemon/config.ts`
- **T01**: 新增 `chromeProfilesDir(config)` → `<dataDir>/chrome-profiles/`

### `src/daemon/session.ts`
- **T06**: 新增 `unseal(id)` 方法，设 `sealed = false` + persist()

### `src/browser/manager.ts`
- **T01**: `launchSession` 根据 `opts.channel` 选择 baseDir：
  `chrome/msedge` → `chromeProfilesDir()`；其他 → `profilesDir()`
  加 `fs.mkdirSync(userDataDir, { recursive: true })`
- **B01**: `attachCdpSession` 对已有 context 尝试 CDP `Browser.setDownloadBehavior` 重定向到 `~/Downloads`；新 context 直接传 `downloadsPath`
- **B04**: `attachCdpSession` 枚举 `ctx.pages()` 全部注册入 `pagesMap`，给每个 page 分配 pageId；target 匹配设为 activePageId；为所有已有 page 附加 framenavigated + observers

### `src/daemon/routes/sessions.ts`
- **T06**: `DELETE` 增加 `?force=true` 查询参数跳过 seal 检查
- **T06**: 新增 `POST /api/v1/sessions/:id/unseal` 路由

### `src/daemon/routes/actions.ts`
- **B03**: upload 路由改用 `resolveWithPage(req.params.id, req.body?.page_id, reply)`，body 增加 `page_id?: string`
- **T08**: upload 路由增加 `file_path?: string`；有 `file_path` 时做路径遍历校验后调用 `page.setInputFiles(file_path)`，无需 base64 解码

### `src/cli/commands/session.ts`
- **T06**: `session rm` 增加 `--force` 选项，请求 `?force=true`
- **T06**: 新增 `session unseal <id>` 子命令

### `src/cli/commands/actions.ts`
- **B03**: `upload` 命令增加 `--page-id <id>` 选项
- **T08**: `upload` 命令默认发送 `{ file_path: path.resolve(file) }`；加 `--force-base64` 回退到读文件+base64

### `src/cli/commands/browser-launch.ts`
- **T02**: 新增 `--profile <name>` 选项，使用 `~/.agentmb/chrome-profiles/<name>` 作为 userDataDir
- **T02**: 启动前检查 `SingletonLock`：进程存活 → exit(1)；进程已死 → 删 lock 继续
- **T02**: 输出增加 `Profile: <name>  (<path>)` 行（与 R10-SPEC 2.3 对齐）

### `tests/e2e/test_r10c01.py`（新建）
6 个测试用例：
- `test_b02_upload_bodylimit` — 上传 1.5MB binary，期望 200
- `test_b03_upload_page_id` — 多 tab session 用 page_id 上传
- `test_t01_dual_zone_profiles` — chrome channel session 验证 chrome-profiles/ 目录
- `test_t06_unseal` — seal → rm(423) → unseal → rm(204)
- `test_t06_rm_force` — seal → rm?force=true(204)
- `test_t08_upload_direct_path` — 本地文件直传，验证 200 + status=ok
- `test_t08_upload_direct_path_traversal_rejected` — `..` 路径应 400

---

## 验证

```bash
# TypeScript 编译通过（无错误）
npm run build

# 待 gate 运行
AGENTMB_PORT=19315 AGENTMB_DATA_DIR=/tmp/agentmb-claude \
  pytest tests/e2e/test_r10c01.py -v
```

---

## 注意事项

- T01: `fs.mkdirSync` 在 ephemeral 分支也等效覆盖（ephemeral 路径原本已在 `launchPersistentContext` 前创建）
- B04: `autoTrackNewPages` 不会双注册已在 pagesMap 中的 page（alreadyTracked 检查）
- T08: 路径遍历校验仅拒绝含 `..` 的路径，通过绝对路径访问的系统文件由 daemon 运行用户权限决定
- SingletonLock 在 Windows 上 `readlinkSync` 可能抛异常，已用 try-catch 降级为直接删 lock
