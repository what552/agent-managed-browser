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
| **type** | `agentmb type <sess> <selector> <text>` | Type char-by-char |
| **press** | `agentmb press <sess> <selector> <key>` | Press key / combo (e.g. `Enter`, `Control+a`) |
| **select** | `agentmb select <sess> <selector> <val>` | Select `<option>` in a `<select>` |
| **hover** | `agentmb hover <sess> <selector>` | Hover over element |
| **wait-selector** | `agentmb wait-selector <sess> <selector>` | Wait for element state |
| **wait-url** | `agentmb wait-url <sess> <pattern>` | Wait for URL pattern |
| **upload** | `agentmb upload <sess> <selector> <file>` | Upload local file to file input |
| **download** | `agentmb download <sess> <selector> -o out` | Click link and save download |

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
- `AGENTMB_PROFILE_KEY` (optional profile encryption key)
- `AGENTMB_LOG_LEVEL` (default `info`)

## License

MIT
