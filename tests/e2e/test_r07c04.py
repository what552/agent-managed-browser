"""
R07-C04 e2e tests: T19/T20/T21/T22/T23/T24/T25

Tests cover:
  T19 — click_at / wheel / insert_text (coordinate-based input primitives)
  T20 — bbox (selector/element_id → bounding box)
  T21 — dual-track click (DOM fallback → coordinate fallback via fallback_x/y)
  T22 — dialog observability (auto-dismiss + ring buffer)
  T23 — clipboard read/write (Clipboard API)
  T24 — viewport emulation (setViewportSize)
  T25 — network conditions (CDP throttle / offline)
"""
from __future__ import annotations

import base64
import os
import time
import pytest
import httpx
from agentmb import (
    BrowserClient,
    ClickAtResult,
    WheelAtResult,
    InsertTextResult,
    BboxResult,
    ClipboardWriteResult,
    ClipboardReadResult,
    ViewportResult,
    NetworkConditionsResult,
    DialogListResult,
)

PORT = os.environ.get("AGENTMB_PORT", "19315")
BASE_URL = f"http://127.0.0.1:{PORT}"
TEST_PROFILE = "r07c04-test"


def _inline(html: str) -> str:
    encoded = base64.b64encode(html.encode()).decode()
    return f"data:text/html;base64,{encoded}"


@pytest.fixture(scope="module")
def client():
    return BrowserClient(base_url=BASE_URL)


@pytest.fixture(scope="module")
def session(client):
    s = client.sessions.create(headless=True, profile=TEST_PROFILE)
    yield s
    s.close()


# ---------------------------------------------------------------------------
# T19: Coordinate-based input primitives
# ---------------------------------------------------------------------------


class TestCoordinateInput:
    """T-CI-*: click_at / wheel / insert_text"""

    def test_click_at_returns_ok(self, session):
        """T-CI-01: click_at(x, y) returns status=ok with coordinates."""
        html = _inline("<html><body style='margin:0'><div style='width:200px;height:200px;background:blue'></div></body></html>")
        session.navigate(html)
        result = session.click_at(100, 100)
        assert isinstance(result, ClickAtResult)
        assert result.status == "ok"
        assert result.x == 100
        assert result.y == 100
        assert result.duration_ms >= 0

    def test_click_at_with_button(self, session):
        """T-CI-02: click_at accepts button and click_count params."""
        result = session.click_at(50, 50, button="right", click_count=1)
        assert result.status == "ok"

    def test_wheel_returns_ok(self, session):
        """T-CI-03: wheel(dx, dy) returns status=ok with deltas."""
        html = _inline("""
        <html><body style='height:2000px;margin:0'>
          <div style='height:2000px;background:linear-gradient(blue,red)'></div>
        </body></html>
        """)
        session.navigate(html)
        result = session.wheel(dy=300)
        assert isinstance(result, WheelAtResult)
        assert result.status == "ok"
        assert result.dy == 300
        assert result.duration_ms >= 0

    def test_insert_text_returns_ok(self, session):
        """T-CI-04: insert_text injects text into focused input."""
        html = _inline("""
        <html><body>
          <input id='inp' type='text' autofocus />
        </body></html>
        """)
        session.navigate(html)
        # Focus the input first
        session.click(selector="#inp")
        # Use plain ASCII to avoid JS UTF-16 vs Python UTF-32 length discrepancy
        result = session.insert_text("Hello world")
        assert isinstance(result, InsertTextResult)
        assert result.status == "ok"
        assert result.length == len("Hello world")
        assert result.duration_ms >= 0

    def test_insert_text_value_appears(self, session):
        """T-CI-05: text inserted via insert_text appears in input value."""
        html = _inline("""
        <html><body>
          <input id='inp2' type='text' />
        </body></html>
        """)
        session.navigate(html)
        session.fill(selector="#inp2", value="")  # clear, ensure focused
        session.click(selector="#inp2")
        session.insert_text("agentmb")
        val = session.eval("document.getElementById('inp2').value")
        assert val.result == "agentmb"


# ---------------------------------------------------------------------------
# T20: Bounding box retrieval
# ---------------------------------------------------------------------------


