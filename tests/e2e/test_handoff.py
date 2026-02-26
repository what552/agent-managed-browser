"""
Login handoff regression tests.
Verifies the handoff/start → handoff/complete → automation-resumes loop.

No actual human interaction required: we call start (→headed) and complete
(→headless) back-to-back to test the full API round-trip and verify that
automation (navigate/screenshot) works correctly after the transition.

Requires: daemon running on localhost:19315 (standard smoke test daemon).
"""

import os
import sys
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../sdk/python"))

from openclaw import BrowserClient, HandoffResult
from openclaw.models import NavigateResult, ScreenshotResult

BASE_URL = f"http://127.0.0.1:{os.environ.get('OPENCLAW_PORT', '19315')}"
TEST_PROFILE = "e2e-handoff-test"


@pytest.fixture(scope="module")
def client():
    with BrowserClient(base_url=BASE_URL) as c:
        yield c


# ---------------------------------------------------------------------------
# Handoff API round-trip
# ---------------------------------------------------------------------------

def test_handoff_start_returns_headed(client):
    """handoff/start should switch session to headed mode and return HandoffResult."""
    sess = client.sessions.create(profile=TEST_PROFILE + "-start", headless=True)
    try:
        result = sess.handoff_start()
        assert isinstance(result, HandoffResult)
        assert result.session_id == sess.id
        assert result.mode == "headed"
        assert "headless" in result.message.lower() or "complete" in result.message.lower()
    finally:
        # Clean up by completing the handoff first (switches back to headless), then close
        sess.handoff_complete()
        sess.close()


def test_handoff_complete_returns_headless(client):
    """handoff/complete should switch session to headless mode and return HandoffResult."""
    sess = client.sessions.create(profile=TEST_PROFILE + "-complete", headless=True)
    try:
        sess.handoff_start()
        result = sess.handoff_complete()
        assert isinstance(result, HandoffResult)
        assert result.session_id == sess.id
        assert result.mode == "headless"
        assert "headless" in result.message.lower() or "resume" in result.message.lower()
    finally:
        sess.close()


def test_handoff_full_loop_automation_resumes(client):
    """Full loop: headless → handoff/start → handoff/complete → navigate works."""
    sess = client.sessions.create(profile=TEST_PROFILE + "-loop", headless=True)
    try:
        # 1. Navigate before handoff (confirm baseline)
        pre = sess.navigate("https://example.com")
        assert pre.status == "ok"
        assert pre.title == "Example Domain"

        # 2. Simulate login handoff (start → complete immediately, no human interaction)
        start_result = sess.handoff_start()
        assert start_result.mode == "headed"

        complete_result = sess.handoff_complete()
        assert complete_result.mode == "headless"

        # 3. Confirm automation resumes correctly after handoff
        post = sess.navigate("https://example.com")
        assert isinstance(post, NavigateResult)
        assert post.status == "ok"
        assert post.title == "Example Domain"

        # 4. Screenshot also works post-handoff
        shot = sess.screenshot()
        assert isinstance(shot, ScreenshotResult)
        assert len(shot.to_bytes()) > 5000
    finally:
        sess.close()


def test_handoff_404_on_missing_session(client):
    """handoff/start on non-existent session should return 404."""
    import httpx
    with pytest.raises(httpx.HTTPStatusError) as exc_info:
        # Build a fake session to call the method on
        from openclaw.client import Session
        fake_sess = Session("sess_nonexistent000", client)
        fake_sess.handoff_start()
    assert exc_info.value.response.status_code == 404


# ---------------------------------------------------------------------------
# Async variant
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_async_handoff_loop():
    """Async client: full handoff loop works end-to-end."""
    from openclaw import AsyncBrowserClient

    async with AsyncBrowserClient(base_url=BASE_URL) as aclient:
        sess = await aclient.sessions.create(
            profile=TEST_PROFILE + "-async-loop", headless=True
        )
        async with sess:
            await sess.navigate("https://example.com")

            start = await sess.handoff_start()
            assert start.mode == "headed"

            done = await sess.handoff_complete()
            assert done.mode == "headless"

            post = await sess.navigate("https://example.com")
            assert post.status == "ok"
