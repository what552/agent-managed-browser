"""
R10-C04 e2e tests: T04 — session switch-engine

switch-engine: Hot-swap browser engine (Chromium ↔ Chrome/Edge) with cookie/localStorage transfer.
- Source session state is exported before closing
- New session launched with target channel
- Rollback: if target fails, source is preserved
- keep_source=true: source session remains alive after switch

Test strategy: test with chromium→chromium to cover API mechanics without requiring system Chrome.
Chrome-specific cross-channel tests are skipped if Chrome is unavailable.
"""
from __future__ import annotations

import os

import httpx
import pytest

PORT = os.environ.get("AGENTMB_PORT", "19315")
BASE_URL = f"http://127.0.0.1:{PORT}"
TEST_PROFILE = "r10c04-test"


@pytest.fixture()
def client() -> httpx.Client:
    return httpx.Client(base_url=BASE_URL, timeout=30)


@pytest.fixture()
def session(client: httpx.Client):
    """Create a managed headless chromium session; tear down after test."""
    r = client.post("/api/v1/sessions", json={"profile": TEST_PROFILE, "headless": True})
    assert r.status_code == 201, r.text
    sid = r.json()["session_id"]
    yield sid
    client.delete(f"/api/v1/sessions/{sid}?force=true")


# ---------------------------------------------------------------------------
# T04 — switch-engine: API contract
# ---------------------------------------------------------------------------

def test_t04_switch_engine_returns_new_session(client: httpx.Client, session: str) -> None:
    """switch-engine returns a new session_id with correct metadata."""
    r = client.put(f"/api/v1/sessions/{session}/switch-engine", json={
        "target_channel": "chromium",
    })
    assert r.status_code == 200, r.text
    data = r.json()

    new_sid = data["session_id"]
    try:
        assert new_sid != session, "new session_id must differ from source"
        assert "old_channel" in data
        assert data["new_channel"] == "chromium"
        assert "profile" in data
        assert "cookies_transferred" in data
        assert "origins_transferred" in data
        assert data["keep_source"] is False
        assert data["old_session_id"] is None
    finally:
        client.delete(f"/api/v1/sessions/{new_sid}?force=true")


def test_t04_switch_engine_source_closed_by_default(client: httpx.Client, session: str) -> None:
    """Source session is closed after switch when keep_source is omitted."""
    r = client.put(f"/api/v1/sessions/{session}/switch-engine", json={
        "target_channel": "chromium",
    })
    assert r.status_code == 200, r.text
    new_sid = r.json()["session_id"]

    try:
        # Source session should be gone
        r2 = client.get(f"/api/v1/sessions/{session}")
        assert r2.status_code == 404, f"Source session should be closed, got {r2.status_code}"
    finally:
        client.delete(f"/api/v1/sessions/{new_sid}?force=true")


def test_t04_switch_engine_keep_source_true(client: httpx.Client, session: str) -> None:
    """Source session stays alive when keep_source=true."""
    r = client.put(f"/api/v1/sessions/{session}/switch-engine", json={
        "target_channel": "chromium",
        "keep_source": True,
    })
    assert r.status_code == 200, r.text
    data = r.json()
    new_sid = data["session_id"]

    try:
        assert data["keep_source"] is True
        assert data["old_session_id"] == session, "old_session_id must reference source"

        # Source must still be live
        r2 = client.get(f"/api/v1/sessions/{session}")
        assert r2.status_code == 200, f"Source should still exist: {r2.text}"
        assert r2.json()["state"] == "live", "Source session should be live"
    finally:
        client.delete(f"/api/v1/sessions/{new_sid}?force=true")
        client.delete(f"/api/v1/sessions/{session}?force=true")


def test_t04_switch_engine_cookies_transferred(client: httpx.Client, session: str) -> None:
    """Cookies set in source session are present in new session after switch."""
    # Navigate to example.com in source and add a cookie
    client.post(f"/api/v1/sessions/{session}/navigate", json={"url": "https://example.com"})
    client.post(f"/api/v1/sessions/{session}/cookies", json={
        "cookies": [{"name": "switch_test", "value": "engine42", "domain": "example.com", "path": "/"}]
    })

    r = client.put(f"/api/v1/sessions/{session}/switch-engine", json={
        "target_channel": "chromium",
    })
    assert r.status_code == 200, r.text
    data = r.json()
    new_sid = data["session_id"]

    try:
        assert data["cookies_transferred"] > 0, "Expected at least one cookie transferred"

        # Verify cookie is in new session
        r2 = client.get(f"/api/v1/sessions/{new_sid}/cookies")
        assert r2.status_code == 200, r2.text
        cookie_names = [c.get("name") for c in r2.json().get("cookies", [])]
        assert "switch_test" in cookie_names, f"switch_test cookie not found in new session: {cookie_names}"
    finally:
        client.delete(f"/api/v1/sessions/{new_sid}?force=true")


