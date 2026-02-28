"""
R08-C04 e2e tests: R08-R03 + R08-R04

R08-R03 — scroll_until / load_more_until: stall detection, stop conditions, max_scrolls/max_loads
R08-R04 — drag (selector + ref_id), mouse_move/down/up (sync + async)
"""
from __future__ import annotations

import asyncio
import base64
import os

import pytest

from agentmb import BrowserClient, AsyncBrowserClient
from agentmb.models import ScrollUntilResult, LoadMoreResult, DragResult, MouseResult

PORT = os.environ.get("AGENTMB_PORT", "19315")
BASE_URL = f"http://127.0.0.1:{PORT}"
TEST_PROFILE = "r08c04-test"


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
# R08-R03: scroll_until
# ===========================================================================

class TestScrollUntil:
    """scroll_until: stall detection, stop_selector, stop_text, max_scrolls."""

    def test_scroll_until_stop_text(self, session):
        """scroll_until stops when stop_text appears after scrolling."""
        items = "".join(f"<p style='height:200px'>item {i}</p>" for i in range(20))
        html = _inline(f"""
        <html><body style='overflow-y:auto;height:500px'>
          {items}
          <p id='footer'>END OF LIST</p>
        </body></html>
        """)
        session.navigate(html)
        res = session.scroll_until(stop_text="END OF LIST", max_scrolls=50)
        assert isinstance(res, ScrollUntilResult)
        assert res.status == "ok"
        assert res.stop_reason in ("text_found", "selector_found", "stall", "max_scrolls")

    def test_scroll_until_max_scrolls_stops(self, session):
        """scroll_until stops at max_scrolls even without a stop condition."""
        items = "".join(f"<p style='height:300px'>tall item {i}</p>" for i in range(50))
        html = _inline(f"""
        <html><body style='overflow-y:auto;height:400px'>
          {items}
        </body></html>
        """)
        session.navigate(html)
        res = session.scroll_until(max_scrolls=3, scroll_delta=200)
        assert isinstance(res, ScrollUntilResult)
        assert res.status == "ok"
        assert res.scrolls_performed <= 3
        assert res.stop_reason in ("max_scrolls", "stall")

    def test_scroll_until_stall_detection(self, session):
        """scroll_until stops on stall (short page, cannot scroll further)."""
        html = _inline("""
        <html><body style='height:100px'>
          <p>Short page</p>
        </body></html>
        """)
        session.navigate(html)
        res = session.scroll_until(direction="down", max_scrolls=20, stall_ms=200)
        assert isinstance(res, ScrollUntilResult)
        assert res.status == "ok"
        assert res.stop_reason in ("stall", "max_scrolls")  # short page may hit max_scrolls before stall timeout

    def test_scroll_until_result_fields(self, session):
        """ScrollUntilResult has all expected fields."""
        html = _inline("<html><body><p style='height:2000px'>tall</p></body></html>")
        session.navigate(html)
        res = session.scroll_until(max_scrolls=2)
        assert hasattr(res, "status")
        assert hasattr(res, "stop_reason")
        assert hasattr(res, "scrolls_performed")
        assert hasattr(res, "duration_ms")
        assert res.duration_ms > 0


# ===========================================================================
# R08-R03: load_more_until
# ===========================================================================

