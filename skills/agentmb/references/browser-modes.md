# Browser Modes — Deep Reference

agentmb supports three browser running modes, differing in **which binary is used and how it is connected**.

| Mode | Browser | How Connected | Profile Persistence |
|---|---|---|---|
| **1. Managed Chromium** | Playwright-bundled Chromium | agentmb spawns & owns | Persistent or ephemeral |
| **2. Managed Chrome Stable** | System Chrome / Edge | agentmb spawns & owns | Persistent or ephemeral |
| **3. CDP Attach** | Any running Chrome-compatible | agentmb attaches via CDP | Owned by external process |

---

## Mode 1 — Managed Chromium (default)

agentmb spawns the **Playwright-bundled Chromium** binary. No system Chrome required. Works in headless (CI) and headed modes.

```bash
agentmb session new --profile demo             # named profile (persistent)
agentmb session new --ephemeral                # temp profile (auto-deleted)
agentmb session new --profile demo --headed    # visible window
```

```python
sess = client.sessions.create(profile="demo")
sess = client.sessions.create(ephemeral=True)
sess = client.sessions.create(profile="demo", headless=False)
```

**Use when**: default automation, CI pipelines, no system Chrome required, any OS.

---

## Mode 2 — Managed Chrome Stable

agentmb spawns **system-installed Chrome or Edge** via Playwright. Chrome Stable or Edge must be installed on the host.

```bash
agentmb session new --browser-channel chrome         # system Chrome Stable
agentmb session new --browser-channel msedge         # system Edge
agentmb session new --executable-path /path/to/chrome  # custom binary
```

```python
sess = client.sessions.create(browser_channel="chrome")           # Chrome Stable
sess = client.sessions.create(browser_channel="msedge")           # Edge
sess = client.sessions.create(executable_path="/usr/bin/chromium") # custom path
```

Valid `browser_channel` values: `chromium` (default), `chrome`, `msedge`.
`browser_channel` and `executable_path` are mutually exclusive — using both returns `400 preflight_failed`.

**Use when**: you need Chrome-specific behavior, extensions, or site compatibility that differs from bundled Chromium.

---

## Mode 3 — CDP Attach

agentmb **attaches to an already-running Chrome** process via the Chrome DevTools Protocol. The external browser is **not terminated** on `close()` — only the Playwright connection is dropped.

### Three Profile Variants

| Variant | `--user-data-dir` | State | Typical Use |
|---|---|---|---|
| **A. Sandbox** | temp dir (auto) | ephemeral | clean CI, throwaway sessions |
| **B. Dedicated Profile** | custom persistent dir | persistent, isolated | automation account, persistent login |
| **C. User Chrome** | your real Chrome profile | inherits cookies & extensions | leverage personal login state |

#### Variant A: Sandbox (temp profile, via browser-launch)

`agentmb browser-launch` starts Chrome with an auto-created temp profile. Clean slate every time.

```bash
agentmb browser-launch --port 9222
# → Chrome launched at ws://127.0.0.1:9222 with temp --user-data-dir

agentmb session new --launch-mode attach --cdp-url http://127.0.0.1:9222
```

```python
sess = client.sessions.create(launch_mode="attach", cdp_url="http://127.0.0.1:9222")
sess.navigate("https://example.com")
sess.close()  # only disconnects — Chrome stays alive
```

#### Variant B: Dedicated Profile (persistent, isolated)

Pass a fixed `--user-data-dir` to Chrome at startup. State persists across restarts. Completely isolated from personal Chrome.

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

#### Variant C: User Chrome (reuse personal profile)

Point Chrome at your existing user profile to inherit all logged-in sessions, saved passwords, and installed extensions. **Chrome must not be running** with that profile when you launch it with remote debugging.

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
# → all cookies, extensions, and login state from personal Chrome are available
```

**Warning**: actions will affect your real Chrome profile. Use Variant B when in doubt.

### CDP Attach Notes

- `close()` only drops the Playwright connection. Chrome process stays alive.
- CDP attach gives agentmb control over **all tabs** in the connected browser.
- `launch_mode=attach` is incompatible with `browser_channel` and `executable_path` (preflight returns `400`).
- Lower `navigator.webdriver` fingerprint than managed modes.
- Supports real browser extensions.

Attach command (all variants):
```bash
agentmb session new --launch-mode attach --cdp-url http://127.0.0.1:9222
```

---

## Preflight Validation

The session creation endpoint validates parameters before launching. Returns `400 preflight_failed` for:
- `browser_channel` + `executable_path` used together
- `browser_channel` not in `['chromium', 'chrome', 'msedge']`
- `launch_mode=attach` without `cdp_url`
- `cdp_url` with invalid URL format
- `launch_mode=attach` combined with `browser_channel` or `executable_path`

---

## Mode Selection Summary

| Need | Mode |
|---|---|
| Default CI automation, no system Chrome | Mode 1 (Managed Chromium) |
| Chrome-specific rendering or extensions | Mode 2 (Managed Chrome Stable) |
| Clean-slate session, real Chrome binary | Mode 3 Variant A (CDP Attach + browser-launch) |
| Persistent automation account (isolated) | Mode 3 Variant B (CDP Attach + dedicated profile) |
| Reuse personal login state | Mode 3 Variant C (CDP Attach + user profile) |
