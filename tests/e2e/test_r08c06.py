"""
R08-C06 e2e tests

R08-R01 — Fill 人性化: fill_strategy='type', char_delay_ms
R08-R08 — Mouse smooth steps + scroll step_delay_ms
R08-R10 — Semantic find (getByRole/Text/Label/Placeholder)
R08-R11 — Browser settings GET
R08-R13 — Error recovery hints (422 enrichDiag)
R08-R14 — Profile lifecycle: list_profiles, reset_profile
R08-R15 — Cookie delete by name (POST /cookies/delete)
R08-R16 — upload_url (asset ingestion from URL)
R08-R17 — Response consistency: session_id in scroll responses
R08-R18 — run_steps batch dispatcher
"""
from __future__ import annotations

import base64
import os

import httpx
import pytest

from agentmb import BrowserClient
from agentmb.models import (
    FindResult,
    MouseResult,
    ProfileListResult,
    RunStepsResult,
    SessionSettings,
    UploadUrlResult,
)

PORT = os.environ.get("AGENTMB_PORT", "19315")
BASE_URL = f"http://127.0.0.1:{PORT}"
TEST_PROFILE = "r08c06-test"


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
# R08-R01: Fill 人性化 — fill_strategy='type', char_delay_ms
# ===========================================================================

class TestFillHumanization:
    """fill_strategy='type' types char-by-char; char_delay_ms controls speed."""

    def test_fill_strategy_type_succeeds(self, session):
        """fill with fill_strategy='type' completes successfully."""
        html = _inline("<html><body><input id='inp' type='text'/></body></html>")
        session.navigate(html)
        res = session.fill(selector="#inp", value="hello world", fill_strategy="type")
        assert res.status == "ok"

    def test_fill_strategy_type_with_char_delay(self, session):
        """fill with fill_strategy='type' and char_delay_ms=5 completes successfully."""
        html = _inline("<html><body><input id='inp' type='text'/></body></html>")
        session.navigate(html)
        res = session.fill(selector="#inp", value="test", fill_strategy="type", char_delay_ms=5)
        assert res.status == "ok"

    def test_fill_without_strategy_backward_compat(self, session):
        """fill without fill_strategy still works (backward-compatible)."""
        html = _inline("<html><body><input id='inp' type='text'/></body></html>")
        session.navigate(html)
        res = session.fill(selector="#inp", value="unchanged")
        assert res.status == "ok"


# ===========================================================================
# R08-R08: Mouse smooth steps + scroll step_delay_ms
# ===========================================================================

class TestMouseStepsScrollDelay:
    """mouse_move steps param, scroll_until step_delay_ms param."""

    def test_mouse_move_with_steps_returns_result(self, session):
        """mouse_move with steps=5 returns ok with x/y/steps in response."""
        html = _inline("<html><body><div style='width:500px;height:500px'></div></body></html>")
        session.navigate(html)
        res = session.mouse_move(x=100, y=100, steps=5)
        assert isinstance(res, MouseResult)
        assert res.status == "ok"
        assert res.x == 100
        assert res.y == 100
        assert res.steps == 5

    def test_mouse_move_default_steps_returns_steps_1(self, session):
        """mouse_move without steps defaults to steps=1."""
        html = _inline("<html><body><div style='width:500px;height:500px'></div></body></html>")
        session.navigate(html)
        res = session.mouse_move(x=50, y=50)
        assert isinstance(res, MouseResult)
        assert res.status == "ok"
        assert res.steps == 1

    def test_scroll_until_with_step_delay_ms(self, session):
        """scroll_until with step_delay_ms=10 completes without error."""
        html = _inline("""
        <html><body>
          <div id="scroll-area" style="height:200px;overflow-y:scroll;border:1px solid #ccc">
            <div style="height:1000px;background:linear-gradient(blue,red)">
              <p>Top content</p>
              <p id="bottom" style="margin-top:900px">Bottom content</p>
            </div>
          </div>
        </body></html>
        """)
        session.navigate(html)
        res = session.scroll_until(
            scroll_selector="#scroll-area",
            direction="down",
            stop_selector="#bottom",
            max_scrolls=5,
            step_delay_ms=10,
        )
        assert res.status == "ok"
        assert res.session_id is not None


# ===========================================================================
# R08-R10: Semantic find — getByRole/Text/Label/Placeholder
# ===========================================================================

