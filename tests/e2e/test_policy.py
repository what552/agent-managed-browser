"""
E2E tests for r06-c02: safety execution policy layer.

Tests cover:
  T-POL-01: GET /policy returns daemon default profile ('disabled' in CI)
  T-POL-02: POST /policy changes session profile and returns updated config
  T-POL-03: 'disabled' profile — no throttle, navigate works normally
  T-POL-04: sensitive action blocked when profile='safe' + allow_sensitive_actions=False
  T-POL-05: sensitive action allowed after overriding allow_sensitive_actions=True
  T-POL-06: retry budget exhausted returns 403
  T-POL-07: policy events appear in audit logs (type='policy')
  T-POL-08: SDK set_policy / get_policy round-trip
  T-POL-09: CLI policy command (smoke via HTTP directly)

Requires: daemon running on localhost:19315 with AGENTMB_POLICY_PROFILE=disabled
Run: pytest tests/e2e/test_policy.py -v
"""

import os
import sys
import pytest
import httpx

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../sdk/python"))

from agentmb import BrowserClient, PolicyInfo

BASE_URL = f"http://127.0.0.1:{os.environ.get('AGENTMB_PORT', '19315')}"
TEST_PROFILE = "e2e-policy"


@pytest.fixture(scope="module")
def client():
    with BrowserClient(base_url=BASE_URL) as c:
        yield c


# ---------------------------------------------------------------------------
# T-POL-01: GET /policy — default profile from daemon
# ---------------------------------------------------------------------------

def test_policy_get_default(client):
    """GET /policy returns the daemon-level default profile."""
    sess = client.sessions.create(profile=TEST_PROFILE + "-default", headless=True)
    try:
        policy = sess.get_policy()
        assert isinstance(policy, PolicyInfo)
        assert policy.session_id == sess.id
        assert policy.profile in ("safe", "permissive", "disabled")
        assert isinstance(policy.jitter_ms, list)
        assert len(policy.jitter_ms) == 2
    finally:
        sess.close()


# ---------------------------------------------------------------------------
# T-POL-02: POST /policy — changes session profile
# ---------------------------------------------------------------------------

def test_policy_set_profile(client):
    """POST /policy sets the session profile and returns updated config."""
    sess = client.sessions.create(profile=TEST_PROFILE + "-set", headless=True)
    try:
        policy = sess.set_policy("permissive")
        assert isinstance(policy, PolicyInfo)
        assert policy.profile == "permissive"
        assert policy.allow_sensitive_actions is True
        # Verify GET also returns the new profile
        current = sess.get_policy()
        assert current.profile == "permissive"
    finally:
        sess.close()


# ---------------------------------------------------------------------------
# T-POL-03: disabled profile — navigate works, no delay
# ---------------------------------------------------------------------------

def test_policy_disabled_no_throttle(client):
    """With 'disabled' profile, navigate succeeds without extra delay."""
    sess = client.sessions.create(profile=TEST_PROFILE + "-nodis", headless=True)
    try:
        sess.set_policy("disabled")
        import time
        t0 = time.time()
        result = sess.navigate("https://example.com")
        elapsed = time.time() - t0
        assert result.status == "ok"
        # Should complete in well under 2 seconds (no jitter/throttle)
        assert elapsed < 10.0  # generous bound for network
    finally:
        sess.close()


# ---------------------------------------------------------------------------
# T-POL-04: sensitive action blocked by safe profile
# ---------------------------------------------------------------------------

def test_policy_sensitive_action_blocked(client):
    """In 'safe' profile with allow_sensitive_actions=False, sensitive=True is denied."""
    sess = client.sessions.create(profile=TEST_PROFILE + "-sensitive-block", headless=True)
    try:
        sess.set_policy("safe", allow_sensitive_actions=False)
        sess.navigate("https://example.com")
        # Send a click with sensitive=True — should be denied (403)
        resp = client._http.post(
            f"/api/v1/sessions/{sess.id}/click",
            json={"selector": "h1", "sensitive": True},
            headers={"content-type": "application/json"},
        )
        assert resp.status_code == 403
        body = resp.json()
        assert "error" in body
        assert "sensitive" in body["error"].lower() or "blocked" in body["error"].lower()
        assert body.get("policy_event") == "deny"
    finally:
        sess.close()


# ---------------------------------------------------------------------------
# T-POL-05: sensitive action allowed after override
# ---------------------------------------------------------------------------

