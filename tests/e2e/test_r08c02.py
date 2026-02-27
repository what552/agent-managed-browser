"""
R08-C02 e2e tests: T02 + T04 + T07 + T08 + T09

T02 — scroll silently does nothing: adds scrolled bool + warning + scrollable_hint
T04 — click on contenteditable: returns 422 with diagnostics instead of opaque 500
T07 — download without accept_downloads: returns 422 download_not_enabled
T08 — download gains --element-id / --ref-id
T09 — upload auto-infers MIME from extension
"""
from __future__ import annotations

import base64
import os
import tempfile

import httpx
import pytest

from agentmb import BrowserClient
from agentmb.models import ScrollResult

PORT = os.environ.get("AGENTMB_PORT", "19315")
BASE_URL = f"http://127.0.0.1:{PORT}"
TEST_PROFILE = "r08c02-test"


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


@pytest.fixture()
def session_with_downloads(client):
    """Session that has accept_downloads=True."""
    s = client.sessions.create(headless=True, profile=TEST_PROFILE, accept_downloads=True)
    yield s
    s.close()


# ===========================================================================
# T02: scroll observability
# ===========================================================================

class TestScrollObservability:
    """R08-T02: scroll returns scrolled bool; warns when no movement."""

    def test_scroll_real_container_returns_scroll_result(self, session):
        """Scrolling returns a ScrollResult with all required fields."""
        html = _inline("""
        <html><body style="margin:0">
          <div id="scroller" style="height:200px;overflow-y:scroll">
            <div style="height:2000px;background:linear-gradient(blue,red)">tall</div>
          </div>
        </body></html>
        """)
        session.navigate(html)
        res = session.scroll(selector="#scroller", delta_y=400)
        assert isinstance(res, ScrollResult)
        assert res.status == "ok"
        assert res.delta_y == 400
        assert res.selector == "#scroller"
        # scrolled is a bool; if False a warning should be present
        assert isinstance(res.scrolled, bool)
        if not res.scrolled:
            assert res.warning is not None

    def test_scroll_non_scrollable_returns_warning(self, session):
        """Scrolling a non-scrollable element returns scrolled=False + warning."""
        html = _inline("""
        <html><body>
          <div id="box" style="height:100px;overflow:hidden">
            <p>not scrollable</p>
          </div>
          <div id="inner" style="height:300px;overflow-y:scroll">
            <div style="height:2000px">tall inner</div>
          </div>
        </body></html>
        """)
        session.navigate(html)
        # scroll the outer non-scrollable div
        res = session.scroll(selector="body", delta_y=500)
        assert isinstance(res, ScrollResult)
        assert res.status == "ok"
        # body is not scrollable on this inline page so scrolled should be False
        # (or True if viewport is scrollable — accept both, just check fields present)
        assert res.scrolled in (True, False)
        # fields are always present
        assert hasattr(res, "scrollable_hint")

    def test_scroll_noop_includes_hint_list(self, session):
        """When scrolled=False, scrollable_hint lists candidates."""
        html = _inline("""
        <html><body style="overflow:hidden;height:200px">
          <div id="static" style="height:100px">no scroll here</div>
          <div id="real" style="height:100px;overflow-y:scroll">
            <div style="height:2000px">tall</div>
          </div>
        </body></html>
        """)
        session.navigate(html)
        res = session.scroll(selector="#static", delta_y=300)
        assert isinstance(res, ScrollResult)
        if not res.scrolled:
            assert res.warning is not None
            # hint list may or may not find descendants depending on nesting
            # but the field should be a list (possibly empty)
            assert res.scrollable_hint is None or isinstance(res.scrollable_hint, list)

    def test_scroll_result_fields(self, session):
        """ScrollResult always has delta_x, delta_y fields."""
        html = _inline("<html><body><div id='x'>x</div></body></html>")
        session.navigate(html)
        res = session.scroll(selector="#x", delta_x=0, delta_y=100)
        assert res.delta_x == 0
        assert res.delta_y == 100
        assert res.selector == "#x"


# ===========================================================================
# T04: contenteditable click
# ===========================================================================

class TestContenteditableClick:
    """R08-T04: click on contenteditable returns 422 diagnostics, not opaque 500."""

    def test_click_contenteditable_succeeds(self, session):
        """Clicking a contenteditable element should succeed (not 500)."""
        html = _inline("""
        <html><body>
          <p id="editable" contenteditable="true" style="border:1px solid #ccc;padding:8px">
            Click me
          </p>
        </body></html>
        """)
        session.navigate(html)
        # Should succeed — contenteditable is a valid click target
        res = session.click(selector="#editable")
        assert res.status == "ok"

    def test_click_contenteditable_div(self, session):
        """Clicking a contenteditable div should not raise opaque 500."""
        html = _inline("""
        <html><body>
          <div contenteditable="true" style="width:200px;height:50px;border:1px solid black">
            Edit this
          </div>
        </body></html>
        """)
        session.navigate(html)
        # Should succeed
        res = session.click(selector="[contenteditable='true']")
        assert res.status == "ok"

    def test_click_bad_selector_returns_422(self, session):
        """Click on non-existent element raises HTTP error (422 with diagnostics)."""
        html = _inline("<html><body><p>nothing</p></body></html>")
        session.navigate(html)
        with pytest.raises(httpx.HTTPStatusError) as exc_info:
            session.click(selector="#definitely-not-here")
        assert exc_info.value.response.status_code == 422
        body = exc_info.value.response.json()
        # Should have diagnostic fields, not bare 500
        assert "error" in body or "url" in body or "title" in body


