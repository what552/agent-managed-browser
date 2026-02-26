---
name: agentmb-operations
description: Initialize, operate, and troubleshoot agentmb browser automation workflows with reproducible daemon/session commands. Use when Codex/Claude/OpenClaw need to start agentmb, create sessions, run navigate/eval/extract/screenshot/login handoff flows, verify health/gates, or debug port/process/profile issues across macOS/Linux/Windows.
---

# AgentMB Operations

Use this skill to run `agentmb` reliably in local development and multi-agent testing.

## Quick Start

1. Install dependencies and build.
```bash
npm ci
npm run build
npx playwright install chromium
```

2. Start daemon (default local mode).
```bash
agentmb start
```

3. Verify daemon health.
```bash
curl -sSf http://127.0.0.1:19315/health
agentmb status
```

4. Create a session and run a smoke flow.
```bash
agentmb session new --profile demo
agentmb session list
agentmb navigate <session-id> https://example.com
agentmb screenshot <session-id> -o ./shot.png
```

## Initialization Patterns

Use isolated runtime env for repeatable tests.

```bash
export AGENTMB_PORT=19525
export AGENTMB_DATA_DIR=/tmp/agentmb-test
agentmb start
```

Run gate check.
```bash
AGENTMB_PORT=19525 AGENTMB_DATA_DIR=/tmp/agentmb-test bash scripts/verify.sh
```

Use one unique `AGENTMB_PORT` + `AGENTMB_DATA_DIR` per parallel agent to avoid cross-test contamination.

## Core Command Set

Daemon lifecycle:
```bash
agentmb start
agentmb status
agentmb stop
```

Session lifecycle:
```bash
agentmb session new --profile <name>
agentmb session list
agentmb session rm <session-id>
```

Browser actions:
```bash
agentmb navigate <session-id> <url> --wait-until load
agentmb click <session-id> <selector>
agentmb fill <session-id> <selector> <value>
agentmb eval <session-id> "document.title"
agentmb extract <session-id> "h1"
agentmb screenshot <session-id> -o ./out.png
```

Human login handoff:
```bash
agentmb login <session-id>
# or split mode manually
agentmb headed <session-id>
agentmb headless <session-id>
```

## Python SDK Initialization

Editable install in repo:
```bash
pip install -e sdk/python
```

Minimal check:
```bash
python3 -c "from agentmb import BrowserClient; print('SDK OK')"
```

## Operational Rules

1. Always check daemon first: `agentmb status`.
2. Always keep profile names explicit for long workflows.
3. Always clean test sessions after validation.
4. Always run with isolated port/data dir in CI or multi-pane runs.
5. Never store plaintext credentials in scripts, commits, or logs.
6. Prefer `scripts/verify.sh` as release gate evidence.

## Troubleshooting

Port already in use:
```bash
lsof -iTCP:19315 -sTCP:LISTEN
pkill -f "node dist/daemon/index.js" || true
```

Session exists but browser not running (`zombie`):
- Recreate session with same profile, then retry actions.

`Unauthorized` responses:
- Ensure token header/env matches daemon token (`AGENTMB_API_TOKEN`).

Headed/login handoff issues on Linux:
```bash
sudo apt-get install -y xvfb
bash scripts/xvfb-headed.sh
```

## Cross-Platform Notes

macOS/Linux env export:
```bash
export AGENTMB_PORT=19525
export AGENTMB_DATA_DIR=/tmp/agentmb-test
```

Windows PowerShell:
```powershell
$env:AGENTMB_PORT = "19525"
$env:AGENTMB_DATA_DIR = "$env:TEMP\\agentmb-test"
```

## Compatibility Note

If `agentmb` command is unavailable in old branches, run CLI directly:
```bash
node dist/cli/index.js status
node dist/cli/index.js session list
```

Use this fallback only for legacy branches; prefer `agentmb` on current naming.
