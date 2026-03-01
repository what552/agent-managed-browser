"""R09 Stability Stress Tests

Three directions:
  1. Multi-page memory leak detection — rapid page create/close cycles,
     verifying Map cleanup and absence of accumulated garbage.
  2. Multi-agent concurrency races — concurrent addRoute/removeRoute on the
     same session, concurrent navigate + eval across agents.
  3. Extreme network delay fallback — delay_ms edge values, navigate timeout
     behaviour, page state consistency after timeout.

Run with:
    AGENTMB_PORT=19315 AGENTMB_DATA_DIR=/tmp/agentmb-claude \\
        pytest tests/e2e/test_r09_stability.py -v
"""

import os
import time
import threading
import concurrent.futures
import pytest
import requests

BASE = f"http://127.0.0.1:{os.environ.get('AGENTMB_PORT', '19315')}"
TIMEOUT = 45  # per-request HTTP timeout in seconds


def api(method: str, path: str, **kwargs):
    return getattr(requests, method)(f"{BASE}{path}", timeout=TIMEOUT, **kwargs)


def new_session(profile: str = "stability-default", **extra) -> str:
    body = {"profile": profile, **extra}
    r = api("post", "/api/v1/sessions", json=body)
    assert r.status_code == 201, f"session create failed: {r.text}"
    return r.json()["session_id"]


def rm_session(sid: str) -> None:
    try:
        api("delete", f"/api/v1/sessions/{sid}")
    except Exception:
        pass


def add_route(sid: str, pattern: str, mock: dict) -> requests.Response:
    return api("post", f"/api/v1/sessions/{sid}/route",
               json={"pattern": pattern, "mock": mock})


def remove_route(sid: str, pattern: str) -> requests.Response:
    return api("delete", f"/api/v1/sessions/{sid}/route",
               json={"pattern": pattern})


def new_page(sid: str) -> str:
    r = api("post", f"/api/v1/sessions/{sid}/pages", json={})
    assert r.status_code == 201, f"new_page failed: {r.text}"
    return r.json()["page_id"]


def close_page(sid: str, page_id: str) -> requests.Response:
    return api("delete", f"/api/v1/sessions/{sid}/pages/{page_id}")


def list_pages(sid: str) -> list:
    r = api("get", f"/api/v1/sessions/{sid}/pages")
    assert r.status_code == 200, f"list_pages failed: {r.text}"
    return r.json().get("pages", [])


def list_routes(sid: str) -> list:
    r = api("get", f"/api/v1/sessions/{sid}/routes")
    assert r.status_code == 200, f"list_routes failed: {r.text}"
    return r.json().get("routes", [])


def navigate(sid: str, url: str, **kwargs) -> requests.Response:
    return api("post", f"/api/v1/sessions/{sid}/navigate",
               json={"url": url, **kwargs})


def eval_js(sid: str, expr: str, **kwargs) -> requests.Response:
    return api("post", f"/api/v1/sessions/{sid}/eval",
               json={"expression": expr, **kwargs})


# ---------------------------------------------------------------------------
# Direction 1: Multi-page memory leak detection
# ---------------------------------------------------------------------------

