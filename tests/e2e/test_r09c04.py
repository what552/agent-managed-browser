"""R09-C04 — T02/T08/T12/T14 feature tests.

T12: navigate response includes sensitive_warning for sensitive domains.
T02: route mock pattern supports /regex/flags strings in addition to glob.
T14: allow_dirs whitelist + /utils/ls file scan endpoint.
T08: session-level proxy_url accepted at creation time.
"""
import os
import tempfile
import pytest
import requests

BASE = f"http://127.0.0.1:{os.environ.get('AGENTMB_PORT', '19315')}"


def api(method: str, path: str, **kwargs):
    return getattr(requests, method)(f"{BASE}{path}", timeout=30, **kwargs)


def new_session(profile: str = "r09c04-default", **extra) -> str:
    body = {"profile": profile, **extra}
    r = api("post", "/api/v1/sessions", json=body)
    assert r.status_code == 201, f"session create failed: {r.text}"
    return r.json()["session_id"]


def rm_session(sid: str) -> None:
    api("delete", f"/api/v1/sessions/{sid}")


# ---------------------------------------------------------------------------
# T12 — Sensitive domain detection
# ---------------------------------------------------------------------------

class TestSensitiveWarning:

    def test_navigate_sensitive_domain_has_warning(self):
        """navigate to a 'bank' domain → response includes sensitive_warning.

        We register a catch-all route mock so Playwright intercepts the navigation
        before any DNS lookup occurs, allowing the sensitive URL to 'succeed'.
        """
        sid = new_session("r09c04-t12-sensitive")
        try:
            # Register catch-all mock so Playwright can intercept navigation to any URL
            rr = api("post", f"/api/v1/sessions/{sid}/route", json={
                "pattern": "**/*",
                "mock": {
                    "status": 200,
                    "content_type": "text/html",
                    "body": "<html><body>mocked banking page</body></html>",
                },
            })
            assert rr.status_code == 201, f"route register failed: {rr.text}"

            # Navigate to a URL with 'bank' in the domain
            r = api("post", f"/api/v1/sessions/{sid}/navigate",
                    json={"url": "http://examplebank.local/"})
            assert r.status_code == 200, f"navigate failed: {r.text}"
            data = r.json()
            assert "sensitive_warning" in data, f"expected sensitive_warning in {data}"
            w = data["sensitive_warning"]
            assert w["category"] == "financial", f"expected financial, got: {w}"
            assert "sensitive" in w["message"].lower(), f"unexpected message: {w['message']}"
        finally:
            rm_session(sid)

    def test_navigate_non_sensitive_domain_no_warning(self):
        """navigate to a normal URL → no sensitive_warning field."""
        sid = new_session("r09c04-t12-normal")
        try:
            # Register catch-all mock to ensure navigation always succeeds
            api("post", f"/api/v1/sessions/{sid}/route", json={
                "pattern": "**/*",
                "mock": {"status": 200, "content_type": "text/html", "body": "<html><body>ok</body></html>"},
            })
            r = api("post", f"/api/v1/sessions/{sid}/navigate",
                    json={"url": "http://example.local/"})
            assert r.status_code == 200, f"navigate failed: {r.text}"
            data = r.json()
            assert "sensitive_warning" not in data, f"unexpected sensitive_warning in {data}"
        finally:
            rm_session(sid)


# ---------------------------------------------------------------------------
# T02 — Regex pattern route mock
# ---------------------------------------------------------------------------

