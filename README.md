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
pip install -e sdk/python
python3 -c "from agentmb import BrowserClient; print('SDK OK')"
```

## Install By Platform

For full installation steps on all environments:

- macOS
- Linux (Ubuntu / Debian)
- Windows (PowerShell / WSL2)

See [INSTALL.md](./INSTALL.md).

## Action Reference

| Action | CLI command | Description |
|---|---|---|
| navigate | `agentmb navigate <sess> <url>` | Navigate to URL |
| screenshot | `agentmb screenshot <sess> -o out.png` | Capture screenshot |
| eval | `agentmb eval <sess> <expr>` | Run JavaScript expression |
| extract | `agentmb extract <sess> <selector>` | Extract text/attributes |
| click | `agentmb click <sess> <selector>` | Click element |
| fill | `agentmb fill <sess> <selector> <value>` | Fill form field |
| type | `agentmb type <sess> <selector> <text>` | Type char-by-char |
| press | `agentmb press <sess> <selector> <key>` | Press key / combo (e.g. `Enter`, `Control+a`) |
| select | `agentmb select <sess> <selector> <val>` | Select `<option>` in a `<select>` |
| hover | `agentmb hover <sess> <selector>` | Hover over element |
| wait-selector | `agentmb wait-selector <sess> <selector>` | Wait for element state |
| wait-url | `agentmb wait-url <sess> <pattern>` | Wait for URL pattern |
| upload | `agentmb upload <sess> <selector> <file>` | Upload local file to file input |
| download | `agentmb download <sess> <selector> -o out` | Click link and save download |

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