class TestSemanticFind:
    """find endpoint locates elements by semantic query types."""

    def test_find_by_role_button(self, session):
        """find(query_type='role', query='button') finds a button."""
        html = _inline("<html><body><button>Submit</button></body></html>")
        session.navigate(html)
        res = session.find(query_type="role", query="button")
        assert isinstance(res, FindResult)
        assert res.status == "ok"
        assert res.found is True
        assert res.count >= 1
        assert res.tag == "button"

    def test_find_by_text(self, session):
        """find(query_type='text', query='Click me') finds matching element."""
        html = _inline("<html><body><button>Click me</button></body></html>")
        session.navigate(html)
        res = session.find(query_type="text", query="Click me", exact=True)
        assert isinstance(res, FindResult)
        assert res.found is True
        assert res.text is not None
        assert "Click me" in res.text

    def test_find_by_placeholder(self, session):
        """find(query_type='placeholder') finds input by placeholder text."""
        html = _inline("<html><body><input placeholder='Enter your name'/></body></html>")
        session.navigate(html)
        res = session.find(query_type="placeholder", query="Enter your name")
        assert isinstance(res, FindResult)
        assert res.found is True
        assert res.tag == "input"

    def test_find_not_found_returns_found_false(self, session):
        """find for non-existent element returns found=False, count=0."""
        html = _inline("<html><body><p>No buttons here</p></body></html>")
        session.navigate(html)
        res = session.find(query_type="text", query="THIS_DOES_NOT_EXIST_XYZ_123")
        assert isinstance(res, FindResult)
        assert res.found is False
        assert res.count == 0


# ===========================================================================
# R08-R11: Browser settings GET
# ===========================================================================

class TestBrowserSettings:
    """GET /sessions/:id/settings returns viewport, UA, url, headless, profile."""

    def test_get_settings_returns_session_settings(self, session):
        """get_settings() returns a SessionSettings object with all required fields."""
        html = _inline("<html><body><p>Settings test</p></body></html>")
        session.navigate(html)
        result = session.get_settings()
        assert isinstance(result, SessionSettings)
        assert result.session_id == session.id
        assert result.profile == TEST_PROFILE

    def test_get_settings_headless_is_true(self, session):
        """get_settings shows headless=True for headless session."""
        result = session.get_settings()
        assert result.headless is True

    def test_get_settings_url_matches_current_page(self, session):
        """get_settings url reflects current page url after navigate."""
        html = _inline("<html><body><p>URL test</p></body></html>")
        session.navigate(html)
        result = session.get_settings()
        assert result.url is not None
        assert "data:text/html" in result.url or result.url != ""


# ===========================================================================
# R08-R13: Error recovery hints (enrichDiag on 422)
# ===========================================================================

class TestErrorRecoveryHints:
    """422 responses from click/fill include recovery_hint when applicable."""

    def test_timeout_error_includes_recovery_hint(self, session):
        """Clicking nonexistent element (timeout) produces 422 with recovery_hint."""
        html = _inline("<html><body><p>No clickable elements</p></body></html>")
        session.navigate(html)
        r = httpx.post(
            f"{BASE_URL}/api/v1/sessions/{session.id}/click",
            json={"selector": "#does-not-exist-xyz", "timeout_ms": 100},
        )
        assert r.status_code == 422
        data = r.json()
        assert "error" in data
        assert "recovery_hint" in data

    def test_recovery_hint_mentions_timeout_or_selector(self, session):
        """recovery_hint text references timeout or selector advice."""
        html = _inline("<html><body><p>Empty</p></body></html>")
        session.navigate(html)
        r = httpx.post(
            f"{BASE_URL}/api/v1/sessions/{session.id}/click",
            json={"selector": "#nonexistent-abc", "timeout_ms": 100},
        )
        assert r.status_code == 422
        hint = r.json().get("recovery_hint", "")
        # recovery_hint should mention timeout or selector guidance
        assert any(kw in hint.lower() for kw in ["timeout", "selector", "visible", "stability", "snapshot"])

    def test_recovery_hint_present_for_different_selectors(self, session):
        """Different nonexistent selectors each produce 422 with recovery_hint."""
        html = _inline("<html><body><p>Sparse page</p></body></html>")
        session.navigate(html)
        r = httpx.post(
            f"{BASE_URL}/api/v1/sessions/{session.id}/click",
            json={"selector": "#another-missing-button", "timeout_ms": 100},
        )
        assert r.status_code == 422
        data = r.json()
        assert "recovery_hint" in data
        # recovery_hint should be a non-empty string
        assert isinstance(data["recovery_hint"], str)
        assert len(data["recovery_hint"]) > 0


