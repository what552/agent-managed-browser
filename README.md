# agent-managed-browser

Agent-ready local browser runtime for stable, auditable web automation.

## What It Does

`agent-managed-browser` provides a persistent Chromium daemon with session management, CLI/Python SDK access, and human login handoff support. It is designed for coding/ops agents that need reproducible browser workflows instead of fragile one-off scripts.

## Use Cases

- **Agent web tasks**: Let Codex/Claude run navigation, click/fill, extraction, screenshot, and evaluation in a controlled runtime.
- **Human-in-the-loop login**: Switch to headed mode for manual login, then return to headless automation with the same profile.
- **E2E and CI verification**: Run isolated smoke/auth/handoff/cdp checks with configurable port and data dir.
- **Local automation service**: Keep one daemon running and let multiple tools/agents reuse sessions safely.

Local Chromium runtime for AI agents, with:

- daemon API (`agentmb`)
- CLI (`agentmb`)
- Python SDK (`agentmb`)

This repo supports macOS, Linux, and Windows.

## Agent Skill

For Codex/Claude/AgentMB operation guidance (initialization, core commands, troubleshooting), see:

- [agentmb-operations-skill/SKILL.md](./agentmb-operations-skill/SKILL.md)

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

## Install from npm / pip

### macOS / Linux

```bash
npm i -g agentmb
python3 -m pip install --user agentmb
agentmb --help
python3 -c "import agentmb; print(agentmb.__version__)"
```

### Windows (PowerShell)

```powershell
npm i -g agentmb
py -m pip install --user agentmb
agentmb --help
py -c "import agentmb; print(agentmb.__version__)"
```

Package roles:
- npm package: CLI + daemon runtime
- pip package: Python SDK client

In another terminal:

```bash
agentmb status
agentmb session new --profile demo
agentmb session list
agentmb navigate <session-id> https://example.com
agentmb screenshot <session-id> -o ./shot.png
agentmb stop
```

## Python SDK

```bash
python3 -m pip install -e sdk/python
python3 -c "from agentmb import BrowserClient; print('SDK OK')"
```

## Install By Platform

For full installation steps on all environments:

- macOS
- Linux (Ubuntu / Debian)
- Windows (PowerShell / WSL2)

See [INSTALL.md](./INSTALL.md).

## Locator Models (How To Operate)

Use one of these three targeting modes based on page stability and replay needs.

### 1) Selector Mode (standard DOM)

Use plain CSS selectors directly.

```bash
agentmb click <session-id> "#submit"
agentmb fill <session-id> "#email" "name@example.com"
agentmb get <session-id> text "#title"
```

Best for: stable pages where selectors are reliable.

### 2) Element-ID Mode (`element-map`)

Step 1: scan the page and get stable `element_id` values.

```bash
agentmb element-map <session-id>
```

Step 2: use `--element-id` in later actions.

```bash
agentmb click <session-id> e3 --element-id
agentmb fill <session-id> e5 "hello" --element-id
agentmb get <session-id> text e3 --element-id
agentmb assert <session-id> visible e3 --element-id
```

Best for: selector drift and dynamic class names.

### 3) Snapshot-Ref Mode (`snapshot-map` + `ref_id`)

Step 1: create a server-side snapshot with `page_rev`.

```bash
agentmb snapshot-map <session-id>
```

Step 2: use returned `ref_id` in API/SDK calls for stale-safe replay.

- If page changed, server returns `409 stale_ref`.
- Recovery: call `snapshot-map` again, then retry with new `ref_id`.

Best for: deterministic replay and safer automation on changing pages.

### Quick Command Index (High Frequency)

```bash
# map/snapshot
agentmb element-map <session-id>
agentmb snapshot-map <session-id>

# read/assert/stability
agentmb get <session-id> <property> <selector-or-eid>
agentmb assert <session-id> <property> <selector-or-eid>
agentmb wait-stable <session-id>

# interaction/navigation
agentmb dblclick <session-id> <selector-or-eid>
agentmb scroll-until <session-id> --direction down --stop-selector ".end"
agentmb load-more-until <session-id> ".load-more" ".item" --item-count 100
agentmb back <session-id>
agentmb reload <session-id>

# state/observability
agentmb cookie-list <session-id>
agentmb storage-export <session-id> -o state.json
agentmb annotated-screenshot <session-id> --highlight "#submit" -o ann.png
agentmb console-log <session-id> --tail 100

# coordinate + browser controls
agentmb click-at <session-id> 640 420
agentmb bbox <session-id> "#submit"
agentmb set-viewport <session-id> 1440 900
agentmb set-network <session-id> --latency-ms 200 --download-kbps 512 --upload-kbps 256
```

