# agent-managed-browser

Agent-ready local browser runtime for stable, auditable web automation.

## What It Does

`agent-managed-browser` runs a persistent **Chromium stable** browser daemon (via Playwright's bundled Chromium stable channel) with session management, structured audit logs, multi-modal element targeting, and human login handoff. It exposes a REST API, a CLI, and a Python SDK.

The browser engine is Chromium (Chrome-compatible). Firefox and WebKit are not supported. Node.js 20 LTS is the runtime baseline.

Designed for coding and ops agents that need reproducible, inspectable browser workflows rather than fragile one-off scripts.

## Use Cases

- **Agent web tasks**: navigate, click, fill, extract, screenshot, evaluate JavaScript, all via API or SDK.
- **Human-in-the-loop login**: switch to headed mode for manual login, then return to headless automation with the same profile and cookies intact.
- **E2E and CI verification**: run isolated smoke/auth/CDP/policy checks with configurable port and data dir.
- **Local automation service**: one daemon, multiple sessions, multiple agents reusing sessions safely.

Supports macOS, Linux, and Windows.

---

## Quick Start

```bash
git clone https://github.com/what552/agent-managed-browser.git
cd agent-managed-browser

# Node 20+ required
npm ci
npm run build
npx playwright install chromium

# optional: install CLI globally
npm link

# start daemon
agentmb start
```

In another terminal:

```bash
agentmb status
agentmb session new --profile demo
agentmb session list
agentmb navigate <session-id> https://example.com
agentmb screenshot <session-id> -o ./shot.png
agentmb stop
```

---

## Install

### npm + pip (macOS / Linux)

```bash
npm i -g agentmb
python3 -m pip install --user agentmb
agentmb --help
python3 -c "import agentmb; print(agentmb.__version__)"
```

### npm + pip (Windows PowerShell)

```powershell
npm i -g agentmb
py -m pip install --user agentmb
agentmb --help
```

Package roles:
- `npm` package: CLI + daemon runtime (Chromium via Playwright)
- `pip` package: Python SDK client (httpx + pydantic v2)

---

## Python SDK

```bash
python3 -m pip install -e sdk/python
```

```python
from agentmb import BrowserClient

with BrowserClient(base_url="http://127.0.0.1:19315") as client:
    sess = client.sessions.create(headless=True, profile="demo")
    sess.navigate("https://example.com")
    res = sess.screenshot()
    res.save("shot.png")
    sess.close()
```

---

## Locator Models

Three targeting modes based on page stability and replay requirements.

### 1) Selector Mode

Plain CSS selectors passed directly.

```bash
agentmb click <session-id> "#submit"
agentmb fill <session-id> "#email" "name@example.com"
agentmb get <session-id> text "#title"
```

Best for: stable pages where selectors are reliable.

### 2) Element-ID Mode (`element-map`)

Step 1: scan the page, get stable `element_id` values.

```bash
agentmb element-map <session-id>
agentmb element-map <session-id> --include-unlabeled   # also surface icon-only elements
```

Step 2: pass the ID to any action.

```bash
agentmb click <session-id> e3 --element-id
agentmb fill <session-id> e5 "hello" --element-id
agentmb get <session-id> text e3 --element-id
agentmb assert <session-id> visible e3 --element-id
```

`label` field per element is synthesized using a 7-level priority chain:

| Priority | Source | `label_source` value |
|---|---|---|
| 1 | `aria-label` attribute | `"aria-label"` |
| 2 | `title` attribute | `"title"` |
| 3 | `aria-labelledby` target text | `"aria-labelledby"` |
| 4 | SVG `<title>` / `<desc>` | `"svg-title"` |
| 5 | `innerText` (trimmed) | `"text"` |
| 6 | `placeholder` attribute | `"placeholder"` |
| 7 | Fallback (icon-only) | `"none"` / `"[tag @ x,y]"` |

Icon-only elements get `label_source="none"` by default; `--include-unlabeled` adds a `[tag @ x,y]` coordinate fallback.

Best for: selector drift, dynamic class names, and icon-heavy SPAs.

### 3) Snapshot-Ref Mode (`snapshot-map` + `ref_id`)

Step 1: create a server-side snapshot.

```bash
agentmb snapshot-map <session-id>
agentmb snapshot-map <session-id> --include-unlabeled
```

Step 2: use the returned `ref_id` (`snap_XXXXXX:eN`) in API/SDK calls.

- `page_rev` is an integer counter returned with each snapshot; it increments on every main-frame navigation. Poll it directly to detect page changes without taking a full snapshot:

```http
GET /api/v1/sessions/:id/page_rev
→ { "status": "ok", "session_id": "...", "page_rev": 3, "url": "https://..." }
```

```python
rev = sess.page_rev()   # PageRevResult with .page_rev, .url
```

- If the page has navigated since the snapshot, using a stale `ref_id` returns `409 stale_ref` with a structured payload:

```json
{
  "error": "stale_ref: page changed",
  "suggestions": ["call snapshot_map to get fresh ref_ids", "re-run your step with the new ref_id"]
}
```

- Recovery: call `snapshot-map` again, retry with new `ref_id`.

Best for: deterministic replay and safe automation on changing pages.

### Mode Selection Guide

| Page Type | Recommended Mode |
|---|---|
| Text-rich pages (docs, GitHub, HN) | `element-map` + `--element-id` |
| Icon/SVG-dense SPAs (social apps, dashboards) | CSS selector or `--include-unlabeled` |
| `contenteditable` / custom components | `eval getBoundingClientRect` + `click-at` |
| Image feeds (Unsplash, Pinterest) | `snapshot-map` (images have `alt` text) |

| Action | Approach |
|---|---|
| Search / navigation | Construct the URL directly |
| Click a labeled button | `element-map` eid or CSS selector |
| Click `contenteditable` | `click-at <sess> <x> <y>` (get coords via `bbox`) |
| Scroll SPA content area | Check `scrolled` + `scrollable_hint` in response; use `eval el.scrollBy()` if needed |
| File upload from disk | `upload <sess> <selector> <file>` (MIME inferred from extension) |
| File upload from URL | API: `POST /sessions/:id/upload_url` |
| Click JS-signed links | `click-at` to trigger a real click event |

---

## Action Reference

Use `agentmb --help` and `agentmb <command> --help` for full flags.

### Navigation

| Command | Notes |
|---|---|
| `agentmb navigate <sess> <url>` | Navigate; `--wait-until load\|networkidle\|commit` |
| `agentmb back <sess>` / `forward <sess>` / `reload <sess>` | Browser history |
| `agentmb wait-url <sess> <pattern>` | Wait for URL match |
| `agentmb wait-load-state <sess>` | Wait for load state |
| `agentmb wait-function <sess> <expr>` | Wait for JS condition |
| `agentmb wait-text <sess> <text>` | Wait for text to appear |
| `agentmb wait-stable <sess>` | Network idle + DOM quiet + optional overlay clear |

### Locator / Read / Assert

| Command | Notes |
|---|---|
| `agentmb element-map <sess>` | Scan; inject `element_id`; return `label` + `label_source` |
| `agentmb element-map <sess> --include-unlabeled` | Include icon-only elements; fallback label = `[tag @ x,y]` |
| `agentmb snapshot-map <sess>` | Server snapshot with `page_rev`; returns `ref_id` per element |
| `agentmb get <sess> <property> <selector-or-eid>` | Read `text/html/value/attr/count/box` |
| `agentmb assert <sess> <property> <selector-or-eid>` | Assert `visible/enabled/checked` |
| `agentmb extract <sess> <selector>` | Extract text/attributes as list |

`selector-or-eid` accepts a CSS selector, `--element-id` (element-map), or `--ref-id` (snapshot-map) on all commands.

### Element Interaction

| Command | Notes |
|---|---|
| `agentmb click <sess> <selector-or-eid>` | Click; `contenteditable` supported; returns `422` with diagnostics + `recovery_hint` on failure |
| `agentmb dblclick <sess> <selector-or-eid>` | Double-click |
| `agentmb fill <sess> <selector-or-eid> <value>` | Fast fill (replaces value) |
| `agentmb type <sess> <selector-or-eid> <text>` | Type character by character; `--delay-ms <ms>` |
| `agentmb press <sess> <selector-or-eid> <key>` | Key / combo (`Enter`, `Tab`, `Control+a`) |
| `agentmb select <sess> <selector> <value...>` | Select `<option>` in `<select>` |
| `agentmb hover <sess> <selector-or-eid>` | Hover |
| `agentmb focus <sess> <selector-or-eid>` | Focus |
| `agentmb check <sess> <selector-or-eid>` / `uncheck` | Checkbox / radio |
| `agentmb drag <sess> <source> <target>` | Drag-and-drop; also accepts `--source-ref-id` / `--target-ref-id` |

**API/SDK — click advanced options:**

```python
# executor: 'strict' (default) or 'auto_fallback'
# auto_fallback: tries Playwright click; if it times out due to overlay/intercept,
# falls back to page.mouse.click(center_x, center_y).
# When clicking inside an <iframe>, auto_fallback automatically adds the frame's
# page-level offset so coordinates land correctly.
# Response includes executed_via: 'high_level' | 'low_level'
sess.click(selector="#btn", executor="auto_fallback", timeout_ms=3000)

# stability: optional pre/post waits to handle animated UIs
sess.click(selector="#btn", stability={
    "wait_before_ms": 200,    # pause before the action
    "wait_after_ms": 100,     # pause after the action
    "wait_dom_stable_ms": 500 # wait for DOM readyState before acting
})
```

**API/SDK — fill humanization:**

```python
# fill_strategy='type': types character-by-character (slower, more human-like)
# char_delay_ms: delay between keystrokes in ms (used with fill_strategy='type')
sess.fill(selector="#inp", value="hello", fill_strategy="type", char_delay_ms=30)
```

### Scroll and Feed

| Command | Notes |
|---|---|
| `agentmb scroll <sess> <selector-or-eid>` | Scroll element; structured response (see below) |
| `agentmb scroll-into-view <sess> <selector-or-eid>` | Scroll element into viewport |
| `agentmb scroll-until <sess>` | Scroll until stop condition (`--stop-selector`, `--stop-text`, `--max-scrolls`) |
| `agentmb load-more-until <sess> <btn-selector> <item-selector>` | Repeatedly click load-more |

**`scroll` response fields:**

```json
{
  "scrolled": true,
  "warning": "element not scrollable — scrolled nearest scrollable ancestor",
  "scrollable_hint": [
    { "selector": "#feed", "tag": "div", "scrollHeight": 4200, "clientHeight": 600 },
    ...
  ]
}
```

- `scrolled` — `true` if any scroll movement occurred
- `warning` — present when the target element itself is not scrollable and a fallback was used
- `scrollable_hint` — top-5 scrollable descendants ranked by `scrollHeight`; use these selectors in subsequent `scroll` calls when `scrolled=false`

**`scroll_until` / `load_more_until` response** includes `session_id` for chaining:

```json
{ "status": "ok", "session_id": "sess_...", "scrolls": 12, "stop_reason": "stop_text_found" }
```

**API/SDK — scroll_until with step_delay:**

```python
# step_delay_ms: wait between each scroll step (default = stall_ms)
sess.scroll_until(scroll_selector="#feed", direction="down",
                  stop_selector=".end", max_scrolls=20, step_delay_ms=150)
```

### Coordinate and Low-Level Input

| Command | Notes |
|---|---|
| `agentmb click-at <sess> <x> <y>` | Click absolute page coordinates |
| `agentmb wheel <sess> --dx --dy` | Low-level wheel event |
| `agentmb insert-text <sess> <text>` | Insert text into focused element (no keyboard simulation) |
| `agentmb bbox <sess> <selector-or-eid>` | Bounding box + center coordinates; accepts `--element-id` / `--ref-id` |
| `agentmb mouse-move <sess> [x] [y]` | Move mouse to absolute coordinates; or use `--selector`/`--element-id`/`--ref-id` to resolve element center |
| `agentmb mouse-down <sess>` / `mouse-up <sess>` | Mouse button press / release |
| `agentmb key-down <sess> <key>` / `key-up <sess> <key>` | Raw key press / release |

**API/SDK — smooth mouse movement:**

```python
# Move by absolute coordinates with smooth interpolation
res = sess.mouse_move(x=400, y=300, steps=10)

# Move to an element center by selector / element_id / ref_id (x/y resolved server-side)
res = sess.mouse_move(selector="#submit-btn", steps=5)
res = sess.mouse_move(element_id="e3", steps=5)
res = sess.mouse_move(ref_id="snap_000001:e3")

# Response includes x, y, steps fields
print(res.x, res.y, res.steps)
```

CLI equivalents:
```bash
agentmb mouse-move <sess> 400 300 --steps 10
agentmb mouse-move <sess> --selector "#btn" --steps 5
agentmb mouse-move <sess> --element-id e3
agentmb mouse-move <sess> --ref-id snap_000001:e3
```

### Semantic Find (API / SDK)

Locate elements by Playwright semantic locators without knowing CSS selectors.

```python
# query_type: 'role' | 'text' | 'label' | 'placeholder' | 'alt_text'
# Returns: found (bool), count, tag, text, bbox, nth
res = sess.find(query_type="role", query="button", name="Submit")
res = sess.find(query_type="text", query="Sign in", exact=True)
res = sess.find(query_type="placeholder", query="Search…")
res = sess.find(query_type="label", query="Email address")
res = sess.find(query_type="alt_text", query="Product photo", nth=2)
```

| `query_type` | Playwright call |
|---|---|
| `role` | `page.getByRole(query, { name, exact })` |
| `text` | `page.getByText(query, { exact })` |
| `label` | `page.getByLabel(query, { exact })` |
| `placeholder` | `page.getByPlaceholder(query, { exact })` |
| `alt_text` | `page.getByAltText(query, { exact })` |

Returns `FindResult` with `found`, `count`, `nth`, `tag`, `text`, `bbox`.

### Batch Execution — run_steps (API / SDK)

Execute a sequence of actions in a single request. Supports `stop_on_error`.

Each step's `params` accepts `selector`, `element_id`, or `ref_id` interchangeably for element targeting:

```python
# First, take a snapshot to get ref_ids
snap = sess.snapshot_map()
btn_ref = next(e.ref_id for e in snap.elements if "Login" in (e.label or ""))

result = sess.run_steps([
    {"action": "navigate",         "params": {"url": "https://example.com"}},
    {"action": "click",            "params": {"ref_id": btn_ref}},           # ref_id from snapshot
    {"action": "fill",             "params": {"element_id": "e5", "value": "user@example.com"}},  # element_id
    {"action": "fill",             "params": {"selector": "#pass", "value": "secret"}},           # CSS selector
    {"action": "press",            "params": {"selector": "#pass", "key": "Enter"}},
    {"action": "wait_for_selector","params": {"selector": ".dashboard"}},
    {"action": "screenshot",       "params": {"format": "png"}},
], stop_on_error=True)

print(result.status)           # 'ok' | 'partial' | 'failed'
print(result.completed_steps)  # number of steps that succeeded
for step in result.results:
    print(step.step, step.action, step.error)
```

- A stale `ref_id` (page navigated since snapshot) returns a step-level error, not a request crash. Use `stop_on_error=False` to continue remaining steps.
- Supported actions: `navigate`, `click`, `fill`, `type`, `press`, `hover`, `scroll`, `wait_for_selector`, `wait_text`, `screenshot`, `eval`. Max 100 steps per call.

### File Transfer

| Command | Notes |
|---|---|
| `agentmb upload <sess> <selector> <file>` | Upload file from disk; MIME auto-inferred from extension (`--mime-type` to override) |
| `agentmb download <sess> <selector-or-eid> -o <file>` | Trigger download; accepts `--element-id` / `--ref-id`; requires `--accept-downloads` on session |

**download guard**: sessions created without `accept_downloads=True` return `422 download_not_enabled`:

```python
# Correct — enable at session creation time
sess = client.sessions.create(accept_downloads=True)
sess.download(selector="#dl-link", output_path="./file.pdf")

# download also accepts element_id / ref_id
sess.download(element_id="e7", output_path="./file.pdf")
sess.download(ref_id="snap_000001:e7", output_path="./file.pdf")
```

```bash
agentmb session new --accept-downloads
agentmb download <sess> "#dl-link" -o file.pdf
agentmb download <sess> e7 --element-id -o file.pdf
```

**API/SDK — upload from URL:**

```python
# Fetches the URL server-side (Node fetch), writes to temp file, uploads to file input.
res = sess.upload_url(
    url="https://example.com/assets/photo.jpg",
    selector="#file-input",
    filename="photo.jpg",       # optional; defaults to last URL path segment
    mime_type="image/jpeg",     # optional; defaults to application/octet-stream
)
# res.size_bytes, res.fetched_bytes, res.filename
```

### Session State (Cookie / Storage)

| Command | Notes |
|---|---|
| `agentmb cookie-list <sess>` | List all cookies |
| `agentmb cookie-clear <sess>` | Clear all cookies |
| `agentmb storage-export <sess> -o state.json` | Export Playwright storageState (cookies + origins) |
| `agentmb storage-import <sess> state.json` | Restore cookies from storageState; `origins_skipped` count returned |

**API/SDK — delete cookie by name:**

```python
# Removes matching cookies, preserves the rest. domain is optional filter.
res = sess.delete_cookie("session_token")
res = sess.delete_cookie("tracker", domain=".example.com")
# res.removed, res.remaining
```

### Observability and Debug

| Command | Notes |
|---|---|
| `agentmb screenshot <sess> -o out.png` | Screenshot; `--full-page`, `--format png\|jpeg` |
| `agentmb annotated-screenshot <sess> --highlight <sel>` | Screenshot with colored element overlays |
| `agentmb eval <sess> <expr>` | Evaluate JavaScript; returns raw result |
| `agentmb console-log <sess>` | Browser console entries; `--tail N` |
| `agentmb page-errors <sess>` | Uncaught JS errors from the page |
| `agentmb dialogs <sess>` | Auto-dismissed dialog history (alert/confirm/prompt) |
| `agentmb logs <sess>` | Session audit log tail (all actions, policy events, CDP calls) |
| `agentmb trace start <sess>` / `trace stop <sess> -o trace.zip` | Playwright trace capture |

### Browser Environment and Controls

| Command | Notes |
|---|---|
| `agentmb set-viewport <sess> <w> <h>` | Resize viewport |
| `agentmb clipboard-write <sess> <text>` / `clipboard-read <sess>` | Clipboard access |
| `agentmb policy <sess> [profile]` | Get or set safety policy profile |
| `agentmb cdp-ws <sess>` | Print browser-level CDP WebSocket URL |

**API/SDK — browser settings:**

```python
# Returns viewport, user_agent, url, headless, profile for a session.
settings = sess.get_settings()
print(settings.viewport, settings.user_agent, settings.headless)
```

---

## Multi-Page Management

```bash
agentmb pages list <session-id>              # list all open tabs
agentmb pages new <session-id>               # open a new tab
agentmb pages switch <session-id> <page-id>  # make a tab the active target
agentmb pages close <session-id> <page-id>   # close a tab (last tab protected)
```

---

## Network Route Mocks

```bash
agentmb route list <session-id>
agentmb route add <session-id> "**/api/**" \
  --status 200 --body '{"ok":true}' \
  --content-type application/json
agentmb route rm <session-id> "**/api/**"
```

Route mocks are applied at context level, so they persist across page navigations within the same session.

---

## Three Browser Running Modes

agentmb supports three distinct browser modes, differing in **which browser binary is used and how it is connected**.

| Mode | Browser | How Connected | Profile Persistence |
|---|---|---|---|
| **1. Managed Chromium** | Playwright bundled Chromium | agentmb spawns & owns | Persistent or ephemeral |
| **2. Managed Chrome Stable** | System Chrome / Edge | agentmb spawns & owns | Persistent or ephemeral |
| **3. CDP Attach** (Bold Mode) | Any running Chrome-compatible | agentmb attaches via CDP | Owned by external process |

```
                ┌─────────────────────────────────────────────────────────┐
                │                     agentmb daemon                      │
                │   REST API  POST /api/v1/sessions  (+ preflight check)  │
                └───────────┬──────────────────┬──────────────┬───────────┘
                            │                  │              │
                   launchPersistent()  launchPersistent()  connectOverCDP()
                   (bundled Chromium)  (system Chrome/Edge) (external process)
                            │                  │              │
               ┌────────────▼────┐  ┌──────────▼────┐  ┌────▼──────────────┐
               │  Mode 1         │  │  Mode 2        │  │  Mode 3           │
               │  Managed        │  │  Managed       │  │  CDP Attach       │
               │  Chromium       │  │  Chrome Stable │  │  (Bold Mode)      │
               │                 │  │  / Edge        │  │  launch_mode=     │
               │  profile=name   │  │  browser_      │  │  attach           │
               │  or ephemeral=T │  │  channel=chrome│  │                   │
               └─────────────────┘  └───────────────┘  └───────────────────┘
```

### Mode 1: Managed Chromium (default)

agentmb spawns the **Playwright-bundled Chromium** binary. No system Chrome required. Works in headless (CI) and headed modes.

Within managed modes, choose a **profile strategy**:

**Agent Workspace** — named profile; cookies, localStorage, and browser state persist across runs:

```python
sess = client.sessions.create(profile="gmail-account")
```

```bash
agentmb session new --profile gmail-account
```

**Pure Sandbox** — ephemeral temp directory; all data is auto-deleted on `close()`:

```python
sess = client.sessions.create(ephemeral=True)
```

```bash
agentmb session new --ephemeral
```

### Mode 2: Managed Chrome Stable

agentmb spawns a **system-installed Chrome or Edge** binary via Playwright. Requires Chrome Stable or Edge to be installed on the host. Both Agent Workspace and Pure Sandbox profile strategies apply.

```python
sess = client.sessions.create(browser_channel="chrome")          # system Chrome Stable
sess = client.sessions.create(browser_channel="msedge")          # system Edge
sess = client.sessions.create(executable_path="/path/to/chrome") # custom binary path
```

```bash
agentmb session new --browser-channel chrome
agentmb session new --browser-channel msedge
agentmb session new --executable-path /usr/bin/chromium-browser
```

Valid `browser_channel` values: `chromium` (Playwright bundled, default), `chrome` (system Chrome Stable), `msedge`. `browser_channel` and `executable_path` are mutually exclusive.

### Mode 3: CDP Attach (Bold Mode)

agentmb **attaches to an already-running Chrome** process via the Chrome DevTools Protocol. The remote browser is **not terminated** on `close()` — only the Playwright connection is dropped. This mode exposes lower `navigator.webdriver` fingerprint than managed modes and supports extensions.

Three profile variants are available, depending on which `--user-data-dir` Chrome is launched with:

| Variant | `--user-data-dir` | State | Typical Use |
|---|---|---|---|
| **A. Sandbox** | temp dir (auto) | ephemeral | clean-slate CI runs, throwaway sessions |
| **B. Dedicated Profile** | custom persistent dir | persistent, isolated | automation account, persistent login |
| **C. User Chrome** | your real Chrome profile | inherits all cookies & extensions | leverage personal login state |

#### Variant A: Sandbox (ephemeral temp dir)

`agentmb browser-launch` creates a fresh temp profile automatically. Clean slate — no cookies, no extensions.

```bash
agentmb browser-launch --port 9222
# → launches Chrome with --user-data-dir=/tmp/agentmb-cdp-9222 (temp, ephemeral)
# → CDP URL: http://127.0.0.1:9222
```

```python
sess = client.sessions.create(launch_mode="attach", cdp_url="http://127.0.0.1:9222")
sess.navigate("https://example.com")
sess.close()  # disconnects only — Chrome stays alive
```

#### Variant B: Dedicated Profile (isolated persistent profile)

Pass a fixed `--user-data-dir` to Chrome. State (cookies, localStorage) persists across restarts. Completely isolated from your personal Chrome.

```bash
# macOS / Linux
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.agentmb-profiles/my-automation-profile" \
  --no-first-run --no-default-browser-check

# Windows
"C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --remote-debugging-port=9222 ^
  --user-data-dir="%APPDATA%\agentmb-profiles\my-automation-profile"
```

```python
sess = client.sessions.create(launch_mode="attach", cdp_url="http://127.0.0.1:9222")
```

#### Variant C: User Chrome (reuse your real Chrome profile)

Point Chrome at your existing user profile to inherit all logged-in sessions, saved passwords, and installed extensions. **Chrome must not already be running with that profile** when you launch with remote debugging.

```bash
# macOS — close Chrome first, then:
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/Library/Application Support/Google/Chrome"

# Linux
google-chrome --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.config/google-chrome"

# Windows
"C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --remote-debugging-port=9222 ^
  --user-data-dir="%LOCALAPPDATA%\Google\Chrome\User Data"
```

```python
sess = client.sessions.create(launch_mode="attach", cdp_url="http://127.0.0.1:9222")
# → all cookies, extensions, and login state from your personal Chrome are available
```

**Warning**: actions performed via agentmb will affect your real Chrome profile (cookies written, history created, etc.). Use Variant B when in doubt.

---

Attach a session (all variants):

```bash
agentmb session new --launch-mode attach --cdp-url http://127.0.0.1:9222
```

**Note**: `launch_mode=attach` is incompatible with `browser_channel` and `executable_path` (preflight returns `400`). CDP attach gives agentmb control over **all tabs** in the connected browser.

### Session Seal

Mark a session as sealed to prevent accidental deletion:

```python
sess.seal()
# Now sess.close() / DELETE returns 423 session_sealed
```

```bash
agentmb session seal <session-id>
agentmb session rm <session-id>  # → error: session is sealed
```

### Preflight Validation

The `POST /api/v1/sessions` endpoint validates parameters before launching and returns `400 preflight_failed` for:
- `browser_channel` + `executable_path` used together (mutually exclusive)
- `browser_channel` not in `['chromium', 'chrome', 'msedge']`
- `launch_mode=attach` without `cdp_url`
- `cdp_url` with invalid URL format
- `launch_mode=attach` combined with `browser_channel` or `executable_path`

---

## CDP Access

agentmb uses Chromium stable as the browser engine. The protocol exposed is the full **Chrome DevTools Protocol (CDP)** as implemented in Chromium/Chrome. Three distinct access modes are provided.

### 1. CDP Command Passthrough (REST)

Send any DevTools Protocol method to the session's CDP session.

```http
GET  /api/v1/sessions/:id/cdp          → session CDP info
POST /api/v1/sessions/:id/cdp
     {"method": "Page.captureScreenshot", "params": {"format": "png"}}
```

All CDP calls are written to the session audit log (`type="cdp"`, `method`, `session_id`, `purpose`, `operator`). Error responses are sanitized (stack frames and internal paths stripped before logging).

### 2. CDP WebSocket Passthrough

Returns the browser-level `ws://` endpoint. Connect Puppeteer, Chrome DevTools, or any CDP client directly.

```bash
agentmb cdp-ws <session-id>
# → ws://127.0.0.1:NNNN/devtools/browser/...
```

```python
ws_url = sess.cdp_ws_url()
# connect with puppeteer, pyppeteer, or raw websocket
```

Note: The WebSocket URL is for the full browser process (not per-page). It is only available when the daemon uses a non-persistent browser launch. Auth-gated: requires the same `X-API-Token` as REST endpoints when auth is enabled.

### 3. CDP Network Emulation

Apply network throttling or offline mode via an internal CDP session attached per-session. Does not require external CDP tooling.

```bash
agentmb set-network <session-id> \
  --latency-ms 200 \
  --download-kbps 512 \
  --upload-kbps 256

agentmb set-network <session-id> --offline   # full offline mode
agentmb reset-network <session-id>           # restore normal conditions
```

```python
sess.network_conditions(offline=False, latency_ms=200,
                        download_kbps=512, upload_kbps=256)
```

---

## Profile Management (API / SDK)

Profiles persist cookies, localStorage, and browser state between sessions.

```python
# List all profiles on disk
result = client.list_profiles()
for p in result.profiles:
    print(p.name, p.path, p.last_used)

# Reset a profile (wipes data dir and recreates empty directory)
# Returns 409 if a live session is currently using the profile.
result = client.reset_profile("demo")
# result.status == "ok"
```

REST:
```
GET  /api/v1/profiles              → ProfileListResult
POST /api/v1/profiles/:name/reset  → ProfileResetResult
```

Profile directories are stored under `AGENTMB_DATA_DIR/profiles/<name>/`.

---

## Safety Execution Policy

Rate limiting and action guardrails enforced per-session, per-domain.

### Profiles

| Profile | Min interval | Jitter | Max actions/min | Sensitive actions |
|---|---|---|---|---|
| `safe` | 1500 ms | 300–800 ms | 8 | blocked (HTTP 403) |
| `permissive` | 200 ms | 0–100 ms | 60 | allowed |
| `disabled` | 0 ms | 0 ms | unlimited | allowed |

Set daemon-wide default via environment variable:

```bash
AGENTMB_POLICY_PROFILE=disabled node dist/daemon/index.js   # CI / trusted automation
AGENTMB_POLICY_PROFILE=safe    node dist/daemon/index.js   # untrusted / social-media flows
```

### Per-session override

```bash
agentmb policy <session-id>                        # get current profile
agentmb policy <session-id> safe                   # switch to safe
agentmb policy <session-id> permissive             # switch to permissive
agentmb policy <session-id> safe --allow-sensitive # safe + allow sensitive actions
```

```python
sess.set_policy("safe", allow_sensitive_actions=False)
info = sess.get_policy()  # → PolicyInfo
```

### Audit log (policy events)

All policy events (`throttle`, `jitter`, `cooldown`, `deny`, `retry`) are written to the session audit log with `type="policy"`.

```bash
agentmb logs <session-id>   # shows policy events inline
```

### Sensitive action guard

Pass `"sensitive": true` in any request body to mark it as sensitive. With `safe` profile and `allow_sensitive_actions=false`:

```json
{ "error": "sensitive action blocked by policy", "policy_event": "deny" }
```

HTTP status: `403`.

---

## Security

### API Token Authentication

All endpoints require `X-API-Token` or `Authorization: Bearer <token>` when `AGENTMB_API_TOKEN` is set.

```bash
export AGENTMB_API_TOKEN="my-secret-token"
```

Requests without a valid token return `401 Unauthorized`. CDP REST and WebSocket endpoints are subject to the same token check.

### Profile Encryption

Browser profiles (cookies, storage) are encrypted at rest using AES-256-GCM when `AGENTMB_ENCRYPTION_KEY` is set.

```bash
# 32-byte key, base64 or hex encoded
export AGENTMB_ENCRYPTION_KEY="$(openssl rand -base64 32)"
```

Profiles written without a key cannot be read with one and vice versa.

### Input Validation (Preflight)

Every action route runs preflight checks before execution:

- `timeout_ms`: must be in range `[50, 60000]` ms. Out-of-range values return `400 preflight_failed` with `{ field, constraint, value }`.
- `fill` value: max 100,000 characters. Longer values return `400 preflight_failed`.

### Error Diagnostics and Recovery Hints

When an action fails (element not found, timeout, detached context, overlay intercept), the route returns `422` with a structured diagnostic payload:

```json
{
  "error": "Timeout 3000ms exceeded.",
  "url": "https://example.com",
  "readyState": "complete",
  "recovery_hint": "Increase timeout_ms or add stability.wait_before_ms; ensure element is visible before acting"
}
```

`recovery_hint` categories:
- **Timeout / waiting for**: increase `timeout_ms` or add `stability.wait_before_ms`; verify element visibility
- **Target closed / detached**: page navigated or element removed; re-navigate or call `snapshot_map` again
- **Not found / no element**: check selector; use `snapshot_map` to verify element exists on current page
- **Intercept / overlap / obscured**: element covered by overlay; try `executor=auto_fallback` or scroll into view first

### Audit Logging

Every action, CDP call, and policy event is appended to a per-session JSONL audit log:

```json
{
  "ts": "2026-02-28T10:00:01.234Z",
  "v": 1,
  "session_id": "s_abc123",
  "action_id": "act_xyz",
  "type": "action",
  "action": "click",
  "url": "https://example.com",
  "selector": "#submit",
  "result": { "status": "ok", "duration_ms": 142 },
  "purpose": "submit search form",
  "operator": "codex-agent"
}
```

Fields: `purpose` (why), `operator` (who/what). Set via request body or `X-Operator` header.

```bash
agentmb logs <session-id> --tail 50
```

---

## Human Login Handoff

Switch a session to headed (visible) mode, log in manually, then return to headless automation with the same cookies and storage.

```bash
agentmb login <session-id>
# → browser window opens
# → log in manually
# → press Enter in terminal to return to headless mode
```

---

## Linux Headed Mode

Linux visual/headed mode requires Xvfb:

```bash
sudo apt-get install -y xvfb
bash scripts/xvfb-headed.sh
```

---

## Playwright Trace Recording

```bash
agentmb trace start <session-id>
# ... perform actions ...
agentmb trace stop <session-id> -o trace.zip
npx playwright show-trace trace.zip
```

---

## Verify

Runs: build → daemon start → 19 pytest suites → daemon stop. Requires daemon to not be running on the configured port.

```bash
bash scripts/verify.sh            # uses default port 19315
AGENTMB_PORT=19320 bash scripts/verify.sh
```

Expected output: `ALL GATES PASSED (24/24)`.

---

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `AGENTMB_PORT` | `19315` | Daemon HTTP port |
| `AGENTMB_DATA_DIR` | `~/.agentmb` | Profiles and logs directory |
| `AGENTMB_API_TOKEN` | _(none)_ | Require this token on all requests |
| `AGENTMB_ENCRYPTION_KEY` | _(none)_ | AES-256-GCM key for profile encryption (32 bytes, base64 or hex) |
| `AGENTMB_LOG_LEVEL` | `info` | Daemon log verbosity |
| `AGENTMB_POLICY_PROFILE` | `safe` | Default safety policy profile (`safe\|permissive\|disabled`) |

---

## License

MIT
