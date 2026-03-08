---
name: agentmb
description: >
  Local browser automation daemon for AI agents. Use when the task requires
  interacting with websites: navigate pages, fill forms, click buttons, take
  screenshots, extract data, run web tests, log in to sites, or automate any
  browser workflow.
  Trigger phrases: "open a website", "fill out a form", "click a button",
  "take a screenshot", "scrape data", "test this web app", "log in to",
  "automate the browser", "browse to", "extract from the page".
allowed-tools:
  - Bash(agentmb *)
  - Bash(node dist/cli/index.js *)
---

# agentmb — AI Agent Quick Reference

> **For AI agents**: Read this file first. It covers 80% of use cases in one read.
> For deep reference, see [`references/`](./references/) (linked at the bottom).

---

## Core Workflow

Every agentmb task follows this loop:

```
1. Start daemon     agentmb start                              (once per machine session)
2. Create session   agentmb session new --profile <name>       → returns <session-id>
3. Navigate         agentmb navigate <session-id> <url>
4. Scan elements    agentmb element-map <session-id>           → returns e1, e2, e3…
5. Interact         agentmb click <session-id> e3 --element-id
6. Re-scan          agentmb element-map <session-id>           (after page changes)
7. Close session    agentmb session rm <session-id>
```

**Important**: Every command requires `<session-id>`. Get it from `session new` or `session list`.

```bash
# Minimal end-to-end example
agentmb start &
SID=$(agentmb session new --profile demo | grep -oP 'sess_\w+')
agentmb navigate $SID https://example.com
agentmb element-map $SID
agentmb screenshot $SID -o shot.png
agentmb session rm $SID
```

---

## Locator Mode — How to Choose

**Use this priority order. Start at 1, move to next only if needed.**

### Priority 1 — element-map + --element-id (default)

Works for most pages with visible text, links, or buttons.

```bash
agentmb element-map <session-id>
# → e1  [button] Submit
# → e2  [input]  Email address
# → e3  [a]      Sign in

agentmb click <session-id> e1 --element-id
agentmb fill  <session-id> e2 "user@example.com" --element-id
```

Use when: text-rich pages (docs, GitHub, dashboards, forms).

### Priority 2 — CSS Selector (when element-map labels are empty or unreliable)

```bash
agentmb click <session-id> "button[data-testid=submit]"
agentmb fill  <session-id> "#email" "user@example.com"
agentmb get   <session-id> text ".product-title"
```

Use when: icon-only SPAs, dynamic class names, element-map returns `label_source=none`.

### Priority 3 — snapshot-map + --ref-id (for dynamic pages / run_steps)

Snapshot captures a point-in-time state; ref_id stays valid as long as the page hasn't navigated.

```bash
agentmb snapshot-map <session-id>
# → snap_000001:e1  [button] Login
# → snap_000001:e5  [input]  Password

agentmb click <session-id> snap_000001:e1 --ref-id
```

Python SDK:
```python
snap = sess.snapshot_map()
btn = next(e for e in snap.elements if "Login" in (e.label or ""))
sess.click(ref_id=btn.ref_id)
```

Use when: you need to confirm element exists before acting, run_steps batch, or stale detection matters.
Stale ref (page changed): catch `409 stale_ref` → call `snapshot-map` again → retry.

### Priority 4 — click-at coordinates (last resort)

```bash
agentmb bbox <session-id> "#editor"          # → center_x, center_y
agentmb click-at <session-id> 450 320
```

Use when: `contenteditable`, canvas, custom components, or all above fail.

---

## Essential Commands

### Session

