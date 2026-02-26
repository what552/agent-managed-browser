# agent-managed-browser

Local Chromium runtime for AI agents, with:

- daemon API (`agentmb`)
- CLI (`agentmb`)
- Python SDK (`agentmb`)

This repo supports macOS, Linux, and Windows.

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

## Migrating from a previous install

If you previously used an older version (when the project was called `openclaw`):

```bash
# Rename data directory (profiles, sessions, logs)
mv ~/.openclaw ~/.agentmb

# Update env vars in your shell profile (~/.zshrc or ~/.bashrc)
# OPENCLAW_PORT         → AGENTMB_PORT
# OPENCLAW_DATA_DIR     → AGENTMB_DATA_DIR
# OPENCLAW_API_TOKEN    → AGENTMB_API_TOKEN

# Reinstall Python SDK
pip install agentmb

# Re-link CLI binary
npm run build && npm link   # then: agentmb --help
```

## License

MIT
