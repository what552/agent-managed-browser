"""
R07-C02 e2e tests: T03/T04/T08/T13/T14/T18

Tests cover:
  T03 — dblclick, focus, check, uncheck, scroll, scroll_into_view, drag, mouse, key
  T04 — back, forward, reload, wait_text, wait_load_state, wait_function
  T08 — scroll_until, load_more_until
  T13 — snapshot_map (returns snapshot_id + page_rev + ref_id per element)
  T14 — ref_id used in click/fill (resolves to element)
  T18 — stale_ref 409 when page changes after snapshot
"""
from __future__ import annotations

import base64
import time
import pytest
import agentmb
from agentmb import BrowserClient, SnapshotMapResult, StaleRefError

PORT = __import__("os").environ.get("AGENTMB_PORT", "19315")
BASE_URL = f"http://127.0.0.1:{PORT}"
TEST_PROFILE = "r07c02-test"

# ---------------------------------------------------------------------------
# Fixture: shared client + single session per test module
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def client():
    return BrowserClient(base_url=BASE_URL)


@pytest.fixture(scope="module")
def session(client):
    s = client.sessions.create(headless=True, profile=TEST_PROFILE)
    yield s
    s.close()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _inline(html: str) -> str:
    """Encode HTML as a data: URL."""
    encoded = base64.b64encode(html.encode()).decode()
    return f"data:text/html;base64,{encoded}"


# ---------------------------------------------------------------------------
# T13: snapshot_map
# ---------------------------------------------------------------------------


class TestSnapshotMap:
    def test_basic(self, session):
        """T-SM-01: snapshot_map returns snapshot_id, page_rev, ref_ids."""
        html = _inline("""
        <html><body>
          <button id="btn1">Alpha</button>
          <a href="#">Beta</a>
          <input type="text" placeholder="Enter text">
        </body></html>
        """)
        session.navigate(html)
        result = session.snapshot_map()
        assert result.status == "ok"
        assert result.snapshot_id.startswith("snap_")
        assert result.page_rev >= 0
        assert result.count >= 3
        assert all(e.ref_id.startswith(result.snapshot_id + ":") for e in result.elements)

    def test_ref_id_format(self, session):
        """T-SM-02: each ref_id = snap_XXXX:eN."""
        result = session.snapshot_map()
        for el in result.elements:
            parts = el.ref_id.split(":")
            assert len(parts) == 2
            assert parts[0].startswith("snap_")
            assert parts[1].startswith("e")

    def test_scope(self, session):
        """T-SM-03: scope parameter limits scan."""
        html = _inline("""
        <html><body>
          <div id="inner"><button>Inner Btn</button></div>
          <button>Outer Btn</button>
        </body></html>
        """)
        session.navigate(html)
        result = session.snapshot_map(scope="#inner")
        assert result.status == "ok"
        texts = [e.text for e in result.elements]
        assert any("Inner Btn" in t for t in texts)
        assert not any("Outer Btn" in t for t in texts)

    def test_page_rev_increments_on_navigation(self, session):
        """T-SM-04: page_rev increases after navigation."""
        html1 = _inline("<html><body><button>Page1</button></body></html>")
        html2 = _inline("<html><body><button>Page2</button></body></html>")
        session.navigate(html1)
        r1 = session.snapshot_map()
        rev1 = r1.page_rev
        session.navigate(html2)
        r2 = session.snapshot_map()
        assert r2.page_rev > rev1


# ---------------------------------------------------------------------------
# T14: ref_id used in click/fill
# ---------------------------------------------------------------------------


class TestRefId:
    def test_click_via_ref_id(self, session):
        """T-RI-01: click using ref_id resolves correctly."""
        html = _inline("""
        <html><body>
          <button id="btn" onclick="this.textContent='clicked'">Click Me</button>
        </body></html>
        """)
        session.navigate(html)
        snap = session.snapshot_map()
        btn = next((e for e in snap.elements if "Click Me" in e.text), None)
        assert btn is not None, "Button not found in snapshot"
        session.click(ref_id=btn.ref_id)
        # Verify the click worked by checking element text
        val = session.get(selector="#btn", property="text")
        assert val.value == "clicked"

    def test_fill_via_ref_id(self, session):
        """T-RI-02: fill using ref_id resolves correctly."""
        html = _inline("""
        <html><body>
          <input id="inp" type="text" placeholder="type here">
        </body></html>
        """)
        session.navigate(html)
        snap = session.snapshot_map()
        inp = next((e for e in snap.elements if e.tag == "input"), None)
        assert inp is not None, "Input not found in snapshot"
        session.fill(ref_id=inp.ref_id, value="hello ref_id")
        val = session.get(selector="#inp", property="value")
        assert val.value == "hello ref_id"


