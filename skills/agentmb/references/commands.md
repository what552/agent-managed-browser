# CLI Commands — Full Reference

All commands follow the pattern: `agentmb <command> <session-id> [args] [flags]`

Use `agentmb --help` and `agentmb <command> --help` for full flag lists.

---

## Daemon

| Command | Notes |
|---|---|
| `agentmb start` | Start daemon; `-p <port>` (default 19315), `-d <data-dir>` |
| `agentmb stop` | Stop daemon |
| `agentmb status` | Show daemon status (sessions, uptime) |
| `agentmb browser-launch` | Launch Chrome with CDP remote debugging (for CDP Attach mode) |

`browser-launch` flags: `--port <n>` (CDP port, default 9222), `--user-data-dir <dir>`, `--channel chrome|msedge`.

---

## Session

| Command | Notes |
|---|---|
| `agentmb session new` | Create session; returns `<session-id>` |
| `agentmb session list` | List all active sessions |
| `agentmb session get <sid>` | Show session details |
| `agentmb session rm <sid>` | Close and delete session |
| `agentmb session seal <sid>` | Seal session (prevent deletion; 423 on rm) |
| `agentmb settings <sid>` | Show session settings (viewport, headless, url, profile) |

`session new` flags:

| Flag | Default | Notes |
|---|---|---|
| `--profile <name>` | — | Named persistent profile |
| `--ephemeral` | false | Temp profile (auto-deleted on close) |
| `--headless` | true | Run headless |
| `--headed` | — | Run headed (visible window) |
| `--browser-channel <ch>` | `chromium` | `chromium` / `chrome` / `msedge` |
| `--executable-path <path>` | — | Custom browser binary |
| `--launch-mode attach` | — | CDP Attach mode |
| `--cdp-url <url>` | — | Required with `--launch-mode attach` |
| `--accept-downloads` | false | Enable file downloads |
| `--policy <profile>` | `safe` | `safe` / `permissive` / `disabled` |

---

## Navigation

| Command | Notes |
|---|---|
| `agentmb navigate <sid> <url>` | Navigate; `--wait-until load\|networkidle\|commit` |
| `agentmb back <sid>` | Browser back |
| `agentmb forward <sid>` | Browser forward |
| `agentmb reload <sid>` | Reload page |
| `agentmb wait-url <sid> <pattern>` | Wait for URL match (glob pattern) |
| `agentmb wait-load-state <sid>` | Wait for load state |
| `agentmb wait-function <sid> <expr>` | Wait for JS expression to return truthy |
| `agentmb wait-text <sid> <text>` | Wait for text to appear in DOM |
| `agentmb wait-stable <sid>` | Network idle + DOM quiet + optional overlay clear |

---

## Locator / Scan

| Command | Notes |
|---|---|
| `agentmb element-map <sid>` | Inject element_ids; return labeled element list |
| `agentmb element-map <sid> --include-unlabeled` | Include icon-only elements (fallback label: `[tag @ x,y]`) |
| `agentmb snapshot-map <sid>` | Server-side snapshot; returns ref_id per element |
| `agentmb snapshot-map <sid> --include-unlabeled` | Include unlabeled in snapshot |
| `agentmb find <sid> <type> <query>` | Semantic find: `type` = `text\|role\|label\|placeholder\|alt_text` |

---

## Read / Assert

| Command | Notes |
|---|---|
| `agentmb get <sid> <prop> <sel-or-eid>` | Read: `text\|html\|value\|attr\|count\|box` |
| `agentmb assert <sid> <prop> <sel-or-eid>` | Assert: `visible\|enabled\|checked` |
| `agentmb extract <sid> <selector>` | Extract all matching elements as list; `--attribute <attr>` |
| `agentmb eval <sid> <expr>` | Evaluate JavaScript; returns raw result |

---

## Element Interaction

| Command | Notes |
|---|---|
| `agentmb click <sid> <sel-or-eid>` | Click; `--element-id` or `--ref-id`; `422` with `recovery_hint` on failure |
| `agentmb dblclick <sid> <sel-or-eid>` | Double-click |
| `agentmb fill <sid> <sel-or-eid> <value>` | Fast fill (replace); `--fill-strategy normal\|type`, `--char-delay-ms <ms>` |
| `agentmb type <sid> <sel-or-eid> <text>` | Type char by char; `--delay-ms <ms>` |
| `agentmb press <sid> <sel-or-eid> <key>` | Key / combo: `Enter`, `Tab`, `Control+a` |
| `agentmb select <sid> <sel> <value...>` | Select `<option>` by value/label |
| `agentmb hover <sid> <sel-or-eid>` | Hover |
| `agentmb focus <sid> <sel-or-eid>` | Focus element |
| `agentmb check <sid> <sel-or-eid>` | Check checkbox / radio |
| `agentmb uncheck <sid> <sel-or-eid>` | Uncheck |
| `agentmb drag <sid> <source> <target>` | Drag-and-drop; `--source-ref-id` / `--target-ref-id` |

---

## Scroll

