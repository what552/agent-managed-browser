"""
E2E tests — CDP passthrough endpoint + audit purpose/operator fields
Requires: daemon running on localhost:19315
Run: pytest tests/e2e/test_cdp.py -v
"""

import os
import sys
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../sdk/python"))

from agentmb import BrowserClient
from agentmb.models import AuditEntry

BASE_URL = f"http://127.0.0.1:{os.environ.get('AGENTMB_PORT', '19315')}"
TEST_PROFILE = "e2e-cdp-test"


@pytest.fixture(scope="module")
def client():
    with BrowserClient(base_url=BASE_URL) as c:
        yield c


@pytest.fixture(scope="module")
def session(client):
    sess = client.sessions.create(profile=TEST_PROFILE, headless=True)
    sess.navigate("https://example.com")
    yield sess
    sess.close()


# ---------------------------------------------------------------------------
# T08: CDP endpoint
# ---------------------------------------------------------------------------

def test_cdp_info(session):
    """GET /api/v1/sessions/:id/cdp returns target info."""
    info = session.cdp_info()
    assert "session_id" in info
    assert info["session_id"] == session.id
    assert "targets" in info
    assert isinstance(info["targets"], list)
    assert len(info["targets"]) >= 1


def test_cdp_send_runtime_evaluate(session):
    """POST /api/v1/sessions/:id/cdp sends a CDP command and returns result."""
    resp = session.cdp_send("Runtime.evaluate", {"expression": "1 + 1", "returnByValue": True})
    assert "result" in resp
    result = resp["result"]
    assert "result" in result
    assert result["result"]["value"] == 2


def test_cdp_send_page_title(session):
    """CDP Runtime.evaluate can fetch document.title."""
    resp = session.cdp_send("Runtime.evaluate", {"expression": "document.title", "returnByValue": True})
    assert resp["result"]["result"]["value"] == "Example Domain"


def test_cdp_send_invalid_method(session):
    """Unknown CDP method should return 400."""
    import httpx
    with pytest.raises(httpx.HTTPStatusError) as exc_info:
        session.cdp_send("InvalidMethod.doesNotExist", {})
    assert exc_info.value.response.status_code == 400


def test_cdp_404_unknown_session(client):
    """CDP on nonexistent session returns 404."""
    import httpx
    with pytest.raises(httpx.HTTPStatusError) as exc_info:
        client._get("/api/v1/sessions/sess_nonexistent999/cdp")
    assert exc_info.value.response.status_code == 404


# ---------------------------------------------------------------------------
# T10: audit purpose/operator fields
# ---------------------------------------------------------------------------

def test_audit_purpose_operator(client):
    """navigate with purpose+operator should appear in audit logs."""
    sess = client.sessions.create(profile=TEST_PROFILE + "-audit", headless=True)
    try:
        sess.navigate(
            "https://example.com",
            purpose="test-audit-fields",
            operator="pytest-runner",
        )
        entries = sess.logs(tail=5)
        assert len(entries) > 0
        nav_entries = [e for e in entries if e.action == "navigate"]
        assert len(nav_entries) >= 1
        entry = nav_entries[-1]
        assert entry.purpose == "test-audit-fields"
        assert entry.operator == "pytest-runner"
    finally:
        sess.close()


def test_audit_purpose_optional(client):
    """navigate without purpose/operator should still work (backward compat)."""
    sess = client.sessions.create(profile=TEST_PROFILE + "-compat", headless=True)
    try:
        result = sess.navigate("https://example.com")
        assert result.status == "ok"
        entries = sess.logs(tail=5)
        nav_entries = [e for e in entries if e.action == "navigate"]
        assert len(nav_entries) >= 1
        entry = nav_entries[-1]
        # Without purpose/operator, fields should be None/absent
        assert entry.purpose is None
        assert entry.operator is None
    finally:
        sess.close()


def test_audit_entry_model_has_fields():
    """AuditEntry model accepts purpose and operator fields."""
    entry = AuditEntry(
        type="action",
        action="navigate",
        purpose="smoke-test",
        operator="agent-001",
    )
    assert entry.purpose == "smoke-test"
    assert entry.operator == "agent-001"