| Command | Notes |
|---|---|
| `agentmb session new --profile <name>` | Named profile (persistent cookies) |
| `agentmb session new --ephemeral` | Temp profile, auto-deleted on close |
| `agentmb session new --browser-channel chrome` | Use system Chrome Stable |
| `agentmb session new --launch-mode attach --cdp-url http://127.0.0.1:9222` | CDP Attach to existing Chrome |
| `agentmb session new --proxy http://user:pass@host:8080` | Route all traffic through proxy |
| `agentmb session new --record-video` | Enable session video recording |
| `agentmb session new --allow-dir /path` | Allow `/utils/ls` access to a local dir (repeatable) |
| `agentmb session new --allow-extensions` | Enable extensions for managed sessions (default: disabled) |
| `agentmb session list` | List active sessions |
| `agentmb session rm <sid>` | Close and delete session |
| `agentmb session seal <sid>` | Prevent accidental deletion (423 on rm) |

### Navigation

| Command | Notes |
|---|---|
| `agentmb navigate <sid> <url>` | Navigate; `--wait-until load\|networkidle` |
| `agentmb back <sid>` / `forward <sid>` / `reload <sid>` | Browser history |
| `agentmb wait-url <sid> <pattern>` | Wait for URL to match pattern |
| `agentmb wait-text <sid> <text>` | Wait for text to appear |
| `agentmb wait-stable <sid>` | Network idle + DOM quiet |

### Element Interaction

| Command | Notes |
|---|---|
| `agentmb click <sid> <sel-or-eid>` | Click; use `--element-id` or `--ref-id` for scanned refs |
| `agentmb fill <sid> <sel-or-eid> <value>` | Fast fill (replace) |
| `agentmb type <sid> <sel-or-eid> <text>` | Type char by char; `--delay-ms <ms>` |
| `agentmb press <sid> <sel-or-eid> <key>` | Key combo: `Enter`, `Tab`, `Control+a` |
| `agentmb hover <sid> <sel-or-eid>` | Hover |
| `agentmb select <sid> <sel> <value>` | Select `<option>` in `<select>` |
| `agentmb check <sid> <sel-or-eid>` / `uncheck` | Checkbox / radio |
| `agentmb drag <sid> <source> <target>` | Drag-and-drop |

`<sel-or-eid>` accepts: CSS selector, `eN --element-id`, or `snap_XXXXXX:eN --ref-id`.

### Read / Assert

| Command | Notes |
|---|---|
| `agentmb get <sid> text <sel-or-eid>` | Read text / value / html / attr / box |
| `agentmb assert <sid> visible <sel-or-eid>` | Assert visible / enabled / checked |
| `agentmb extract <sid> <selector>` | Extract multiple elements as list |
| `agentmb eval <sid> <js-expr>` | Evaluate JavaScript; returns raw result |

### Observe

| Command | Notes |
|---|---|
| `agentmb screenshot <sid> -o out.png` | Screenshot; `--full-page` |
| `agentmb extract-image <sid> <selector> -o out.png` | Extract element as image asset (`--format png|jpeg`) |
| `agentmb annotated-screenshot <sid> --highlight <sel>` | Screenshot with element overlays |
| `agentmb logs <sid> --tail 50` | Session audit log |
| `agentmb console-log <sid>` | Browser console entries |
| `agentmb page-errors <sid>` | Uncaught JS errors |

### Scroll

| Command | Notes |
|---|---|
| `agentmb scroll <sid> <sel-or-eid>` | Scroll; response has `scrolled`, `scrollable_hint` |
| `agentmb scroll-until <sid>` | Scroll until `--stop-selector` / `--stop-text` |
| `agentmb load-more-until <sid> <btn-sel> <item-sel>` | Repeatedly click load-more |

If `scrolled=false`, check `scrollable_hint` in response — it lists the top scrollable containers.

### Multi-Page (Tabs)

| Command | Notes |
|---|---|
| `agentmb pages list <sid>` | List all open tabs with IDs and URLs |
| `agentmb pages new <sid>` | Open a new tab → returns page-id |
| `agentmb pages switch <sid> <page-id>` | Switch active tab (changes default target) |
| `agentmb pages close <sid> <page-id>` | Close tab (last tab protected) |

**Direct page targeting (no tab switch needed)**: Pass `page_id` in the request body to any action route.
All major actions support `page_id`: navigate, click, fill, type, press, eval, screenshot, element_map, snapshot_map, scroll.

