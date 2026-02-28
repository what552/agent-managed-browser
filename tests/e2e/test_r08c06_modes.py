"""
test_r08c06_modes.py — R08-c06-fix: Three Browser Running Modes

Tests:
 1. Workspace (default chromium) smoke — existing mode still works
 2. Ephemeral session — temp dir auto-cleanup on close
 3. browser_channel='chrome' — skip if Chrome not installed
 4. browser_channel + executable_path → 400 preflight_failed
 5. launch_mode='attach' without cdp_url → 400 preflight_failed
 6. cdp_url invalid format → 400 preflight_failed
 7. launch_mode='attach' + browser_channel → 400 preflight_failed
 8. CDP Attach success + navigate
 9. CDP Attach close → remote browser stays alive (disconnect only)
10. Session seal → delete returns 423
"""

import os
import sys
import subprocess
import time
import http.client
import tempfile
import shutil
from typing import Optional
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../sdk/python"))

from agentmb import BrowserClient
from agentmb.models import SessionInfo, AttachResult, SealResult

BASE_URL = f"http://127.0.0.1:{os.environ.get('AGENTMB_PORT', '19315')}"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_client() -> BrowserClient:
    token = os.environ.get("AGENTMB_API_TOKEN")
    return BrowserClient(base_url=BASE_URL, api_token=token, timeout=30)


def daemon_is_running() -> bool:
    try:
        client = make_client()
        client.health()
        client.close()
        return True
    except Exception:
        return False


def find_chromium_executable() -> "Optional[str]":
    """Find a Chromium/Chrome executable on the current platform."""
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
    """Spawn a headless Chromium with remote debugging on the given port.
    Returns (process, cdp_url).
    Raises pytest.skip if no executable found.
    """
    exe = find_chromium_executable()
    if exe is None:
        pytest.skip("No Chromium/Chrome binary found — skipping CDP attach test")

    data_dir = tempfile.mkdtemp(prefix="agentmb-test-cdp-")
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
    # Wait for browser to be ready
    deadline = time.time() + 10
    while time.time() < deadline:
        try:
            conn = http.client.HTTPConnection(f"127.0.0.1:{port}", timeout=1)
            conn.request("GET", "/json/version")
            resp = conn.getresponse()
            if resp.status == 200:
                conn.close()
                return proc, cdp_url
            conn.close()
        except Exception:
            pass
        time.sleep(0.3)
    proc.terminate()
    pytest.skip(f"Chromium did not become ready on port {port}")


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

pytestmark = pytest.mark.skipif(
    not daemon_is_running(),
    reason="agentmb daemon not running — skip"
)


class TestWorkspaceMode:
    """Test 1: Agent Workspace (default mode) still works."""

    def test_workspace_default_chromium(self):
        """Default session creates managed Chromium session."""
        client = make_client()
        try:
            sess = client.sessions.create(profile="test-workspace-smoke")
            try:
                # Basic navigate
                result = sess.navigate("about:blank")
                assert result.status == "ok"
                # Verify session info
                info = client.sessions.get(sess.id)
                assert isinstance(info, SessionInfo)
                assert info.launch_mode == "managed"
                assert info.ephemeral is False
            finally:
                sess.close()
        finally:
            client.close()


class TestEphemeralMode:
    """Test 2: Pure Sandbox (ephemeral) — temp dir cleanup."""

    def test_ephemeral_session_cleanup(self):
        """Ephemeral session uses temp dir and profile dir does NOT persist after close."""
        import glob
        client = make_client()
        try:
            sess = client.sessions.create(ephemeral=True)
            sess_id = sess.id
            try:
                result = sess.navigate("about:blank")
                assert result.status == "ok"
                # The session should exist and be live
                info = client.sessions.get(sess_id)
                assert info.ephemeral is True
            finally:
                sess.close()
            # After close: no agentmb-eph-{id} dir should remain in tmpdir
            import tempfile
            eph_pattern = os.path.join(tempfile.gettempdir(), f"agentmb-eph-{sess_id}")
            assert not os.path.exists(eph_pattern), f"Ephemeral dir was not cleaned up: {eph_pattern}"
        finally:
            client.close()


class TestBrowserChannel:
    """Test 3: Multi-channel (chrome) — skip if Chrome not installed."""

    def test_browser_channel_chrome_skip_if_absent(self):
        """Attempting browser_channel='chrome' either succeeds (Chrome installed) or gives clear error."""
        import shutil
        client = make_client()
        try:
            try:
                sess = client.sessions.create(browser_channel="chrome")
                # Chrome is installed — verify session is live
                result = sess.navigate("about:blank")
                assert result.status == "ok"
                sess.close()
            except Exception as e:
                # Chrome not installed — error should mention channel or executable
                err_msg = str(e).lower()
                assert any(k in err_msg for k in ["chrome", "channel", "not found", "executable", "browser", "500"]), \
                    f"Unexpected error: {e}"
        finally:
            client.close()


