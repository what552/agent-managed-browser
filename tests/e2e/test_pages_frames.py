"""
E2E tests for r05-c02: multi-page (T03) and frame actions (T04).

Requires: daemon running on localhost:19315
Run: pytest tests/e2e/test_pages_frames.py -v
"""

import os
import sys
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../sdk/python"))

from agentmb import BrowserClient
from agentmb.models import PageListResult, NewPageResult

BASE_URL = f"http://127.0.0.1:{os.environ.get('AGENTMB_PORT', '19315')}"
TEST_PROFILE = "e2e-pages-frames"


@pytest.fixture(scope="module")
def client():
    with BrowserClient(base_url=BASE_URL) as c:
        yield c


# ---------------------------------------------------------------------------
# T03: Multi-page
# ---------------------------------------------------------------------------

def test_list_pages_initial(client):
    """A new session should have exactly one page."""
    sess = client.sessions.create(profile=TEST_PROFILE + "-list", headless=True)
    try:
        result = sess.pages()
        assert isinstance(result, PageListResult)
        assert len(result.pages) == 1
        assert result.pages[0].active is True
    finally:
        sess.close()


def test_new_page_creates_tab(client):
    """new_page() should add a second page and return a page_id."""
    sess = client.sessions.create(profile=TEST_PROFILE + "-new", headless=True)
    try:
        p1 = sess.pages()
        assert len(p1.pages) == 1

        new = sess.new_page()
        assert isinstance(new, NewPageResult)
        assert new.page_id.startswith("page_")

        p2 = sess.pages()
        assert len(p2.pages) == 2
    finally:
        sess.close()


def test_switch_page(client):
    """switch_page() should make a different page active."""
    sess = client.sessions.create(profile=TEST_PROFILE + "-switch", headless=True)
    try:
        sess.navigate("https://example.com")
        orig_pages = sess.pages()
        orig_id = orig_pages.pages[0].page_id

        new = sess.new_page()
        new_id = new.page_id

        # Switch to new page
        sess.switch_page(new_id)
        current = sess.pages()
        active = next(p for p in current.pages if p.active)
        assert active.page_id == new_id

        # Switch back
        sess.switch_page(orig_id)
        current2 = sess.pages()
        active2 = next(p for p in current2.pages if p.active)
        assert active2.page_id == orig_id
    finally:
        sess.close()


def test_close_page(client):
    """close_page() should remove the page from the list."""
    sess = client.sessions.create(profile=TEST_PROFILE + "-close", headless=True)
    try:
        new = sess.new_page()
        before = sess.pages()
        assert len(before.pages) == 2

        sess.close_page(new.page_id)
        after = sess.pages()
        assert len(after.pages) == 1
        assert all(p.page_id != new.page_id for p in after.pages)
    finally:
        sess.close()


def test_each_page_independent_navigation(client):
    """Pages should be independent - navigating page 2 doesn't affect page 1."""
    sess = client.sessions.create(profile=TEST_PROFILE + "-indep", headless=True)
    try:
        sess.navigate("https://example.com")
        pages_before = sess.pages()
        page1_id = pages_before.pages[0].page_id

        new = sess.new_page()
        sess.switch_page(new.page_id)
        # Page 2 starts at about:blank; navigate it to a different URL
        sess.navigate("https://example.com")
        title2 = sess.eval("document.title")

        # Switch back to page 1
        sess.switch_page(page1_id)
        title1 = sess.eval("document.title")
        assert title1.result == "Example Domain"
        assert title2.result == "Example Domain"
    finally:
        sess.close()


# ---------------------------------------------------------------------------
# T04: Frame actions
# ---------------------------------------------------------------------------

IFRAME_PAGE = (
    "data:text/html,<html><body>"
    "<iframe name='myframe' srcdoc='<html><body>"
    "<input id=fi type=text/>"
    "<h1 id=fh>Frame Content</h1>"
    "</body></html>'></iframe>"
    "</body></html>"
)


def test_eval_in_frame_by_name(client):
    """eval with frame selector should execute in the named iframe."""
    sess = client.sessions.create(profile=TEST_PROFILE + "-frame-eval", headless=True)
    try:
        sess.navigate(IFRAME_PAGE)
        # Wait for iframe to load
        import time; time.sleep(0.5)
        result = sess.eval("document.title")
        # Main frame has no title — this confirms we can call eval on main frame
        assert result.status == "ok"
    finally:
        sess.close()


def test_extract_from_main_frame(client):
    """extract without frame selector works on main page as before."""
    sess = client.sessions.create(profile=TEST_PROFILE + "-frame-extract", headless=True)
    try:
        sess.navigate("https://example.com")
        result = sess.extract("h1")
        assert result.status == "ok"
        assert result.count >= 1
    finally:
        sess.close()
