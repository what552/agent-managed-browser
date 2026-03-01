# Session Management — Deep Reference

---

## Session Lifecycle

```
create  →  active  →  sealed (optional)  →  closed
           │                                  │
           └── all actions available          └── profile data persists (if named)
                                                   or is deleted (if ephemeral)
```

States:
- **active**: session is running, accepts all commands
- **sealed**: protected from deletion (`423` on `rm`); all actions still work
- **zombie**: browser process died unexpectedly; session entry remains but is non-functional

---

## Session Creation Options

### Named Profile (Persistent)

Cookies, localStorage, and browser state persist across runs. Use the same `--profile` name to reuse saved state.

```bash
agentmb session new --profile gmail-account
agentmb session new --profile shopify-store --headed
```

```python
sess = client.sessions.create(profile="gmail-account")
```

Profile data stored under `AGENTMB_DATA_DIR/profiles/<name>/` (default `~/.agentmb/profiles/`).

### Pure Sandbox (Ephemeral)

Temp directory — all data auto-deleted on `close()` or daemon restart.

```bash
agentmb session new --ephemeral
```

```python
sess = client.sessions.create(ephemeral=True)
```

### Headed vs Headless

```bash
agentmb session new --profile demo              # headless (default)
agentmb session new --profile demo --headed     # visible browser window
```

```python
sess = client.sessions.create(profile="demo", headless=False)
```

Linux headed mode requires Xvfb: `sudo apt-get install -y xvfb && bash scripts/xvfb-headed.sh`

### Downloads

File downloads are disabled by default. Enable at creation time:

```bash
agentmb session new --accept-downloads
```

```python
sess = client.sessions.create(accept_downloads=True)
```

### Policy Profile

Rate limiting and action guardrails per-session. Override at creation:

```bash
agentmb session new --profile demo --policy permissive
```

```python
sess = client.sessions.create(profile="demo", policy="permissive")
```

Profiles:
| Profile | Min interval | Max actions/min | Sensitive actions |
|---|---|---|---|
| `safe` | 1500 ms | 8 | blocked |
| `permissive` | 200 ms | 60 | allowed |
| `disabled` | 0 ms | unlimited | allowed |

Change policy for a running session:
```bash
agentmb policy <sid> permissive
agentmb policy <sid> safe --allow-sensitive
```

---

## Session Commands

```bash
agentmb session new [flags]        # create; prints session-id
agentmb session list               # list all active sessions
agentmb session get <sid>          # show details: profile, headless, url, created_at
agentmb session rm <sid>           # close + delete
agentmb session seal <sid>         # protect from deletion
agentmb settings <sid>             # show viewport, user_agent, headless, url, profile
```

Python SDK:
```python
sess = client.sessions.create(profile="demo")
sessions = client.sessions.list()
info = client.sessions.get(sess.id)
sess.seal()
sess.close()
settings = sess.get_settings()   # viewport, user_agent, headless, url, profile
```

---

## Multi-Page (Tabs) Management

Multiple tabs in the same session share profile (cookies, storage) but have independent navigation state.

```bash
agentmb pages list <sid>                    # list all tabs
agentmb pages new <sid>                     # open new blank tab → returns page-id
agentmb pages switch <sid> <page-id>        # make tab active target
agentmb pages close <sid> <page-id>         # close tab
# Note: closing the last tab returns 409 (session must have ≥ 1 tab)
```

Python SDK:
```python
# Open additional tabs
page2_id = sess.new_page()         # returns page_id
page3_id = sess.new_page()

# Switch between tabs
sess.switch_page(page2_id)
sess.navigate("https://other.example.com")

# List tabs
pages = sess.pages()               # list[PageInfo]: .page_id, .url, .title, .active

# Close tab
sess.close_page(page3_id)

# Work on original tab
sess.switch_page(pages[0].page_id)
```

---

## page_id Direct Targeting (R09-C03)

Instead of switching the active tab before every action, pass `page_id` directly to any action
request. All major action routes support this param:
`navigate`, `click`, `fill`, `type`, `press`, `eval`, `screenshot`, `element_map`, `snapshot_map`, `scroll`.

```python
# Create session + open multiple tabs
p1 = sess.pages()[0].page_id
p2 = sess.new_page()   # returns page_id string
p3 = sess.new_page()

# Navigate each independently — no switch_page() needed
sess.navigate("https://site.com/a", page_id=p1)
sess.navigate("https://site.com/b", page_id=p2)
sess.navigate("https://site.com/c", page_id=p3)

# element_map + interact on a non-active tab
em = sess.element_map(page_id=p2)
sess.click(element_id="e3", page_id=p2)

# Screenshot any tab
shot = sess.screenshot(page_id=p3)
```

REST (add `page_id` to request body):
```json
POST /api/v1/sessions/:id/navigate
{ "url": "https://example.com", "page_id": "page_abc123" }
```

Error: `404` if `page_id` not found in session — call `GET /api/v1/sessions/:id/pages` to list valid IDs.

---

## Multi-Agent Concurrency

Different agents can share a daemon but must use **separate sessions** (different profiles).

```bash
# Agent A
agentmb session new --profile agent-a-work
# Agent B (separate, isolated)
agentmb session new --profile agent-b-work
```

Sessions are fully isolated: cookies, navigation, and page state do not leak between them.

**Concurrent access to the same session** is not recommended — actions are not queued, and concurrent commands on one session may produce unpredictable results.

---

## Session Seal

Sealed sessions cannot be deleted until explicitly unsealed. Useful for long-running sessions that should not be accidentally closed.

```bash
agentmb session seal <session-id>
agentmb session rm <session-id>   # → 423 session_sealed
```

```python
sess.seal()
sess.close()  # → 423 SessionSealedError
```

Unseal via REST:
```
DELETE /api/v1/sessions/:id/seal
```

---

## Profile Management

```python
# List all profiles
result = client.list_profiles()
for p in result.profiles:
    print(p.name, p.path, p.last_used)

# Reset a profile (wipes data dir)
# Returns 409 if a live session is currently using the profile
client.reset_profile("demo")
```

REST:
```
GET  /api/v1/profiles              → ProfileListResult
POST /api/v1/profiles/:name/reset  → ProfileResetResult
```

---

## Environment Variables Affecting Sessions

| Variable | Default | Notes |
|---|---|---|
| `AGENTMB_DATA_DIR` | `~/.agentmb` | Root dir for profiles and logs |
| `AGENTMB_POLICY_PROFILE` | `safe` | Daemon-wide default policy |
| `AGENTMB_API_TOKEN` | _(none)_ | Token required on all requests |
| `AGENTMB_ENCRYPTION_KEY` | _(none)_ | AES-256-GCM encrypt profiles at rest |