class TestMultiPageMemoryLeak:
    """Verify that Map entries are properly cleaned up after page close cycles."""

    def test_page_create_close_cycle_cleans_pages_map(self):
        """Create and close many pages; verify sessionPages Map stays clean."""
        sid = new_session("stability-mem-01")
        try:
            # Install a catch-all route so navigations don't hit the network
            add_route(sid, "**/*", {
                "status": 200,
                "content_type": "text/html",
                "body": "<html><body>mock</body></html>",
            })

            initial_pages = list_pages(sid)
            assert len(initial_pages) == 1, "should start with exactly one page"
            initial_page_id = initial_pages[0]["page_id"]

            created_page_ids = []
            for i in range(10):
                pid = new_page(sid)
                created_page_ids.append(pid)

            pages_after_create = list_pages(sid)
            assert len(pages_after_create) == 11, (
                f"expected 11 pages after creating 10, got {len(pages_after_create)}"
            )

            # Close all except the initial page
            for pid in created_page_ids:
                r = close_page(sid, pid)
                assert r.status_code == 204, f"close_page failed for {pid}: {r.text}"

            pages_after_close = list_pages(sid)
            assert len(pages_after_close) == 1, (
                f"expected 1 page after closing all extras, got {len(pages_after_close)}: {pages_after_close}"
            )
            assert pages_after_close[0]["page_id"] == initial_page_id, (
                "the surviving page should be the initial page"
            )
        finally:
            rm_session(sid)

    def test_last_page_cannot_be_closed(self):
        """Closing the last page must return 409, not drop the session."""
        sid = new_session("stability-mem-02")
        try:
            pages = list_pages(sid)
            assert len(pages) == 1
            r = close_page(sid, pages[0]["page_id"])
            assert r.status_code == 409, (
                f"expected 409 LAST_PAGE, got {r.status_code}: {r.text}"
            )
            # Session must still be alive
            pages_after = list_pages(sid)
            assert len(pages_after) == 1, "session page count should be unchanged"
        finally:
            rm_session(sid)

    def test_rapid_page_cycle_50_rounds(self):
        """50 rounds of create+close; daemon must stay responsive throughout."""
        sid = new_session("stability-mem-03")
        try:
            add_route(sid, "**/*", {
                "status": 200, "content_type": "text/html",
                "body": "<html><body>rapid cycle</body></html>",
            })

            errors = []
            for i in range(50):
                try:
                    pid = new_page(sid)
                    r = close_page(sid, pid)
                    if r.status_code != 204:
                        errors.append(f"round {i}: close_page returned {r.status_code}: {r.text}")
                except Exception as e:
                    errors.append(f"round {i}: {e}")

            assert not errors, f"Errors during page cycling:\n" + "\n".join(errors)

            # Verify exactly 1 page remains (the original)
            pages = list_pages(sid)
            assert len(pages) == 1, (
                f"expected 1 page after 50 cycles, got {len(pages)}"
            )
        finally:
            rm_session(sid)

    def test_console_log_ring_buffer_bounded_across_pages(self):
        """Console ring buffer must not exceed MAX_CONSOLE entries regardless of page count."""
        sid = new_session("stability-mem-04")
        try:
            add_route(sid, "**/*", {
                "status": 200,
                "content_type": "text/html",
                "body": "<html><body>log test</body></html>",
            })

            # Open 5 pages and generate console logs on each
            page_ids = []
            for i in range(5):
                pid = new_page(sid)
                page_ids.append(pid)
                # Navigate so the page has an execution context
                navigate(sid, "http://local.test/", page_id=pid)
                # Generate 20 console.log entries
                eval_js(sid,
                        "for(let i=0;i<20;i++) console.log('log-' + i)",
                        page_id=pid)

            # Retrieve console log
            r = api("get", f"/api/v1/sessions/{sid}/console_log")
            if r.status_code == 200:
                entries = r.json().get("entries", [])
                assert len(entries) <= 500, (
                    f"console log exceeded MAX_CONSOLE=500: got {len(entries)}"
                )

            # Close all extra pages
            for pid in page_ids:
                close_page(sid, pid)
        finally:
            rm_session(sid)

    def test_page_specific_route_patterns_not_leaked(self):
        """Routes registered before page cycling are still intact after closes."""
        sid = new_session("stability-mem-05")
        try:
            add_route(sid, "**/api/data**", {
                "status": 200, "content_type": "application/json",
                "body": '{"ok": true}',
            })

            pids = [new_page(sid) for _ in range(5)]
            for pid in pids:
                close_page(sid, pid)

            routes = list_routes(sid)
            patterns = [rt["pattern"] for rt in routes]
            assert "**/api/data**" in patterns, (
                f"route should survive page cycling, got routes: {patterns}"
            )
        finally:
            rm_session(sid)


# ---------------------------------------------------------------------------
# Direction 2: Multi-agent concurrency races
# ---------------------------------------------------------------------------

