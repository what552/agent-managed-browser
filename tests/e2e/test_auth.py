"""
API token authentication tests.
Starts a second daemon on port 19316 with AGENTMB_API_TOKEN=testtoken-r02
to test 401/200 responses independently of the main daemon.
"""

import os
import sys
import time
import subprocess
import httpx
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../sdk/python"))

from agentmb import BrowserClient

# Port used by the auth-gated test daemon (must not conflict with main daemon on 19315)
AUTH_PORT = 19316
AUTH_TOKEN = "testtoken-r02"
AUTH_DATA_DIR = "/tmp/agentmb-auth-test"
AUTH_BASE = f"http://127.0.0.1:{AUTH_PORT}"
DAEMON_BIN = os.path.join(os.path.dirname(__file__), "../../dist/daemon/index.js")


@pytest.fixture(scope="module")
def auth_daemon():
    """Start a token-gated daemon on AUTH_PORT, yield base URL, then stop it."""
    env = {
        **os.environ,
        "AGENTMB_PORT": str(AUTH_PORT),
        "AGENTMB_API_TOKEN": AUTH_TOKEN,
        "AGENTMB_DATA_DIR": AUTH_DATA_DIR,
    }
    proc = subprocess.Popen(
        ["node", DAEMON_BIN],
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    # Wait for daemon to be ready
    deadline = time.time() + 8
    while time.time() < deadline:
        try:
            r = httpx.get(f"{AUTH_BASE}/health", timeout=1)
            if r.status_code == 200:
                break
        except Exception:
            pass
        time.sleep(0.2)
    else:
        proc.terminate()
        proc.wait()
        pytest.skip("Auth daemon failed to start — skipping auth tests")

    yield AUTH_BASE

    proc.terminate()
    proc.wait()


# ---------------------------------------------------------------------------
# /health is exempt from auth
# ---------------------------------------------------------------------------

def test_health_no_auth_exempt(auth_daemon):
    """/health must be reachable without any token."""
    r = httpx.get(f"{auth_daemon}/health")
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "ok"


# ---------------------------------------------------------------------------
# Authenticated endpoints — negative cases
# ---------------------------------------------------------------------------

def test_no_token_returns_401(auth_daemon):
    """Request without token should be rejected with 401."""
    r = httpx.get(f"{auth_daemon}/api/v1/sessions")
    assert r.status_code == 401
    assert "Unauthorized" in r.json().get("error", "")


def test_wrong_token_returns_401(auth_daemon):
    """Request with wrong token should be rejected with 401."""
    r = httpx.get(
        f"{auth_daemon}/api/v1/sessions",
        headers={"X-API-Token": "wrong-token"},
    )
    assert r.status_code == 401


def test_wrong_bearer_returns_401(auth_daemon):
    """Wrong Bearer token should be rejected with 401."""
    r = httpx.get(
        f"{auth_daemon}/api/v1/sessions",
        headers={"Authorization": "Bearer wrong-token"},
    )
    assert r.status_code == 401


# ---------------------------------------------------------------------------
# Authenticated endpoints — positive cases
# ---------------------------------------------------------------------------

def test_valid_x_api_token_accepted(auth_daemon):
    """Valid X-API-Token header should allow access."""
    r = httpx.get(
        f"{auth_daemon}/api/v1/sessions",
        headers={"X-API-Token": AUTH_TOKEN},
    )
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_valid_bearer_token_accepted(auth_daemon):
    """Valid Authorization: Bearer token should allow access."""
    r = httpx.get(
        f"{auth_daemon}/api/v1/sessions",
        headers={"Authorization": f"Bearer {AUTH_TOKEN}"},
    )
    assert r.status_code == 200


def test_sdk_with_api_token(auth_daemon):
    """SDK client with api_token should work end-to-end."""
    with BrowserClient(base_url=auth_daemon, api_token=AUTH_TOKEN) as client:
        status = client.health()
        assert status.status == "ok"
        sessions = client.sessions.list()
        assert isinstance(sessions, list)


# ---------------------------------------------------------------------------
# CDP endpoint — auth coverage
# ---------------------------------------------------------------------------

def test_cdp_get_no_token_returns_401(auth_daemon):
    """GET /api/v1/sessions/:id/cdp without token must return 401."""
    r = httpx.get(f"{auth_daemon}/api/v1/sessions/sess_fake/cdp")
    assert r.status_code == 401
    assert "Unauthorized" in r.json().get("error", "")


def test_cdp_post_no_token_returns_401(auth_daemon):
    """POST /api/v1/sessions/:id/cdp without token must return 401."""
    r = httpx.post(
        f"{auth_daemon}/api/v1/sessions/sess_fake/cdp",
        json={"method": "Runtime.evaluate", "params": {}},
    )
    assert r.status_code == 401
    assert "Unauthorized" in r.json().get("error", "")


def test_cdp_get_with_token_passes_auth(auth_daemon):
    """GET /api/v1/sessions/:id/cdp with valid token should pass auth (404, not 401)."""
    r = httpx.get(
        f"{auth_daemon}/api/v1/sessions/sess_nonexistent_cdp/cdp",
        headers={"X-API-Token": AUTH_TOKEN},
    )
    # 404 = auth passed, session not found; 401 would mean auth failed
    assert r.status_code == 404


def test_cdp_post_with_token_passes_auth(auth_daemon):
    """POST /api/v1/sessions/:id/cdp with valid token should pass auth (404, not 401)."""
    r = httpx.post(
        f"{auth_daemon}/api/v1/sessions/sess_nonexistent_cdp/cdp",
        json={"method": "Runtime.evaluate"},
        headers={"X-API-Token": AUTH_TOKEN},
    )
    assert r.status_code == 404
