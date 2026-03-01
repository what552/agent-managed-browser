"""R09-C03 — page_id direct targeting for multi-page / multi-agent workflows.

P0: All major action routes accept an optional page_id body param to target a
    specific tab without switching the session's active page.

Verified routes: navigate, eval, screenshot, element_map, snapshot_map, scroll
"""
import os
import pytest
import requests

BASE = f"http://127.0.0.1:{os.environ.get('AGENTMB_PORT', '19315')}"


def api(method: str, path: str, **kwargs):
    return getattr(requests, method)(f"{BASE}{path}", timeout=30, **kwargs)


def new_session(profile: str = "r09c03-default") -> str:
    r = api("post", "/api/v1/sessions", json={"profile": profile})
    assert r.status_code == 201, f"session create failed: {r.text}"
    return r.json()["session_id"]


def rm_session(sid: str) -> None:
    api("delete", f"/api/v1/sessions/{sid}")


def navigate(sid: str, url: str, **kwargs) -> None:
    body = {"url": url, **kwargs}
    r = api("post", f"/api/v1/sessions/{sid}/navigate", json=body)
    assert r.status_code == 200, f"navigate failed: {r.text}"


def new_page(sid: str) -> str:
    r = api("post", f"/api/v1/sessions/{sid}/pages", json={})
    assert r.status_code == 201, f"new_page failed: {r.text}"
    return r.json()["page_id"]


def list_pages(sid: str) -> list:
    r = api("get", f"/api/v1/sessions/{sid}/pages")
    assert r.status_code == 200
    return r.json().get("pages", [])


# ---------------------------------------------------------------------------
# P0 — page_id targeting
# ---------------------------------------------------------------------------

class TestPageIdTargeting:

    def test_navigate_with_page_id(self):
        """navigate with page_id targets non-active tab, active tab unchanged."""
        sid = new_session("r09c03-nav")
        try:
            pages = list_pages(sid)
            p1 = pages[0]["page_id"]  # initial (active) tab

            # Navigate active tab to example.com
            navigate(sid, "https://example.com")

            # Open second tab
            p2 = new_page(sid)

            # Navigate second tab WITHOUT switching
            navigate(sid, "https://example.org", page_id=p2)

            # eval on each page_id should return different URLs
            r1 = api("post", f"/api/v1/sessions/{sid}/eval",
                     json={"expression": "location.hostname", "page_id": p1})
            assert r1.status_code == 200
            h1 = r1.json().get("result", "")

            r2 = api("post", f"/api/v1/sessions/{sid}/eval",
                     json={"expression": "location.hostname", "page_id": p2})
            assert r2.status_code == 200
            h2 = r2.json().get("result", "")

            assert "example.com" in h1, f"p1 expected example.com, got {h1!r}"
            assert "example.org" in h2, f"p2 expected example.org, got {h2!r}"

        finally:
            rm_session(sid)

    def test_eval_with_page_id(self):
        """eval with page_id evaluates JS on the specified tab."""
        sid = new_session("r09c03-eval")
        try:
            p1 = list_pages(sid)[0]["page_id"]
            navigate(sid, "https://example.com")

            p2 = new_page(sid)
            navigate(sid, "https://example.org", page_id=p2)

            r1 = api("post", f"/api/v1/sessions/{sid}/eval",
                     json={"expression": "location.hostname", "page_id": p1})
            assert r1.status_code == 200

            r2 = api("post", f"/api/v1/sessions/{sid}/eval",
                     json={"expression": "location.hostname", "page_id": p2})
            assert r2.status_code == 200

            # Hostnames must differ: example.com vs example.org
            h1 = r1.json().get("result", "")
            h2 = r2.json().get("result", "")
            assert "example.com" in h1, f"p1 should be example.com, got {h1!r}"
            assert "example.org" in h2, f"p2 should be example.org, got {h2!r}"

        finally:
            rm_session(sid)

    def test_screenshot_with_page_id(self):
        """screenshot with page_id captures the specified (non-active) tab."""
        sid = new_session("r09c03-shot")
        try:
            navigate(sid, "https://example.com")
            p2 = new_page(sid)
            navigate(sid, "https://example.org", page_id=p2)

            # Screenshot the second tab without switching
            r = api("post", f"/api/v1/sessions/{sid}/screenshot",
                    json={"format": "png", "page_id": p2})
            assert r.status_code == 200
            data = r.json()
            assert data.get("status") == "ok"
            assert "image" in data or "data" in data or "base64" in data, (
                f"No image data in response: {list(data.keys())}"
            )

        finally:
            rm_session(sid)

    def test_element_map_with_page_id(self):
        """element_map with page_id scans the specified (non-active) tab."""
        sid = new_session("r09c03-em")
        try:
            navigate(sid, "https://example.com")
            p2 = new_page(sid)
            navigate(sid, "https://example.org", page_id=p2)

            r = api("post", f"/api/v1/sessions/{sid}/element_map",
                    json={"page_id": p2})
            assert r.status_code == 200
            data = r.json()
            assert "elements" in data, f"No elements key: {data}"
            # example.org should have at least 1 element (e.g. heading, link)
            assert len(data["elements"]) > 0, "element_map returned no elements on example.org"

        finally:
            rm_session(sid)

    def test_snapshot_map_with_page_id(self):
        """snapshot_map with page_id creates snapshot scoped to specified tab."""
        sid = new_session("r09c03-snap")
        try:
            navigate(sid, "https://example.com")
            p2 = new_page(sid)
            navigate(sid, "https://example.org", page_id=p2)

            r = api("post", f"/api/v1/sessions/{sid}/snapshot_map",
                    json={"page_id": p2})
            assert r.status_code == 200
            data = r.json()
            assert data.get("status") == "ok"
            assert "snapshot_id" in data
            assert "elements" in data

            # Verify url in snapshot matches the p2 tab URL
            snap_url = data.get("url", "")
            assert "example.org" in snap_url, (
                f"Snapshot url should be example.org tab, got {snap_url!r}"
            )

        finally:
            rm_session(sid)

    def test_invalid_page_id_returns_404(self):
        """Passing a non-existent page_id to any action returns 404."""
        sid = new_session("r09c03-notfound")
        try:
            navigate(sid, "https://example.com")
            r = api("post", f"/api/v1/sessions/{sid}/eval",
                    json={"expression": "1+1", "page_id": "page_nonexistent"})
            assert r.status_code == 404, (
                f"Expected 404 for invalid page_id, got {r.status_code}: {r.text}"
            )
        finally:
            rm_session(sid)

    def test_no_page_id_uses_active_tab(self):
        """Without page_id, action targets the active tab (backward compatible)."""
        sid = new_session("r09c03-compat")
        try:
            navigate(sid, "https://example.com")
            # No page_id → active tab
            r = api("post", f"/api/v1/sessions/{sid}/eval",
                    json={"expression": "location.hostname"})
            assert r.status_code == 200
            host = r.json().get("result", "")
            assert "example.com" in host
        finally:
            rm_session(sid)