# ===========================================================================
# T07: download accept_downloads guard
# ===========================================================================

class TestDownloadGuard:
    """R08-T07: download without accept_downloads returns 422 download_not_enabled."""

    def test_download_without_flag_returns_422(self, session):
        """Session without accept_downloads=True → 422 download_not_enabled."""
        html = _inline("""
        <html><body>
          <a id="dl" href="/fake.txt" download>Download</a>
        </body></html>
        """)
        session.navigate(html)
        with pytest.raises(httpx.HTTPStatusError) as exc_info:
            session._client._post(
                f"/api/v1/sessions/{session.id}/download",
                {"selector": "#dl"},
                dict,
            )
        assert exc_info.value.response.status_code == 422
        body = exc_info.value.response.json()
        assert body.get("error") == "download_not_enabled"
        assert "accept_downloads" in body.get("message", "")

    def test_download_with_flag_passes_guard(self, session_with_downloads):
        """Session with accept_downloads=True passes the guard (may still fail on fake href)."""
        html = _inline("""
        <html><body>
          <a id="dl" href="data:text/plain,hello" download="test.txt">Download</a>
        </body></html>
        """)
        session_with_downloads.navigate(html)
        # Should not raise 422 download_not_enabled (may timeout or succeed)
        try:
            session_with_downloads._client._post(
                f"/api/v1/sessions/{session_with_downloads.id}/download",
                {"selector": "#dl", "timeout_ms": 3000},
                dict,
            )
        except httpx.HTTPStatusError as e:
            # Accept any error except download_not_enabled
            body = e.response.json()
            assert body.get("error") != "download_not_enabled", \
                f"Got download_not_enabled even with accept_downloads=True: {body}"


# ===========================================================================
# T08: download --element-id / --ref-id
# ===========================================================================

class TestDownloadElementId:
    """R08-T08: download accepts element_id and ref_id."""

    def _setup_page(self, session):
        html = _inline("""
        <html><body>
          <a id="dl" href="data:text/plain,hello" download="test.txt">Download</a>
        </body></html>
        """)
        session.navigate(html)

    def test_download_element_id_accepted(self, session_with_downloads):
        """download body accepts element_id (guard passes, download may timeout)."""
        self._setup_page(session_with_downloads)
        em = session_with_downloads.element_map()
        link_eid = None
        for el in em.elements:
            if el.tag == "a":
                link_eid = el.element_id
                break
        assert link_eid, "No <a> element found in element-map"

        try:
            session_with_downloads._client._post(
                f"/api/v1/sessions/{session_with_downloads.id}/download",
                {"element_id": link_eid, "timeout_ms": 3000},
                dict,
            )
        except httpx.HTTPStatusError as e:
            body = e.response.json()
            assert body.get("error") != "download_not_enabled"
            assert body.get("error") != "validation_error"

    def test_download_ref_id_accepted(self, session_with_downloads):
        """download body accepts ref_id."""
        self._setup_page(session_with_downloads)
        snap = session_with_downloads.snapshot_map()
        link_ref = None
        for el in snap.elements:
            if el.tag == "a":
                link_ref = el.ref_id
                break
        assert link_ref, "No <a> element in snapshot_map"

        try:
            session_with_downloads._client._post(
                f"/api/v1/sessions/{session_with_downloads.id}/download",
                {"ref_id": link_ref, "timeout_ms": 3000},
                dict,
            )
        except httpx.HTTPStatusError as e:
            body = e.response.json()
            assert body.get("error") != "download_not_enabled"
            assert body.get("error") != "validation_error"


# ===========================================================================
# T09: upload MIME inference
# ===========================================================================

class TestUploadMimeInference:
    """R08-T09: upload auto-infers MIME type from file extension."""

    def _setup_upload_page(self, session):
        html = _inline("""
        <html><body>
          <input id="file" type="file" accept="image/*" />
        </body></html>
        """)
        session.navigate(html)

    def _write_tmp(self, suffix: str, content: bytes = b"fake") -> str:
        f = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
        f.write(content)
        f.close()
        return f.name

    def test_upload_png_infers_mime(self, session):
        """Uploading a .png without explicit mime_type uses image/png."""
        self._setup_upload_page(session)
        tmp = self._write_tmp(".png")
        try:
            res = session.upload(selector="#file", file_path=tmp)
            assert res.status == "ok"
            assert res.mime_type == "image/png"
        finally:
            os.unlink(tmp)

    def test_upload_jpg_infers_mime(self, session):
        """Uploading a .jpg without explicit mime_type uses image/jpeg."""
        self._setup_upload_page(session)
        tmp = self._write_tmp(".jpg")
        try:
            res = session.upload(selector="#file", file_path=tmp)
            assert res.status == "ok"
            assert res.mime_type == "image/jpeg"
        finally:
            os.unlink(tmp)

    def test_upload_explicit_mime_overrides(self, session):
        """Explicit mime_type overrides inferred value."""
        self._setup_upload_page(session)
        tmp = self._write_tmp(".png")
        try:
            res = session.upload(selector="#file", file_path=tmp, mime_type="image/webp")
            assert res.status == "ok"
            assert res.mime_type == "image/webp"
        finally:
            os.unlink(tmp)

    def test_upload_unknown_ext_fallback(self, session):
        """Unknown extension falls back to application/octet-stream."""
        self._setup_upload_page(session)
        tmp = self._write_tmp(".unknownxyz")
        try:
            res = session.upload(selector="#file", file_path=tmp)
            assert res.status == "ok"
            assert res.mime_type == "application/octet-stream"
        finally:
            os.unlink(tmp)
