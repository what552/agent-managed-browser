"""
R08-C01 e2e tests: T01 + T06

T01 — press/type/hover gain --element-id (and ref_id) parity with click/fill
T06 — CLI --ref-id flag: snapshot ref_ids are now actionable in click/fill/press/type/hover/get/assert/bbox
"""
from __future__ import annotations

import base64
import os
import pytest
import httpx
from agentmb import (
    BrowserClient,
    ActionResult,
    PressResult,
    TypeResult,
    HoverResult,
    BboxResult,
    GetPropertyResult,
    AssertResult,
)

PORT = os.environ.get("AGENTMB_PORT", "19315")
BASE_URL = f"http://127.0.0.1:{PORT}"
TEST_PROFILE = "r08c01-test"


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


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _page_with_input(session) -> str:
    """Navigate to a page with an input, run element-map, return element_id."""
    html = _inline("""
    <html><body>
      <input id="txt" type="text" placeholder="enter text here" />
      <button id="btn">Submit</button>
    </body></html>
    """)
    session.navigate(html)
    em = session.element_map()
    # find element_id for the input
    for el in em.elements:
        if el.tag == "input":
            return el.element_id
    pytest.fail("No input element found in element-map")


def _page_with_snapshot(session):
    """Navigate, run snapshot_map, return (ref_id for input, ref_id for button)."""
    html = _inline("""
    <html><body>
      <input id="txt" type="text" placeholder="enter text here" />
      <button id="btn">Submit</button>
    </body></html>
    """)
    session.navigate(html)
    snap = session.snapshot_map()
    input_ref = None
    button_ref = None
    for el in snap.elements:
        if el.tag == "input":
            input_ref = el.ref_id
        elif el.tag == "button":
            button_ref = el.ref_id
    assert input_ref, "No input ref_id in snapshot"
    assert button_ref, "No button ref_id in snapshot"
    return input_ref, button_ref


# ===========================================================================
# T01: press + element_id
# ===========================================================================

class TestPressElementId:
    """R08-T01: press accepts element_id"""

    def test_press_with_element_id(self, session):
        """press with element_id dispatches key to element."""
        eid = _page_with_input(session)
        # focus input first, then press via element_id
        res = session._client._post(
            f"/api/v1/sessions/{session.id}/press",
            {"element_id": eid, "key": "Tab"},
            PressResult,
        )
        assert res.status == "ok"

    def test_press_with_ref_id(self, session):
        """press with ref_id (server resolves via snapshot store)."""
        input_ref, _ = _page_with_snapshot(session)
        res = session.press(ref_id=input_ref, key="Tab")
        assert res.status == "ok"

    def test_press_with_selector_still_works(self, session):
        """press with CSS selector still works (regression)."""
        html = _inline("<html><body><input id='x' /></body></html>")
        session.navigate(html)
        res = session.press(selector="#x", key="Tab")
        assert res.status == "ok"


# ===========================================================================
# T01: type + element_id
# ===========================================================================

class TestTypeElementId:
    """R08-T01: type accepts element_id"""

    def test_type_with_element_id(self, session):
        """type with element_id fills element."""
        eid = _page_with_input(session)
        res = session.type(element_id=eid, text="hello")
        assert res.status == "ok"

    def test_type_with_ref_id(self, session):
        """type with ref_id."""
        input_ref, _ = _page_with_snapshot(session)
        res = session.type(ref_id=input_ref, text="world")
        assert res.status == "ok"

    def test_type_with_selector_still_works(self, session):
        """type with CSS selector still works (regression)."""
        html = _inline("<html><body><input id='x' /></body></html>")
        session.navigate(html)
        res = session.type(selector="#x", text="abc")
        assert res.status == "ok"


# ===========================================================================
# T01: hover + element_id
# ===========================================================================

class TestHoverElementId:
    """R08-T01: hover accepts element_id"""

    def test_hover_with_element_id(self, session):
        """hover with element_id moves pointer to element."""
        eid = _page_with_input(session)
        res = session.hover(element_id=eid)
        assert res.status == "ok"

    def test_hover_with_ref_id(self, session):
        """hover with ref_id."""
        input_ref, _ = _page_with_snapshot(session)
        res = session.hover(ref_id=input_ref)
        assert res.status == "ok"

    def test_hover_with_selector_still_works(self, session):
        """hover with CSS selector still works (regression)."""
        html = _inline("<html><body><button>Hover me</button></body></html>")
        session.navigate(html)
        res = session.hover(selector="button")
        assert res.status == "ok"


# ===========================================================================
# T06: ref_id is actionable in click/fill/get/assert/bbox
# ===========================================================================

class TestRefIdInActions:
    """R08-T06: snapshot ref_ids work for all action commands."""

    def test_click_with_ref_id(self, session):
        """click accepts ref_id."""
        _, button_ref = _page_with_snapshot(session)
        res = session.click(ref_id=button_ref)
        assert res.status == "ok"

    def test_fill_with_ref_id(self, session):
        """fill accepts ref_id."""
        input_ref, _ = _page_with_snapshot(session)
        res = session.fill(ref_id=input_ref, value="filled via ref_id")
        assert res.status == "ok"

    def test_get_with_ref_id(self, session):
        """get accepts ref_id."""
        input_ref, _ = _page_with_snapshot(session)
        res = session._client._post(
            f"/api/v1/sessions/{session.id}/get",
            {"ref_id": input_ref, "property": "value"},
            GetPropertyResult,
        )
        assert res.property == "value"

    def test_assert_with_ref_id(self, session):
        """assert accepts ref_id."""
        input_ref, _ = _page_with_snapshot(session)
        res = session._client._post(
            f"/api/v1/sessions/{session.id}/assert",
            {"ref_id": input_ref, "property": "visible", "expected": True},
            AssertResult,
        )
        assert res.passed is True

    def test_bbox_with_ref_id(self, session):
        """bbox accepts ref_id."""
        input_ref, _ = _page_with_snapshot(session)
        res = session.bbox(ref_id=input_ref)
        assert res.found is True
        assert res.width is not None and res.width > 0

    def test_stale_ref_id_returns_409(self, session):
        """Using a ref_id after navigation returns 409 stale_ref."""
        input_ref, _ = _page_with_snapshot(session)
        # navigate invalidates snapshot
        session.navigate("about:blank")
        with pytest.raises(httpx.HTTPStatusError) as exc_info:
            session.click(ref_id=input_ref)
        assert exc_info.value.response.status_code == 409
        body = exc_info.value.response.json()
        assert body.get("error") == "stale_ref"
