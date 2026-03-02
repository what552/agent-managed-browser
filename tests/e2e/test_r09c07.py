"""R09-C07 — Hardening: symlink guard, navigate timeout, memory leak, SDK version.

P0a: /utils/ls via symlink inside allow_dir → 403 (realpath escapes sandbox).
P0b: navigate with timeout_ms param returns error within that window; no cascade.
P0c: delay_ms > 60000 is silently capped; daemon stays healthy.
P1a: closePage removes entry from pages map — no accumulation after cycles.
P1b: SDK VersionMismatchError class exists and carries sdk/daemon version attrs.
"""
import os
import sys
import time
import tempfile
import pytest
import requests

BASE = f"http://127.0.0.1:{os.environ.get('AGENTMB_PORT', '19315')}"
REQUEST_TIMEOUT_S = 180

# Ensure local SDK takes priority over any globally installed version
_SDK_PATH = os.path.join(os.path.dirname(__file__), "../../sdk/python")
if os.path.isdir(_SDK_PATH) and _SDK_PATH not in sys.path:
    sys.path.insert(0, os.path.abspath(_SDK_PATH))


def api(method: str, path: str, **kwargs):
    return getattr(requests, method)(f"{BASE}{path}", timeout=REQUEST_TIMEOUT_S, **kwargs)


def new_session(profile: str = "r09c07-default", **extra) -> str:
    body = {"profile": profile, **extra}
    r = api("post", "/api/v1/sessions", json=body)
    assert r.status_code == 201, f"session create failed: {r.text}"
    return r.json()["session_id"]


def rm_session(sid: str) -> None:
    api("delete", f"/api/v1/sessions/{sid}")


# ---------------------------------------------------------------------------
# P0a — Symlink traversal guard
# ---------------------------------------------------------------------------

class TestSymlinkGuard:

    def test_symlink_within_allow_dir_is_denied(self):
        """A symlink inside allow_dir pointing outside → 403 (realpath escapes sandbox)."""
        import shutil
        with tempfile.TemporaryDirectory() as allowed:
            outside_dir = tempfile.mkdtemp()
            try:
                link_path = os.path.join(allowed, "escape_link")
                os.symlink(outside_dir, link_path)

                sid = new_session("r09c07-symlink", allow_dirs=[allowed])
                try:
                    r = api("post", "/api/v1/utils/ls", json={
                        "session_id": sid,
                        "path": link_path,
                    })
                    # realpath resolves the symlink to outside_dir → not in allow_dirs → 403
                    assert r.status_code == 403, (
                        f"Expected 403 for symlink traversal, got {r.status_code}: {r.text}"
                    )
                finally:
                    rm_session(sid)
            finally:
                shutil.rmtree(outside_dir, ignore_errors=True)

    def test_real_path_inside_allow_dir_still_works(self):
        """A regular sub-directory inside allow_dir → 200 (non-symlink path unaffected)."""
        with tempfile.TemporaryDirectory() as allowed:
            subdir = os.path.join(allowed, "subdir")
            os.makedirs(subdir)
            with open(os.path.join(subdir, "file.txt"), "w") as f:
                f.write("ok")

            sid = new_session("r09c07-realpath-ok", allow_dirs=[allowed])
            try:
                r = api("post", "/api/v1/utils/ls", json={
                    "session_id": sid,
                    "path": subdir,
                })
                assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
                names = [e["name"] for e in r.json()["entries"]]
                assert "file.txt" in names
            finally:
                rm_session(sid)


# ---------------------------------------------------------------------------
# P0b — navigate timeout_ms parameter (no daemon cascade crash)
# ---------------------------------------------------------------------------

class TestNavigateTimeout:

    def test_navigate_with_short_timeout_returns_error_cleanly(self):
        """navigate with timeout_ms=500 times out cleanly; daemon stays healthy."""
        sid = new_session("r09c07-nav-timeout")
        try:
            # Add a catch-all route mock with delay > timeout_ms
            r_route = api("post", f"/api/v1/sessions/{sid}/route", json={
                "pattern": "**/*",
                "mock": {"status": 200, "body": "<html></html>", "delay_ms": 5000},
            })
            assert r_route.status_code in (200, 201), f"route add failed: {r_route.text}"

            # Navigate with very short timeout — should return error within ~1 s
            t0 = time.time()
            r_nav = api("post", f"/api/v1/sessions/{sid}/navigate", json={
                "url": "https://example.com/",
                "timeout_ms": 500,
            })
            elapsed = time.time() - t0
            # Must NOT return 503 (daemon crash)
            assert r_nav.status_code != 503, (
                f"Daemon soft-crashed (503). Cascade failure. Response: {r_nav.text}"
            )
            assert elapsed < 10, f"Took too long ({elapsed:.1f}s), expected ~0.5s timeout"
        finally:
            rm_session(sid)

    def test_daemon_healthy_after_navigate_timeout(self):
        """After a navigate timeout, the daemon still accepts new session creation."""
        sid = new_session("r09c07-post-crash-check")
        try:
            api("post", f"/api/v1/sessions/{sid}/route", json={
                "pattern": "**/*",
                "mock": {"status": 200, "body": "<html></html>", "delay_ms": 5000},
            })
            api("post", f"/api/v1/sessions/{sid}/navigate", json={
                "url": "https://example.com/",
                "timeout_ms": 200,
            })
        finally:
            rm_session(sid)

        r = api("get", "/health")
        assert r.status_code == 200, f"Daemon unhealthy after timeout: {r.text}"

        sid2 = new_session("r09c07-recover")
        try:
            assert sid2.startswith("sess_")
        finally:
            rm_session(sid2)

    def test_navigate_timeout_ms_preflight_rejects_out_of_range(self):
        """timeout_ms outside [0, 60000] → 400 preflight error."""
        sid = new_session("r09c07-nav-preflight")
        try:
            r = api("post", f"/api/v1/sessions/{sid}/navigate", json={
                "url": "https://example.com/",
                "timeout_ms": 99999,   # exceeds max 60000
            })
            assert r.status_code == 400, (
                f"Expected 400 preflight, got {r.status_code}: {r.text}"
            )
        finally:
            rm_session(sid)