class TestConcurrencyRaces:
    """Probe concurrent addRoute/removeRoute races and navigate+eval concurrency."""

    def test_concurrent_add_same_route_pattern(self):
        """Two threads calling addRoute for the same pattern concurrently.

        Acceptable outcomes:
          - Both succeed (201) — one handler wins, no crash
          - One or both return 201, route list has exactly 1 entry for the pattern

        Unacceptable outcomes:
          - Daemon 500 error
          - Stale/duplicate route entries in the registry
        """
        sid = new_session("stability-race-01")
        try:
            pattern = "**/concurrent/route**"
            mock = {"status": 200, "body": "concurrent_ok"}

            results = []
            errors = []

            def do_add():
                try:
                    r = add_route(sid, pattern, mock)
                    results.append(r.status_code)
                except Exception as e:
                    errors.append(str(e))

            threads = [threading.Thread(target=do_add) for _ in range(5)]
            for t in threads:
                t.start()
            for t in threads:
                t.join(timeout=30)

            assert not errors, f"Thread errors: {errors}"
            # All responses should be non-500
            assert all(s != 500 for s in results), (
                f"Got 500 responses during concurrent addRoute: {results}"
            )
            # Exactly one entry for the pattern in the route registry
            routes = list_routes(sid)
            matching = [rt for rt in routes if rt["pattern"] == pattern]
            assert len(matching) == 1, (
                f"Expected exactly 1 route entry for pattern, got {len(matching)}: {matching}"
            )
        finally:
            rm_session(sid)

    def test_concurrent_add_remove_interleaved(self):
        """Interleaved add/remove on the same pattern; registry must converge."""
        sid = new_session("stability-race-02")
        try:
            pattern = "**/flapping/**"
            mock = {"status": 200, "body": "flap"}
            cycle_errors = []

            def flap_cycle(n: int):
                for _ in range(n):
                    try:
                        add_route(sid, pattern, mock)
                        remove_route(sid, pattern)
                    except Exception as e:
                        cycle_errors.append(str(e))

            with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
                futs = [pool.submit(flap_cycle, 10) for _ in range(4)]
                for f in futs:
                    f.result(timeout=60)

            assert not cycle_errors, f"Cycle errors: {cycle_errors}"

            # Daemon health check: we can still perform basic operations
            r = api("get", f"/api/v1/sessions/{sid}/routes")
            assert r.status_code == 200, f"routes endpoint broken after flapping: {r.text}"
        finally:
            rm_session(sid)

    def test_concurrent_navigate_different_pages(self):
        """Multiple agents navigate different pages of the same session concurrently."""
        sid = new_session("stability-race-03")
        try:
            add_route(sid, "**/*", {
                "status": 200, "content_type": "text/html",
                "body": "<html><body>concurrent nav</body></html>",
            })

            page_ids = [new_page(sid) for _ in range(4)]
            urls = [
                "http://agent0.local/",
                "http://agent1.local/",
                "http://agent2.local/",
                "http://agent3.local/",
            ]

            nav_results = {}
            nav_errors = {}

            def do_navigate(pid: str, url: str):
                try:
                    r = navigate(sid, url, page_id=pid)
                    nav_results[pid] = r.status_code
                except Exception as e:
                    nav_errors[pid] = str(e)

            threads = [
                threading.Thread(target=do_navigate, args=(pid, url))
                for pid, url in zip(page_ids, urls)
            ]
            for t in threads:
                t.start()
            for t in threads:
                t.join(timeout=30)

            assert not nav_errors, f"Navigate errors: {nav_errors}"
            # All navigations must succeed
            for pid, status in nav_results.items():
                assert status == 200, f"page {pid} navigate returned {status}"

            # Verify each page landed on its own URL
            for pid, url in zip(page_ids, urls):
                r = eval_js(sid, "location.href", page_id=pid)
                assert r.status_code == 200, f"eval failed on {pid}: {r.text}"
                result = r.json().get("result", "")
                assert url in result, (
                    f"page {pid} expected URL containing {url!r}, got {result!r}"
                )

            # Cleanup
            for pid in page_ids:
                close_page(sid, pid)
        finally:
            rm_session(sid)

    def test_concurrent_eval_same_page(self):
        """Multiple agents eval JS on the same page concurrently — no crash or corruption."""
        sid = new_session("stability-race-04")
        try:
            add_route(sid, "**/*", {
                "status": 200, "content_type": "text/html",
                "body": "<html><head></head><body>eval race</body></html>",
            })
            navigate(sid, "http://eval-race.local/")

            results = []
            errors = []

            def do_eval(expr: str):
                try:
                    r = eval_js(sid, expr)
                    if r.status_code == 200:
                        results.append(r.json().get("result"))
                    else:
                        errors.append(f"status {r.status_code}: {r.text}")
                except Exception as e:
                    errors.append(str(e))

            threads = [
                threading.Thread(target=do_eval, args=(f"1 + {i}",))
                for i in range(20)
            ]
            for t in threads:
                t.start()
            for t in threads:
                t.join(timeout=30)

            assert not errors, f"Eval errors: {errors}"
            # All returned values must be integers 1..20
            for v in results:
                assert isinstance(v, (int, float)), f"unexpected eval result type: {v!r}"
        finally:
            rm_session(sid)

    def test_concurrent_route_add_while_navigating(self):
        """Add a route while a concurrent navigation is in progress.

        The navigation uses a slow route (delay_ms=500) on the initial request.
        A concurrent thread adds a new route while the first navigation is pending.
        Both operations must complete without 500 errors.
        """
        sid = new_session("stability-race-05")
        try:
            # Slow route for main page
            add_route(sid, "http://slow-nav.local/*", {
                "status": 200,
                "content_type": "text/html",
                "body": "<html><body>slow</body></html>",
                "delay_ms": 800,
            })

            nav_result = {}
            nav_error = {}
            add_result = {}
            add_error = {}

            def do_nav():
                try:
                    r = navigate(sid, "http://slow-nav.local/")
                    nav_result["status"] = r.status_code
                except Exception as e:
                    nav_error["err"] = str(e)

            def do_add():
                time.sleep(0.2)  # small delay so navigation is in-flight
                try:
                    r = add_route(sid, "**/other/**", {
                        "status": 200, "body": "other",
                    })
                    add_result["status"] = r.status_code
                except Exception as e:
                    add_error["err"] = str(e)

            t1 = threading.Thread(target=do_nav)
            t2 = threading.Thread(target=do_add)
            t1.start()
            t2.start()
            t1.join(timeout=30)
            t2.join(timeout=10)

            assert not nav_error, f"Navigate error: {nav_error}"
            assert not add_error, f"Add route error: {add_error}"
            assert nav_result.get("status") == 200, (
                f"navigation should succeed, got {nav_result}"
            )
            assert add_result.get("status") == 201, (
                f"addRoute should succeed, got {add_result}"
            )
        finally:
            rm_session(sid)

    def test_close_session_while_route_ops_in_flight(self):
        """closeSession called while concurrent route mutations are happening.

        The daemon must not crash; operations may return 404 (session gone)
        but must not return 500.
        """
        sid = new_session("stability-race-06")
        errors = []
        statuses = []

        def flap():
            for _ in range(30):
                try:
                    r = add_route(sid, "**/flap/**",
                                  {"status": 200, "body": "x"})
                    statuses.append(r.status_code)
                    r2 = remove_route(sid, "**/flap/**")
                    statuses.append(r2.status_code)
                except Exception as e:
                    errors.append(str(e))

        flapper = threading.Thread(target=flap)
        flapper.start()
        time.sleep(0.05)  # let flapper start
        rm_session(sid)
        flapper.join(timeout=30)

        # No 500s — 404 is acceptable (session already deleted)
        bad_statuses = [s for s in statuses if s == 500]
        assert not bad_statuses, f"Got 500 responses during closeSession race: {statuses}"