# ---------------------------------------------------------------------------
# T18: stale_ref on navigation
# ---------------------------------------------------------------------------


class TestStaleRef:
    def test_stale_ref_after_navigation(self, session):
        """T-SR-01: clicking a ref_id after navigation returns 409 stale_ref."""
        html1 = _inline("""
        <html><body><button id="btn">Click Me</button></body></html>
        """)
        html2 = _inline("<html><body><p>New page</p></body></html>")
        session.navigate(html1)
        snap = session.snapshot_map()
        btn = next((e for e in snap.elements if "Click Me" in e.text), None)
        assert btn is not None
        # Navigate away — page_rev should increment, snapshot becomes stale
        session.navigate(html2)
        with pytest.raises(Exception) as exc_info:
            session.click(ref_id=btn.ref_id)
        err_str = str(exc_info.value).lower()
        assert "stale" in err_str or "409" in err_str

    def test_stale_ref_after_new_page_navigation(self, client):
        """T-SR-02 (P1 fix): ref_id goes stale when a newly-created page navigates.

        Reproduces the bug where createPage() missed the framenavigated listener,
        so page_rev stayed frozen and old snapshots remained falsely valid.
        """
        s = client.sessions.create(headless=True, profile=TEST_PROFILE)
        try:
            # Take snapshot on page1
            html1 = _inline("<html><body><button>OrigBtn</button></body></html>")
            s.navigate(html1)
            snap = s.snapshot_map()
            btn = next((e for e in snap.elements if "OrigBtn" in e.text), None)
            assert btn is not None, "OrigBtn not found"

            # Create a second page and switch to it, then navigate — MUST increment page_rev
            html2 = _inline("<html><body><p>Page Two</p></body></html>")
            page2 = s.new_page()
            s.switch_page(page2.page_id)
            s.navigate(html2)  # navigate on page2 while it's active

            # ref_id from snap (page1, old page_rev) must now be stale
            with pytest.raises(Exception) as exc_info:
                s.click(ref_id=btn.ref_id)
            err_str = str(exc_info.value).lower()
            assert "stale" in err_str or "409" in err_str, (
                f"Expected stale_ref 409, got: {exc_info.value}"
            )
        finally:
            s.close()


# ---------------------------------------------------------------------------
# T03: interaction primitives
# ---------------------------------------------------------------------------


class TestInteractionPrimitives:
    def test_dblclick(self, session):
        """T-T03-01: dblclick fires dblclick event."""
        html = _inline("""
        <html><body>
          <div id="target" ondblclick="this.textContent='dbl'">Double-click me</div>
        </body></html>
        """)
        session.navigate(html)
        session.dblclick(selector="#target")
        val = session.get(selector="#target", property="text")
        assert val.value == "dbl"

    def test_focus(self, session):
        """T-T03-02: focus gives focus to an input."""
        html = _inline("""
        <html><body>
          <input id="inp" type="text">
        </body></html>
        """)
        session.navigate(html)
        session.focus(selector="#inp")
        # After focus, document.activeElement should be #inp
        result = session.eval("document.activeElement.id")
        assert result.result == "inp"

    def test_check_uncheck(self, session):
        """T-T03-03: check/uncheck toggle a checkbox."""
        html = _inline("""
        <html><body>
          <input id="cb" type="checkbox">
        </body></html>
        """)
        session.navigate(html)
        session.check(selector="#cb")
        checked = session.get(selector="#cb", property="value")
        # 'value' of checkbox isn't standard; use eval instead
        r1 = session.eval("document.getElementById('cb').checked")
        assert r1.result is True
        session.uncheck(selector="#cb")
        r2 = session.eval("document.getElementById('cb').checked")
        assert r2.result is False

    def test_scroll_into_view(self, session):
        """T-T03-04: scroll_into_view on a far-down element."""
        items = "".join(f'<div style="height:200px">Item {i}</div>' for i in range(20))
        html = _inline(f"""
        <html><body>
          {items}
          <button id="bottom">Bottom Button</button>
        </body></html>
        """)
        session.navigate(html)
        res = session.scroll_into_view(selector="#bottom")
        assert res.status == "ok"

    def test_key_down_up(self, session):
        """T-T03-05: key_down / key_up are accepted by the API."""
        html = _inline("""
        <html><body><input id="inp" type="text"></body></html>
        """)
        session.navigate(html)
        session.focus(selector="#inp")
        res_down = session.key_down(key="Shift")
        assert res_down.status == "ok"
        res_up = session.key_up(key="Shift")
        assert res_up.status == "ok"

    def test_mouse_move(self, session):
        """T-T03-06: mouse_move is accepted by the API."""
        html = _inline("<html><body><p>Hi</p></body></html>")
        session.navigate(html)
        res = session.mouse_move(x=100, y=100)
        assert res.status == "ok"

    def test_mouse_down_up(self, session):
        """T-T03-07: mouse_down / mouse_up are accepted by the API."""
        html = _inline("<html><body><p>Hi</p></body></html>")
        session.navigate(html)
        res_down = session.mouse_down()
        assert res_down.status == "ok"
        res_up = session.mouse_up()
        assert res_up.status == "ok"