## Action Reference

Use `agentmb --help` and `agentmb <command> --help` for full flags.  
Below is grouped by operation type.

### Navigation and Page Runtime

| Command | Purpose |
|---|---|
| `agentmb navigate <sess> <url>` | Navigate to URL |
| `agentmb back <sess>` / `forward <sess>` / `reload <sess>` | Browser history/navigation control |
| `agentmb wait-url <sess> <pattern>` | Wait for URL match |
| `agentmb wait-load-state <sess>` | Wait for load state |
| `agentmb wait-function <sess> <expr>` | Wait for JS condition |
| `agentmb wait-text <sess> <text>` | Wait for text appearance |
| `agentmb wait-stable <sess>` | Wait for network idle + DOM quiet + optional overlay clear |

### Locator and Read/Assert

| Command | Purpose |
|---|---|
| `agentmb element-map <sess>` | Generate stable `element_id` map (DOM injection model) |
| `agentmb snapshot-map <sess>` | Generate server snapshot (`snapshot_id`, `ref_id`, `page_rev`) |
| `agentmb get <sess> <property> <selector-or-eid>` | Read `text/html/value/attr/count/box` |
| `agentmb assert <sess> <property> <selector-or-eid>` | Assert `visible/enabled/checked` |
| `agentmb extract <sess> <selector>` | Extract text/attributes |

Notes:
- `selector-or-eid` accepts CSS selector or `--element-id`.
- `ref_id` is mainly used in API/SDK payloads for stale-safe replay (`409 stale_ref` on page change).

### Element Interaction

| Command | Purpose |
|---|---|
| `agentmb click <sess> <selector-or-eid>` | Click element |
| `agentmb dblclick <sess> <selector-or-eid>` | Double-click element |
| `agentmb fill <sess> <selector-or-eid> <value>` | Fill input/textarea |
| `agentmb type <sess> <selector> <text>` | Type with optional per-char delay |
| `agentmb press <sess> <selector> <key>` | Press key/combo on element |
| `agentmb select <sess> <selector> <value...>` | Select `<option>` in `<select>` |
| `agentmb hover <sess> <selector>` | Hover element |
| `agentmb focus <sess> <selector-or-eid>` | Focus element |
| `agentmb check <sess> <selector-or-eid>` / `uncheck` | Checkbox/radio control |
| `agentmb drag <sess> <source> <target>` | Drag-and-drop by selectors |
| `agentmb upload <sess> <selector> <file>` | Upload file |
| `agentmb download <sess> <selector> -o out` | Trigger download and save |

### Scroll and Feed Operations

| Command | Purpose |
|---|---|
| `agentmb scroll <sess> <selector-or-eid>` | Scroll element by delta |
| `agentmb scroll-into-view <sess> <selector-or-eid>` | Scroll target into viewport |
| `agentmb scroll-until <sess> ...` | Scroll page/element until stop condition |
| `agentmb load-more-until <sess> <load-more-selector> <content-selector> ...` | Repeated load-more with count/text stop |

### Coordinate and Low-Level Input

| Command | Purpose |
|---|---|
| `agentmb click-at <sess> <x> <y>` | Click absolute page coordinates |
| `agentmb wheel <sess> --dx --dy` | Low-level wheel event |
| `agentmb insert-text <sess> <text>` | Insert text into focused element |
| `agentmb bbox <sess> <selector-or-eid>` | Get bounding box / center |
| `agentmb mouse-move <sess> <x> <y>` | Move mouse |
| `agentmb mouse-down <sess>` / `mouse-up <sess>` | Mouse press/release |
| `agentmb key-down <sess> <key>` / `key-up <sess> <key>` | Keyboard press/release |

### Session State (Cookie / Storage)

| Command | Purpose |
|---|---|
| `agentmb cookie-list <sess>` | List cookies |
| `agentmb cookie-clear <sess>` | Clear cookies |
| `agentmb storage-export <sess> -o state.json` | Export storage state |
| `agentmb storage-import <sess> state.json` | Restore storage state |

### Observability and Debug

| Command | Purpose |
|---|---|
| `agentmb screenshot <sess> -o out.png` | Screenshot |
| `agentmb annotated-screenshot <sess> --highlight ...` | Highlighted screenshot |
| `agentmb eval <sess> <expr>` | JS eval |
| `agentmb console-log <sess>` | Console entries |
| `agentmb page-errors <sess>` | Uncaught page errors |
| `agentmb dialogs <sess>` / `dialogs <sess> --clear` | Auto-dismissed dialog history |
| `agentmb logs <sess>` | Audit log tail |
| `agentmb trace start <sess>` / `trace stop <sess>` | Playwright trace capture |