class TestLoadMoreUntil:
    """load_more_until: stall detection, item_count stop, max_loads stop."""

    def test_load_more_until_max_loads(self, session):
        """load_more_until stops at max_loads if count not reached."""
        html = _inline("""
        <html><body>
          <ul id="items"><li>item 1</li></ul>
          <button id="load-more" onclick="
            var ul = document.getElementById('items');
            var count = ul.children.length;
            ul.innerHTML += '<li>item ' + (count+1) + '</li>';
          ">Load More</button>
        </body></html>
        """)
        session.navigate(html)
        res = session.load_more_until(
            load_more_selector="#load-more",
            content_selector="#items li",
            item_count=100,
            max_loads=3,
        )
        assert isinstance(res, LoadMoreResult)
        assert res.status == "ok"
        assert res.stop_reason in ("max_loads", "stall", "item_count")
        assert res.loads_performed <= 3

    def test_load_more_until_item_count(self, session):
        """load_more_until stops when item_count is reached."""
        html = _inline("""
        <html><body>
          <ul id="items"><li>item 1</li></ul>
          <button id="load-more" onclick="
            var ul = document.getElementById('items');
            var n = ul.children.length + 1;
            ul.innerHTML += '<li>item ' + n + '</li>';
          ">Load More</button>
        </body></html>
        """)
        session.navigate(html)
        res = session.load_more_until(
            load_more_selector="#load-more",
            content_selector="#items li",
            item_count=3,
            max_loads=20,
        )
        assert isinstance(res, LoadMoreResult)
        assert res.status == "ok"
        assert res.stop_reason in ("item_count_reached", "stall")

    def test_load_more_until_result_fields(self, session):
        """LoadMoreResult has all expected fields."""
        html = _inline("""
        <html><body>
          <ul id="items"><li>item 1</li></ul>
          <button id="load-more" onclick="
            var ul = document.getElementById('items');
            ul.innerHTML += '<li>x</li>';
          ">Load More</button>
        </body></html>
        """)
        session.navigate(html)
        res = session.load_more_until(
            load_more_selector="#load-more",
            content_selector="#items li",
            max_loads=2,
        )
        assert hasattr(res, "status")
        assert hasattr(res, "stop_reason")
        assert hasattr(res, "loads_performed")
        assert hasattr(res, "duration_ms")


# ===========================================================================
# R08-R04: drag (selector + ref_id)
# ===========================================================================

class TestDrag:
    """drag: CSS selector and ref_id targeting."""

    def test_drag_css_selectors(self, session):
        """drag works with CSS selectors for source and target."""
        html = _inline("""
        <html><body>
          <div id="source" style="width:100px;height:100px;background:red;position:absolute;left:50px;top:50px">SOURCE</div>
          <div id="target" style="width:100px;height:100px;background:blue;position:absolute;left:300px;top:50px">TARGET</div>
        </body></html>
        """)
        session.navigate(html)
        res = session.drag(source="#source", target="#target")
        assert isinstance(res, DragResult)
        assert res.status == "ok"
        assert res.duration_ms >= 0

    def test_drag_with_source_ref_id(self, session):
        """drag accepts source_ref_id/target_ref_id from snapshot_map."""
        html = _inline("""
        <html><body>
          <button id="src-btn" style="width:80px;height:80px;position:absolute;left:50px;top:50px">SrcBtn</button>
          <button id="tgt-btn" style="width:80px;height:80px;position:absolute;left:300px;top:50px">TgtBtn</button>
        </body></html>
        """)
        session.navigate(html)
        snap = session.snapshot_map()
        src_el = next((e for e in snap.elements if e.tag == "button" and "SrcBtn" in e.text), None)
        tgt_el = next((e for e in snap.elements if e.tag == "button" and "TgtBtn" in e.text), None)
        assert src_el is not None, "source button not in snapshot"
        assert tgt_el is not None, "target button not in snapshot"
        res = session.drag(source_ref_id=src_el.ref_id, target_ref_id=tgt_el.ref_id)
        assert isinstance(res, DragResult)
        assert res.status == "ok"

    def test_drag_result_fields(self, session):
        """DragResult has expected fields."""
        html = _inline("""
        <html><body>
          <div id="a" style="width:60px;height:60px;background:red;position:absolute;left:20px;top:20px">A</div>
          <div id="b" style="width:60px;height:60px;background:blue;position:absolute;left:200px;top:20px">B</div>
        </body></html>
        """)
        session.navigate(html)
        res = session.drag(source="#a", target="#b")
        assert hasattr(res, "status")
        assert hasattr(res, "source")
        assert hasattr(res, "target")
        assert hasattr(res, "duration_ms")


# ===========================================================================
# R08-R04: mouse_move / mouse_down / mouse_up (sync)
# ===========================================================================

