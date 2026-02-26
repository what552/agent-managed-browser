# Installation Guide

## Prerequisites

| Component | Version | Install |
|---|---|---|
| Node.js | ≥ 20 LTS | [nodejs.org](https://nodejs.org) or `nvm install 20` |
| Python | ≥ 3.9 | [python.org](https://python.org) |
| Chromium | (auto) | `npx playwright install chromium` |

---

## macOS

```bash
# 1. Clone the repo
git clone https://github.com/openclaw/openclaw-browser.git
cd openclaw-browser

# 2. Install Node dependencies and build
npm ci
npm run build

# 3. Install Chromium (one-time)
npx playwright install chromium

# 4. (Optional) Install CLI globally
npm link
# → openclaw start / openclaw session / openclaw navigate …

# 5. Install Python SDK
pip install sdk/python
# or editable: pip install -e sdk/python

# 6. Verify
openclaw start &
sleep 2
curl http://localhost:19315/health
openclaw stop
```

---

## Linux (Ubuntu / Debian)

```bash
# 1. Install Node 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. Clone and build
git clone https://github.com/openclaw/openclaw-browser.git
cd openclaw-browser
npm ci
npm run build

# 3. Install Chromium + headless dependencies
npx playwright install chromium
npx playwright install-deps chromium    # installs libglib2, libnss3, etc.

# 4. (Optional) CLI global install
sudo npm link

# 5. Install Python SDK
pip3 install sdk/python
# or: pip3 install -e sdk/python

# 6. Verify (headless — no display needed)
openclaw start &
sleep 2
curl http://localhost:19315/health
openclaw stop

# Headed mode (visual / login handoff) requires Xvfb:
sudo apt-get install -y xvfb
bash scripts/xvfb-headed.sh
```

### Linux: run tests

```bash
# Full regression gate (starts/stops daemon automatically)
bash scripts/verify.sh
```

---

## Windows (PowerShell / WSL2)

### Option A — WSL2 (recommended)

Run the Linux instructions above inside WSL2 (Ubuntu).

### Option B — Native Windows (PowerShell)

```powershell
# 1. Install Node 20 LTS from https://nodejs.org
#    Verify: node --version  (must be >= 20)

# 2. Clone and build
git clone https://github.com/openclaw/openclaw-browser.git
cd openclaw-browser
npm ci
npm run build

# 3. Install Chromium
npx playwright install chromium

# 4. (Optional) CLI global install
npm link

# 5. Install Python SDK
pip install sdk/python

# 6. Verify
Start-Process node -ArgumentList "dist/daemon/index.js" -NoNewWindow
Start-Sleep 2
Invoke-RestMethod http://localhost:19315/health
```

> **Note**: Windows headed mode works natively (no Xvfb needed).
> Windows headless mode requires `--no-sandbox` which is already set in `src/browser/manager.ts`.

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `OPENCLAW_PORT` | `19315` | Daemon HTTP port |
| `OPENCLAW_DATA_DIR` | `~/.openclaw` | Profile & log storage |
| `OPENCLAW_API_TOKEN` | (none) | Enable token auth |
| `OPENCLAW_PROFILE_KEY` | (none) | AES-256-GCM profile encryption key |
| `OPENCLAW_LOG_LEVEL` | `info` | Pino log level |

---

## Quick sanity check (all platforms)

After install:

```bash
# Build
npm run build                           # → 0 errors

# SDK import
python3 -c "from openclaw import BrowserClient; print('SDK OK')"

# CLI version
node dist/cli/index.js --help           # shows usage

# Full gate (needs network for example.com)
bash scripts/verify.sh
```