```python
# Target a specific tab WITHOUT switching active tab
sess.navigate("https://page2.example.com", page_id="page_abc123")
sess.element_map(page_id="page_abc123")
sess.click(element_id="e1", page_id="page_abc123")
```

```bash
# CLI: use --page-id flag
agentmb navigate $SID https://page2.example.com --page-id page_abc123
agentmb screenshot $SID -o p2.png --page-id page_abc123
```

---

## Common Patterns

### Pattern 1: Fill a Form and Submit

```bash
SID=<session-id>
agentmb navigate $SID https://example.com/login
agentmb element-map $SID
# Identify: e2 = email input, e3 = password input, e4 = Submit button
agentmb fill  $SID e2 "user@example.com" --element-id
agentmb fill  $SID e3 "password123"      --element-id
agentmb click $SID e4                    --element-id
agentmb wait-url $SID "**/dashboard**"
agentmb screenshot $SID -o after-login.png
```

### Pattern 2: Human Login Handoff (Reuse Login State)

```bash
# Step 1: One-time manual login
agentmb session new --profile myaccount
agentmb login <session-id>              # opens headed browser window
# → Log in manually → press Enter in terminal

# Step 2: Subsequent runs reuse the saved profile
agentmb session new --profile myaccount   # cookies already there
agentmb navigate <session-id> https://app.example.com/dashboard
```

Python SDK:
```python
# Export auth state after manual login
sess.storage_export("myaccount-state.json")

# Restore in future sessions
sess2 = client.sessions.create(profile="myaccount")
sess2.storage_import("myaccount-state.json")
```

### Pattern 3: Extract Data from a Page

```bash
SID=<session-id>
agentmb navigate $SID https://news.ycombinator.com
agentmb extract  $SID ".titleline > a"          # all article titles
agentmb get      $SID text ".score:first-child"  # first score
agentmb eval     $SID "document.querySelectorAll('.rank').length"  # JS eval
```

Python SDK:
```python
result = sess.extract(".titleline > a")
titles = [item["text"] for item in result.items]
```

### Pattern 4: run_steps Batch Execution

Execute multiple actions in one request. Supports `stop_on_error`.

```python
snap = sess.snapshot_map()
btn_ref = next(e.ref_id for e in snap.elements if "Login" in (e.label or ""))

result = sess.run_steps([
    {"action": "navigate", "params": {"url": "https://example.com"}},
    {"action": "click",    "params": {"ref_id": btn_ref}},
    {"action": "fill",     "params": {"element_id": "e5", "value": "user@example.com"}},
    {"action": "fill",     "params": {"selector": "#pass", "value": "secret"}},
    {"action": "press",    "params": {"selector": "#pass", "key": "Enter"}},
    {"action": "screenshot","params": {"format": "png"}},
], stop_on_error=True)

print(result.status, result.completed_steps)
for step in result.results:
    if step.error:
        print(f"Step {step.step} failed: {step.error}")
```

### Pattern 5: CDP Attach to Existing Chrome

```bash
# Start Chrome with remote debugging (Variant A: temp profile)
agentmb browser-launch --port 9222

# Attach
agentmb session new --launch-mode attach --cdp-url http://127.0.0.1:9222
```

Python SDK:
```python
sess = client.sessions.create(launch_mode="attach", cdp_url="http://127.0.0.1:9222")
sess.navigate("https://example.com")
sess.close()  # only disconnects — Chrome stays alive
```

Use when: you need real Chrome fingerprint, extensions, or want to reuse your personal login state.

### Pattern 6: Multi-Tab Parallel Work (Switch-Based)

```python
# Open tabs, switch between them
page2_id = sess.new_page()
sess.switch_page(page2_id)
sess.navigate("https://other.example.com")

# Switch back to first tab
pages = sess.pages()
sess.switch_page(pages[0].page_id)
```

### Pattern 7: Single-Account Multi-Page Targeting (R09-C03)

**Key insight**: Use one session (one login) with multiple pages. Target specific pages directly
via `page_id` param — no tab switching needed. One agent can drive multiple pages concurrently.