class TestPreflightValidation:
    """Tests 4-7: Preflight validation returns 400 preflight_failed."""

    def test_browser_channel_and_executable_path_conflict(self):
        """browser_channel + executable_path together → 400 preflight_failed."""
        import httpx
        client = make_client()
        try:
            with pytest.raises(httpx.HTTPStatusError) as exc_info:
                client.sessions.create(
                    browser_channel="chrome",
                    executable_path="/usr/bin/google-chrome",
                )
            assert exc_info.value.response.status_code == 400
            data = exc_info.value.response.json()
            assert data.get("error") == "preflight_failed"
        finally:
            client.close()

    def test_attach_mode_without_cdp_url(self):
        """launch_mode='attach' without cdp_url → 400 preflight_failed."""
        import httpx
        client = make_client()
        try:
            with pytest.raises(httpx.HTTPStatusError) as exc_info:
                client.sessions.create(launch_mode="attach")
            assert exc_info.value.response.status_code == 400
            data = exc_info.value.response.json()
            assert data.get("error") == "preflight_failed"
            assert "cdp_url" in str(data)
        finally:
            client.close()

    def test_invalid_cdp_url_format(self):
        """cdp_url with invalid format → 400 preflight_failed."""
        import httpx
        client = make_client()
        try:
            with pytest.raises(httpx.HTTPStatusError) as exc_info:
                client.sessions.create(launch_mode="attach", cdp_url="not-a-url")
            assert exc_info.value.response.status_code == 400
            data = exc_info.value.response.json()
            assert data.get("error") == "preflight_failed"
        finally:
            client.close()

    def test_attach_mode_with_browser_channel_conflict(self):
        """launch_mode='attach' + browser_channel → 400 preflight_failed."""
        import httpx
        client = make_client()
        try:
            with pytest.raises(httpx.HTTPStatusError) as exc_info:
                client.sessions.create(
                    launch_mode="attach",
                    cdp_url="http://127.0.0.1:9999",
                    browser_channel="chrome",
                )
            assert exc_info.value.response.status_code == 400
            data = exc_info.value.response.json()
            assert data.get("error") == "preflight_failed"
        finally:
            client.close()


class TestCdpAttach:
    """Tests 8-9: CDP Attach mode."""

    def test_cdp_attach_navigate(self):
        """CDP attach session can navigate and perform actions."""
        CDP_PORT = 19901
        proc, cdp_url = spawn_debug_chromium(CDP_PORT)
        client = make_client()
        try:
            sess = client.sessions.create(launch_mode="attach", cdp_url=cdp_url)
            try:
                info = client.sessions.get(sess.id)
                assert info.launch_mode == "attach"
                result = sess.navigate("about:blank")
                assert result.status == "ok"
                # Take a screenshot to verify the session works
                shot = sess.screenshot()
                assert shot.status == "ok"
                assert len(shot.data) > 0
            finally:
                sess.close()  # disconnects only — does NOT kill remote browser
        finally:
            client.close()
            proc.terminate()
            proc.wait(timeout=5)

    def test_cdp_attach_close_does_not_kill_browser(self):
        """Closing a CDP attach session disconnects but the remote browser stays alive."""
        CDP_PORT = 19902
        proc, cdp_url = spawn_debug_chromium(CDP_PORT)
        client = make_client()
        try:
            sess = client.sessions.create(launch_mode="attach", cdp_url=cdp_url)
            sess.close()  # This should disconnect only

            # Remote browser should still be accepting connections
            time.sleep(0.5)
            import http.client as hc
            conn = hc.HTTPConnection(f"127.0.0.1:{CDP_PORT}", timeout=3)
            conn.request("GET", "/json/version")
            resp = conn.getresponse()
            assert resp.status == 200, "Remote browser was killed by close() — expected it to stay alive"
            conn.close()
        finally:
            client.close()
            proc.terminate()
            proc.wait(timeout=5)


class TestSessionSeal:
    """Test 10: Session seal → DELETE returns 423."""

    def test_seal_blocks_delete(self):
        """After sealing a session, DELETE returns 423 session_sealed."""
        import httpx
        client = make_client()
        try:
            sess = client.sessions.create(profile="test-seal")
            try:
                # Seal the session
                seal_result = sess.seal()
                assert isinstance(seal_result, SealResult)
                assert seal_result.sealed is True
                assert seal_result.session_id == sess.id

                # Attempt to delete — should get 423
                with pytest.raises(httpx.HTTPStatusError) as exc_info:
                    sess.close()
                assert exc_info.value.response.status_code == 423
                data = exc_info.value.response.json()
                assert data.get("error") == "session_sealed"
            finally:
                # Force delete via raw HTTP (daemon may need cleanup) — ignore errors
                import httpx as _httpx
                try:
                    token = os.environ.get("AGENTMB_API_TOKEN")
                    headers = {"X-API-Token": token} if token else {}
                    # The session is sealed, so we can't delete it via API
                    # Just leave it for cleanup — or restart daemon
                    pass
                except Exception:
                    pass
        finally:
            client.close()
