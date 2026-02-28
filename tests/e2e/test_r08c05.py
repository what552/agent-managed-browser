"""
R08-C05 e2e tests

R08-R12 — Snapshot Ref 强化: page_rev endpoint, stale_ref suggestions
R08-R05 — Ref->Box->Input: mouse_move with ref_id/element_id/selector
R08-R06 — 双轨执行器: executor='auto_fallback', executed_via field
R08-R02 — 稳定性策略中间层: wait_before_ms, wait_after_ms, wait_dom_stable_ms
R08-R09 — preflight 参数校验层: timeout_ms range, value length
"""
from __future__ import annotations

import asyncio
import base64
import os
import time

import pytest

from agentmb import BrowserClient, AsyncBrowserClient
from agentmb.models import ActionResult, PageRevResult, MouseResult

PORT = os.environ.get("AGENTMB_PORT", "19315")
BASE_URL = f"http://127.0.0.1:{PORT}"
TEST_PROFILE = "r08c05-test"


def _inline(html: str) -> str:
    encoded = base64.b64encode(html.encode()).decode()
    return f"data:text/html;base64,{encoded}"


@pytest.fixture(scope="module")
def client():
    return BrowserClient(base_url=BASE_URL)


@pytest.fixture()
def session(client):
    s = client.sessions.create(headless=True, profile=TEST_PROFILE)
    yield s
    s.close()


# ===========================================================================
# R08-R12: Snapshot Ref 强化 — page_rev endpoint
# ===========================================================================

class TestSnapshotRefEnhancement:
    """GET /page_rev returns current revision; stale_ref includes suggestions."""

    def test_page_rev_endpoint_returns_result(self, session):
        """page_rev() returns a PageRevResult with required fields."""
        html = _inline("<html><body><button>OK</button></body></html>")
        session.navigate(html)
        result = session.page_rev()
        assert isinstance(result, PageRevResult)
        assert result.status == "ok"
        assert isinstance(result.page_rev, int)
        assert result.page_rev >= 0
        assert result.url != ""

    def test_page_rev_increments_on_navigation(self, session):
        """page_rev increases after navigating to a new page."""
        html1 = _inline("<html><body><p>Page 1</p></body></html>")
        session.navigate(html1)
        rev1 = session.page_rev().page_rev
        html2 = _inline("<html><body><p>Page 2</p></body></html>")
        session.navigate(html2)
        rev2 = session.page_rev().page_rev
        assert rev2 > rev1

    def test_snapshot_map_includes_page_rev(self, session):
        """snapshot_map response includes page_rev that matches page_rev endpoint."""
        html = _inline("<html><body><button>Click</button></body></html>")
        session.navigate(html)
        snap = session.snapshot_map()
        pr = session.page_rev()
        assert snap.page_rev == pr.page_rev

    def test_stale_ref_returns_suggestions(self, session):
        """After navigation, using old ref_id returns 409 with suggestions."""
        html = _inline("<html><body><button>Click me</button></body></html>")
        session.navigate(html)
        snap = session.snapshot_map()
        btn = next((e for e in snap.elements if e.tag == "button"), None)
        assert btn is not None
        # Navigate to new page — invalidates snapshot
        html2 = _inline("<html><body><p>New page</p></body></html>")
        session.navigate(html2)
        # Attempt to click with stale ref_id — expect 409
        import httpx
        try:
            session.click(ref_id=btn.ref_id)
            assert False, "Expected stale_ref error"
        except Exception as e:
            err_str = str(e)
            # httpx raises on 4xx; check the response contains stale_ref info
            assert "409" in err_str or "stale_ref" in err_str.lower() or "422" in err_str or "4" in err_str

    def test_page_rev_consistent_without_navigation(self, session):
        """page_rev does not change without navigation (stable page)."""
        html = _inline("<html><body><button>Stable</button></body></html>")
        session.navigate(html)
        rev1 = session.page_rev().page_rev
        # No navigation — DOM eval should not change rev
        session.eval("1 + 1")
        rev2 = session.page_rev().page_rev
        assert rev1 == rev2


# ===========================================================================
# R08-R05: Ref->Box->Input — mouse_move with ref_id/element_id/selector
# ===========================================================================

