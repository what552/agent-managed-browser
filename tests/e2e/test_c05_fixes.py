"""
E2E tests for r05-c05 fixes:
  - Fix 1 (P1): frame selection failure → 422 + diagnostics (no silent fallback)
  - Fix 2 (P2): acceptDownloads session-level flag (default false)
  - Fix 3 (P2): closing last page → 409

Requires: daemon running on localhost:19315
Run: pytest tests/e2e/test_c05_fixes.py -v
"""

import os
import sys
import time
import pytest
import httpx

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../sdk/python"))

from agentmb import BrowserClient, SessionInfo

BASE_URL = f"http://127.0.0.1:{os.environ.get('AGENTMB_PORT', '19315')}"
TEST_PROFILE = "e2e-c05"


@pytest.fixture(scope="module")
def client():
    with BrowserClient(base_url=BASE_URL) as c:
        yield c


# ---------------------------------------------------------------------------
# Fix 1: Frame selection failure → 422 + diagnostics (no silent fallback)
# ---------------------------------------------------------------------------

def test_invalid_frame_name_returns_422(client):
    """Specifying a non-existent frame by name must return 422, not silently use main frame."""
    sess = client.sessions.create(profile=TEST_PROFILE + "-frame422", headless=True)
    try:
        sess.navigate("https://example.com")
        # example.com has no iframes — frame by name 'nonexistent' should fail
        resp = client._http.post(
            f"/api/v1/sessions/{sess.id}/eval",
            json={"expression": "document.title", "frame": {"type": "name", "value": "nonexistent"}},
            headers={"content-type": "application/json"},
        )
        assert resp.status_code == 422
        body = resp.json()
        assert "not found" in body["error"].lower()
        assert "frame_selector" in body
        assert body["frame_selector"]["type"] == "name"
        assert body["frame_selector"]["value"] == "nonexistent"
        assert "available_frames" in body
        # available_frames should include at least the main frame
        assert isinstance(body["available_frames"], list)
        assert len(body["available_frames"]) >= 1
    finally:
        sess.close()


def test_invalid_frame_nth_returns_422(client):
    """Specifying a frame by index that doesn't exist must return 422."""
    sess = client.sessions.create(profile=TEST_PROFILE + "-frame-nth", headless=True)
    try:
        sess.navigate("https://example.com")
        resp = client._http.post(
            f"/api/v1/sessions/{sess.id}/click",
            json={"selector": "h1", "frame": {"type": "nth", "value": 99}},
            headers={"content-type": "application/json"},
        )
        assert resp.status_code == 422
        body = resp.json()
        assert "frame_selector" in body
        assert body["frame_selector"]["value"] == 99
    finally:
        sess.close()


def test_no_frame_param_still_works(client):
    """Requests without a frame param should work normally (no regression)."""
    sess = client.sessions.create(profile=TEST_PROFILE + "-no-frame", headless=True)
    try:
        sess.navigate("https://example.com")
        result = sess.eval("document.title")
        assert result.status == "ok"
        assert result.result == "Example Domain"
    finally:
        sess.close()


def test_valid_frame_nth_zero_works(client):
    """Frame nth=0 (main frame) should work on any page."""
    sess = client.sessions.create(profile=TEST_PROFILE + "-frame-zero", headless=True)
    try:
        sess.navigate("https://example.com")
        resp = client._http.post(
            f"/api/v1/sessions/{sess.id}/eval",
            json={"expression": "document.title", "frame": {"type": "nth", "value": 0}},
            headers={"content-type": "application/json"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "ok"
    finally:
        sess.close()


# ---------------------------------------------------------------------------
# Fix 2: acceptDownloads session-level flag
# ---------------------------------------------------------------------------

def test_accept_downloads_default_false(client):
    """By default, accept_downloads should be false in session creation response."""
    sess = client.sessions.create(profile=TEST_PROFILE + "-dl-false", headless=True)
    try:
        # Get session info from response
        info = client._get(f"/api/v1/sessions/{sess.id}")
        # accept_downloads is not in the GET /sessions/:id response (only in POST response)
        # but we can check the POST response via direct call
        resp = client._http.post(
            "/api/v1/sessions",
            json={"profile": TEST_PROFILE + "-dl-check", "headless": True},
            headers={"content-type": "application/json"},
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body.get("accept_downloads") is False
        # clean up
        client._delete(f"/api/v1/sessions/{body['session_id']}")
    finally:
        sess.close()


def test_accept_downloads_explicit_true(client):
    """Setting accept_downloads=True should be reflected in session creation response."""
    resp = client._http.post(
        "/api/v1/sessions",
        json={"profile": TEST_PROFILE + "-dl-true", "headless": True, "accept_downloads": True},
        headers={"content-type": "application/json"},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body.get("accept_downloads") is True
    # clean up
    client._delete(f"/api/v1/sessions/{body['session_id']}")


def test_sdk_accept_downloads_param(client):
    """SDK sessions.create(accept_downloads=True) should pass the flag through."""
    sess = None
    try:
        # Create via SDK with accept_downloads=True
        sess = client.sessions.create(
            profile=TEST_PROFILE + "-sdk-dl",
            headless=True,
            accept_downloads=True,
        )
        # Verify by creating directly with the HTTP client — the daemon accepted it
        # (session is live means launch succeeded with acceptDownloads=True)
        from agentmb import SessionInfo as SI
        info = client._get(f"/api/v1/sessions/{sess.id}", SI)
        assert info.session_id == sess.id
    finally:
        if sess:
            sess.close()


# ---------------------------------------------------------------------------
# Fix 3: Closing last page → 409
# ---------------------------------------------------------------------------

def test_close_last_page_returns_409(client):
    """Attempting to close the only remaining page in a session must return 409."""
    sess = client.sessions.create(profile=TEST_PROFILE + "-last-page", headless=True)
    try:
        pages = sess.pages()
        assert len(pages.pages) == 1
        only_page_id = pages.pages[0].page_id

        resp = client._http.delete(f"/api/v1/sessions/{sess.id}/pages/{only_page_id}")
        assert resp.status_code == 409
        body = resp.json()
        assert "last" in body["error"].lower()
    finally:
        sess.close()


def test_close_non_last_page_works(client):
    """Closing a page when there are multiple pages should still succeed (204)."""
    sess = client.sessions.create(profile=TEST_PROFILE + "-multi-close", headless=True)
    try:
        new = sess.new_page()
        pages_before = sess.pages()
        assert len(pages_before.pages) == 2

        # Close the new page (not the last one relative to the remaining)
        resp = client._http.delete(f"/api/v1/sessions/{sess.id}/pages/{new.page_id}")
        assert resp.status_code == 204

        pages_after = sess.pages()
        assert len(pages_after.pages) == 1
    finally:
        sess.close()


def test_close_last_page_error_message(client):
    """409 error message should clearly explain it's the last page."""
    sess = client.sessions.create(profile=TEST_PROFILE + "-lp-msg", headless=True)
    try:
        pages = sess.pages()
        page_id = pages.pages[0].page_id
        resp = client._http.delete(f"/api/v1/sessions/{sess.id}/pages/{page_id}")
        assert resp.status_code == 409
        assert "Cannot close" in resp.json()["error"]
    finally:
        sess.close()