```python
import asyncio
from agentmb import AsyncBrowserClient

async def run():
    async with AsyncBrowserClient() as client:
        # One session = one logged-in account
        sess = await client.sessions.create(profile="gmail-account")
        async with sess:
            # Open three tabs
            pages = await sess.pages()
            p1 = pages[0].page_id        # main tab
            p2 = await sess.new_page()   # returns page_id
            p3 = await sess.new_page()

            # Navigate each tab independently
            await asyncio.gather(
                sess.navigate("https://gmail.com/inbox",   page_id=p1),
                sess.navigate("https://gmail.com/sent",    page_id=p2),
                sess.navigate("https://gmail.com/drafts",  page_id=p3),
            )

            # Screenshot all three without switching
            shots = await asyncio.gather(
                sess.screenshot(page_id=p1),
                sess.screenshot(page_id=p2),
                sess.screenshot(page_id=p3),
            )

asyncio.run(run())
```

CLI equivalent (parallel via background jobs):
```bash
SID=<session-id>
P1=$(agentmb pages list $SID | grep active | awk '{print $1}')
P2=$(agentmb pages new $SID | grep page_id | awk '{print $2}')

agentmb navigate $SID https://site.com/page1 --page-id $P1 &
agentmb navigate $SID https://site.com/page2 --page-id $P2 &
wait

agentmb screenshot $SID -o p1.png --page-id $P1
agentmb screenshot $SID -o p2.png --page-id $P2
```

### Pattern 8: Anti-Ban / Humanization

For sites that detect automation, use these techniques:

```python
# 1. Use Chrome Stable (not Chromium) — real browser fingerprint
sess = client.sessions.create(
    profile="my-account",
    browser_channel="chrome",   # system Chrome Stable
    headless=False,             # headed = visible window (harder to detect)
)

# 2. Human-like typing with delays
sess.fill(selector="#search", value="python tutorial",
          fill_strategy="type", char_delay_ms=80)  # ~80 ms per char

# 3. Mouse movement before click
sess.mouse_move(ref_id="snap_abc:e3")   # smooth trajectory to target
sess.click(ref_id="snap_abc:e3")

# 4. Add realistic pauses between actions
import time
sess.click(element_id="e1")
time.sleep(1.2)                # human-like pause
sess.fill(element_id="e2", value="hello world", fill_strategy="type", char_delay_ms=60)
time.sleep(0.8)
sess.click(element_id="e3")   # submit

# 5. Use permissive policy (avoid rate-limit delays for your own throttling)
sess = client.sessions.create(profile="demo", policy="permissive")

# 6. Scroll before interacting (shows engagement pattern)
sess.scroll(selector="body", delta_y=300)
time.sleep(0.5)
sess.click(element_id="e5")
```

Key rules:
- Prefer `browser_channel="chrome"` over default Chromium for sites with fingerprint detection
- Use `fill_strategy="type"` for controlled inputs on SPAs (React/Vue/Angular) — avoids double-input bugs
- Use named profiles so each account has its own persistent session (cookies/storage)
- Avoid hammering the same endpoint — use `scroll_until` with `step_delay_ms` for pagination
- If blocked, use `agentmb login <sid>` to manually re-authenticate

### Pattern 9: Sensitive Domain Warning

`navigate` responses automatically include `sensitive_warning` when the target domain matches a sensitive category (financial, medical, gambling, adult, crypto). Use this to gate actions or log warnings:

```python
result = sess.navigate("https://mybank.example.com/")
raw = result.model_dump() if hasattr(result, "model_dump") else vars(result)
if raw.get("sensitive_warning"):
    w = raw["sensitive_warning"]
    print(f"[WARN] Sensitive domain ({w['category']}): {w['message']}")
    # Optionally abort or require human confirmation
```

### Pattern 10: Network Route Mock with Regex

Use regex patterns for flexible URL interception. Enclose in `/regex/flags`:

```python
# Mock all JSON API endpoints
sess.add_route(r"/\/api\/.*\.json/i", mock={
    "status": 200,
    "content_type": "application/json",
    "body": '{"mock": true}',
    "delay_ms": 200,   # simulate 200 ms latency
})
```

CLI:
```bash
agentmb route add $SID '/\/api\/.*\.json/i' --status 200 --body '{"mock":true}' --content-type application/json
```

### Pattern 11: Local File Scan via allow_dirs

Allow a session to scan specific local directories. Useful for agents that need to list generated reports, downloaded files, or workspace contents:

```python
import os, tempfile

tmpdir = "/tmp/agent-workspace"
os.makedirs(tmpdir, exist_ok=True)

sess = client.sessions.create(profile="demo", allow_dirs=[tmpdir])

# List directory contents (depth 2)
import requests
r = requests.get(f"http://127.0.0.1:19315/api/v1/utils/ls",
                 params={"session_id": sess.id, "path": tmpdir, "depth": "2"})
for entry in r.json()["entries"]:
    print(entry["name"], entry["type"], entry.get("size"))
```

Access outside allowed dirs returns `403`. Sessions without `allow_dirs` always return `403`.

---

## Python SDK Quick Reference

```python
from agentmb import BrowserClient, AsyncBrowserClient

# Sync
with BrowserClient(base_url="http://127.0.0.1:19315") as client:
    sess = client.sessions.create(profile="demo", headless=True)
    sess.navigate("https://example.com")
    shot = sess.screenshot()
    shot.save("out.png")
    result = sess.extract("h1")
    print(result.items)
    sess.close()

# Async
async with AsyncBrowserClient(base_url="http://127.0.0.1:19315") as client:
    sess = await client.sessions.create(profile="demo")
    async with sess:
        await sess.navigate("https://example.com")
        title = await sess.eval("document.title")
```

Key session options:
```python
client.sessions.create(
    profile="name",          # named persistent profile
    ephemeral=True,          # temp profile (no persistence)
    headless=True,           # headless mode (default)
    browser_channel="chrome",# system Chrome Stable
    launch_mode="attach",    # CDP Attach
    cdp_url="http://...",    # required for attach mode
    accept_downloads=True,   # enable file downloads
    policy="permissive",     # rate limit policy: safe|permissive|disabled
    proxy_url="http://...",  # session-level proxy (R09)
    record_video=True,       # enable video recording (R09)
    allow_dirs=["/tmp/data"],# whitelist for /utils/ls file scan (R09)
)
```

---

## Session State Transfer (R10)

### grant-permission — Runtime Browser Permission Grant

Dynamically grant browser permissions to a live session without relaunching:

```bash
agentmb session grant-permission <session-id> camera microphone
agentmb session grant-permission <session-id> notifications --origin https://example.com
```

Supported: `camera`, `microphone`, `notifications`, `geolocation`, `clipboard-read`, `clipboard-write`, `accelerometer`, `background-sync`, `magnetometer`, `gyroscope`, `midi`, `payment-handler`, `persistent-storage`.

### profile list / delete — Profile Asset Management

```bash
agentmb profile list                          # list all profiles (managed + stable zones)
agentmb profile list --zone managed           # Playwright Chromium profiles only
agentmb profile delete <name>                 # delete managed profile (live sessions → 423)
agentmb profile delete <name> --force         # force delete even with live sessions
agentmb profile delete <name> --zone stable   # delete Chrome/Edge profile
```

Profile zones: `managed` = Playwright Chromium (`profiles/`), `stable` = system Chrome/Edge (`chrome-profiles/`).

### eval — top-level await support

`eval` auto-wraps expressions containing `await` — no manual async wrapper needed:

```bash
agentmb eval $SID "await fetch('/api/data').then(r => r.json())"
agentmb eval $SID "await new Promise(r => setTimeout(r, 500)); document.title"
```

### session fork — Clone Live Session State

Copy cookies + localStorage from a live session into a new independent session:

```bash
agentmb session fork <session-id>
agentmb session fork <session-id> --channel chrome --profile new-profile
```

