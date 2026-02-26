# Linux Headed Mode (Xvfb)

Linux servers have no physical display. To use headed (visible) browser mode — required for human login handoff — you need a virtual framebuffer via **Xvfb**.

## Quick start

```bash
# 1. Install Xvfb
apt-get install -y xvfb

# 2. Run the automated demo script (installs Xvfb, starts daemon, runs headed session)
bash scripts/xvfb-headed.sh
```

The script creates a headed browser session, navigates to `https://example.com`, takes a screenshot, and saves it to `/tmp/openclaw-headed-screenshot.png`.

## Manual steps

```bash
# 1. Start a virtual display on :99
Xvfb :99 -screen 0 1280x720x24 &

# 2. Export DISPLAY so Chromium knows where to render
export DISPLAY=:99

# 3. Start the daemon (DISPLAY is inherited)
OPENCLAW_PORT=19315 node dist/daemon/index.js &

# 4. Create a headed session
curl -X POST http://localhost:19315/api/v1/sessions \
  -H 'Content-Type: application/json' \
  -d '{"profile":"my-profile","headless":false}'

# 5. Trigger human login handoff
SESSION_ID=<id from above>
curl -X POST http://localhost:19315/api/v1/sessions/$SESSION_ID/handoff/start

# 6. Use a VNC viewer or Xvfb screenshot tool to observe/interact:
#    apt-get install -y x11vnc
#    x11vnc -display :99 -nopw -forever &
#    Then connect VNC client to <server-ip>:5900

# 7. After login, return to headless automation
curl -X POST http://localhost:19315/api/v1/sessions/$SESSION_ID/handoff/complete
```

## Environment variable reference

| Variable | Default | Description |
|---|---|---|
| `DISPLAY` | (none) | X11 display for Chromium (e.g. `:99`) |
| `OPENCLAW_PORT` | `19315` | Daemon HTTP port |
| `OPENCLAW_DATA_DIR` | `~/.openclaw` | Profile and log storage |

## How it works

- Headless mode (`headless: true`) uses `--no-sandbox` + `--disable-setuid-sandbox` and needs **no** `DISPLAY`.
- Headed mode (`headless: false`) requires a real or virtual X11 display (`DISPLAY` env var).
- `scripts/xvfb-headed.sh` manages Xvfb lifecycle automatically and cleans up on exit.
- The `handoff/start` → `handoff/complete` flow relaunches Chromium in headed/headless mode while preserving the profile (cookies/cache).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `error while loading shared libraries: libX11.so` | Missing X11 libs | `apt-get install -y libx11-xcb1 libxcomposite1 libxdamage1 libxrandr2` |
| `Xvfb: server already active for display :99` | Leftover Xvfb lock | `rm /tmp/.X99-lock && pkill Xvfb` |
| Screenshot is blank / all black | Chromium started before Xvfb was ready | Add `sleep 1` after `Xvfb &` |
| `--no-sandbox` warning | Expected on Linux | Safe for non-root CI environments; the flag is hardcoded in `src/browser/manager.ts` |