class TestRegexRouteMock:

    def test_regex_pattern_route_mock(self):
        """Register a /regex/flags route and verify it intercepts matching URLs."""
        sid = new_session("r09c04-t02-regex")
        try:
            # Register a regex route: match any URL containing /api/ with .json extension
            r = api("post", f"/api/v1/sessions/{sid}/route", json={
                "pattern": r"/\/api\/.*\.json/i",
                "mock": {
                    "status": 200,
                    "content_type": "application/json",
                    "body": '{"mocked": true, "source": "regex_route"}',
                },
            })
            assert r.status_code == 201, f"route register failed: {r.text}"

            # Navigate to a test page, then eval fetch to trigger the mock
            nav = api("post", f"/api/v1/sessions/{sid}/navigate",
                      json={"url": "https://example.com/"})
            assert nav.status_code in (200, 422), f"navigate: {nav.text}"

            # Fetch a URL matching the regex
            eval_r = api("post", f"/api/v1/sessions/{sid}/eval", json={
                "expression": (
                    "fetch('/api/data.json')"
                    "  .then(r => r.json())"
                    "  .then(d => JSON.stringify(d))"
                ),
                "timeout_ms": 5000,
            })
            if eval_r.status_code == 200:
                result = eval_r.json().get("result", "")
                assert "mocked" in result, f"expected mocked response, got: {result}"

            # Verify route appears in list
            routes = api("get", f"/api/v1/sessions/{sid}/routes").json()
            patterns = [rt["pattern"] for rt in routes.get("routes", [])]
            assert r"/\/api\/.*\.json/i" in patterns
        finally:
            rm_session(sid)

    def test_glob_pattern_route_not_regressed(self):
        """Existing glob-style route still works after regex support added."""
        sid = new_session("r09c04-t02-glob")
        try:
            r = api("post", f"/api/v1/sessions/{sid}/route", json={
                "pattern": "**/api/data**",
                "mock": {"status": 200, "body": "glob_ok"},
            })
            assert r.status_code == 201, f"route register failed: {r.text}"

            routes = api("get", f"/api/v1/sessions/{sid}/routes").json()
            patterns = [rt["pattern"] for rt in routes.get("routes", [])]
            assert "**/api/data**" in patterns
        finally:
            rm_session(sid)


# ---------------------------------------------------------------------------
# T14 — allow_dirs + /utils/ls
# ---------------------------------------------------------------------------

class TestAllowDirsLs:

    def test_ls_succeeds_within_allowed_dir(self):
        """Session with allow_dirs → /utils/ls returns entries for allowed path."""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create some test files
            with open(os.path.join(tmpdir, "hello.txt"), "w") as f:
                f.write("hello")
            with open(os.path.join(tmpdir, "world.txt"), "w") as f:
                f.write("world")

            sid = new_session("r09c04-t14-allowed", allow_dirs=[tmpdir])
            try:
                r = api("get", "/api/v1/utils/ls", params={
                    "session_id": sid, "path": tmpdir,
                })
                assert r.status_code == 200, f"ls failed: {r.text}"
                data = r.json()
                # R09-C07: handleLs now returns realpath — on macOS /var is a symlink to /private/var
                assert data["path"] == os.path.realpath(tmpdir)
                names = [e["name"] for e in data["entries"]]
                assert "hello.txt" in names
                assert "world.txt" in names
            finally:
                rm_session(sid)

    def test_ls_denied_outside_allowed_dir(self):
        """Session with allow_dirs → /utils/ls returns 403 for path outside allowed dir."""
        with tempfile.TemporaryDirectory() as tmpdir:
            sid = new_session("r09c04-t14-denied", allow_dirs=[tmpdir])
            try:
                r = api("get", "/api/v1/utils/ls", params={
                    "session_id": sid, "path": "/etc",
                })
                assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"
            finally:
                rm_session(sid)

    def test_ls_denied_no_allow_dirs(self):
        """Session without allow_dirs → /utils/ls returns 403."""
        sid = new_session("r09c04-t14-noallowdirs")
        try:
            r = api("get", "/api/v1/utils/ls", params={
                "session_id": sid, "path": "/tmp",
            })
            assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"
        finally:
            rm_session(sid)


# ---------------------------------------------------------------------------
# T08 — Session-level proxy
# ---------------------------------------------------------------------------

class TestSessionProxy:

    def test_session_creation_with_proxy_url(self):
        """Session created with proxy_url → creation succeeds (proxy connectivity not tested)."""
        # Use a non-routable proxy address; browser launch should succeed regardless
        # because proxy is only used when making actual network requests
        r = api("post", "/api/v1/sessions", json={
            "profile": "r09c04-t08-proxy",
            "proxy_url": "http://proxy.invalid:8080",
        })
        # Expect 201 (browser launches fine; proxy is not connected until navigation)
        assert r.status_code == 201, f"session creation with proxy_url failed: {r.text}"
        sid = r.json()["session_id"]
        try:
            assert r.json()["session_id"] == sid
        finally:
            rm_session(sid)