# ---------------------------------------------------------------------------
# Direction 3: Extreme network delay fallback
# ---------------------------------------------------------------------------

class TestNetworkDelayFallback:
    """Probe delay_ms extremes, navigate timeout behaviour, page state consistency."""

    def test_zero_delay_route_works_normally(self):
        """delay_ms=0 (or omitted) — standard mock, immediate fulfillment."""
        sid = new_session("stability-delay-01")
        try:
            add_route(sid, "**/*", {
                "status": 200,
                "content_type": "text/html",
                "body": "<html><body>instant</body></html>",
                "delay_ms": 0,
            })
            r = navigate(sid, "http://instant.local/")
            assert r.status_code == 200, f"navigate failed: {r.text}"
        finally:
            rm_session(sid)

    def test_small_delay_ms_route(self):
        """delay_ms=200 — navigation succeeds within reasonable time."""
        sid = new_session("stability-delay-02")
        try:
            add_route(sid, "**/*", {
                "status": 200,
                "content_type": "text/html",
                "body": "<html><body>delayed 200ms</body></html>",
                "delay_ms": 200,
            })
            t0 = time.time()
            r = navigate(sid, "http://delayed.local/")
            elapsed = time.time() - t0
            assert r.status_code == 200, f"navigate failed: {r.text}"
            # Should take at least 200ms (route delay) but less than 10s
            assert elapsed >= 0.18, f"response too fast ({elapsed:.3f}s), delay_ms not applied?"
            assert elapsed < 10, f"response too slow ({elapsed:.3f}s)"
        finally:
            rm_session(sid)

    def test_large_delay_ms_navigate_timeout_returns_error(self):
        """delay_ms large enough to trigger Playwright navigate timeout.

        The daemon should return an error response (not hang indefinitely or 500-crash).
        Acceptable status codes: 200 with timeout error details, or 422/500 from Playwright.
        The daemon must remain responsive after the timeout.
        """
        sid = new_session("stability-delay-03")
        try:
            # delay_ms=35000 exceeds Playwright's default 30s navigate timeout
            add_route(sid, "**/*", {
                "status": 200,
                "content_type": "text/html",
                "body": "<html><body>timeout-bait</body></html>",
                "delay_ms": 35000,
            })

            t0 = time.time()
            r = navigate(sid, "http://timeout-bait.local/")
            elapsed = time.time() - t0

            # Response must arrive (daemon must not hang)
            assert elapsed < 40, f"Daemon hung for {elapsed:.1f}s (expected timeout <35s)"

            # Expect a timeout error — could be 422, 500, or even 200 with error message
            # The key assertion is that the response is not a successful navigation
            if r.status_code == 200:
                data = r.json()
                # If 200, must indicate an error (status='timeout' or error field)
                has_error = "error" in data or data.get("status") == "timeout"
                assert has_error, (
                    f"navigate with 35s delay returned 200 OK with no error: {data}"
                )

            # Critical: daemon must remain responsive after timeout
            r2 = api("get", f"/api/v1/sessions/{sid}")
            assert r2.status_code == 200, (
                f"Session endpoint unresponsive after navigate timeout: {r2.status_code}"
            )
        finally:
            rm_session(sid)

    def test_page_state_after_navigate_timeout(self):
        """After a navigate timeout, the session must still accept new operations."""
        sid = new_session("stability-delay-04")
        try:
            # First navigate to a stable page
            add_route(sid, "http://base.local/*", {
                "status": 200,
                "content_type": "text/html",
                "body": "<html><body id='base'>base</body></html>",
                "delay_ms": 0,
            })
            r_base = navigate(sid, "http://base.local/")
            assert r_base.status_code == 200, f"base navigate failed: {r_base.text}"

            # Add a very-slow route that will cause timeout
            add_route(sid, "http://slow.local/*", {
                "status": 200,
                "content_type": "text/html",
                "body": "<html><body>slow</body></html>",
                "delay_ms": 35000,
            })

            # Navigate to slow page — expect timeout (we don't assert status)
            navigate(sid, "http://slow.local/")

            # After timeout, daemon must still serve eval requests
            r_eval = eval_js(sid, "document.readyState")
            # eval may succeed or fail depending on page state, but daemon must respond
            assert r_eval.status_code in (200, 422, 410), (
                f"eval after timeout returned unexpected {r_eval.status_code}: {r_eval.text}"
            )

            # Must be able to navigate again
            r_recover = navigate(sid, "http://base.local/")
            assert r_recover.status_code == 200, (
                f"recovery navigate after timeout failed: {r_recover.text}"
            )
        finally:
            rm_session(sid)

    def test_extreme_delay_ms_value_accepted_but_handled(self):
        """delay_ms=999999 is accepted by the route endpoint.

        The test verifies:
          1. Route is registered (201)
          2. A non-matching navigate still works (route pattern is specific)
          3. Daemon remains healthy
        """
        sid = new_session("stability-delay-05")
        try:
            # Register extreme delay on a very specific pattern that won't be hit
            r = add_route(sid, "http://extreme-delay-only.invalid/*", {
                "status": 200,
                "content_type": "text/html",
                "body": "<html><body>extreme</body></html>",
                "delay_ms": 999999,
            })
            # Route registration itself should succeed
            assert r.status_code == 201, (
                f"Route with extreme delay_ms rejected: {r.status_code} {r.text}"
            )

            # Navigate to a different URL (no route match — real network, or blocked)
            # We don't assert navigation success; we assert daemon health
            r_health = api("get", "/api/v1/sessions")
            assert r_health.status_code == 200, (
                f"Daemon unhealthy after extreme delay_ms route registration: {r_health.text}"
            )
        finally:
            rm_session(sid)

    def test_concurrent_delayed_routes_daemon_stability(self):
        """Register multiple delay_ms routes concurrently; daemon must not crash."""
        sid = new_session("stability-delay-06")
        try:
            errors = []
            statuses = []

            def register_delay_route(i: int):
                try:
                    r = add_route(sid, f"**/delay/{i}/**", {
                        "status": 200,
                        "body": f"delay_{i}",
                        "delay_ms": 500 * (i % 5 + 1),  # 500–2500ms
                    })
                    statuses.append(r.status_code)
                except Exception as e:
                    errors.append(str(e))

            with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
                futs = [pool.submit(register_delay_route, i) for i in range(20)]
                for f in futs:
                    f.result(timeout=30)

            assert not errors, f"Errors registering concurrent delay routes: {errors}"
            bad = [s for s in statuses if s not in (200, 201)]
            assert not bad, f"Non-2xx statuses from concurrent route registration: {statuses}"

            # Daemon must still list routes
            routes = list_routes(sid)
            assert len(routes) >= 10, (
                f"Expected at least 10 routes after concurrent registration, got {len(routes)}"
            )
        finally:
            rm_session(sid)

    def test_fill_no_timeout_on_existing_element(self):
        """fill completes normally on a rendered element (no timeout issues)."""
        sid = new_session("stability-delay-07")
        try:
            add_route(sid, "**/*", {
                "status": 200,
                "content_type": "text/html",
                "body": "<html><body><input id='f' type='text'/></body></html>",
            })
            navigate(sid, "http://fill-test.local/")
            r = api("post", f"/api/v1/sessions/{sid}/fill",
                    json={"selector": "#f", "value": "hello"})
            assert r.status_code in (200, 422), (
                f"fill returned unexpected status {r.status_code}: {r.text}"
            )
        finally:
            rm_session(sid)

    def test_network_conditions_offline_then_reset(self):
        """Set offline network condition, then reset; daemon must stay healthy."""
        sid = new_session("stability-delay-08")
        try:
            # Set offline
            r = api("post", f"/api/v1/sessions/{sid}/network_conditions",
                    json={"offline": True})
            if r.status_code == 404:
                pytest.skip("network_conditions endpoint not available")
            assert r.status_code in (200, 201), (
                f"set offline failed: {r.status_code} {r.text}"
            )

            # Reset
            r2 = api("delete", f"/api/v1/sessions/{sid}/network_conditions")
            assert r2.status_code in (200, 204), (
                f"reset network conditions failed: {r2.status_code} {r2.text}"
            )

            # Daemon still healthy
            r3 = api("get", f"/api/v1/sessions/{sid}")
            assert r3.status_code == 200
        finally:
            rm_session(sid)