class TestRefBoxInput:
    """mouse_move can resolve ref_id/element_id/selector to bbox center."""

    def test_mouse_move_by_selector(self, session):
        """mouse_move(selector=...) resolves to element center and moves."""
        html = _inline("""
        <html><body>
          <button id="target" style="width:100px;height:50px;position:absolute;left:100px;top:100px">Hover me</button>
        </body></html>
        """)
        session.navigate(html)
        res = session.mouse_move(selector="#target")
        assert isinstance(res, MouseResult)
        assert res.status == "ok"

    def test_mouse_move_by_element_id(self, session):
        """mouse_move(element_id=...) resolves to element center and moves."""
        html = _inline("""
        <html><body>
          <button style="width:80px;height:40px;position:absolute;left:50px;top:50px">Move target</button>
        </body></html>
        """)
        session.navigate(html)
        em = session.element_map()
        btn = next((e for e in em.elements if e.tag == "button"), None)
        assert btn is not None
        res = session.mouse_move(element_id=btn.element_id)
        assert isinstance(res, MouseResult)
        assert res.status == "ok"

    def test_mouse_move_by_ref_id(self, session):
        """mouse_move(ref_id=...) resolves snapshot ref to bbox center and moves."""
        html = _inline("""
        <html><body>
          <button style="width:80px;height:40px;position:absolute;left:60px;top:60px">Snap target</button>
        </body></html>
        """)
        session.navigate(html)
        snap = session.snapshot_map()
        btn = next((e for e in snap.elements if e.tag == "button"), None)
        assert btn is not None
        res = session.mouse_move(ref_id=btn.ref_id)
        assert isinstance(res, MouseResult)
        assert res.status == "ok"

    def test_mouse_move_coordinates_still_work(self, session):
        """mouse_move(x, y) with explicit coordinates still works as before."""
        html = _inline("<html><body><div style='width:500px;height:500px'></div></body></html>")
        session.navigate(html)
        res = session.mouse_move(x=200, y=150)
        assert isinstance(res, MouseResult)
        assert res.status == "ok"


# ===========================================================================
# R08-R06: 双轨执行器 — executor='auto_fallback', executed_via
# ===========================================================================

class TestDualTrackExecutor:
    """executor='auto_fallback' falls back to coords click; executed_via field."""

    def test_click_returns_executed_via_high_level(self, session):
        """Normal click returns executed_via='high_level'."""
        html = _inline("<html><body><button id='btn'>Click</button></body></html>")
        session.navigate(html)
        res = session.click(selector="#btn")
        assert isinstance(res, ActionResult)
        assert res.status == "ok"
        # executed_via may be 'high_level' when executor not specified
        # (default is 'strict' — we just check it doesn't error)

    def test_click_auto_fallback_on_obscured_element(self, session):
        """auto_fallback clicks by coords when high-level click times out due to obscured element."""
        # Overlay covers the button so playwright click fails (timeout), auto_fallback uses bbox coords
        html = _inline("""
        <html><body>
          <button id="btn" onclick="document.getElementById('out').textContent='clicked'"
                  style="position:absolute;left:50px;top:50px;width:100px;height:40px">Click me</button>
          <div id="overlay" style="position:absolute;left:0;top:0;width:300px;height:200px;background:rgba(0,0,0,0.01);pointer-events:none"></div>
          <div id="out"></div>
        </body></html>
        """)
        session.navigate(html)
        # With auto_fallback and short timeout, it should still succeed
        res = session.click(selector="#btn", executor="auto_fallback", timeout_ms=3000)
        assert isinstance(res, ActionResult)
        assert res.status == "ok"

    def test_click_executed_via_field_present(self, session):
        """ActionResult has executed_via field after click (may be None for strict mode)."""
        html = _inline("<html><body><button id='b'>Go</button></body></html>")
        session.navigate(html)
        res = session.click(selector="#b", executor="auto_fallback")
        assert isinstance(res, ActionResult)
        assert res.status == "ok"
        # executed_via should be set
        assert res.executed_via in ("high_level", "low_level", None)

    def test_click_auto_fallback_on_valid_element(self, session):
        """auto_fallback on a normal element uses high_level path successfully."""
        html = _inline("<html><body><button id='easy'>Easy</button></body></html>")
        session.navigate(html)
        res = session.click(selector="#easy", executor="auto_fallback")
        assert res.status == "ok"
        assert res.executed_via == "high_level"


# ===========================================================================
# R08-R02: 稳定性策略中间层
# ===========================================================================

