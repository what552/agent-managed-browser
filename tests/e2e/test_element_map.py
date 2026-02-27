"""
E2E tests for r07-c01: element_map, get, assert, wait_page_stable.

Tests cover:
  T-EM-01: element_map returns labeled elements with element_id
  T-EM-02: click via element_id (backward-compat: selector still works)
  T-EM-03: fill via element_id
  T-EM-04: dynamic list — element_map after DOM mutation reflects new items
  T-EM-05: lazy-load scenario — wait_page_stable then element_map
  T-EM-06: overlay detection — wait_page_stable with overlay_selector
  T-EM-07: get text / innerText property via element_id
  T-EM-08: assert visible/enabled/checked properties
  T-EM-09: get count property

Requires: daemon running on localhost:19315
Run: pytest tests/e2e/test_element_map.py -v
"""

from __future__ import annotations

import os
import sys
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../sdk/python"))

from agentmb import (
    BrowserClient,
    ElementMapResult,
    GetPropertyResult,
    AssertResult,
    StableResult,
)

BASE_URL = f"http://127.0.0.1:{os.environ.get('AGENTMB_PORT', '19315')}"
TEST_PROFILE = "e2e-element-map"

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def client():
    c = BrowserClient(base_url=BASE_URL, operator="e2e-element-map")
    yield c


@pytest.fixture
def session(client):
    s = client.sessions.create(headless=True, profile=TEST_PROFILE)
    yield s
    try:
        s.close()
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def navigate_to_html(session, html: str, title: str = "test") -> None:
    """Navigate the session to an inline data: URI page."""
    import urllib.parse
    encoded = urllib.parse.quote(html)
    session.navigate(f"data:text/html,{encoded}")


# ---------------------------------------------------------------------------
# T-EM-01: element_map returns labeled elements
# ---------------------------------------------------------------------------

def test_element_map_basic(session):
    """element_map scans page and returns elements with stable element_id values."""
    html = """
    <html><body>
      <button id="btn1">Click Me</button>
      <input type="text" placeholder="Enter name" />
      <a href="#anchor">Link</a>
    </body></html>
    """
    navigate_to_html(session, html)

    result = session.element_map()
    assert isinstance(result, ElementMapResult)
    assert result.status == "ok"
    assert result.count >= 3
    assert len(result.elements) == result.count

    # All elements must have valid element_id strings (e.g. 'e1', 'e2')
    ids = [e.element_id for e in result.elements]
    assert all(eid.startswith("e") for eid in ids), f"Unexpected IDs: {ids}"
    assert len(set(ids)) == len(ids), "element_ids must be unique"

    # Verify specific elements are present
    tags = [e.tag.lower() for e in result.elements]
    assert "button" in tags
    assert "input" in tags
    assert "a" in tags


# ---------------------------------------------------------------------------
# T-EM-02: click via element_id (backward-compat: selector still works)
# ---------------------------------------------------------------------------

def test_click_via_element_id(session):
    """Click an element using element_id; selector backward-compat also works."""
    html = """
    <html><body>
      <button id="btn" onclick="this.textContent='clicked'">Click Me</button>
    </body></html>
    """
    navigate_to_html(session, html)

    result = session.element_map()
    btn = next((e for e in result.elements if e.tag.lower() == "button"), None)
    assert btn is not None, "Button element not found in element_map"

    # Click via element_id
    session.click(element_id=btn.element_id)

    # Verify the click happened — get text property
    text_result = session.get("text", element_id=btn.element_id)
    assert text_result.value == "clicked"

    # Backward compat: selector still works
    navigate_to_html(session, html)
    session.click(selector="#btn")
    text_result2 = session.get("text", selector="#btn")
    assert text_result2.value == "clicked"


# ---------------------------------------------------------------------------
# T-EM-03: fill via element_id
# ---------------------------------------------------------------------------

def test_fill_via_element_id(session):
    """Fill an input element using element_id."""
    html = """
    <html><body>
      <input type="text" id="name" placeholder="Enter name" />
    </body></html>
    """
    navigate_to_html(session, html)

    result = session.element_map()
    inp = next((e for e in result.elements if e.tag.lower() == "input"), None)
    assert inp is not None, "Input element not found"

    session.fill(element_id=inp.element_id, value="hello world")

    value_result = session.get("value", element_id=inp.element_id)
    assert value_result.value == "hello world"


# ---------------------------------------------------------------------------
# T-EM-04: dynamic list — element_map after DOM mutation
# ---------------------------------------------------------------------------

def test_dynamic_list_element_map(session):
    """element_map after a DOM mutation reflects newly added interactive items.

    Note: element_map captures interactive elements (buttons, links, inputs etc.)
    so we use <button> items, not plain <li> text nodes.
    """
    html = """
    <html><body>
      <div id="list">
        <button class="item">Item 1</button>
      </div>
      <button id="add" onclick="
        var btn = document.createElement('button');
        btn.className = 'item';
        btn.textContent = 'Item 2';
        document.getElementById('list').appendChild(btn);
      ">Add Item</button>
    </body></html>
    """
    navigate_to_html(session, html)

    # Initial scan — should see 1 .item button + the add button
    result1 = session.element_map()
    items_before = [e for e in result1.elements if e.tag.lower() == "button" and e.text.startswith("Item")]
    assert len(items_before) == 1, f"Expected 1 item button before add, got {len(items_before)}"

    # Click add button
    session.click(selector="#add")

    # Re-scan — new button should appear
    result2 = session.element_map()
    items_after = [e for e in result2.elements if e.tag.lower() == "button" and e.text.startswith("Item")]
    assert len(items_after) == 2, f"Expected 2 item buttons after add, got {len(items_after)}"