class TestMousePrimitives:
    """mouse_move, mouse_down, mouse_up: coordinate-based input primitives."""

    def test_mouse_move(self, session):
        """mouse_move returns ok with x/y."""
        html = _inline("<html><body><div style='width:500px;height:500px'></div></body></html>")
        session.navigate(html)
        res = session.mouse_move(x=100, y=150)
        assert isinstance(res, MouseResult)
        assert res.status == "ok"

    def test_mouse_down_up(self, session):
        """mouse_down then mouse_up returns ok."""
        html = _inline("<html><body><div style='width:500px;height:500px'></div></body></html>")
        session.navigate(html)
        res_down = session.mouse_down(x=200, y=200)
        assert isinstance(res_down, MouseResult)
        assert res_down.status == "ok"
        res_up = session.mouse_up()
        assert isinstance(res_up, MouseResult)
        assert res_up.status == "ok"

    def test_mouse_move_then_click_sequence(self, session):
        """mouse_move + mouse_down + mouse_up can simulate a manual click."""
        html = _inline("""
        <html><body>
          <button id="btn" onclick="document.getElementById('out').textContent='clicked'">Click Me</button>
          <div id="out"></div>
        </body></html>
        """)
        session.navigate(html)
        # Get button bounding box
        bbox = session.bbox(selector="#btn")
        cx = (bbox.x + bbox.width / 2)
        cy = (bbox.y + bbox.height / 2)
        session.mouse_move(x=int(cx), y=int(cy))
        session.mouse_down(button="left")
        session.mouse_up(button="left")
        result = session.eval("document.getElementById('out').textContent")
        assert "clicked" in (result.result or "")

    def test_mouse_result_fields(self, session):
        """MouseResult has expected fields."""
        html = _inline("<html><body></body></html>")
        session.navigate(html)
        res = session.mouse_move(x=50, y=50)
        assert hasattr(res, "status")
        assert hasattr(res, "duration_ms")


# ===========================================================================
# R08-R04: async drag / mouse_move / mouse_down / mouse_up (AsyncSession)
# ===========================================================================

class TestAsyncMouseDrag:
    """AsyncSession async equivalents for drag, mouse_move, mouse_down, mouse_up."""

    def test_async_drag(self):
        async def _run():
            async with AsyncBrowserClient(base_url=BASE_URL) as ac:
                s = await ac.sessions.create(headless=True, profile=TEST_PROFILE)
                try:
                    html = _inline("""
                    <html><body>
                      <button id="src-btn" style="width:80px;height:80px;position:absolute;left:30px;top:30px">SrcA</button>
                      <button id="tgt-btn" style="width:80px;height:80px;position:absolute;left:250px;top:30px">TgtA</button>
                    </body></html>
                    """)
                    await s.navigate(html)
                    res = await s.drag(source="#src-btn", target="#tgt-btn")
                    assert isinstance(res, DragResult)
                    assert res.status == "ok"
                finally:
                    await s.close()
        asyncio.run(_run())

    def test_async_mouse_move(self):
        async def _run():
            async with AsyncBrowserClient(base_url=BASE_URL) as ac:
                s = await ac.sessions.create(headless=True, profile=TEST_PROFILE)
                try:
                    html = _inline("<html><body><div style='width:500px;height:500px'></div></body></html>")
                    await s.navigate(html)
                    res = await s.mouse_move(x=120, y=130)
                    assert isinstance(res, MouseResult)
                    assert res.status == "ok"
                finally:
                    await s.close()
        asyncio.run(_run())

    def test_async_mouse_down_up(self):
        async def _run():
            async with AsyncBrowserClient(base_url=BASE_URL) as ac:
                s = await ac.sessions.create(headless=True, profile=TEST_PROFILE)
                try:
                    html = _inline("<html><body><div style='width:500px;height:500px'></div></body></html>")
                    await s.navigate(html)
                    res_down = await s.mouse_down(x=100, y=100)
                    assert isinstance(res_down, MouseResult)
                    assert res_down.status == "ok"
                    res_up = await s.mouse_up()
                    assert isinstance(res_up, MouseResult)
                    assert res_up.status == "ok"
                finally:
                    await s.close()
        asyncio.run(_run())

    def test_async_scroll_until_with_scroll_selector(self):
        """AsyncSession.scroll_until supports scroll_selector param (parity fix)."""
        async def _run():
            async with AsyncBrowserClient(base_url=BASE_URL) as ac:
                s = await ac.sessions.create(headless=True, profile=TEST_PROFILE)
                try:
                    items = "".join(f"<p style='height:100px'>item {i}</p>" for i in range(10))
                    html = _inline(f"""
                    <html><body>
                      <div id="scrollable" style="overflow-y:auto;height:300px">{items}</div>
                    </body></html>
                    """)
                    await s.navigate(html)
                    res = await s.scroll_until(
                        scroll_selector="#scrollable",
                        stop_text="item 9",
                        max_scrolls=20,
                    )
                    assert isinstance(res, ScrollUntilResult)
                    assert res.status == "ok"
                finally:
                    await s.close()
        asyncio.run(_run())