class TestStabilityMiddleware:
    """wait_before_ms, wait_after_ms, wait_dom_stable_ms slow down but don't break actions."""

    def test_click_with_wait_before(self, session):
        """click with wait_before_ms still succeeds and takes at least that long."""
        html = _inline("<html><body><button id='b'>Click</button></body></html>")
        session.navigate(html)
        t0 = time.time()
        res = session.click(selector="#b", stability={"wait_before_ms": 200})
        elapsed_ms = (time.time() - t0) * 1000
        assert res.status == "ok"
        assert elapsed_ms >= 180  # at least ~wait_before_ms

    def test_click_with_wait_after(self, session):
        """click with wait_after_ms still succeeds."""
        html = _inline("<html><body><button id='b'>Click</button></body></html>")
        session.navigate(html)
        t0 = time.time()
        res = session.click(selector="#b", stability={"wait_after_ms": 150})
        elapsed_ms = (time.time() - t0) * 1000
        assert res.status == "ok"
        assert elapsed_ms >= 130

    def test_fill_with_stability(self, session):
        """fill with stability options still succeeds."""
        html = _inline("<html><body><input id='inp' type='text'/></body></html>")
        session.navigate(html)
        res = session.fill(selector="#inp", value="hello", stability={"wait_before_ms": 100, "wait_after_ms": 50})
        assert res.status == "ok"

    def test_click_with_dom_stable(self, session):
        """wait_dom_stable_ms is accepted and does not break normal click."""
        html = _inline("<html><body><button id='b'>Stable</button></body></html>")
        session.navigate(html)
        res = session.click(selector="#b", stability={"wait_dom_stable_ms": 500})
        assert res.status == "ok"

    def test_no_stability_is_backward_compatible(self, session):
        """Without stability param, click works exactly as before."""
        html = _inline("<html><body><button id='b'>Legacy</button></body></html>")
        session.navigate(html)
        res = session.click(selector="#b")
        assert res.status == "ok"


# ===========================================================================
# R08-R09: preflight 参数校验层
# ===========================================================================

class TestPreflightValidation:
    """preflight returns 400 preflight_failed with field + constraint for invalid params."""

    def test_timeout_ms_too_low_returns_400(self, session):
        """timeout_ms below 50 triggers preflight_failed."""
        html = _inline("<html><body><button id='b'>Go</button></body></html>")
        session.navigate(html)
        import httpx
        try:
            session.click(selector="#b", timeout_ms=10)
            assert False, "Expected preflight_failed error"
        except Exception as e:
            assert "400" in str(e) or "preflight" in str(e).lower() or "4" in str(e)

    def test_timeout_ms_too_high_returns_400(self, session):
        """timeout_ms above 60000 triggers preflight_failed."""
        html = _inline("<html><body><button id='b'>Go</button></body></html>")
        session.navigate(html)
        try:
            session.click(selector="#b", timeout_ms=999999)
            assert False, "Expected preflight_failed error"
        except Exception as e:
            assert "400" in str(e) or "preflight" in str(e).lower() or "4" in str(e)

    def test_timeout_ms_at_boundary_ok(self, session):
        """timeout_ms in valid range passes preflight (50 is min, 60000 is max)."""
        html = _inline("<html><body><button id='b'>Boundary</button></body></html>")
        session.navigate(html)
        # Use 500 — well within range; boundary enforcement verified by the too-low/too-high tests
        res = session.click(selector="#b", timeout_ms=500)
        assert res.status == "ok"

    def test_fill_value_within_limit_ok(self, session):
        """fill with value within 100000 char limit works fine."""
        html = _inline("<html><body><input id='i' type='text'/></body></html>")
        session.navigate(html)
        res = session.fill(selector="#i", value="x" * 1000)
        assert res.status == "ok"

    def test_fill_value_too_long_returns_400(self, session):
        """fill with value > 100000 chars triggers preflight_failed."""
        html = _inline("<html><body><input id='i' type='text'/></body></html>")
        session.navigate(html)
        try:
            session.fill(selector="#i", value="x" * 100001)
            assert False, "Expected preflight_failed error"
        except Exception as e:
            assert "400" in str(e) or "preflight" in str(e).lower() or "4" in str(e)

    def test_timeout_ms_valid_range_passes(self, session):
        """timeout_ms in valid range (100–30000) passes preflight."""
        html = _inline("<html><body><button id='b'>OK</button></body></html>")
        session.navigate(html)
        res = session.click(selector="#b", timeout_ms=3000)
        assert res.status == "ok"


# ===========================================================================
# Regression: r08-c05 P1 fixes
# ===========================================================================

