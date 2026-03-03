"""
R10-C01 e2e tests: P0 fixes (B01-B04) + T01/T02/T06/T08

B02 — bodyLimit fix: upload >1 MB file should return 200 (not 413)
B03 — upload gains page_id: multi-tab upload targets correct page
T01 — dual-zone profiles: chrome channel uses chrome-profiles/ subdir
T06 — session unseal: seal -> rm -> 423; unseal -> rm -> 204
T06 — session rm --force: seal -> rm --force -> 204 (skips seal check)
T08 — upload direct-path: file_path payload avoids base64 round-trip
"""
from __future__ import annotations

import base64
import io
import os
import tempfile

import httpx
import pytest

PORT = os.environ.get("AGENTMB_PORT", "19315")
BASE_URL = f"http://127.0.0.1:{PORT}"
TEST_PROFILE = "r10c01-test"


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
# B02 — bodyLimit fix
# ---------------------------------------------------------------------------

def test_b02_upload_bodylimit(client: httpx.Client, session: str) -> None:
    """Upload a >1 MB base64 payload should succeed (not 413) after bodyLimit fix."""
    html = _inline('<input id="f" type="file">')
    nav = client.post(f"/api/v1/sessions/{session}/navigate", json={"url": html})
    assert nav.status_code == 200

    # Generate ~1.5 MB of binary content (will expand to ~2 MB base64)
    content = os.urandom(1_500_000)
    b64 = base64.b64encode(content).decode()

    r = client.post(f"/api/v1/sessions/{session}/upload", json={
        "selector": "#f",
        "content": b64,
        "filename": "bigfile.bin",
        "mime_type": "application/octet-stream",
    })
    # Should no longer be rejected with 413 (bodyLimit was too small before)
    assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
    assert r.json()["status"] == "ok"


# ---------------------------------------------------------------------------
# B03 — upload page_id targeting
# ---------------------------------------------------------------------------

def test_b03_upload_page_id(client: httpx.Client, session: str) -> None:
    """Upload with page_id should target the correct tab in a multi-tab session."""
    # Open two pages
    p1 = client.post(f"/api/v1/sessions/{session}/pages")
    assert p1.status_code == 201
    page1_id = p1.json()["page_id"]

    p2 = client.post(f"/api/v1/sessions/{session}/pages")
    assert p2.status_code == 201
    page2_id = p2.json()["page_id"]

    html = _inline('<input id="f" type="file">')

    # Navigate both pages to the file input HTML
    client.post(f"/api/v1/sessions/{session}/navigate", json={"url": html, "page_id": page1_id})
    client.post(f"/api/v1/sessions/{session}/navigate", json={"url": html, "page_id": page2_id})

    # Upload to page2 explicitly
    content_b64 = base64.b64encode(b"hello world").decode()
    r = client.post(f"/api/v1/sessions/{session}/upload", json={
        "selector": "#f",
        "content": content_b64,
        "filename": "test.txt",
        "mime_type": "text/plain",
        "page_id": page2_id,
    })
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "ok"


# ---------------------------------------------------------------------------
# T01 — dual-zone profile storage
# ---------------------------------------------------------------------------

def test_t01_dual_zone_profiles(client: httpx.Client) -> None:
    """Sessions with browser_channel=chrome store profiles in chrome-profiles/ subdir."""
    data_dir = os.environ.get("AGENTMB_DATA_DIR", os.path.expanduser("~/.agentmb"))

    # Create a session with channel=chrome (requires system Chrome installed)
    r = client.post("/api/v1/sessions", json={
        "profile": "r10c01-chrome-zone",
        "headless": True,
        "browser_channel": "chrome",
    })
    # If Chrome is not installed, the daemon returns 500 — skip gracefully
    if r.status_code == 500 and "chrome" in r.text.lower():
        pytest.skip("System Chrome not available in test environment")
    assert r.status_code == 201, r.text
    sid = r.json()["session_id"]

    try:
        # The profile directory should be under chrome-profiles/, not profiles/
        chrome_profile_path = os.path.join(data_dir, "chrome-profiles", "r10c01-chrome-zone")
        assert os.path.isdir(chrome_profile_path), (
            f"Expected chrome-profiles/ dir at {chrome_profile_path}, "
            f"but it does not exist (data_dir={data_dir})"
        )
    finally:
        client.delete(f"/api/v1/sessions/{sid}?force=true")


# ---------------------------------------------------------------------------
# T06 — session unseal
# ---------------------------------------------------------------------------

def test_t06_unseal(client: httpx.Client, session: str) -> None:
    """seal -> rm should 423; unseal -> rm should 204."""
    # Seal
    r = client.post(f"/api/v1/sessions/{session}/seal")
    assert r.status_code == 200
    assert r.json()["sealed"] is True

    # DELETE while sealed should be 423
    r = client.delete(f"/api/v1/sessions/{session}")
    assert r.status_code == 423, f"Expected 423, got {r.status_code}"

    # Unseal
    r = client.post(f"/api/v1/sessions/{session}/unseal")
    assert r.status_code == 200
    assert r.json()["sealed"] is False

    # DELETE after unseal should succeed
    r = client.delete(f"/api/v1/sessions/{session}")
    assert r.status_code == 204, f"Expected 204, got {r.status_code}"


def test_t06_rm_force(client: httpx.Client, session: str) -> None:
    """seal -> rm --force (?force=true) should 204 (bypasses seal)."""
    # Seal
    r = client.post(f"/api/v1/sessions/{session}/seal")
    assert r.status_code == 200

    # DELETE with force=true should bypass sealed check
    r = client.delete(f"/api/v1/sessions/{session}?force=true")
    assert r.status_code == 204, f"Expected 204, got {r.status_code}"


# ---------------------------------------------------------------------------
# T08 — upload direct-path mode
# ---------------------------------------------------------------------------

def test_t08_upload_direct_path(client: httpx.Client, session: str) -> None:
    """Upload via file_path (direct-path mode) should succeed without base64 content."""
    html = _inline('<input id="f" type="file">')
    nav = client.post(f"/api/v1/sessions/{session}/navigate", json={"url": html})
    assert nav.status_code == 200

    # Write a temp file on disk accessible to the daemon (same machine)
    with tempfile.NamedTemporaryFile(suffix=".txt", delete=False) as tmp:
        tmp.write(b"direct path upload test content")
        tmp_path = tmp.name

    try:
        r = client.post(f"/api/v1/sessions/{session}/upload", json={
            "selector": "#f",
            "file_path": tmp_path,
            "filename": "direct.txt",
            "mime_type": "text/plain",
        })
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        data = r.json()
        assert data["status"] == "ok"
        assert data["filename"] == "direct.txt"
    finally:
        os.unlink(tmp_path)


def test_t08_upload_direct_path_traversal_rejected(client: httpx.Client, session: str) -> None:
    """file_path containing '..' should be rejected with 400."""
    html = _inline('<input id="f" type="file">')
    nav = client.post(f"/api/v1/sessions/{session}/navigate", json={"url": html})
    assert nav.status_code == 200

    r = client.post(f"/api/v1/sessions/{session}/upload", json={
        "selector": "#f",
        "file_path": "/tmp/../etc/passwd",
        "filename": "passwd",
        "mime_type": "text/plain",
    })
    assert r.status_code == 400, f"Expected 400, got {r.status_code}: {r.text}"
    assert "traversal" in r.json().get("error", "").lower()