class TestBbox:
    """T-BB-*: bbox endpoint (selector, element_id)"""

    def test_bbox_by_selector(self, session):
        """T-BB-01: bbox returns found=True with coordinates for visible element."""
        html = _inline("""
        <html><body style='margin:0;padding:0'>
          <div id='box' style='position:absolute;left:10px;top:20px;width:100px;height:50px;background:green'></div>
        </body></html>
        """)
        session.navigate(html)
        result = session.bbox(selector="#box")
        assert isinstance(result, BboxResult)
        assert result.status == "ok"
        assert result.found is True
        assert result.width == 100
        assert result.height == 50
        assert result.center_x == result.x + 50
        assert result.center_y == result.y + 25
        assert result.duration_ms >= 0

    def test_bbox_not_found(self, session):
        """T-BB-02: bbox returns found=False for non-existent element."""
        result = session.bbox(selector="#nonexistent-element-xyz")
        assert result.found is False
        assert result.x == 0
        assert result.y == 0

    def test_bbox_by_element_id(self, session):
        """T-BB-03: bbox accepts element_id from element_map."""
        html = _inline("""
        <html><body style='margin:0;padding:0'>
          <button id='btn' style='width:80px;height:30px'>Click</button>
        </body></html>
        """)
        session.navigate(html)
        emap = session.element_map()
        btn_elem = next((e for e in emap.elements if e.tag == "button"), None)
        if btn_elem is not None:
            result = session.bbox(element_id=btn_elem.element_id)
            assert result.found is True
            assert result.width > 0
            assert result.height > 0

    def test_bbox_missing_params_raises(self, session):
        """T-BB-04: bbox with no params raises ValueError."""
        with pytest.raises(ValueError):
            session.bbox()


# ---------------------------------------------------------------------------
# T21: Dual-track click (DOM + coordinate fallback)
# ---------------------------------------------------------------------------


class TestDualTrackClick:
    """T-DT-*: click with fallback_x/y"""

    def test_dual_track_dom_success(self, session):
        """T-DT-01: click succeeds via DOM track (no fallback needed)."""
        html = _inline("""
        <html><body>
          <button id='btn'>OK</button>
        </body></html>
        """)
        session.navigate(html)
        # Standard click — should use DOM track
        result = session._client._post(
            f"/api/v1/sessions/{session.id}/click",
            {"selector": "#btn", "fallback_x": 50, "fallback_y": 50},
            dict,
        )
        assert result["status"] == "ok"
        # track may be 'dom' or absent (dom is default)

    def test_dual_track_coord_fallback(self, session):
        """T-DT-02: click uses coordinate fallback when selector fails."""
        html = _inline("""
        <html><body style='margin:0'>
          <button style='position:absolute;left:50px;top:50px;width:100px;height:40px'>Target</button>
        </body></html>
        """)
        session.navigate(html)
        # Use a non-existent selector with fallback coords
        result = session._client._post(
            f"/api/v1/sessions/{session.id}/click",
            {"selector": "#does-not-exist", "fallback_x": 100, "fallback_y": 70, "timeout_ms": 500},
            dict,
        )
        # Should succeed via coordinate fallback
        assert result.get("status") == "ok"
        assert result.get("track") == "coords"


# ---------------------------------------------------------------------------
# T22: Dialog observability
# ---------------------------------------------------------------------------


class TestDialogs:
    """T-DG-*: auto-dismissed dialogs ring buffer"""

    def test_dialogs_empty_initially(self, session):
        """T-DG-01: dialogs() returns empty list before any dialog triggered."""
        html = _inline("<html><body><p>no dialogs</p></body></html>")
        session.navigate(html)
        session.clear_dialogs()
        result = session.dialogs()
        assert isinstance(result, DialogListResult)
        assert result.session_id == session.id
        assert result.count == 0

    def test_dialog_auto_dismissed(self, session):
        """T-DG-02: alert() is auto-dismissed and recorded in history."""
        html = _inline("""
        <html><body>
          <button id='btn' onclick='alert("test dialog")'>Alert</button>
        </body></html>
        """)
        session.navigate(html)
        session.clear_dialogs()
        # Trigger alert via eval (fire and forget — dialog is auto-dismissed)
        try:
            session.eval("window.alert('hello from test')")
        except Exception:
            pass  # may throw if dialog handling interferes with eval
        time.sleep(0.3)  # allow dialog observer to fire
        result = session.dialogs()
        assert result.count >= 1
        entry = result.entries[0]
        assert entry.type == "alert"
        assert entry.action == "dismissed"
        assert entry.message == "hello from test"

    def test_dialogs_tail(self, session):
        """T-DG-03: dialogs(tail=N) returns at most N entries."""
        result = session.dialogs(tail=1)
        assert isinstance(result, DialogListResult)
        assert result.count <= 1

    def test_clear_dialogs(self, session):
        """T-DG-04: clear_dialogs() empties the history."""
        session.clear_dialogs()
        result = session.dialogs()
        assert result.count == 0