### Browser Environment and Controls

| Command | Purpose |
|---|---|
| `agentmb set-viewport <sess> <w> <h>` | Resize viewport |
| `agentmb set-network <sess> ...` / `reset-network <sess>` | CDP network throttle/offline |
| `agentmb clipboard-write <sess> <text>` / `clipboard-read <sess>` | Clipboard read/write |
| `agentmb policy <sess> [safe|permissive|disabled]` | Session safety policy |
| `agentmb cdp-ws <sess>` | Browser CDP WebSocket URL |

## Multi-Page Management

```bash
agentmb pages list <session-id>           # list all open tabs
agentmb pages new <session-id>            # open a new tab
agentmb pages switch <session-id> <page-id>  # make a tab the active target
agentmb pages close <session-id> <page-id>   # close a tab (last tab protected)
```

## Network Route Mocks

```bash
agentmb route list <session-id>                          # list active mocks
agentmb route add <session-id> "**/api/**" \
  --status 200 --body '{"ok":true}' \
  --content-type application/json                        # intercept requests
agentmb route rm <session-id> "**/api/**"               # remove a mock
```

## Playwright Trace Recording

```bash
agentmb trace start <session-id>          # start recording
# ... do actions ...
agentmb trace stop <session-id> -o trace.zip   # save ZIP
npx playwright show-trace trace.zip       # open in Playwright UI
```

## CDP WebSocket URL

```bash
agentmb cdp-ws <session-id>              # print browser CDP WebSocket URL
```

## Linux Headed Mode

Linux visual/headed mode requires Xvfb.

```bash
sudo apt-get install -y xvfb
bash scripts/xvfb-headed.sh
```

## Verify

```bash
bash scripts/verify.sh
```

## npm Release Setup

```bash
# login once
npm login
npm whoami

# check package payload before publish
npm run pack:check

# publish from repo root
npm publish
```

If your global npm cache has permission issues, this repo uses project-local cache (`.npm-cache`) via `.npmrc`.

## Environment Variables

Common runtime env vars:

- `AGENTMB_PORT` (default `19315`)
- `AGENTMB_DATA_DIR` (default `~/.agentmb`)
- `AGENTMB_API_TOKEN` (optional API auth)
- `AGENTMB_ENCRYPTION_KEY` (optional AES-256-GCM profile encryption key, 32 bytes as base64 or hex)
- `AGENTMB_LOG_LEVEL` (default `info`)
- `AGENTMB_POLICY_PROFILE` (default `safe`) — daemon-wide default safety policy profile

## Safety Execution Policy

agentmb enforces a configurable **safety execution policy** that throttles actions, enforces per-domain rate limits, and blocks sensitive actions (e.g. form submissions, file uploads) unless explicitly permitted.

### Profiles

| Profile | Min interval | Jitter | Max actions/min | Sensitive actions |
|---|---|---|---|---|
| `safe` | 1500 ms | 300–800 ms | 8 | blocked by default |
| `permissive` | 200 ms | 0–100 ms | 60 | allowed |
| `disabled` | 0 ms | 0 ms | unlimited | allowed |

Set the daemon-wide default via env var:
```bash
AGENTMB_POLICY_PROFILE=disabled node dist/daemon/index.js   # CI / trusted automation
AGENTMB_POLICY_PROFILE=safe    node dist/daemon/index.js   # social-media / sensitive workflows
```

### Per-session override (CLI)

```bash
agentmb policy <session-id>                       # get current policy
agentmb policy <session-id> safe                  # switch to safe profile
agentmb policy <session-id> permissive            # switch to permissive
agentmb policy <session-id> safe --allow-sensitive # safe + allow sensitive actions
```

### Per-session override (Python SDK)

```python
from agentmb import BrowserClient

with BrowserClient() as client:
    sess = client.sessions.create()
    policy = sess.set_policy("safe", allow_sensitive_actions=False)
    print(policy.max_retries_per_domain)  # 3
    current = sess.get_policy()
```

### Audit logs

All policy events (`throttle`, `jitter`, `cooldown`, `deny`, `retry`) are written to the session audit log with `type="policy"`.

```bash
agentmb logs <session-id>   # shows policy events inline
```

### Sensitive actions

Mark any action as sensitive by passing `"sensitive": true` in the request body. With `safe` profile and `allow_sensitive_actions=false`, the request returns HTTP 403:

```json
{ "error": "sensitive action blocked by policy", "policy_event": "deny" }
```

## License

MIT