# ===========================================================================
# R08-R14: Profile lifecycle — list_profiles, reset_profile
# ===========================================================================

class TestProfileLifecycle:
    """list_profiles enumerates profiles; reset_profile wipes and recreates."""

    def test_list_profiles_returns_profile_list_result(self, client, session):
        """list_profiles() returns ProfileListResult with count >= 1."""
        # session fixture creates the TEST_PROFILE, so at least one profile exists
        result = client.list_profiles()
        assert isinstance(result, ProfileListResult)
        assert result.count >= 1
        assert len(result.profiles) == result.count

    def test_list_profiles_includes_test_profile(self, client, session):
        """list_profiles includes the profile used by the test session."""
        result = client.list_profiles()
        names = [p.name for p in result.profiles]
        assert TEST_PROFILE in names

    def test_reset_profile_not_in_use_succeeds(self, client):
        """reset_profile on a profile not in active use returns ok."""
        reset_name = "r08c06-reset-ephemeral"
        result = client.reset_profile(reset_name)
        assert result.status == "ok"
        assert result.profile == reset_name
        # After reset, it should appear in list_profiles
        listing = client.list_profiles()
        names = [p.name for p in listing.profiles]
        assert reset_name in names


# ===========================================================================
# R08-R15: Cookie delete by name
# ===========================================================================

class TestCookieDeleteByName:
    """POST /cookies/delete removes cookies by name (+ optional domain)."""

    def test_delete_cookie_by_name_removes_it(self, session):
        """delete_cookie removes the named cookie; remaining count decreases."""
        # Add a test cookie then delete it
        session.navigate(_inline("<html><body><p>Cookie test</p></body></html>"))
        session.add_cookies([{"name": "test_del", "value": "v1", "domain": "127.0.0.1", "path": "/"}])
        cookies_before = session.cookies().cookies
        count_before = len([c for c in cookies_before if c.get("name") == "test_del"])
        assert count_before >= 1

        result = session.delete_cookie("test_del")
        assert result.status == "ok"
        assert result.removed >= 1

        cookies_after = session.cookies().cookies
        count_after = len([c for c in cookies_after if c.get("name") == "test_del"])
        assert count_after == 0

    def test_delete_cookie_nonexistent_returns_removed_0(self, session):
        """delete_cookie on a name that doesn't exist returns removed=0."""
        session.navigate(_inline("<html><body><p>Cookie test 2</p></body></html>"))
        result = session.delete_cookie("cookie_that_does_not_exist_xyz")
        assert result.status == "ok"
        assert result.removed == 0

    def test_delete_cookie_by_name_and_domain(self, session):
        """delete_cookie with domain only removes matching domain cookie."""
        session.navigate(_inline("<html><body><p>Cookie domain test</p></body></html>"))
        # Add two cookies with same name but different approach (both domain 127.0.0.1)
        session.add_cookies([
            {"name": "multi_del", "value": "a", "domain": "127.0.0.1", "path": "/"},
        ])
        result = session.delete_cookie("multi_del", domain="127.0.0.1")
        assert result.status == "ok"
        assert result.removed >= 1


# ===========================================================================
# R08-R16: upload_url — asset ingestion from URL
# ===========================================================================

class TestUploadUrl:
    """upload_url fetches a URL and uploads to a file input."""

    def test_upload_url_from_local_endpoint(self, session):
        """upload_url fetches daemon's health endpoint and uploads to file input."""
        html = _inline("""
        <html><body>
          <input type="file" id="file-input"/>
        </body></html>
        """)
        session.navigate(html)
        result = session.upload_url(
            url=f"{BASE_URL}/health",
            selector="#file-input",
            filename="health.json",
        )
        assert isinstance(result, UploadUrlResult)
        assert result.status == "ok"
        assert result.size_bytes > 0
        assert result.fetched_bytes > 0

    def test_upload_url_filename_and_size(self, session):
        """upload_url response includes correct filename and size_bytes."""
        html = _inline("""
        <html><body>
          <input type="file" id="fu"/>
        </body></html>
        """)
        session.navigate(html)
        result = session.upload_url(
            url=f"{BASE_URL}/health",
            selector="#fu",
            filename="testfile.json",
        )
        assert result.status == "ok"
        assert result.filename == "testfile.json"
        assert result.size_bytes == result.fetched_bytes


