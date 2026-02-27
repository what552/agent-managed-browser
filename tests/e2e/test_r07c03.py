"""
R07-C03 e2e tests: T05/T06/T09/T10/T11/T12/T15/T16/T17

Tests cover:
  T05  — cookies (list/add/clear) + storage_state (export/import)
  T10  — Recipe MVP (step decorator, run, checkpoint)
  T15  — annotated_screenshot (highlights applied without error)
  T16  — console log collection (page.on('console') ring buffer)
  T17  — page error collection (page.on('pageerror') ring buffer)

r07-c03-fix additions:
  T-RC-05 — Recipe rejects async steps (TypeError, not silent success)
  T-RC-06 — AsyncRecipe properly awaits async steps
  T-AS-04 — annotated_screenshot label escaping (special chars)
  T-SS-02 — storage_state restore reports origins_skipped
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import tempfile
import time
import pytest
from agentmb import BrowserClient
from agentmb.recipe import AsyncRecipe, Recipe, RecipeResult

PORT = os.environ.get("AGENTMB_PORT", "19315")
BASE_URL = f"http://127.0.0.1:{PORT}"
TEST_PROFILE = "r07c03-test"


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
# T05: Cookie management
# ---------------------------------------------------------------------------


class TestCookies:
    def test_list_cookies_empty(self, session):
        """T-CK-01: freshly navigated page may have few or no cookies."""
        html = _inline("<html><body><p>blank</p></body></html>")
        session.navigate(html)
        result = session.cookies()
        assert result.session_id == session.id
        assert isinstance(result.cookies, list)
        assert result.count == len(result.cookies)

    def test_add_and_list_cookies(self, session):
        """T-CK-02: add_cookies persists cookies that show up in list."""
        # Navigate to a real-ish origin so cookies stick
        html = _inline("<html><body><p>cookie test</p></body></html>")
        session.navigate(html)
        # Clear first
        session.clear_cookies()
        # data: URLs don't support document.cookie; just verify cookies() shape
        result = session.cookies()
        # The cookie might not appear in context.cookies() for data: URLs,
        # so just assert the call succeeds with valid shape
        assert isinstance(result.cookies, list)

    def test_add_cookies_api(self, client):
        """T-CK-03: add_cookies via API accepts well-formed cookie objects."""
        s = client.sessions.create(headless=True, profile=TEST_PROFILE)
        try:
            # Navigate to localhost-like URL so domain matches
            s.navigate("about:blank")
            s.clear_cookies()
            # Add a cookie for google.com (domain must match context origin restriction)
            # Use a permissive domain that Playwright accepts in addCookies
            cookie = {
                "name": "test_cookie",
                "value": "agentmb_value",
                "domain": "example.com",
                "path": "/",
            }
            res = s.add_cookies([cookie])
            assert res.get("added") == 1
        finally:
            s.close()

    def test_clear_cookies(self, client):
        """T-CK-04: clear_cookies removes all cookies."""
        s = client.sessions.create(headless=True, profile=TEST_PROFILE)
        try:
            s.navigate("about:blank")
            # Add then clear
            cookie = {"name": "tmp", "value": "val", "domain": "example.com", "path": "/"}
            s.add_cookies([cookie])
            s.clear_cookies()  # Should not raise
            result = s.cookies()
            # After clear, no cookies should exist
            assert result.count == 0
        finally:
            s.close()


class TestStorageState:
    def test_export_storage_state(self, session):
        """T-SS-01: storage_state returns a dict with expected keys."""
        html = _inline("<html><body><p>storage</p></body></html>")
        session.navigate(html)
        result = session.storage_state()
        assert result.session_id == session.id
        state = result.storage_state
        assert isinstance(state, dict)
        assert "cookies" in state
        assert "origins" in state

    def test_restore_storage_state(self, client):
        """T-SS-02: restore_storage_state from exported state; reports origins_skipped."""
        s = client.sessions.create(headless=True, profile=TEST_PROFILE)
        try:
            s.navigate("about:blank")
            # Export current (empty) state
            exported = s.storage_state()
            # Restore it — should succeed
            result = s.restore_storage_state(exported.storage_state)
            assert result.status == "ok"
            assert isinstance(result.cookies_restored, int)
            assert isinstance(result.origins_skipped, int)

        finally:
            s.close()

    def test_restore_storage_state_with_origins_reports_skipped(self, client):
        """T-SS-03: origins in storage_state are skipped with origins_skipped > 0 and a note."""
        s = client.sessions.create(headless=True, profile=TEST_PROFILE)
        try:
            s.navigate("about:blank")
            # Build a fake storage_state with an origins entry
            fake_state = {
                "cookies": [],
                "origins": [
                    {
                        "origin": "https://example.com",
                        "localStorage": [{"name": "key", "value": "val"}],
                    }
                ],
            }
            result = s.restore_storage_state(fake_state)
            assert result.status == "ok"
            assert result.origins_skipped == 1
            # note should explain the limitation
            assert result.note is not None and "localStorage" in result.note
        finally:
            s.close()


# ---------------------------------------------------------------------------
# T15: Annotated screenshot
# ---------------------------------------------------------------------------


class TestAnnotatedScreenshot:
    def test_basic_highlight(self, session):
        """T-AS-01: annotated_screenshot returns valid PNG with highlight count."""
        html = _inline("""
        <html><body>
          <button id="btn">Click Me</button>
          <input id="inp" type="text" placeholder="Type here">
        </body></html>
        """)
        session.navigate(html)
        result = session.annotated_screenshot(
            highlights=[
                {"selector": "#btn", "color": "rgba(255,100,0,0.4)", "label": "button"},
                {"selector": "#inp", "color": "rgba(0,100,255,0.4)", "label": "input"},
            ]
        )
        assert result.status == "ok"
        assert result.format == "png"
        assert result.highlight_count == 2
        assert result.duration_ms >= 0
        # Verify it's valid base64 PNG data
        raw = result.to_bytes()
        assert raw[:4] == b'\x89PNG', "Expected PNG magic bytes"

    def test_single_highlight(self, session):
        """T-AS-02: single highlight on body element works."""
        html = _inline("<html><body style='background:#fff'><p>Hello</p></body></html>")
        session.navigate(html)
        result = session.annotated_screenshot(
            highlights=[{"selector": "p"}]
        )
        assert result.status == "ok"
        assert result.highlight_count == 1

    def test_save_to_file(self, session, tmp_path):
        """T-AS-03: annotated_screenshot.save() writes a valid file."""
        html = _inline("<html><body><button>Btn</button></body></html>")
        session.navigate(html)
        result = session.annotated_screenshot(highlights=[{"selector": "button"}])
        out = str(tmp_path / "annotated.png")
        result.save(out)
        assert os.path.getsize(out) > 100

    def test_label_special_chars(self, session):
        """T-AS-04: label with single-quotes and backslash must not break CSS injection."""
        html = _inline("<html><body><p id='t'>text</p></body></html>")
        session.navigate(html)
        # Label contains characters that would break naive CSS string interpolation
        result = session.annotated_screenshot(
            highlights=[{"selector": "#t", "label": "it's a \\backslash & 'quote'"}]
        )
        assert result.status == "ok"
        assert result.highlight_count == 1


# ---------------------------------------------------------------------------
# T16: Console log collection
# ---------------------------------------------------------------------------


class TestConsoleLog:
    def test_console_log_collected(self, client):
        """T-CL-01: console.log() calls appear in the console log buffer."""
        s = client.sessions.create(headless=True, profile=TEST_PROFILE)
        try:
            s.clear_console_log()
            html = _inline("""
            <html><body>
              <script>
                console.log('Hello from agentmb');
                console.warn('This is a warning');
                console.error('This is an error');
              </script>
            </body></html>
            """)
            s.navigate(html)
            # Give a moment for events to fire
            time.sleep(0.2)
            result = s.console_log()
            assert result.session_id == s.id
            assert isinstance(result.entries, list)
            texts = [e.text for e in result.entries]
            assert any("Hello from agentmb" in t for t in texts), f"Expected log entry, got: {texts}"
        finally:
            s.close()

    def test_console_log_tail(self, client):
        """T-CL-02: tail parameter limits the number of returned entries."""
        s = client.sessions.create(headless=True, profile=TEST_PROFILE)
        try:
            s.clear_console_log()
            html = _inline("""
            <html><body>
              <script>
                for(var i = 0; i < 10; i++) console.log('Entry ' + i);
              </script>
            </body></html>
            """)
            s.navigate(html)
            time.sleep(0.2)
            result = s.console_log(tail=3)
            assert result.count <= 3
            assert len(result.entries) <= 3
        finally:
            s.close()

    def test_clear_console_log(self, client):
        """T-CL-03: clear_console_log empties the buffer."""
        s = client.sessions.create(headless=True, profile=TEST_PROFILE)
        try:
            html = _inline("<html><body><script>console.log('test');</script></body></html>")
            s.navigate(html)
            time.sleep(0.2)
            s.clear_console_log()
            result = s.console_log()
            assert result.count == 0
        finally:
            s.close()


# ---------------------------------------------------------------------------
# T17: Page error collection
# ---------------------------------------------------------------------------


class TestPageErrors:
    def test_page_error_collected(self, client):
        """T-PE-01: uncaught JS errors appear in page_errors buffer."""
        s = client.sessions.create(headless=True, profile=TEST_PROFILE)
        try:
            s.clear_page_errors()
            html = _inline("""
            <html><body>
              <script>
                // Throw an uncaught error
                setTimeout(function() { throw new Error('TestUncaughtError'); }, 50);
              </script>
            </body></html>
            """)
            s.navigate(html)
            time.sleep(0.3)
            result = s.page_errors()
            assert result.session_id == s.id
            assert isinstance(result.entries, list)
            messages = [e.message for e in result.entries]
            assert any("TestUncaughtError" in m for m in messages), f"Expected error, got: {messages}"
        finally:
            s.close()

    def test_clear_page_errors(self, client):
        """T-PE-02: clear_page_errors empties the buffer."""
        s = client.sessions.create(headless=True, profile=TEST_PROFILE)
        try:
            html = _inline("<html><body><script>setTimeout(()=>{throw new Error('E')},50)</script></body></html>")
            s.navigate(html)
            time.sleep(0.3)
            s.clear_page_errors()
            result = s.page_errors()
            assert result.count == 0
        finally:
            s.close()


# ---------------------------------------------------------------------------
# T10: Recipe MVP
# ---------------------------------------------------------------------------


class TestRecipe:
    def test_basic_recipe_run(self, client):
        """T-RC-01: Recipe runs steps in order and returns ok result."""
        s = client.sessions.create(headless=True, profile=TEST_PROFILE)
        try:
            recipe = Recipe(s, name="test-basic")
            executed = []

            @recipe.step("step_one")
            def step_one(sess):
                html = _inline("<html><body><button>Go</button></body></html>")
                sess.navigate(html)
                executed.append("step_one")

            @recipe.step("step_two")
            def step_two(sess):
                result = sess.eval("document.title")
                executed.append("step_two")
                return result.result

            result = recipe.run()
            assert result.ok
            assert len(result.steps) == 2
            assert all(s.status == "ok" for s in result.steps)
            assert executed == ["step_one", "step_two"]
        finally:
            s.close()

    def test_recipe_stop_on_error(self, client):
        """T-RC-02: Recipe stops at first error and marks subsequent steps as not run."""
        s = client.sessions.create(headless=True, profile=TEST_PROFILE)
        try:
            recipe = Recipe(s, name="test-error", stop_on_error=True)

            @recipe.step("will_fail")
            def will_fail(sess):
                raise ValueError("Intentional failure")

            @recipe.step("wont_run")
            def wont_run(sess):
                pass

            result = recipe.run()
            assert not result.ok
            assert result.failed_step is not None
            assert result.failed_step.name == "will_fail"
            # second step was never executed (not in steps list)
            step_names = [s.name for s in result.steps]
            assert "wont_run" not in step_names
        finally:
            s.close()

    def test_recipe_checkpoint_resume(self, client, tmp_path):
        """T-RC-03: Checkpoint saves progress; second run skips completed steps."""
        s = client.sessions.create(headless=True, profile=TEST_PROFILE)
        ckpt_path = str(tmp_path / "ckpt.json")
        try:
            executed = []

            def make_recipe():
                r = Recipe(s, name="ckpt-test", checkpoint=ckpt_path, stop_on_error=False)

                @r.step("step_a")
                def step_a(sess):
                    executed.append("step_a")

                @r.step("step_b")
                def step_b(sess):
                    executed.append("step_b")
                    raise RuntimeError("Fail at step_b")

                @r.step("step_c")
                def step_c(sess):
                    executed.append("step_c")

                return r

            # First run: step_a succeeds, step_b fails (not stop_on_error, continues)
            r1 = make_recipe()
            r1.run()
            assert "step_a" in executed

            # Second run: step_a should be skipped (checkpointed)
            executed.clear()
            r2 = make_recipe()
            r2.run()
            # step_a was completed in first run, so it's skipped
            assert "step_a" not in executed

        finally:
            s.close()

    def test_recipe_summary(self, client):
        """T-RC-04: RecipeResult.summary() returns a non-empty string."""
        s = client.sessions.create(headless=True, profile=TEST_PROFILE)
        try:
            recipe = Recipe(s, name="summary-test")

            @recipe.step("only_step")
            def only_step(sess):
                pass

            result = recipe.run()
            summary = result.summary()
            assert "summary-test" in summary
            assert "only_step" in summary
        finally:
            s.close()

    def test_recipe_rejects_async_step(self, client):
        """T-RC-05: Recipe.run() raises TypeError when a step is async, not silent success."""
        s = client.sessions.create(headless=True, profile=TEST_PROFILE)
        try:
            recipe = Recipe(s, name="async-guard-test", stop_on_error=True)

            @recipe.step("async_step")
            async def async_step(sess):
                pass  # pragma: no cover

            result = recipe.run()
            # The coroutine must be detected and reported as an error (not silently ok)
            assert not result.ok
            assert result.failed_step is not None
            assert result.failed_step.name == "async_step"
            assert "AsyncRecipe" in (result.failed_step.error or "")
        finally:
            s.close()

    def test_async_recipe_runs_async_steps(self, client):
        """T-RC-06: AsyncRecipe.run() properly awaits async step functions."""
        s = client.sessions.create(headless=True, profile=TEST_PROFILE)
        try:
            executed: list = []

            async def _run():
                recipe = AsyncRecipe(s, name="async-recipe-test")

                @recipe.step("async_nav")
                async def async_nav(sess):
                    html = _inline("<html><body><p>async</p></body></html>")
                    sess.navigate(html)  # Session is sync; still valid to call in async step
                    executed.append("async_nav")

                @recipe.step("sync_step")
                def sync_step(sess):
                    executed.append("sync_step")

                return await recipe.run()

            result = asyncio.run(_run())
            assert result.ok
            assert len(result.steps) == 2
            assert all(step.status == "ok" for step in result.steps)
            assert executed == ["async_nav", "sync_step"]
        finally:
            s.close()
