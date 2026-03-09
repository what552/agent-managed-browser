"""
R10-C06 e2e tests: Issue #9 — CDP attach pages list reconciliation

Fix: attachCdpSession() now reconciles pagesMap against CDP /json ground truth.
If Playwright misses tabs during connectOverCDP (async attachedToTarget race),
it waits up to 2 s for delayed page events to fill the gap.

Tests:
1. attach + pages list aligns with CDP /json (core reconciliation check)
2. multiple tabs created before attach — all visible
3. no duplicate pages in list
4. graceful fallback: managed session still works (regression guard)
5. unreachable cdp_url returns an error status (not a daemon crash)
"""
from __future__ import annotations

import http.client
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from typing import Optional

import httpx
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../sdk/python"))

PORT = os.environ.get("AGENTMB_PORT", "19315")
BASE_URL = f"http://127.0.0.1:{PORT}"

# CDP debug ports — chosen to avoid collision with other test files
CDP_PORT_A = 19903  # used for most reconciliation tests
CDP_PORT_B = 19904  # used for multiple-tabs test


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def daemon_running() -> bool:
    try:
        httpx.get(f"{BASE_URL}/health", timeout=2).raise_for_status()
        return True
    except Exception:
        return False


def find_chromium_executable() -> Optional[str]:
    import platform
    plt = platform.system()
    if plt == "Darwin":
        candidates = [
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        ]
        for c in candidates:
            if os.path.isfile(c):
                return c
    elif plt == "Linux":
        for cmd in ["chromium-browser", "chromium", "google-chrome-stable", "google-chrome"]:
            path = shutil.which(cmd)
            if path:
                return path
    return None