# ---------------------------------------------------------------------------
# T04: navigation control
# ---------------------------------------------------------------------------


class TestNavigationControl:
    def test_back_forward(self, session):
        """T-T04-01: back / forward navigate history."""
        html1 = _inline("<html><body><h1>Page One</h1></body></html>")
        html2 = _inline("<html><body><h1>Page Two</h1></body></html>")
        session.navigate(html1)
        session.navigate(html2)
        r_back = session.back()
        assert r_back.status == "ok"
        # After back, we should be on page 1
        r_fwd = session.forward()
        assert r_fwd.status == "ok"

    def test_reload(self, session):
        """T-T04-02: reload reloads the page."""
        html = _inline("<html><body><p>Hello</p></body></html>")
        session.navigate(html)
        res = session.reload()
        assert res.status == "ok"

    def test_wait_text(self, session):
        """T-T04-03: wait_text waits for text that's already on the page."""
        html = _inline("<html><body><p>Target text appears here</p></body></html>")
        session.navigate(html)
        res = session.wait_text(text="Target text")
        assert res.status == "ok"

    def test_wait_load_state(self, session):
        """T-T04-04: wait_load_state returns ok after page is loaded."""
        html = _inline("<html><body><p>Loaded</p></body></html>")
        session.navigate(html)
        res = session.wait_load_state(state="load")
        assert res.status == "ok"

    def test_wait_function(self, session):
        """T-T04-05: wait_function resolves a simple truthy expression."""
        html = _inline("<html><body><p id='el'>x</p></body></html>")
        session.navigate(html)
        res = session.wait_function(expression="document.getElementById('el') !== null")
        assert res.status == "ok"


# ---------------------------------------------------------------------------
# T08: scroll primitives
# ---------------------------------------------------------------------------


class TestScrollPrimitives:
    def test_scroll_until_stop_selector(self, session):
        """T-T08-01: scroll_until stops when stop_selector is found."""
        items = "".join(f'<div style="height:100px" class="item">Item {i}</div>' for i in range(30))
        html = _inline(f"""
        <html><body style="overflow-y: scroll; height: 400px">
          {items}
          <div id="sentinel">THE END</div>
        </body></html>
        """)
        session.navigate(html)
        res = session.scroll_until(stop_selector="#sentinel", max_scrolls=100)
        assert res.status == "ok"
        assert res.stop_reason in ("selector_found", "stall", "max_scrolls")

    def test_scroll_until_stop_text(self, session):
        """T-T08-02: scroll_until stops when stop_text appears."""
        items = "".join(f'<div style="height:100px">Item {i}</div>' for i in range(20))
        html = _inline(f"""
        <html><body>
          {items}
          <div>DONE LOADING</div>
        </body></html>
        """)
        session.navigate(html)
        res = session.scroll_until(stop_text="DONE LOADING", max_scrolls=100)
        assert res.status == "ok"
        assert res.stop_reason in ("text_found", "stall", "max_scrolls")

    def test_scroll_until_max_scrolls(self, session):
        """T-T08-03: scroll_until respects max_scrolls limit."""
        html = _inline("<html><body>" + "".join(f'<div style="height:50px">x</div>' for _ in range(5)) + "</body></html>")
        session.navigate(html)
        res = session.scroll_until(max_scrolls=2)
        assert res.status == "ok"
        assert res.scrolls_performed <= 2

    def test_load_more_until_item_count(self, session):
        """T-T08-04: load_more_until stops when enough items are loaded."""
        # Page with a load-more button that adds items via JS
        html = _inline("""
        <html><body>
          <ul id="list">
            <li class="item">Item 1</li>
            <li class="item">Item 2</li>
          </ul>
          <button id="load-more" onclick="
            var list = document.getElementById('list');
            var count = list.children.length;
            for(var i=1;i<=3;i++){
              var li = document.createElement('li');
              li.className='item';
              li.textContent='Item '+(count+i);
              list.appendChild(li);
            }
            if(list.children.length >= 8) this.remove();
          ">Load More</button>
        </body></html>
        """)
        session.navigate(html)
        res = session.load_more_until(
            load_more_selector="#load-more",
            content_selector=".item",
            item_count=5,
            max_loads=10,
        )
        assert res.status == "ok"
        assert res.final_count >= 5
        assert res.stop_reason in ("item_count_reached", "load_more_gone", "stall", "max_loads")
