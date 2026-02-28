"""
R08-C03 e2e tests: T03 + T05

T03 — element-map/snapshot-map synthesize label for icon-only interactive elements
      Priority chain: aria-label > title > aria-labelledby > svg-title > text > placeholder
T05 — snapshot-map --include-unlabeled: icon-only elements with no accessible text get
      fallback [tag @ x,y] label; label_source = 'fallback'
"""
from __future__ import annotations

import base64
import os

import pytest

from agentmb import BrowserClient
from agentmb.models import ElementInfo, SnapshotElement

PORT = os.environ.get("AGENTMB_PORT", "19315")
BASE_URL = f"http://127.0.0.1:{PORT}"
TEST_PROFILE = "r08c03-test"


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
# T03: synthesized label — element-map
# ===========================================================================

class TestSynthesizedLabelElementMap:
    """R08-T03: element-map returns label + label_source for each element."""

    def test_label_from_aria_label(self, session):
        """Button with aria-label gets label from aria-label (highest priority)."""
        html = _inline("""
        <html><body>
          <button aria-label="Close dialog" title="ignored title">
            <svg><path/></svg>
          </button>
        </body></html>
        """)
        session.navigate(html)
        em = session.element_map()
        btn = next((e for e in em.elements if e.tag == "button"), None)
        assert btn is not None
        assert btn.label == "Close dialog"
        assert btn.label_source == "aria-label"

    def test_label_from_title(self, session):
        """Button with title attribute (no aria-label) gets label from title."""
        html = _inline("""
        <html><body>
          <button title="Delete item">
            <svg><path/></svg>
          </button>
        </body></html>
        """)
        session.navigate(html)
        em = session.element_map()
        btn = next((e for e in em.elements if e.tag == "button"), None)
        assert btn is not None
        assert btn.label == "Delete item"
        assert btn.label_source == "title"

    def test_label_from_aria_labelledby(self, session):
        """Button with aria-labelledby gets label from referenced element text."""
        html = _inline("""
        <html><body>
          <span id="lbl1">Send</span>
          <button aria-labelledby="lbl1">
            <svg><path/></svg>
          </button>
        </body></html>
        """)
        session.navigate(html)
        em = session.element_map()
        btn = next((e for e in em.elements if e.tag == "button"), None)
        assert btn is not None
        assert "Send" in btn.label
        assert btn.label_source == "aria-labelledby"

    def test_label_from_svg_title(self, session):
        """Button with SVG <title> gets label from SVG title."""
        html = _inline("""
        <html><body>
          <button>
            <svg><title>Upload file</title><path/></svg>
          </button>
        </body></html>
        """)
        session.navigate(html)
        em = session.element_map()
        btn = next((e for e in em.elements if e.tag == "button"), None)
        assert btn is not None
        assert btn.label == "Upload file"
        assert btn.label_source == "svg-title"

    def test_label_from_text(self, session):
        """Regular button with visible text gets label from text."""
        html = _inline("""
        <html><body>
          <button>Submit</button>
        </body></html>
        """)
        session.navigate(html)
        em = session.element_map()
        btn = next((e for e in em.elements if e.tag == "button"), None)
        assert btn is not None
        assert btn.label == "Submit"
        assert btn.label_source == "text"

    def test_label_from_placeholder(self, session):
        """Input with placeholder gets label from placeholder when no text."""
        html = _inline("""
        <html><body>
          <input type="text" placeholder="Enter your email" />
        </body></html>
        """)
        session.navigate(html)
        em = session.element_map()
        inp = next((e for e in em.elements if e.tag == "input"), None)
        assert inp is not None
        assert inp.label == "Enter your email"
        assert inp.label_source == "placeholder"

    def test_label_empty_for_bare_icon_button(self, session):
        """Icon button with NO accessible text gets empty label by default."""
        html = _inline("""
        <html><body>
          <button>
            <svg><path d="M10 10"/></svg>
          </button>
        </body></html>
        """)
        session.navigate(html)
        em = session.element_map()
        btn = next((e for e in em.elements if e.tag == "button"), None)
        assert btn is not None
        assert btn.label == ""
        assert btn.label_source == "none"

    def test_all_elements_have_label_field(self, session):
        """Every element in element-map has label and label_source fields."""
        html = _inline("""
        <html><body>
          <button>OK</button>
          <input type="text" placeholder="name" />
          <a href="#top">Home</a>
        </body></html>
        """)
        session.navigate(html)
        em = session.element_map()
        assert len(em.elements) >= 3
        for el in em.elements:
            assert isinstance(el, ElementInfo)
            assert hasattr(el, "label")
            assert hasattr(el, "label_source")
            assert el.label_source in ("aria-label", "title", "aria-labelledby", "svg-title",
                                        "text", "placeholder", "fallback", "none")