def test_t04_switch_engine_new_session_is_live(client: httpx.Client, session: str) -> None:
    """New session is reachable and live after switch."""
    r = client.put(f"/api/v1/sessions/{session}/switch-engine", json={
        "target_channel": "chromium",
    })
    assert r.status_code == 200, r.text
    new_sid = r.json()["session_id"]

    try:
        r2 = client.get(f"/api/v1/sessions/{new_sid}")
        assert r2.status_code == 200, f"New session not reachable: {r2.text}"
        assert r2.json()["state"] == "live"
    finally:
        client.delete(f"/api/v1/sessions/{new_sid}?force=true")


# ---------------------------------------------------------------------------
# T04 — switch-engine: failure paths
# ---------------------------------------------------------------------------

def test_t04_switch_engine_invalid_channel(client: httpx.Client, session: str) -> None:
    """switch-engine with invalid target_channel returns 400."""
    r = client.put(f"/api/v1/sessions/{session}/switch-engine", json={
        "target_channel": "firefox",
    })
    assert r.status_code == 400, r.text
    assert "channel" in r.json().get("error", "").lower()


def test_t04_switch_engine_missing_channel(client: httpx.Client, session: str) -> None:
    """switch-engine without target_channel returns 400."""
    r = client.put(f"/api/v1/sessions/{session}/switch-engine", json={})
    assert r.status_code == 400, r.text


def test_t04_switch_engine_nonexistent_session(client: httpx.Client) -> None:
    """switch-engine on nonexistent session returns 404."""
    r = client.put("/api/v1/sessions/nonexistent-sess-id/switch-engine", json={
        "target_channel": "chromium",
    })
    assert r.status_code == 404, r.text


def test_t04_switch_engine_rollback_invalid_channel(client: httpx.Client, session: str) -> None:
    """If target engine fails (e.g. unavailable channel), source session is preserved."""
    # Try to switch to chrome — may or may not be available, but we test the source survives.
    r = client.put(f"/api/v1/sessions/{session}/switch-engine", json={
        "target_channel": "chrome",
    })
    if r.status_code == 200:
        # Chrome happened to be available — clean up new session
        new_sid = r.json()["session_id"]
        client.delete(f"/api/v1/sessions/{new_sid}?force=true")
        pytest.skip("Chrome is available on this machine; rollback test not applicable")
    elif r.status_code == 502:
        # Expected rollback: source session must still be alive
        r2 = client.get(f"/api/v1/sessions/{session}")
        assert r2.status_code == 200, f"Source session lost after failed switch: {r2.text}"
        assert r2.json()["state"] == "live", "Source must remain live after failed switch"
    else:
        pytest.fail(f"Unexpected status {r.status_code}: {r.text}")


# ---------------------------------------------------------------------------
# T04 — switch-engine: Chrome cross-channel (skipped if Chrome unavailable)
# ---------------------------------------------------------------------------

def test_t04_switch_to_chrome(client: httpx.Client, session: str) -> None:
    """Switch from chromium to chrome (skipped if Chrome not installed)."""
    r = client.put(f"/api/v1/sessions/{session}/switch-engine", json={
        "target_channel": "chrome",
    })
    if r.status_code == 502:
        pytest.skip("Chrome not available on this machine")
    assert r.status_code == 200, r.text
    data = r.json()
    new_sid = data["session_id"]
    try:
        assert data["new_channel"] == "chrome"
        assert data["old_channel"] == "chromium"
        # New session is live
        r2 = client.get(f"/api/v1/sessions/{new_sid}")
        assert r2.status_code == 200
        assert r2.json()["state"] == "live"
    finally:
        client.delete(f"/api/v1/sessions/{new_sid}?force=true")