| Command | Notes |
|---|---|
| `agentmb scroll <sid> <sel-or-eid>` | Scroll element; direction `up\|down\|left\|right`; `--amount <px>` |
| `agentmb scroll-into-view <sid> <sel-or-eid>` | Scroll element into viewport |
| `agentmb scroll-until <sid>` | Scroll until condition; `--stop-selector`, `--stop-text`, `--max-scrolls`, `--step-delay-ms` |
| `agentmb load-more-until <sid> <btn-sel> <item-sel>` | Click load-more repeatedly |

`scroll` response: `{ "scrolled": bool, "warning": "...", "scrollable_hint": [...] }`
If `scrolled=false`, use selectors from `scrollable_hint` for the next scroll call.

---

## Coordinate / Low-Level

| Command | Notes |
|---|---|
| `agentmb click-at <sid> <x> <y>` | Click at absolute page coordinates |
| `agentmb bbox <sid> <sel-or-eid>` | Bounding box + center_x/center_y; accepts `--element-id` / `--ref-id` |
| `agentmb mouse-move <sid> [x] [y]` | Move mouse; or `--selector`/`--element-id`/`--ref-id`; `--steps <n>` |
| `agentmb mouse-down <sid>` / `mouse-up <sid>` | Mouse button press/release |
| `agentmb key-down <sid> <key>` / `key-up <sid> <key>` | Raw key press/release |
| `agentmb wheel <sid> --dx <n> --dy <n>` | Low-level wheel event |
| `agentmb insert-text <sid> <text>` | Insert text into focused element (no keyboard simulation) |

---

## File Transfer

| Command | Notes |
|---|---|
| `agentmb upload <sid> <selector> <file>` | Upload from disk; `--mime-type` to override auto-detection |
| `agentmb download <sid> <sel-or-eid> -o <file>` | Download triggered by element; session must have `--accept-downloads` |

`download` also accepts `--element-id` / `--ref-id`. Without `accept_downloads=True`, returns `422 download_not_enabled`.

---

## Cookies / Storage

| Command | Notes |
|---|---|
| `agentmb cookie-list <sid>` | List all cookies |
| `agentmb cookie-clear <sid>` | Clear all cookies |
| `agentmb cookie-delete <sid> <name>` | Delete cookie by name; `--domain`, `--path`, `--url` filters |
| `agentmb storage-export <sid> -o state.json` | Export Playwright storageState (cookies + origins) |
| `agentmb storage-import <sid> state.json` | Restore cookies from storageState |

---

## Observability

| Command | Notes |
|---|---|
| `agentmb screenshot <sid> -o out.png` | Screenshot; `--full-page`, `--format png\|jpeg` |
| `agentmb annotated-screenshot <sid>` | Screenshot with element overlays; `--highlight <sel>` |
| `agentmb logs <sid>` | Session audit log; `--tail <n>` |
| `agentmb console-log <sid>` | Browser console entries; `--tail <n>` |
| `agentmb page-errors <sid>` | Uncaught JS errors |
| `agentmb dialogs <sid>` | Auto-dismissed dialog history (alert/confirm/prompt) |
| `agentmb trace start <sid>` | Start Playwright trace recording |
| `agentmb trace stop <sid> -o trace.zip` | Stop trace and save; view with `npx playwright show-trace trace.zip` |

---

## Browser Controls

| Command | Notes |
|---|---|
| `agentmb set-viewport <sid> <w> <h>` | Resize viewport |
| `agentmb clipboard-write <sid> <text>` | Write to clipboard |
| `agentmb clipboard-read <sid>` | Read from clipboard |
| `agentmb policy <sid>` | Get current policy profile |
| `agentmb policy <sid> <profile>` | Set policy: `safe\|permissive\|disabled` |
| `agentmb policy <sid> safe --allow-sensitive` | Safe + allow sensitive actions |
| `agentmb cdp-ws <sid>` | Print browser-level CDP WebSocket URL |
| `agentmb set-network <sid>` | Network throttling; `--latency-ms`, `--download-kbps`, `--upload-kbps`, `--offline` |
| `agentmb reset-network <sid>` | Restore normal network conditions |

---

## Multi-Page (Tabs)

| Command | Notes |
|---|---|
| `agentmb pages list <sid>` | List all open tabs |
| `agentmb pages new <sid>` | Open a new blank tab; returns `<page-id>` |
| `agentmb pages switch <sid> <page-id>` | Make tab the active target |
| `agentmb pages close <sid> <page-id>` | Close tab (last tab protected — 409) |

---

## Routes (Network Mocks)

| Command | Notes |
|---|---|
| `agentmb route list <sid>` | List active route mocks |
| `agentmb route add <sid> <pattern>` | Add mock; `--status`, `--body`, `--content-type` |
| `agentmb route rm <sid> <pattern>` | Remove mock |

Mocks persist across page navigations within the session.

---

## CDP

| Command | Notes |
|---|---|
| `agentmb cdp-ws <sid>` | Print `ws://` browser-level CDP endpoint |

REST:
```
GET  /api/v1/sessions/:id/cdp          → session CDP info
POST /api/v1/sessions/:id/cdp          → send CDP method: {"method": "...", "params": {...}}
```

---

## Health

```
GET /health
→ { "status": "ok", "version": "0.3.1", "uptime_s": N, "sessions_active": N }
```