Source session stays alive. Useful for: testing multiple auth flows in parallel, running A/B workflows from the same login state.

### session adopt — Import External Browser State via CDP

Extract cookies + localStorage from a system Chrome (or any Chromium-based browser) into a new managed session.

**CDP prerequisite**: the external browser must expose a remote debugging port:
```bash
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug
```

Then:
```bash
agentmb session adopt --cdp-url http://127.0.0.1:9222 --profile imported
```

The external browser is **not closed** — state is read-only. The new managed session can be used for headless automation with the imported cookies.

**attach vs adopt**:
- `session attach` (CDP attach): agentmb connects to and controls an existing browser directly (invasive)
- `session adopt` (CDP adopt): agentmb reads state from a browser, creates a NEW managed session, disconnects (non-invasive)

### session switch-engine — Hot-Swap Browser Engine

Switch engine mid-session while preserving cookies and localStorage:

```bash
agentmb session switch-engine <session-id> --target-channel chrome
agentmb session switch-engine <session-id> --target-channel chromium --keep-source
```

Returns a new session ID. Source session is closed by default (`keep-source` keeps it alive).
Rollback-safe: if target engine fails to start, source is preserved and `502` is returned.

### allow-extensions — Managed Session Extension Toggle

Managed sessions are secure-by-default: extensions are disabled unless you opt in.

```bash
agentmb session new --profile dev --allow-extensions
agentmb session new --browser-channel chrome --allow-extensions
```

Notes:
- Default is `allow_extensions=false`.
- Applies to managed launches (`chromium`/`chrome`/`msedge`).
- In CDP attach mode, extension behavior is controlled by the external browser.

### extract-image — Visual Asset Extraction

Extract one page element as an image file (PNG/JPEG):

```bash
agentmb extract-image <session-id> ".product-card img" --format png -o ./product.png
agentmb extract-image <session-id> "#hero" --format jpeg -o ./hero.jpg
```

API:
```http
POST /api/v1/sessions/:id/extract-image
{ "selector": ".product-card img", "format": "png" }
```

Response includes base64 image data and metadata (`width`, `height`, `tag_name`, optional `src`).

---

## Error Recovery

| Error | Meaning | Fix |
|---|---|---|
| `404 session not found` | Session ID invalid or expired | `session list` → use valid ID |
| `422` with `recovery_hint` | Action failed (timeout, not found, overlay) | Follow `recovery_hint` in response |
| `409 stale_ref` | snapshot-map ref_id expired (page navigated) | Call `snapshot-map` again, retry with new ref_id |
| `400 preflight_failed` | Invalid session parameters | Check field + constraint in error body |
| `403 sensitive blocked` | Safe policy blocking sensitive action | Use `agentmb policy <sid> permissive` or pass `sensitive: false` |
| `403 No allowed directories` | `/utils/ls` called but session has no `allow_dirs` | Re-create session with `--allow-dir <path>` or `allow_dirs=[...]` |
| `403 path not within allowed` | `/utils/ls` path is outside the whitelist | Use a path inside one of the configured `allow_dirs` |
| `423 session_sealed` | Session is sealed | Unseal via API or use a different session |
| `sensitive_warning` in navigate response | Target domain matched a sensitive category | Log warning; optionally gate further actions or require human confirmation |

---

## References

For deeper detail, see `skills/agentmb/references/`:

| File | When to read |
|---|---|
| [`locator-modes.md`](./references/locator-modes.md) | Full locator priority guide, `label_source` chain, stale_ref recovery, `ref_id` format |
| [`commands.md`](./references/commands.md) | Complete CLI command table by category (all flags) |
| [`session-management.md`](./references/session-management.md) | Multi-page, multi-agent, session lifecycle, policy |
| [`browser-modes.md`](./references/browser-modes.md) | Managed Chromium / Chrome Stable / CDP Attach deep dive |
| [`authentication.md`](./references/authentication.md) | Human login handoff, profile persistence, storage export/import |