# ---------------------------------------------------------------------------
# T23: Clipboard read/write
# ---------------------------------------------------------------------------


class TestClipboard:
    """T-CB-*: clipboard write/read"""

    def test_clipboard_write_returns_ok(self, session):
        """T-CB-01: clipboard_write returns status=ok with length."""
        html = _inline("<html><body><p>clipboard test</p></body></html>")
        session.navigate(html)
        result = session.clipboard_write("agentmb clipboard test")
        assert isinstance(result, ClipboardWriteResult)
        assert result.status == "ok"
        assert result.length == len("agentmb clipboard test")
        assert result.duration_ms >= 0

    def test_clipboard_read_returns_text(self, session):
        """T-CB-02: clipboard_read returns previously written text (may fail in restricted headless envs)."""
        import httpx as _httpx
        text = "agentmb-r07c04"
        session.clipboard_write(text)
        try:
            result = session.clipboard_read()
            assert isinstance(result, ClipboardReadResult)
            assert result.status == "ok"
            assert result.text == text
            assert result.duration_ms >= 0
        except _httpx.HTTPStatusError as exc:
            if exc.response.status_code == 422:
                pytest.skip("clipboard-read not available in this headless environment (navigator.clipboard.readText() requires permission)")
            raise


# ---------------------------------------------------------------------------
# T24: Viewport emulation
# ---------------------------------------------------------------------------


class TestViewport:
    """T-VP-*: viewport resize"""

    def test_set_viewport(self, session):
        """T-VP-01: set_viewport resizes to requested dimensions."""
        html = _inline("<html><body><p>viewport test</p></body></html>")
        session.navigate(html)
        result = session.set_viewport(1280, 720)
        assert isinstance(result, ViewportResult)
        assert result.status == "ok"
        assert result.width == 1280
        assert result.height == 720
        assert result.duration_ms >= 0

    def test_set_viewport_small(self, session):
        """T-VP-02: set_viewport accepts small mobile-like dimensions."""
        result = session.set_viewport(375, 667)
        assert result.status == "ok"
        assert result.width == 375
        assert result.height == 667

    def test_set_viewport_missing_params(self):
        """T-VP-03: viewport endpoint returns 400 if width/height missing."""
        resp = httpx.put(f"{BASE_URL}/api/v1/sessions/nonexistent/viewport", json={})
        assert resp.status_code in (400, 404)


# ---------------------------------------------------------------------------
# T25: Network conditions (CDP)
# ---------------------------------------------------------------------------


class TestNetworkConditions:
    """T-NC-*: network throttling / offline simulation"""

    def test_set_offline(self, session):
        """T-NC-01: set_network_conditions(offline=True) returns correct fields."""
        html = _inline("<html><body><p>network test</p></body></html>")
        session.navigate(html)
        result = session.set_network_conditions(offline=True)
        assert isinstance(result, NetworkConditionsResult)
        assert result.status == "ok"
        assert result.offline is True

    def test_reset_network_conditions(self, session):
        """T-NC-02: reset_network_conditions() restores normal network."""
        session.reset_network_conditions()
        # After reset, navigation should work (we're on data: URL so always works)
        nav = session.navigate(_inline("<html><body>back online</body></html>"))
        assert nav.status == "ok"

    def test_set_throttle(self, session):
        """T-NC-03: set_network_conditions with latency/bandwidth returns ok."""
        result = session.set_network_conditions(
            offline=False, latency_ms=100, download_kbps=1000, upload_kbps=500
        )
        assert result.status == "ok"
        assert result.offline is False
        assert result.latency_ms == 100
        session.reset_network_conditions()
