"""
E2E smoke test — agentmb Python SDK
Requires: daemon running on localhost:19315
Run: pytest tests/e2e/test_smoke.py -v
"""

import os
import sys
import pytest
import asyncio

# Add sdk to path so we don't need to install it
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../sdk/python"))

from agentmb import BrowserClient, AsyncBrowserClient
from agentmb.models import DaemonStatus, NavigateResult, ScreenshotResult, EvalResult, ExtractResult

BASE_URL = f"http://127.0.0.1:{os.environ.get('AGENTMB_PORT', '19315')}"
TEST_PROFILE = "e2e-smoke-test"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def client():
    with BrowserClient(base_url=BASE_URL) as c:
        yield c


@pytest.fixture(scope="module")
def session(client):
    sess = client.sessions.create(profile=TEST_PROFILE, headless=True)
    yield sess
    sess.close()


# ---------------------------------------------------------------------------
# Daemon health
# ---------------------------------------------------------------------------

def test_health(client):
    status = client.health()
    assert isinstance(status, DaemonStatus)
    assert status.status == "ok"
    assert status.version == "0.3.1"
    assert status.uptime_s >= 0


# ---------------------------------------------------------------------------
# Session lifecycle
# ---------------------------------------------------------------------------

def test_session_create(client):
    sess = client.sessions.create(profile=TEST_PROFILE + "-create", headless=True)
    assert sess.id.startswith("sess_")
    sess.close()


def test_session_list(client, session):
    sessions = client.sessions.list()
    assert any(s.session_id == session.id for s in sessions)


def test_session_get(client, session):
    info = client.sessions.get(session.id)
    assert info.session_id == session.id
    assert info.profile == TEST_PROFILE


def test_session_404(client):
    """Getting a non-existent session should raise HTTP 404."""
    import httpx
    with pytest.raises(httpx.HTTPStatusError) as exc_info:
        client.sessions.get("sess_nonexistent000")
    assert exc_info.value.response.status_code == 404


# ---------------------------------------------------------------------------
# Navigation
# ---------------------------------------------------------------------------

def test_navigate(session):
    result = session.navigate("https://example.com")
    assert isinstance(result, NavigateResult)
    assert result.status == "ok"
    assert "example.com" in result.url
    assert result.title == "Example Domain"
    assert result.duration_ms > 0


# ---------------------------------------------------------------------------
# Screenshot
# ---------------------------------------------------------------------------

def test_screenshot(session, tmp_path):
    result = session.screenshot(format="png")
    assert isinstance(result, ScreenshotResult)
    assert result.status == "ok"
    assert result.format == "png"
    assert len(result.data) > 0

    # Save and verify file size
    out = tmp_path / "smoke.png"
    result.save(str(out))
    assert out.exists()
    assert out.stat().st_size > 5000  # at least 5KB


# ---------------------------------------------------------------------------
# JavaScript eval
# ---------------------------------------------------------------------------

def test_eval(session):
    result = session.eval("document.title")
    assert isinstance(result, EvalResult)
    assert result.status == "ok"
    assert result.result == "Example Domain"


# ---------------------------------------------------------------------------
# Selector-based extract
# ---------------------------------------------------------------------------

def test_extract_text(session):
    result = session.extract("h1")
    assert isinstance(result, ExtractResult)
    assert result.status == "ok"
    assert result.count >= 1
    assert any("Example Domain" in item.get("text", "") for item in result.items)


def test_extract_attribute(session):
    result = session.extract("a", attribute="href")
    assert isinstance(result, ExtractResult)
    assert result.count >= 1
    assert any("iana.org" in item.get("href", "") for item in result.items)


# ---------------------------------------------------------------------------
# Action failure diagnostics
# ---------------------------------------------------------------------------

def test_eval_failure_has_diagnostics(session):
    """eval with an invalid expression returns a 422 with structured diagnostics fields."""
    import httpx
    with pytest.raises(httpx.HTTPStatusError) as exc_info:
        session.eval(")(invalid syntax()(")
    resp = exc_info.value.response
    assert resp.status_code == 422
    data = resp.json()
    assert "error" in data
    assert "url" in data
    assert "readyState" in data
    assert "elapsedMs" in data


# ---------------------------------------------------------------------------
# Audit logs
# ---------------------------------------------------------------------------

def test_audit_logs(session):
    entries = session.logs(tail=10)
    assert len(entries) > 0
    actions = [e.action for e in entries if e.action]
    assert "navigate" in actions or "screenshot" in actions


# ---------------------------------------------------------------------------
# Async client
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_async_health():
    async with AsyncBrowserClient(base_url=BASE_URL) as client:
        status = await client.health()
        assert status.status == "ok"


@pytest.mark.asyncio
async def test_async_navigate():
    async with AsyncBrowserClient(base_url=BASE_URL) as client:
        sess = await client.sessions.create(profile=TEST_PROFILE + "-async", headless=True)
        async with sess:
            result = await sess.navigate("https://example.com")
            assert result.status == "ok"
            assert result.title == "Example Domain"

            title = await sess.eval("document.title")
            assert title.result == "Example Domain"


@pytest.mark.asyncio
async def test_async_screenshot():
    async with AsyncBrowserClient(base_url=BASE_URL) as client:
        sess = await client.sessions.create(profile=TEST_PROFILE + "-async-ss", headless=True)
        async with sess:
            await sess.navigate("https://example.com")
            shot = await sess.screenshot()
            assert shot.status == "ok"
            assert len(shot.to_bytes()) > 5000