# ---------------------------------------------------------------------------
# P0c — delay_ms cap at 60000
# ---------------------------------------------------------------------------

class TestDelayMsCap:

    def test_extreme_delay_ms_does_not_crash_daemon(self):
        """delay_ms=999999 is silently capped; daemon stays healthy after navigate timeout."""
        sid = new_session("r09c07-delay-cap")
        try:
            r_route = api("post", f"/api/v1/sessions/{sid}/route", json={
                "pattern": "**/*",
                "mock": {"status": 200, "body": "<html><body>ok</body></html>", "delay_ms": 999999},
            })
            assert r_route.status_code in (200, 201), f"route add failed: {r_route.text}"

            # Navigate with 1 s timeout — will timeout, daemon must not crash
            r_nav = api("post", f"/api/v1/sessions/{sid}/navigate", json={
                "url": "https://example.com/",
                "timeout_ms": 1000,
            })
            assert r_nav.status_code != 503, f"Daemon crashed with extreme delay_ms: {r_nav.text}"

            r_health = api("get", "/health")
            assert r_health.status_code == 200
        finally:
            rm_session(sid)


# ---------------------------------------------------------------------------
# P1a — closePage cleans pages map (no memory accumulation)
# ---------------------------------------------------------------------------

class TestPageCloseMemoryLeak:

    def test_closed_pages_removed_from_list(self):
        """After creating and closing 10 pages, only 1 page (initial) remains."""
        sid = new_session("r09c07-page-leak")
        try:
            initial_pages = api("get", f"/api/v1/sessions/{sid}/pages").json()["pages"]
            assert len(initial_pages) == 1, f"Expected 1 initial page, got {len(initial_pages)}"

            created = []
            for _ in range(10):
                r = api("post", f"/api/v1/sessions/{sid}/pages", json={})
                assert r.status_code == 201, f"Failed to create page: {r.text}"
                created.append(r.json()["page_id"])

            for pid in created:
                r = api("delete", f"/api/v1/sessions/{sid}/pages/{pid}")
                assert r.status_code == 204, f"Failed to close page {pid}: {r.text}"

            final_pages = api("get", f"/api/v1/sessions/{sid}/pages").json()["pages"]
            assert len(final_pages) == 1, (
                f"Expected 1 page after closing 10, got {len(final_pages)}: {final_pages}"
            )
        finally:
            rm_session(sid)

    def test_rapid_page_cycle_no_accumulation(self):
        """20 create+close cycles — pages list must stay at 1 (no ghost entries)."""
        sid = new_session("r09c07-rapid-cycle")
        try:
            for i in range(20):
                r_new = api("post", f"/api/v1/sessions/{sid}/pages", json={})
                assert r_new.status_code == 201, f"cycle {i}: create failed: {r_new.text}"
                pid = r_new.json()["page_id"]
                r_close = api("delete", f"/api/v1/sessions/{sid}/pages/{pid}")
                assert r_close.status_code == 204, f"cycle {i}: close failed: {r_close.text}"

            pages = api("get", f"/api/v1/sessions/{sid}/pages").json()["pages"]
            assert len(pages) == 1, (
                f"After 20 create+close cycles expected 1 page, got {len(pages)}: {pages}"
            )
        finally:
            rm_session(sid)


# ---------------------------------------------------------------------------
# P1b — SDK VersionMismatchError (loaded from local sdk/python path)
# ---------------------------------------------------------------------------

class TestSdkVersionCheck:

    def test_version_mismatch_error_importable(self):
        """VersionMismatchError is importable from local SDK and carries correct attrs."""
        from agentmb.client import VersionMismatchError
        err = VersionMismatchError("0.3.2", "0.3.1")
        assert err.sdk_version == "0.3.2"
        assert err.daemon_version == "0.3.1"
        assert "0.3.2" in str(err)
        assert "0.3.1" in str(err)
        assert isinstance(err, RuntimeError)

    def test_check_daemon_version_passes_on_match(self):
        """check_daemon_version() returns True when daemon == SDK version."""
        from agentmb import BrowserClient
        port = os.environ.get("AGENTMB_PORT", "19315")
        client = BrowserClient(base_url=f"http://127.0.0.1:{port}")
        try:
            result = client.check_daemon_version(strict=True)
            assert result is True
        finally:
            client.close()

    def test_check_daemon_version_strict_false_warns_on_mismatch(self):
        """check_daemon_version(strict=False) warns and returns False on version mismatch."""
        import warnings
        from agentmb import BrowserClient
        from agentmb.client import VersionMismatchError
        from agentmb.models import DaemonStatus

        port = os.environ.get("AGENTMB_PORT", "19315")
        client = BrowserClient(base_url=f"http://127.0.0.1:{port}")
        try:
            original_health = client.health

            def fake_health():
                return DaemonStatus(status="ok", version="0.0.0", uptime_s=0, sessions_active=0)

            client.health = fake_health  # type: ignore[method-assign]
            with warnings.catch_warnings(record=True) as w:
                warnings.simplefilter("always")
                result = client.check_daemon_version(strict=False)
                assert result is False
                assert any("mismatch" in str(x.message).lower() for x in w)
        finally:
            client.health = original_health  # type: ignore[method-assign]
            client.close()
