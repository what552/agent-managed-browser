"""
R10-C03 e2e tests: T03 — session fork + session adopt

fork: Clone cookies+localStorage from a live session into a new managed session
adopt: Extract state from an external CDP browser into a new managed session

Test strategy for adopt: use an agentmb-managed session's WS CDP URL as
the "external" CDP source — this lets us test adopt without requiring a
separate system Chrome/Edge installation.
"""
from __future__ import annotations

import base64
import os

import httpx
import pytest

PORT = os.environ.get("AGENTMB_PORT", "19315")
BASE_URL = f"http://127.0.0.1:{PORT}"
TEST_PROFILE = "r10c03-test"


def _inline(html: str) -> str:
    encoded = base64.b64encode(html.encode()).decode()
    return f"data:text/html;base64,{encoded}"


@pytest.fixture()
def client() -> httpx.Client:
    return httpx.Client(base_url=BASE_URL, timeout=30)


@pytest.fixture()
def session(client: httpx.Client):
    """Create a managed headless session; tear down after test."""
    r = client.post("/api/v1/sessions", json={"profile": TEST_PROFILE, "headless": True})
    assert r.status_code == 201, r.text
    sid = r.json()["session_id"]
    yield sid
    client.delete(f"/api/v1/sessions/{sid}?force=true")


# ---------------------------------------------------------------------------
# T03 — session fork: success path
# ---------------------------------------------------------------------------

def test_t03_fork_creates_new_session(client: httpx.Client, session: str) -> None:
    """fork returns a new session_id distinct from the source."""
    r = client.post(f"/api/v1/sessions/{session}/fork", json={})
    assert r.status_code == 201, r.text
    data = r.json()
    assert "session_id" in data
    assert data["session_id"] != session
    assert data["source_session_id"] == session
    assert data["channel"] in ("chromium", "chrome", "msedge")
    assert "cookies_injected" in data
    assert "origins_pending" in data
    # Tear down forked session
    client.delete(f"/api/v1/sessions/{data['session_id']}?force=true")


def test_t03_fork_source_stays_alive(client: httpx.Client, session: str) -> None:
    """After fork, the source session must still be live."""
    r = client.post(f"/api/v1/sessions/{session}/fork", json={})
    assert r.status_code == 201, r.text
    fork_id = r.json()["session_id"]

    try:
        # Source must still be reachable and live
        r2 = client.get(f"/api/v1/sessions/{session}")
        assert r2.status_code == 200, f"Source session gone after fork: {r2.text}"
        assert r2.json()["state"] == "live"
    finally:
        client.delete(f"/api/v1/sessions/{fork_id}?force=true")


def test_t03_fork_inherits_cookies(client: httpx.Client, session: str) -> None:
    """Cookies set in source session are present in the forked session."""
    # Navigate to example.com in source and add a cookie
    client.post(f"/api/v1/sessions/{session}/navigate", json={"url": "https://example.com"})
    client.post(f"/api/v1/sessions/{session}/cookies", json={
        "cookies": [{"name": "fork_test", "value": "hello", "domain": "example.com", "path": "/"}]
    })

    # Fork
    r = client.post(f"/api/v1/sessions/{session}/fork", json={})
    assert r.status_code == 201, r.text
    fork_id = r.json()["session_id"]
    cookies_injected = r.json()["cookies_injected"]

    try:
        assert cookies_injected > 0, "Expected at least one cookie to be injected"

        # Verify cookie exists in forked session
        r2 = client.get(f"/api/v1/sessions/{fork_id}/cookies")
        assert r2.status_code == 200, r2.text
        cookie_names = [c.get("name") for c in r2.json().get("cookies", [])]
        assert "fork_test" in cookie_names, f"fork_test cookie not found in fork: {cookie_names}"
    finally:
        client.delete(f"/api/v1/sessions/{fork_id}?force=true")


def test_t03_fork_with_custom_profile(client: httpx.Client, session: str) -> None:
    """Fork can target a different profile name."""
    fork_profile = "r10c03-fork-custom"
    r = client.post(f"/api/v1/sessions/{session}/fork", json={"profile": fork_profile})
    assert r.status_code == 201, r.text
    data = r.json()
    assert data["profile"] == fork_profile
    fork_id = data["session_id"]
    client.delete(f"/api/v1/sessions/{fork_id}?force=true")


def test_t03_fork_nonexistent_session(client: httpx.Client) -> None:
    """fork of a nonexistent session returns 404."""
    r = client.post("/api/v1/sessions/nonexistent-sess-id/fork", json={})
    assert r.status_code == 404, r.text


def test_t03_fork_invalid_channel(client: httpx.Client, session: str) -> None:
    """fork with invalid channel returns 400."""
    r = client.post(f"/api/v1/sessions/{session}/fork", json={"channel": "firefox"})
    assert r.status_code == 400, r.text
    assert "channel" in r.json().get("error", "").lower() or "Invalid" in r.json().get("error", "")


# ---------------------------------------------------------------------------
# T03 — session fork: multiple forks
# ---------------------------------------------------------------------------