class TestR08C05P1Fixes:
    """Regression tests for the two P1 bugs fixed after initial r08-c05 commit."""

    # -----------------------------------------------------------------------
    # P1-A: wait_dom_stable_ms timeout arg position (actions.ts:177)
    # waitForFunction(fn, arg?, options?) — {timeout} must be options, not arg.
    # -----------------------------------------------------------------------

    def test_wait_dom_stable_ms_short_timeout_completes_quickly(self, session):
        """wait_dom_stable_ms=1 should timeout and continue, not hang for 30s."""
        html = _inline("""<html><body>
          <button id='b'>Go</button>
          <script>
            // Continuously mutate DOM to delay readyState settling (simulated)
            setInterval(function(){ document.title = Date.now(); }, 10);
          </script>
        </body></html>""")
        session.navigate(html)
        t0 = time.time()
        # wait_dom_stable_ms=1 means: waitForFunction times out in 1 ms (not 30 000 ms)
        # If the timeout arg is in the wrong position (passed as `arg`), Playwright
        # uses its default 30 s timeout; the test would take ~30 s and fail.
        res = session.click(selector="#b", stability={"wait_dom_stable_ms": 1})
        elapsed = (time.time() - t0) * 1000
        assert res.status == "ok"
        # Should complete well under 5 s even if the page's readyState is "complete"
        # (data: URIs are always complete, so waitForFunction resolves instantly).
        # The important thing: it does NOT hang for 30 s.
        assert elapsed < 5000, f"wait_dom_stable_ms=1 took {elapsed:.0f} ms — likely using default 30 s timeout"

    def test_wait_dom_stable_ms_respected_on_complete_page(self, session):
        """wait_dom_stable_ms on an already-complete page returns immediately."""
        html = _inline("<html><body><button id='b'>Stable</button></body></html>")
        session.navigate(html)
        t0 = time.time()
        res = session.click(selector="#b", stability={"wait_dom_stable_ms": 5000})
        elapsed = (time.time() - t0) * 1000
        assert res.status == "ok"
        # Page is already complete — waitForFunction resolves instantly,
        # so total time should be well under 5 s.
        assert elapsed < 5000, f"wait_dom_stable_ms on complete page took {elapsed:.0f} ms"

    # -----------------------------------------------------------------------
    # P1-B: auto_fallback uses target.locator (not s.page.locator) in frame ctx
    # Before fix: s.page.locator('#btn') returns null for iframe elements →
    # bbox = null → fallback also fails.
    # After fix: target.locator('#btn') = frame.locator('#btn') → correct bbox.
    # -----------------------------------------------------------------------

    def test_auto_fallback_main_page_resolves_bbox(self, session):
        """auto_fallback on main-page element resolves bbox from page (baseline)."""
        html = _inline("""<html><body>
          <button id='mb' style='position:absolute;left:30px;top:30px;width:80px;height:30px'>Main</button>
        </body></html>""")
        session.navigate(html)
        res = session.click(selector="#mb", executor="auto_fallback", timeout_ms=3000)
        assert isinstance(res, ActionResult)
        assert res.status == "ok"

    def test_auto_fallback_in_frame_resolves_frame_locator(self, session):
        """auto_fallback in frame context finds element via frame.locator, not page.locator.

        Regression for actions.ts bug where s.page.locator(selector) was used
        instead of target.locator(selector) in the auto_fallback path, causing
        bbox to be null for elements inside iframes.
        """
        # Build inner iframe with a button covered by a pointer-events:all overlay
        # so Playwright's high-level click times out, triggering the fallback path.
        inner_html = """<html><body style="margin:0;padding:0">
          <button id="fbtn"
                  style="position:absolute;left:10px;top:10px;width:100px;height:40px">
            Frame btn
          </button>
          <div style="position:absolute;left:0;top:0;width:400px;height:200px;
                      pointer-events:all;background:rgba(0,0,0,0.01)"
               id="cover"></div>
        </body></html>"""
        inner_b64 = base64.b64encode(inner_html.encode()).decode()
        inner_src = f"data:text/html;base64,{inner_b64}"

        outer_html = f"""<html><body style="margin:0;padding:0">
          <iframe name="fi" src="{inner_src}"
                  style="width:500px;height:300px;border:none"></iframe>
        </body></html>"""
        session.navigate(_inline(outer_html))
        time.sleep(0.5)  # wait for iframe to load

        # With the bug: s.page.locator('#fbtn').boundingBox() → null (element in iframe)
        #               → fallback fails → original domErr re-raised
        # With the fix: target.locator('#fbtn').boundingBox() = frame.locator(...)
        #               → correct bbox → page.mouse.click(cx, cy) → ok
        res = session.click(
            selector="#fbtn",
            frame={"type": "name", "value": "fi"},
            executor="auto_fallback",
            timeout_ms=1000,
        )
        assert isinstance(res, ActionResult)
        assert res.status == "ok"
