"""
E2E tests for r05-c03: network route mocks (T07), operator inference (T09),
and CDP WS URL endpoint (T06).

Requires: daemon running on localhost:19315
Run: pytest tests/e2e/test_network_cdp.py -v
"""

import os
import sys
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../sdk/python"))

from agentmb import BrowserClient, RouteListResult

BASE_URL = f"http://127.0.0.1:{os.environ.get('AGENTMB_PORT', '19315')}"
TEST_PROFILE = "e2e-network-cdp"


@pytest.fixture(scope="module")
def client():
    with BrowserClient(base_url=BASE_URL) as c:
        yield c


# ---------------------------------------------------------------------------
# T06: CDP WebSocket URL endpoint
# ---------------------------------------------------------------------------


def test_cdp_ws_url_returns_info(client):
    """cdp/ws endpoint should return a response with session_id field."""
    sess = client.sessions.create(profile=TEST_PROFILE + "-cdpws", headless=True)
    try:
        result = sess.cdp_ws_url()
        assert result["session_id"] == sess.id
        # browser_ws_url may be null if wsEndpoint isn't exposed, but endpoint must work
        assert "browser_ws_url" in result
    finally:
        sess.close()


# ---------------------------------------------------------------------------
# T07: Network route mock
# ---------------------------------------------------------------------------

def test_route_mock_intercepts_request(client):
    """A registered route mock should intercept matching requests."""
    sess = client.sessions.create(profile=TEST_PROFILE + "-route", headless=True)
    try:
        # Register a mock that returns JSON for any example.com request
        mock = {"status": 200, "body": '{"mocked": true}', "content_type": "application/json"}
        result = sess.route("**/api/**", mock)
        assert result.get("pattern") == "**/api/**"

        # List routes
        routes_result = sess.routes()
        assert isinstance(routes_result, RouteListResult)
        assert any(r.pattern == "**/api/**" for r in routes_result.routes)
    finally:
        sess.close()


def test_route_unroute_removes_mock(client):
    """unroute() should remove a previously registered mock."""
    sess = client.sessions.create(profile=TEST_PROFILE + "-unroute", headless=True)
    try:
        sess.route("**/intercepted/**", {"status": 404, "body": "not found"})

        before = sess.routes()
        assert any(r.pattern == "**/intercepted/**" for r in before.routes)

        sess.unroute("**/intercepted/**")
        after = sess.routes()
        assert not any(r.pattern == "**/intercepted/**" for r in after.routes)
    finally:
        sess.close()


def test_route_list_empty_initially(client):
    """A fresh session should have no active route mocks."""
    sess = client.sessions.create(profile=TEST_PROFILE + "-empty", headless=True)
    try:
        result = sess.routes()
        assert isinstance(result, RouteListResult)
        assert len(result.routes) == 0
    finally:
        sess.close()


def test_route_mock_serves_response(client):
    """Navigating to a mocked URL pattern should return the mocked body."""
    sess = client.sessions.create(profile=TEST_PROFILE + "-serve", headless=True)
    try:
        # Mock all requests to example.com with a custom HTML body
        html = "<html><body><h1 id='mock'>Mocked!</h1></body></html>"
        sess.route("**/example.com/**", {"status": 200, "body": html, "content_type": "text/html"})

        sess.navigate("https://example.com")
        result = sess.extract("#mock")
        assert result.status == "ok"
        # The mocked page has our custom h1
        assert any("Mocked" in item.get("text", "") for item in result.items)
    finally:
        sess.close()


# ---------------------------------------------------------------------------
# T09: Operator auto-inference
# ---------------------------------------------------------------------------

def test_operator_inferred_from_header(client):
    """X-Operator header should be auto-inferred when not passed explicitly."""
    # Create a client that sends X-Operator header
    import httpx
    custom_client = BrowserClient(base_url=BASE_URL, operator="test-agent-x")
    sess = None
    try:
        sess = custom_client.sessions.create(profile=TEST_PROFILE + "-op", headless=True)
        sess.navigate("https://example.com")
        # Check audit log — operator should appear
        logs = sess.logs(tail=5)
        # Find the navigate entry
        nav_entries = [e for e in logs if e.action == "navigate"]
        assert len(nav_entries) > 0
        assert nav_entries[-1].operator == "test-agent-x"
    finally:
        if sess:
            sess.close()
        custom_client.close()


def test_operator_inferred_from_agent_id(client):
    """When no X-Operator header, agent_id from session should be used."""
    sess = client.sessions.create(
        profile=TEST_PROFILE + "-agentid", headless=True, agent_id="my-agent-007"
    )
    try:
        sess.navigate("https://example.com")
        logs = sess.logs(tail=5)
        nav_entries = [e for e in logs if e.action == "navigate"]
        assert len(nav_entries) > 0
        assert nav_entries[-1].operator == "my-agent-007"
    finally:
        sess.close()


def test_operator_fallback_to_default(client):
    """Without X-Operator or agent_id, operator should default to 'agentmb-daemon'."""
    sess = client.sessions.create(profile=TEST_PROFILE + "-default-op", headless=True)
    try:
        sess.navigate("https://example.com")
        logs = sess.logs(tail=5)
        nav_entries = [e for e in logs if e.action == "navigate"]
        assert len(nav_entries) > 0
        assert nav_entries[-1].operator == "agentmb-daemon"
    finally:
        sess.close()