def test_t03_fork_multiple_forks_independent(client: httpx.Client, session: str) -> None:
    """Multiple forks from the same source are independent (don't share state after creation)."""
    r1 = client.post(f"/api/v1/sessions/{session}/fork", json={})
    r2 = client.post(f"/api/v1/sessions/{session}/fork", json={})
    assert r1.status_code == 201, r1.text
    assert r2.status_code == 201, r2.text
    fork1_id = r1.json()["session_id"]
    fork2_id = r2.json()["session_id"]

    try:
        # Both forks are distinct sessions
        assert fork1_id != fork2_id
        assert fork1_id != session
        assert fork2_id != session

        # Both forks and source should all be live
        all_ids = [session, fork1_id, fork2_id]
        sessions_resp = client.get("/api/v1/sessions")
        live_ids = [s["session_id"] for s in sessions_resp.json() if s["state"] == "live"]
        for sid in all_ids:
            assert sid in live_ids, f"Session {sid} not live after multi-fork"
    finally:
        client.delete(f"/api/v1/sessions/{fork1_id}?force=true")
        client.delete(f"/api/v1/sessions/{fork2_id}?force=true")


# ---------------------------------------------------------------------------
# T03 — session adopt: success path using agentmb session's CDP WS URL
# ---------------------------------------------------------------------------

def test_t03_adopt_from_cdp_ws(client: httpx.Client, session: str) -> None:
    """
    adopt extracts state from a managed session via its CDP WS URL
    and creates a new managed session.
    Source session must survive the adopt operation.
    """
    # Get the CDP WS URL of the source session
    r_ws = client.get(f"/api/v1/sessions/{session}/cdp/ws")
    if r_ws.status_code != 200:
        pytest.skip(f"CDP WS endpoint not available: {r_ws.status_code} {r_ws.text}")
    ws_url = r_ws.json().get("browser_ws_url")
    if not ws_url:
        pytest.skip("browser_ws_url is null — browser may not expose WS endpoint")

    adopt_profile = "r10c03-adopted"
    r = client.post("/api/v1/sessions/adopt", json={
        "cdp_url": ws_url,
        "profile": adopt_profile,
    })
    assert r.status_code == 201, f"adopt failed: {r.status_code} {r.text}"
    data = r.json()

    adopted_id = data["session_id"]
    try:
        assert adopted_id != session
        assert data["profile"] == adopt_profile
        assert data["channel"] == "chromium"
        assert "cookies_injected" in data
        assert "origins_pending" in data
        assert data["source_cdp_url"] == ws_url

        # Source session must still be live
        r2 = client.get(f"/api/v1/sessions/{session}")
        assert r2.status_code == 200
        assert r2.json()["state"] == "live", "Source session died after adopt"
    finally:
        client.delete(f"/api/v1/sessions/{adopted_id}?force=true")


def test_t03_adopt_inherits_cookies(client: httpx.Client, session: str) -> None:
    """Cookies set in source are present in adopted session."""
    # Navigate source to example.com and add a cookie
    client.post(f"/api/v1/sessions/{session}/navigate", json={"url": "https://example.com"})
    client.post(f"/api/v1/sessions/{session}/cookies", json={
        "cookies": [{"name": "adopt_test", "value": "world", "domain": "example.com", "path": "/"}]
    })

    # Get CDP WS URL
    r_ws = client.get(f"/api/v1/sessions/{session}/cdp/ws")
    if r_ws.status_code != 200:
        pytest.skip("CDP WS not available")
    ws_url = r_ws.json().get("browser_ws_url")
    if not ws_url:
        pytest.skip("browser_ws_url is null")

    r = client.post("/api/v1/sessions/adopt", json={
        "cdp_url": ws_url,
        "profile": "r10c03-adopt-cookies",
    })
    assert r.status_code == 201, r.text
    adopted_id = r.json()["session_id"]

    try:
        assert r.json()["cookies_injected"] > 0

        # Verify cookie was propagated
        r2 = client.get(f"/api/v1/sessions/{adopted_id}/cookies")
        assert r2.status_code == 200, r2.text
        cookie_names = [c.get("name") for c in r2.json().get("cookies", [])]
        assert "adopt_test" in cookie_names, f"adopt_test not found: {cookie_names}"
    finally:
        client.delete(f"/api/v1/sessions/{adopted_id}?force=true")


# ---------------------------------------------------------------------------
# T03 — adopt: failure paths
# ---------------------------------------------------------------------------

def test_t03_adopt_missing_cdp_url(client: httpx.Client) -> None:
    """adopt without cdp_url returns 400."""
    r = client.post("/api/v1/sessions/adopt", json={"profile": "test"})
    assert r.status_code == 400, r.text


def test_t03_adopt_missing_profile(client: httpx.Client) -> None:
    """adopt without profile returns 400."""
    r = client.post("/api/v1/sessions/adopt", json={"cdp_url": "http://127.0.0.1:9999"})
    assert r.status_code == 400, r.text


def test_t03_adopt_invalid_cdp_url(client: httpx.Client) -> None:
    """adopt with invalid CDP URL (no open browser) returns 502."""
    r = client.post("/api/v1/sessions/adopt", json={
        "cdp_url": "http://127.0.0.1:19399",  # nothing listening here
        "profile": "r10c03-invalid-adopt",
    })
    assert r.status_code == 502, f"Expected 502 for unreachable CDP, got {r.status_code}"