def spawn_debug_chromium(port: int):
    """Spawn a headless Chromium with remote debugging. Skip if no binary found."""
    exe = find_chromium_executable()
    if exe is None:
        pytest.skip("No Chromium/Chrome binary found — skipping CDP reconciliation test")

    data_dir = tempfile.mkdtemp(prefix="agentmb-test-r10c06-")
    proc = subprocess.Popen(
        [
            exe,
            f"--remote-debugging-port={port}",
            f"--user-data-dir={data_dir}",
            "--headless=new",
            "--no-sandbox",
            "--disable-gpu",
            "--no-first-run",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    cdp_url = f"http://127.0.0.1:{port}"
    deadline = time.time() + 10
    while time.time() < deadline:
        try:
            conn = http.client.HTTPConnection(f"127.0.0.1:{port}", timeout=1)
            conn.request("GET", "/json/version")
            resp = conn.getresponse()
            if resp.status == 200:
                conn.close()
                return proc, cdp_url, data_dir
            conn.close()
        except Exception:
            pass
        time.sleep(0.3)
    proc.terminate()
    shutil.rmtree(data_dir, ignore_errors=True)
    pytest.skip(f"Chromium did not become ready on port {port}")


def open_cdp_tab(port: int) -> dict:
    """Open a new tab via CDP /json/new and return target info."""
    conn = http.client.HTTPConnection(f"127.0.0.1:{port}", timeout=5)
    conn.request("PUT", "/json/new")
    resp = conn.getresponse()
    body = resp.read()
    conn.close()
    return json.loads(body)


def get_cdp_pages(port: int) -> list[dict]:
    """Return all type=page targets from CDP /json."""
    conn = http.client.HTTPConnection(f"127.0.0.1:{port}", timeout=5)
    conn.request("GET", "/json")
    resp = conn.getresponse()
    body = resp.read()
    conn.close()
    targets = json.loads(body)
    return [t for t in targets if t.get("type") == "page"]


def normalize_url(url: str) -> str:
    """Normalize Chrome internal URL aliases.

    Chrome's CDP reports the new-tab page as 'chrome://newtab/' while
    Playwright's Page.url() returns 'chrome://new-tab-page/'.
    Both refer to the same page — normalize to the Playwright form for comparison.
    """
    if url in ("chrome://newtab/", "chrome://newtab"):
        return "chrome://new-tab-page/"
    return url


def close_session(client: httpx.Client, sid: str) -> None:
    client.delete(f"/api/v1/sessions/{sid}")


# ---------------------------------------------------------------------------
# Skip marker
# ---------------------------------------------------------------------------

pytestmark = pytest.mark.skipif(
    not daemon_running(),
    reason="agentmb daemon not running"
)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestCdpReconciliation:
    """Core reconciliation: pages list must align with CDP /json after attach."""

    def test_pages_list_aligns_with_cdp_json(self):
        """After attach, every URL in CDP /json type=page appears in pages list."""
        proc, cdp_url, data_dir = spawn_debug_chromium(CDP_PORT_A)
        try:
            cdp_pages = get_cdp_pages(CDP_PORT_A)
            assert len(cdp_pages) >= 1, "Chrome should have at least one page on start"

            with httpx.Client(base_url=BASE_URL, timeout=15) as c:
                r = c.post("/api/v1/sessions", json={
                    "launch_mode": "attach",
                    "cdp_url": cdp_url,
                })
                assert r.status_code == 201, r.text
                sid = r.json()["session_id"]
                try:
                    pages_r = c.get(f"/api/v1/sessions/{sid}/pages")
                    assert pages_r.status_code == 200, pages_r.text
                    # Normalize Chrome internal URL aliases before comparing
                    agentmb_urls = {normalize_url(p["url"]) for p in pages_r.json()["pages"]}
                    cdp_urls = {normalize_url(p["url"]) for p in cdp_pages}
                    # Every CDP page URL should appear in agentmb pages list
                    missing = cdp_urls - agentmb_urls
                    assert missing == set(), (
                        f"Pages missing from agentmb list: {missing}\n"
                        f"agentmb: {agentmb_urls}\ncdp: {cdp_urls}"
                    )
                finally:
                    close_session(c, sid)
        finally:
            proc.terminate()
            shutil.rmtree(data_dir, ignore_errors=True)

    def test_multiple_tabs_all_visible_after_attach(self):
        """Open 3 extra tabs before attach; all should appear in pages list."""
        proc, cdp_url, data_dir = spawn_debug_chromium(CDP_PORT_B)
        try:
            # Open 3 additional tabs via CDP before attaching
            for _ in range(3):
                open_cdp_tab(CDP_PORT_B)
            time.sleep(0.3)  # give Chrome a moment to register tabs

            cdp_pages = get_cdp_pages(CDP_PORT_B)
            assert len(cdp_pages) >= 3, f"Expected ≥3 CDP pages, got {len(cdp_pages)}"

            with httpx.Client(base_url=BASE_URL, timeout=15) as c:
                r = c.post("/api/v1/sessions", json={
                    "launch_mode": "attach",
                    "cdp_url": cdp_url,
                })
                assert r.status_code == 201, r.text
                sid = r.json()["session_id"]
                try:
                    pages_r = c.get(f"/api/v1/sessions/{sid}/pages")
                    assert pages_r.status_code == 200, pages_r.text
                    agentmb_pages = pages_r.json()["pages"]
                    # Normalize Chrome internal URL aliases before comparing
                    agentmb_urls = {normalize_url(p["url"]) for p in agentmb_pages}
                    cdp_urls = {normalize_url(p["url"]) for p in cdp_pages}
                    missing = cdp_urls - agentmb_urls
                    assert missing == set(), (
                        f"Tabs missing after reconciliation: {missing}\n"
                        f"agentmb ({len(agentmb_pages)} pages): {agentmb_urls}\n"
                        f"cdp ({len(cdp_pages)} pages): {cdp_urls}"
                    )
                finally:
                    close_session(c, sid)
        finally:
            proc.terminate()
            shutil.rmtree(data_dir, ignore_errors=True)

    def test_no_duplicate_pages_after_reconciliation(self):
        """pages list must not contain duplicate page_ids or duplicate URLs."""
        proc, cdp_url, data_dir = spawn_debug_chromium(CDP_PORT_A)
        try:
            with httpx.Client(base_url=BASE_URL, timeout=15) as c:
                r = c.post("/api/v1/sessions", json={
                    "launch_mode": "attach",
                    "cdp_url": cdp_url,
                })
                assert r.status_code == 201, r.text
                sid = r.json()["session_id"]
                try:
                    pages_r = c.get(f"/api/v1/sessions/{sid}/pages")
                    assert pages_r.status_code == 200, pages_r.text
                    pages = pages_r.json()["pages"]
                    ids = [p["page_id"] for p in pages]
                    assert len(ids) == len(set(ids)), f"Duplicate page_ids: {ids}"
                    urls = [normalize_url(p["url"]) for p in pages]
                    assert len(urls) == len(set(urls)), f"Duplicate URLs: {urls}"
                finally:
                    close_session(c, sid)
        finally:
            proc.terminate()
            shutil.rmtree(data_dir, ignore_errors=True)


class TestCdpReconciliationFallback:
    """Reconciliation graceful fallback: managed sessions must not be broken."""

    def test_managed_session_unaffected_by_reconciliation_code(self):
        """Managed (non-attach) sessions still work correctly after code change."""
        with httpx.Client(base_url=BASE_URL, timeout=15) as c:
            r = c.post("/api/v1/sessions", json={"profile": "r10c06-fallback", "headless": True})
            assert r.status_code == 201, r.text
            sid = r.json()["session_id"]
            try:
                nav_r = c.post(f"/api/v1/sessions/{sid}/navigate", json={"url": "about:blank"})
                assert nav_r.status_code == 200, nav_r.text
                pages_r = c.get(f"/api/v1/sessions/{sid}/pages")
                assert pages_r.status_code == 200, pages_r.text
                assert len(pages_r.json()["pages"]) >= 1
            finally:
                close_session(c, sid)

    def test_attach_unreachable_cdp_url_returns_http_error(self):
        """attach with unreachable cdp_url returns an HTTP error (not a daemon crash)."""
        with httpx.Client(base_url=BASE_URL, timeout=10) as c:
            r = c.post("/api/v1/sessions", json={
                "launch_mode": "attach",
                "cdp_url": "http://127.0.0.1:19399",  # nothing listening
            })
            # agentmb currently returns 500 for connectOverCDP ECONNREFUSED;
            # any 4xx/5xx is acceptable — the daemon must not crash.
            assert r.status_code >= 400, (
                f"Expected HTTP error for unreachable CDP, got {r.status_code}: {r.text}"
            )
            assert "error" in r.json(), "Error response must include 'error' field"
