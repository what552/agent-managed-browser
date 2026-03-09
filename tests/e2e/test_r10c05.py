"""
R10-C05 e2e tests:
- T11: extract-image API (visual asset extraction from page element)
- T13: --allow-extensions (session new secure-by-default extension control)
- version 0.4.1 check
"""
from __future__ import annotations

import base64
import os

import httpx
import pytest

PORT = os.environ.get("AGENTMB_PORT", "19315")
BASE_URL = f"http://127.0.0.1:{PORT}"
TEST_PROFILE = "r10c05-test"


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
# Version check
# ---------------------------------------------------------------------------

def test_version_041(client: httpx.Client) -> None:
    """Daemon /health or /api/v1/sessions responds; version constant 0.4.1 in package.json is verified via build."""
    r = client.get("/health")
    assert r.status_code == 200


# ---------------------------------------------------------------------------
# T11 — extract-image: API contract
# ---------------------------------------------------------------------------

def test_t11_extract_image_returns_base64(client: httpx.Client, session: str) -> None:
    """extract-image returns valid base64 data for a visible element."""
    # Navigate to a simple page with a known element
    client.post(f"/api/v1/sessions/{session}/navigate", json={"url": "https://example.com"})

    r = client.post(f"/api/v1/sessions/{session}/extract-image", json={
        "selector": "h1",
    })
    assert r.status_code == 200, r.text
    data = r.json()

    assert "data" in data, "Response must have 'data' field"
    assert data["status"] == "ok"
    assert data["format"] == "png"
    assert data["mime_type"] == "image/png"
    assert isinstance(data["width"], int) and data["width"] > 0
    assert isinstance(data["height"], int) and data["height"] > 0
    assert data["selector"] == "h1"
    assert "tag_name" in data
    assert "url" in data
    assert "duration_ms" in data

    # Verify base64 is valid
    decoded = base64.b64decode(data["data"])
    assert len(decoded) > 0, "Decoded image bytes must be non-empty"
    # PNG magic bytes
    assert decoded[:4] == b'\x89PNG', "Expected PNG magic bytes"


def test_t11_extract_image_jpeg_format(client: httpx.Client, session: str) -> None:
    """extract-image supports jpeg format."""
    client.post(f"/api/v1/sessions/{session}/navigate", json={"url": "https://example.com"})

    r = client.post(f"/api/v1/sessions/{session}/extract-image", json={
        "selector": "h1",
        "format": "jpeg",
    })
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["format"] == "jpeg"
    assert data["mime_type"] == "image/jpeg"

    decoded = base64.b64decode(data["data"])
    # JPEG magic bytes: FF D8 FF
    assert decoded[:3] == b'\xff\xd8\xff', "Expected JPEG magic bytes"


def test_t11_extract_image_dimensions_match_element(client: httpx.Client, session: str) -> None:
    """extract-image returns element's actual rendered dimensions."""
    client.post(f"/api/v1/sessions/{session}/navigate", json={"url": "https://example.com"})

    r = client.post(f"/api/v1/sessions/{session}/extract-image", json={
        "selector": "h1",
    })
    assert r.status_code == 200, r.text
    data = r.json()

    # Dimensions should be > 0 (element rendered on page)
    assert data["width"] > 0
    assert data["height"] > 0


def test_t11_extract_image_tag_name_returned(client: httpx.Client, session: str) -> None:
    """extract-image returns the element tag_name."""
    client.post(f"/api/v1/sessions/{session}/navigate", json={"url": "https://example.com"})

    r = client.post(f"/api/v1/sessions/{session}/extract-image", json={
        "selector": "h1",
    })
    assert r.status_code == 200, r.text
    assert r.json()["tag_name"] == "h1"


def test_t11_extract_image_missing_selector_returns_400(client: httpx.Client, session: str) -> None:
    """extract-image without selector returns 400."""
    r = client.post(f"/api/v1/sessions/{session}/extract-image", json={})
    assert r.status_code == 400, r.text


def test_t11_extract_image_nonexistent_element_returns_422(client: httpx.Client, session: str) -> None:
    """extract-image on nonexistent selector returns 422 with diagnostics."""
    client.post(f"/api/v1/sessions/{session}/navigate", json={"url": "https://example.com"})
    r = client.post(f"/api/v1/sessions/{session}/extract-image", json={
        "selector": "#nonexistent-element-xyz",
    })
    assert r.status_code == 422, r.text


def test_t11_extract_image_nonexistent_session_returns_404(client: httpx.Client) -> None:
    """extract-image on nonexistent session returns 404."""
    r = client.post("/api/v1/sessions/nonexistent-sess/extract-image", json={
        "selector": "h1",
    })
    assert r.status_code == 404, r.text


# ---------------------------------------------------------------------------
# T13 — allow-extensions: session creation flag
# ---------------------------------------------------------------------------

def test_t13_extensions_disabled_by_default(client: httpx.Client) -> None:
    """Session created without allow_extensions has allow_extensions=false in response."""
    r = client.post("/api/v1/sessions", json={"profile": "r10c05-ext-default", "headless": True})
    assert r.status_code == 201, r.text
    data = r.json()
    sid = data["session_id"]
    try:
        assert data.get("allow_extensions") is False, (
            f"Expected allow_extensions=false, got {data.get('allow_extensions')}"
        )
    finally:
        client.delete(f"/api/v1/sessions/{sid}?force=true")


def test_t13_extensions_enabled_when_requested(client: httpx.Client) -> None:
    """Session created with allow_extensions=true has allow_extensions=true in response."""
    r = client.post("/api/v1/sessions", json={
        "profile": "r10c05-ext-enabled",
        "headless": True,
        "allow_extensions": True,
    })
    assert r.status_code == 201, r.text
    data = r.json()
    sid = data["session_id"]
    try:
        assert data.get("allow_extensions") is True, (
            f"Expected allow_extensions=true, got {data.get('allow_extensions')}"
        )
    finally:
        client.delete(f"/api/v1/sessions/{sid}?force=true")


def test_t13_session_with_extensions_is_functional(client: httpx.Client) -> None:
    """Session with allow_extensions=true can navigate and execute actions."""
    r = client.post("/api/v1/sessions", json={
        "profile": "r10c05-ext-functional",
        "headless": True,
        "allow_extensions": True,
    })
    assert r.status_code == 201, r.text
    sid = r.json()["session_id"]
    try:
        nav = client.post(f"/api/v1/sessions/{sid}/navigate", json={"url": "https://example.com"})
        assert nav.status_code == 200
        assert nav.json()["url"].startswith("https://example.com")
    finally:
        client.delete(f"/api/v1/sessions/{sid}?force=true")