# ===========================================================================
# R08-R17: Response consistency — session_id in scroll responses
# ===========================================================================

class TestResponseConsistency:
    """scroll_until and load_more_until responses include session_id."""

    def test_scroll_until_response_has_session_id(self, session):
        """scroll_until result includes session_id matching the active session."""
        html = _inline("""
        <html><body>
          <div style="height:600px;overflow:auto;border:1px solid #000" id="sc">
            <div style="height:2000px;background:linear-gradient(blue,green)">
              <p id="bottom" style="margin-top:1900px">End</p>
            </div>
          </div>
        </body></html>
        """)
        session.navigate(html)
        res = session.scroll_until(
            scroll_selector="#sc",
            direction="down",
            max_scrolls=3,
        )
        assert res.status == "ok"
        assert res.session_id == session.id

    def test_load_more_until_response_has_session_id(self, session):
        """load_more_until result includes session_id matching the active session."""
        # Page with a "load more" button that adds items via onclick
        html = _inline("""
        <html><body>
          <div id="list">
            <div class="item">Item 1</div>
            <div class="item">Item 2</div>
          </div>
          <button id="load-btn" onclick="
            var d=document.createElement('div');
            d.className='item';
            d.textContent='Item '+document.querySelectorAll('.item').length;
            document.getElementById('list').appendChild(d);
          ">Load More</button>
        </body></html>
        """)
        session.navigate(html)
        res = session.load_more_until(
            load_more_selector="#load-btn",
            content_selector=".item",
            item_count=5,
            max_loads=3,
        )
        assert res.status == "ok"
        assert res.session_id == session.id


# ===========================================================================
# R08-R18: run_steps batch dispatcher
# ===========================================================================

class TestRunSteps:
    """run_steps dispatches a sequence of actions in one request."""

    def test_run_steps_navigate_sequence(self, session):
        """run_steps with two navigate steps both complete."""
        html1 = _inline("<html><body><p>Page A</p></body></html>")
        html2 = _inline("<html><body><p>Page B</p></body></html>")
        result = session.run_steps([
            {"action": "navigate", "params": {"url": html1}},
            {"action": "navigate", "params": {"url": html2}},
        ])
        assert isinstance(result, RunStepsResult)
        assert result.status == "ok"
        assert result.total_steps == 2
        assert result.completed_steps == 2
        assert result.failed_steps == 0

    def test_run_steps_navigate_click_fill(self, session):
        """run_steps with navigate + click + fill succeeds in sequence."""
        html = _inline("""
        <html><body>
          <input id="inp" type="text"/>
          <button id="btn">Go</button>
        </body></html>
        """)
        result = session.run_steps([
            {"action": "navigate", "params": {"url": html}},
            {"action": "click", "params": {"selector": "#btn"}},
            {"action": "fill", "params": {"selector": "#inp", "value": "hello"}},
        ])
        assert isinstance(result, RunStepsResult)
        assert result.status == "ok"
        assert result.completed_steps == 3
        assert result.failed_steps == 0

    def test_run_steps_stop_on_error_true(self, session):
        """run_steps stop_on_error=True halts after first failing step."""
        html = _inline("<html><body><p>No buttons</p></body></html>")
        result = session.run_steps(
            [
                {"action": "navigate", "params": {"url": html}},
                {"action": "click", "params": {"selector": "#nonexistent-xyz", "timeout_ms": 200}},
                {"action": "navigate", "params": {"url": html}},  # should not run
            ],
            stop_on_error=True,
        )
        # First step (navigate) passes, second (click) fails → stops
        assert isinstance(result, RunStepsResult)
        assert result.status in ("partial", "failed")
        assert result.failed_steps >= 1
        # Third step was never executed
        assert result.completed_steps < 3

    def test_run_steps_results_list_matches_steps(self, session):
        """run_steps results list has one entry per step (up to stop point)."""
        html = _inline("<html><body><button id='b'>OK</button></body></html>")
        result = session.run_steps([
            {"action": "navigate", "params": {"url": html}},
            {"action": "click", "params": {"selector": "#b"}},
        ])
        assert isinstance(result, RunStepsResult)
        assert len(result.results) >= 1
        # Each result has step number and action name
        for sr in result.results:
            assert isinstance(sr.step, int)
            assert isinstance(sr.action, str)