def test_policy_sensitive_action_allowed_after_override(client):
    """After setting allow_sensitive_actions=True, sensitive actions are permitted."""
    sess = client.sessions.create(profile=TEST_PROFILE + "-sensitive-allow", headless=True)
    try:
        sess.set_policy("safe", allow_sensitive_actions=True)
        sess.navigate("https://example.com")
        # sensitive click on h1 should now succeed (no 403)
        resp = client._http.post(
            f"/api/v1/sessions/{sess.id}/click",
            json={"selector": "h1", "sensitive": True},
            headers={"content-type": "application/json"},
        )
        # Should succeed (200) or at worst fail with action error (422), NOT 403
        assert resp.status_code != 403, f"Expected no policy denial but got 403: {resp.json()}"
    finally:
        sess.close()


# ---------------------------------------------------------------------------
# T-POL-06: retry budget exhausted
# ---------------------------------------------------------------------------

def test_policy_retry_budget_exhausted(client):
    """Exceeding max_retries_per_domain returns 403 with policy_event='deny'."""
    sess = client.sessions.create(profile=TEST_PROFILE + "-retry", headless=True)
    try:
        # Set a policy with very low retry budget
        resp = client._http.post(
            f"/api/v1/sessions/{sess.id}/policy",
            json={"profile": "permissive"},
            headers={"content-type": "application/json"},
        )
        assert resp.status_code == 200

        # Manually push retry count past budget by sending retry=True repeatedly
        # permissive profile allows 10 retries; send 11
        sess.navigate("https://example.com")
        domain = "example.com"

        # Use a 'disabled' profile with a tiny max_retries override — we can't set
        # arbitrary overrides via API, so instead use 'safe' and exhaust its budget (3)
        sess.set_policy("safe")  # max_retries_per_domain=3

        denied = False
        for i in range(5):
            r = client._http.post(
                f"/api/v1/sessions/{sess.id}/navigate",
                json={"url": "https://example.com", "retry": True},
                headers={"content-type": "application/json"},
            )
            if r.status_code == 403 and r.json().get("policy_event") == "deny":
                denied = True
                break

        assert denied, "Expected retry budget to be exhausted within 5 retry attempts"
    finally:
        sess.close()


# ---------------------------------------------------------------------------
# T-POL-07: policy events in audit logs
# ---------------------------------------------------------------------------

def test_policy_events_in_audit_logs(client):
    """Policy throttle/deny events appear in session audit logs (type='policy')."""
    sess = client.sessions.create(profile=TEST_PROFILE + "-audit", headless=True)
    try:
        # Trigger a policy deny via sensitive action
        sess.set_policy("safe", allow_sensitive_actions=False)
        sess.navigate("https://example.com")
        # Attempt sensitive action (will be denied)
        client._http.post(
            f"/api/v1/sessions/{sess.id}/fill",
            json={"selector": "input", "value": "test", "sensitive": True},
            headers={"content-type": "application/json"},
        )
        # Check audit logs for policy entry
        entries = sess.logs(tail=10)
        policy_entries = [e for e in entries if e.type == "policy"]
        assert len(policy_entries) >= 1, "Expected at least one policy audit entry"
        deny_entries = [e for e in policy_entries if e.action == "deny"]
        assert len(deny_entries) >= 1, "Expected a 'deny' policy audit entry"
    finally:
        sess.close()


# ---------------------------------------------------------------------------
# T-POL-08: SDK PolicyInfo round-trip
# ---------------------------------------------------------------------------

def test_policy_sdk_model(client):
    """PolicyInfo model has all required fields."""
    sess = client.sessions.create(profile=TEST_PROFILE + "-model", headless=True)
    try:
        p = sess.set_policy("permissive", allow_sensitive_actions=True)
        assert isinstance(p, PolicyInfo)
        assert p.profile == "permissive"
        assert p.domain_min_interval_ms >= 0
        assert p.cooldown_after_error_ms >= 0
        assert p.max_retries_per_domain > 0
        assert p.max_actions_per_minute > 0
        assert p.allow_sensitive_actions is True
    finally:
        sess.close()


# ---------------------------------------------------------------------------
# T-POL-09: invalid profile returns 400
# ---------------------------------------------------------------------------

def test_policy_invalid_profile_returns_400(client):
    """Setting an unknown profile returns 400."""
    sess = client.sessions.create(profile=TEST_PROFILE + "-invalid", headless=True)
    try:
        resp = client._http.post(
            f"/api/v1/sessions/{sess.id}/policy",
            json={"profile": "ultra-stealth"},
            headers={"content-type": "application/json"},
        )
        assert resp.status_code == 400
        assert "invalid" in resp.json()["error"].lower() or "profile" in resp.json()["error"].lower()
    finally:
        sess.close()