# ---------------------------------------------------------------------------
# T-EM-05: lazy-load scenario — wait_page_stable then element_map
# ---------------------------------------------------------------------------

def test_lazy_load_wait_stable(session):
    """wait_page_stable waits for network+DOM quiet before element_map."""
    html = """
    <html><body>
      <div id="content">Loading...</div>
      <script>
        setTimeout(function() {
          document.getElementById('content').textContent = 'Loaded!';
        }, 200);
      </script>
    </body></html>
    """
    navigate_to_html(session, html)

    # wait_page_stable should let the timeout fire and DOM settle
    stable_result = session.wait_page_stable(timeout_ms=5000, dom_stable_ms=400)
    assert isinstance(stable_result, StableResult)
    assert stable_result.status == "ok"

    # Now get the content — should be 'Loaded!' not 'Loading...'
    text_result = session.get("text", selector="#content")
    assert text_result.value == "Loaded!", f"Got: {text_result.value!r}"


# ---------------------------------------------------------------------------
# T-EM-06: overlay detection — wait_page_stable with overlay_selector
# ---------------------------------------------------------------------------

def test_overlay_detection(session):
    """wait_page_stable with overlay_selector waits for overlay to disappear."""
    html = """
    <html><body>
      <div id="overlay" style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5)">
        Loading overlay
      </div>
      <div id="content">Main content</div>
      <script>
        setTimeout(function() {
          var el = document.getElementById('overlay');
          if (el) el.parentNode.removeChild(el);
        }, 300);
      </script>
    </body></html>
    """
    navigate_to_html(session, html)

    stable_result = session.wait_page_stable(
        timeout_ms=5000,
        dom_stable_ms=200,
        overlay_selector="#overlay",
    )
    assert stable_result.status == "ok"

    # Overlay should be gone
    count_result = session.get("count", selector="#overlay")
    assert count_result.value == 0


# ---------------------------------------------------------------------------
# T-EM-07: get text / innerText property via element_id
# ---------------------------------------------------------------------------

def test_get_text_property(session):
    """get() reads text content of an element by element_id or selector.

    Note: element_map captures interactive elements, so we use an <a> link
    (which IS scanned) for the element_id path. The selector path works on any
    element, so we also test get('html') via a plain selector.
    """
    html = """
    <html><body>
      <a id="link" href="#">Hello World</a>
      <div id="para">Hello <strong>World</strong></div>
    </body></html>
    """
    navigate_to_html(session, html)

    # element_id path: use the <a> which element_map captures
    result = session.element_map()
    link = next((e for e in result.elements if e.tag.lower() == "a"), None)
    assert link is not None, "Link element not found in element_map"

    text_result = session.get("text", element_id=link.element_id)
    assert isinstance(text_result, GetPropertyResult)
    assert text_result.status == "ok"
    assert "Hello" in str(text_result.value)

    # selector path: get html property from a non-interactive div
    html_result = session.get("html", selector="#para")
    assert isinstance(html_result, GetPropertyResult)
    assert "<strong>" in str(html_result.value)


# ---------------------------------------------------------------------------
# T-EM-08: assert visible/enabled/checked properties
# ---------------------------------------------------------------------------

def test_assert_state_properties(session):
    """assert_state() checks visible/enabled/checked and returns passed/actual."""
    html = """
    <html><body>
      <button id="btn">Visible</button>
      <button id="disabled-btn" disabled>Disabled</button>
      <input type="checkbox" id="chk" checked />
      <input type="checkbox" id="unchk" />
    </body></html>
    """
    navigate_to_html(session, html)

    # visible=true for visible button
    vis = session.assert_state("visible", selector="#btn", expected=True)
    assert isinstance(vis, AssertResult)
    assert vis.passed is True
    assert vis.actual is True

    # enabled=false for disabled button
    enb = session.assert_state("enabled", selector="#disabled-btn", expected=False)
    assert enb.passed is True
    assert enb.actual is False

    # checked=true for checked checkbox
    chk = session.assert_state("checked", selector="#chk", expected=True)
    assert chk.passed is True
    assert chk.actual is True

    # checked=false for unchecked checkbox — should pass
    unchk = session.assert_state("checked", selector="#unchk", expected=False)
    assert unchk.passed is True
    assert unchk.actual is False


# ---------------------------------------------------------------------------
# T-EM-09: get count property
# ---------------------------------------------------------------------------

def test_get_count_property(session):
    """get('count', selector) returns the number of matching elements."""
    html = """
    <html><body>
      <ul>
        <li class="item">A</li>
        <li class="item">B</li>
        <li class="item">C</li>
      </ul>
    </body></html>
    """
    navigate_to_html(session, html)

    count_result = session.get("count", selector=".item")
    assert isinstance(count_result, GetPropertyResult)
    assert count_result.status == "ok"
    assert count_result.value == 3
