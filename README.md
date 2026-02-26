# agent-managed-browser

Local Chromium runtime for AI agents, with:

- daemon API (`openclaw-browser`)
- CLI (`agentmb`)
- Python SDK (`openclaw`)

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
python3 -c "from openclaw import BrowserClient; print('SDK OK')"
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

- `OPENCLAW_PORT` (default `19315`)
- `OPENCLAW_DATA_DIR` (default `~/.openclaw`)
- `OPENCLAW_API_TOKEN` (optional API auth)
- `OPENCLAW_PROFILE_KEY` (optional profile encryption key)
- `OPENCLAW_LOG_LEVEL` (default `info`)

## License

MIT