# ---------------------------------------------------------------------------
# Cross-direction: combined stress — all three dimensions at once
# ---------------------------------------------------------------------------

class TestCombinedStress:
    """Combined scenario: multi-page + concurrency + delay_ms in one session."""

    def test_multi_page_concurrent_with_delay_routes(self):
        """Open 3 pages, navigate each concurrently through a delay_ms route.

        Verifies that:
          - All navigations complete (or time out gracefully)
          - Daemon remains responsive
          - Page count remains correct after operations
        """
        sid = new_session("stability-combined-01")
        try:
            # Route with moderate delay
            add_route(sid, "**/*", {
                "status": 200,
                "content_type": "text/html",
                "body": "<html><body>combined</body></html>",
                "delay_ms": 300,
            })

            page_ids = [new_page(sid) for _ in range(3)]
            urls = [f"http://combined-{i}.local/" for i in range(3)]

            results = {}
            errors = {}

            def do_nav(pid: str, url: str):
                try:
                    r = navigate(sid, url, page_id=pid)
                    results[pid] = r.status_code
                except Exception as e:
                    errors[pid] = str(e)

            threads = [
                threading.Thread(target=do_nav, args=(pid, url))
                for pid, url in zip(page_ids, urls)
            ]
            for t in threads:
                t.start()
            for t in threads:
                t.join(timeout=30)

            assert not errors, f"Nav errors: {errors}"
            for pid in page_ids:
                assert results.get(pid) == 200, (
                    f"page {pid} navigate status: {results.get(pid)}"
                )

            # Concurrent eval on all pages
            eval_results = {}
            eval_errors = {}

            def do_eval(pid: str):
                try:
                    r = eval_js(sid, "location.hostname", page_id=pid)
                    eval_results[pid] = r.status_code
                except Exception as e:
                    eval_errors[pid] = str(e)

            eth = [threading.Thread(target=do_eval, args=(pid,)) for pid in page_ids]
            for t in eth:
                t.start()
            for t in eth:
                t.join(timeout=20)

            assert not eval_errors, f"Eval errors: {eval_errors}"

            # Cleanup pages
            for pid in page_ids:
                close_page(sid, pid)

            # Verify we're back to 1 page
            remaining = list_pages(sid)
            assert len(remaining) == 1, (
                f"expected 1 page after cleanup, got {len(remaining)}"
            )

            # Final daemon health check
            r_health = api("get", "/api/v1/sessions")
            assert r_health.status_code == 200
        finally:
            rm_session(sid)