# ===========================================================================
# T05: --include-unlabeled (element-map)
# ===========================================================================

class TestIncludeUnlabeledElementMap:
    """R08-T05: --include-unlabeled causes icon-only elements to get fallback label."""

    def test_include_unlabeled_gives_fallback_label(self, session):
        """With include_unlabeled=True, bare icon button gets [button @ x,y] label."""
        html = _inline("""
        <html><body>
          <button id="icon-btn">
            <svg><path d="M10 10"/></svg>
          </button>
        </body></html>
        """)
        session.navigate(html)
        em = session.element_map(include_unlabeled=True)
        btn = next((e for e in em.elements if e.tag == "button"), None)
        assert btn is not None
        assert btn.label_source == "fallback"
        assert btn.label.startswith("[button @")
        # Should contain coordinates
        assert "," in btn.label

    def test_include_unlabeled_false_gives_empty(self, session):
        """Without include_unlabeled, same bare icon button still has empty label."""
        html = _inline("""
        <html><body>
          <button>
            <svg><path d="M10 10"/></svg>
          </button>
        </body></html>
        """)
        session.navigate(html)
        em = session.element_map(include_unlabeled=False)
        btn = next((e for e in em.elements if e.tag == "button"), None)
        assert btn is not None
        assert btn.label == ""
        assert btn.label_source == "none"

    def test_labeled_elements_unaffected_by_flag(self, session):
        """Elements with real labels are not affected by include_unlabeled flag."""
        html = _inline("""
        <html><body>
          <button aria-label="Save">
            <svg><path/></svg>
          </button>
        </body></html>
        """)
        session.navigate(html)
        em = session.element_map(include_unlabeled=True)
        btn = next((e for e in em.elements if e.tag == "button"), None)
        assert btn is not None
        assert btn.label == "Save"
        assert btn.label_source == "aria-label"  # not overridden by fallback


# ===========================================================================
# T03 + T05: snapshot-map
# ===========================================================================

class TestSynthesizedLabelSnapshotMap:
    """R08-T03/T05: snapshot-map also benefits from label synthesis."""

    def test_snapshot_map_has_label_fields(self, session):
        """snapshot-map elements have label and label_source fields."""
        html = _inline("""
        <html><body>
          <button aria-label="Close">X</button>
          <a href="#" title="Home link">
            <svg><path/></svg>
          </a>
        </body></html>
        """)
        session.navigate(html)
        snap = session.snapshot_map()
        assert len(snap.elements) >= 2
        for el in snap.elements:
            assert isinstance(el, SnapshotElement)
            assert hasattr(el, "label")
            assert hasattr(el, "label_source")

    def test_snapshot_map_aria_label_wins(self, session):
        """snapshot-map uses aria-label as label source (highest priority)."""
        html = _inline("""
        <html><body>
          <button aria-label="Toggle menu">
            <svg><path/></svg>
          </button>
        </body></html>
        """)
        session.navigate(html)
        snap = session.snapshot_map()
        btn = next((e for e in snap.elements if e.tag == "button"), None)
        assert btn is not None
        assert btn.label == "Toggle menu"
        assert btn.label_source == "aria-label"

    def test_snapshot_map_include_unlabeled(self, session):
        """snapshot-map with include_unlabeled=True gives fallback for icon buttons."""
        html = _inline("""
        <html><body>
          <button>
            <svg><path d="M5 5"/></svg>
          </button>
        </body></html>
        """)
        session.navigate(html)
        snap = session.snapshot_map(include_unlabeled=True)
        btn = next((e for e in snap.elements if e.tag == "button"), None)
        assert btn is not None
        assert btn.label_source == "fallback"
        assert "[button @" in btn.label

    def test_snapshot_map_ref_id_still_works(self, session):
        """Label synthesis does not break ref_id generation or stale detection."""
        html = _inline("""
        <html><body>
          <button aria-label="Submit form">Go</button>
        </body></html>
        """)
        session.navigate(html)
        snap = session.snapshot_map()
        btn = next((e for e in snap.elements if e.tag == "button"), None)
        assert btn is not None
        assert btn.ref_id.startswith("snap_")
        assert ":" in btn.ref_id
        assert btn.label == "Submit form"
        # ref_id should be usable in click
        res = session.click(ref_id=btn.ref_id)
        assert res.status == "ok"

    def test_snapshot_map_svg_title_source(self, session):
        """snapshot-map uses SVG <title> as label source."""
        html = _inline("""
        <html><body>
          <button>
            <svg><title>Search</title><circle cx="10" cy="10" r="5"/></svg>
          </button>
        </body></html>
        """)
        session.navigate(html)
        snap = session.snapshot_map()
        btn = next((e for e in snap.elements if e.tag == "button"), None)
        assert btn is not None
        assert btn.label == "Search"
        assert btn.label_source == "svg-title"
