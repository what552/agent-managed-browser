# Authentication — Deep Reference

---

## Human Login Handoff

Switch a headless session to headed (visible) mode, log in manually, then return to headless automation with the same cookies and storage intact.

```bash
# Step 1: Start daemon and create a session (can be existing profile)
agentmb session new --profile myaccount

# Step 2: Open the browser window for manual login
agentmb login <session-id>
# → browser window opens
# → navigate to the site and log in manually
# → press Enter in terminal when done
# → session returns to headless mode with cookies preserved
```

Python SDK:
```python
sess = client.sessions.create(profile="myaccount", headless=False)
# ... navigate to the site manually via headed browser ...
# (no SDK equivalent for the interactive login flow — use CLI `agentmb login`)
```

After login, subsequent sessions created with the same `--profile` name automatically have the saved cookies.

---

## Profile Persistence

### Agent Workspace (Named Profile)

Cookies, localStorage, IndexedDB, and browser state are saved to `AGENTMB_DATA_DIR/profiles/<name>/`.

```bash
agentmb session new --profile gmail-account
# cookies and state saved to ~/.agentmb/profiles/gmail-account/
```

Reuse in future runs:
```bash
agentmb session new --profile gmail-account   # cookies already there
agentmb navigate <sid> https://mail.google.com  # logged in automatically
```

### Pure Sandbox (Ephemeral)

No state persisted. Auto-deleted on `close()`.

```bash
agentmb session new --ephemeral
```

---

## Storage Export / Import

Export auth state from one session and import into another (e.g., from manual login to automated session).

```bash
agentmb storage-export <session-id> -o myaccount-state.json
# → saves Playwright storageState format (cookies + origins)

agentmb storage-import <new-session-id> myaccount-state.json
# → restores cookies; origins_skipped count returned
```

Python SDK:
```python
# After manual login — export the state
sess.storage_export("myaccount-state.json")
sess.close()

# New automated session — import the state
sess2 = client.sessions.create(profile="myaccount")
result = sess2.storage_import("myaccount-state.json")
print(result.origins_skipped)  # number of origins skipped (cross-origin restrictions)
```

Use case: login once (headless or manual), export, share across sessions or agents.

---

## Cookie Management

```bash
agentmb cookie-list <session-id>              # list all cookies
agentmb cookie-clear <session-id>             # clear all cookies
agentmb cookie-delete <session-id> <name>     # delete specific cookie
agentmb cookie-delete <session-id> session_token --domain .example.com
```

Python SDK:
```python
# List cookies
cookies = sess.cookie_list()

# Clear all
sess.cookie_clear()

# Delete specific cookie (domain filter optional)
result = sess.delete_cookie("session_token")
result = sess.delete_cookie("tracker", domain=".example.com")
print(result.removed, result.remaining)
```

---

## Profile Encryption

Browser profiles (cookies, storage) can be encrypted at rest using AES-256-GCM.

```bash
# Generate a 32-byte key
export AGENTMB_ENCRYPTION_KEY="$(openssl rand -base64 32)"
# Start daemon with key set
agentmb start
```

```python
import os
os.environ["AGENTMB_ENCRYPTION_KEY"] = "your-32-byte-key-base64-or-hex"
```

**Important**: Profiles written without a key cannot be read with one, and vice versa. Keep the key consistent across daemon restarts.

---

## API Token Authentication

When `AGENTMB_API_TOKEN` is set, all endpoints except `/health` require the token.

```bash
export AGENTMB_API_TOKEN="my-secret-token"
agentmb start
```

Send the token in requests:
```bash
# Via header
curl -H "X-API-Token: my-secret-token" http://127.0.0.1:19315/health

# Via Authorization Bearer
curl -H "Authorization: Bearer my-secret-token" http://127.0.0.1:19315/health
```

Python SDK:
```python
client = BrowserClient(base_url="http://127.0.0.1:19315", api_token="my-secret-token")
```

Requests without a valid token return `401 Unauthorized`.

---

## Multi-Site Auth Pattern

For workflows that require multiple site logins:

```bash
# Login to site A
agentmb session new --profile site-a-account
agentmb login <sid-a>      # manual login
agentmb storage-export <sid-a> -o site-a-state.json
agentmb session rm <sid-a>

# Login to site B
agentmb session new --profile site-b-account
agentmb login <sid-b>
agentmb storage-export <sid-b> -o site-b-state.json
agentmb session rm <sid-b>

# Automation session with pre-loaded auth
agentmb session new --profile site-a-account
agentmb storage-import <sid> site-a-state.json
agentmb navigate <sid> https://site-a.example.com   # already logged in
```
