"""
E2E tests for r05 action capabilities:
  type, press, select, hover, wait_for_selector, wait_for_url,
  wait_for_response, upload, download

Requires: daemon running on localhost:19315
Run: pytest tests/e2e/test_actions_v2.py -v
"""

import os
import sys
import base64
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../sdk/python"))

from agentmb import BrowserClient
from agentmb.models import (
    TypeResult, PressResult, SelectResult, HoverResult,
    WaitForSelectorResult, WaitForUrlResult, WaitForResponseResult,
    UploadResult, DownloadResult,
)

BASE_URL = f"http://127.0.0.1:{os.environ.get('AGENTMB_PORT', '19315')}"
TEST_PROFILE = "e2e-actions-v2"


@pytest.fixture(scope="module")
def client():
    with BrowserClient(base_url=BASE_URL) as c:
        yield c


@pytest.fixture(scope="module")
def session(client):
    sess = client.sessions.create(profile=TEST_PROFILE, headless=True)
    # Start on a page with form elements (httpbin's forms page works offline-ish)
    # Use a data: URI so no network needed for form tests
    yield sess
    sess.close()


# ---------------------------------------------------------------------------
# type
# ---------------------------------------------------------------------------

def test_type_into_input(session):
    """type action should populate a text input character by character."""
    session.navigate("https://example.com")
    # Navigate to a page with a text input via data URI
    session.navigate(
        "data:text/html,<html><body>"
        "<input id='t' type='text'/>"
        "</body></html>"
    )
    result = session.type("#t", "hello world")
    assert isinstance(result, TypeResult)
    assert result.status == "ok"
    assert result.selector == "#t"
    assert result.duration_ms >= 0
    # Verify value was typed
    val = session.eval("document.getElementById('t').value")
    assert val.result == "hello world"


# ---------------------------------------------------------------------------
# press
# ---------------------------------------------------------------------------

def test_press_enter(session):
    """press Enter on an input should work without error."""
    session.navigate(
        "data:text/html,<html><body>"
        "<input id='p' type='text' value='abc'/>"
        "</body></html>"
    )
    result = session.press("#p", "End")
    assert isinstance(result, PressResult)
    assert result.status == "ok"
    assert result.key == "End"
    assert result.duration_ms >= 0


# ---------------------------------------------------------------------------
# select
# ---------------------------------------------------------------------------

def test_select_option(session):
    """select action should pick an option from a <select> element."""
    session.navigate(
        "data:text/html,<html><body>"
        "<select id='s'>"
        "<option value='a'>A</option>"
        "<option value='b'>B</option>"
        "<option value='c'>C</option>"
        "</select>"
        "</body></html>"
    )
    result = session.select("#s", ["b"])
    assert isinstance(result, SelectResult)
    assert result.status == "ok"
    assert "b" in result.selected
    # Verify selected via eval
    val = session.eval("document.getElementById('s').value")
    assert val.result == "b"


# ---------------------------------------------------------------------------
# hover
# ---------------------------------------------------------------------------

def test_hover_element(session):
    """hover should succeed on a visible element."""
    session.navigate("https://example.com")
    result = session.hover("h1")
    assert isinstance(result, HoverResult)
    assert result.status == "ok"
    assert result.selector == "h1"
    assert result.duration_ms >= 0


# ---------------------------------------------------------------------------
# wait_for_selector
# ---------------------------------------------------------------------------

def test_wait_for_selector_visible(session):
    """wait_for_selector should resolve immediately for an already-visible element."""
    session.navigate("https://example.com")
    result = session.wait_for_selector("h1", state="visible", timeout_ms=3000)
    assert isinstance(result, WaitForSelectorResult)
    assert result.status == "ok"
    assert result.state == "visible"
    assert result.duration_ms >= 0


def test_wait_for_selector_timeout(session):
    """wait_for_selector should 422 when element never appears."""
    import httpx
    with pytest.raises(httpx.HTTPStatusError) as exc_info:
        session.wait_for_selector("#nonexistent-xyz-99999", state="visible", timeout_ms=500)
    assert exc_info.value.response.status_code == 422
    data = exc_info.value.response.json()
    assert "error" in data
    assert "elapsedMs" in data


# ---------------------------------------------------------------------------
# wait_for_url
# ---------------------------------------------------------------------------

def test_wait_for_url_current(session):
    """wait_for_url should resolve immediately when already on matching URL."""
    session.navigate("https://example.com")
    result = session.wait_for_url("**/example.com**", timeout_ms=3000)
    assert isinstance(result, WaitForUrlResult)
    assert result.status == "ok"
    assert "example.com" in result.url


# ---------------------------------------------------------------------------
# wait_for_response (with navigate trigger)
# ---------------------------------------------------------------------------

def test_wait_for_response_with_trigger(session):
    """wait_for_response should capture a response triggered by navigate."""
    result = session.wait_for_response(
        url_pattern="example.com",
        timeout_ms=10000,
        trigger={"type": "navigate", "url": "https://example.com", "wait_until": "commit"},
    )
    assert isinstance(result, WaitForResponseResult)
    assert result.status == "ok"
    assert "example.com" in result.url
    assert result.status_code in (200, 301, 302, 304)
    assert result.duration_ms >= 0


# ---------------------------------------------------------------------------
# upload
# ---------------------------------------------------------------------------

def test_upload_file(session, tmp_path):
    """upload should set a file input's files list."""
    # Create a test file
    test_file = tmp_path / "test_upload.txt"
    test_file.write_text("hello from upload test")

    session.navigate(
        "data:text/html,<html><body>"
        "<input id='u' type='file'/>"
        "</body></html>"
    )
    result = session.upload("#u", str(test_file), mime_type="text/plain")
    assert isinstance(result, UploadResult)
    assert result.status == "ok"
    assert result.filename == "test_upload.txt"
    assert result.size_bytes == len("hello from upload test")


# ---------------------------------------------------------------------------
# download
# ---------------------------------------------------------------------------

def test_download_file(client, tmp_path):
    """download should capture a file download triggered by clicking a link.
    Requires accept_downloads=True (r05-c05: default is now false)."""
    dl_sess = client.sessions.create(
        profile=TEST_PROFILE + "-dl", headless=True, accept_downloads=True
    )
    try:
        dl_sess.navigate(
            "data:text/html,<html><body>"
            "<a id='dl' href='data:text/plain;charset=utf-8,hello+download' download='hello.txt'>Download</a>"
            "</body></html>"
        )
        result = dl_sess.download("#dl", timeout_ms=10000)
        assert isinstance(result, DownloadResult)
        assert result.status == "ok"
        assert result.size_bytes > 0
        assert len(result.to_bytes()) > 0
        # Save and verify
        out = tmp_path / "downloaded.txt"
        result.save(str(out))
        assert out.exists()
        assert out.stat().st_size > 0
    finally:
        dl_sess.close()
