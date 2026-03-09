"""
R10-C07 e2e tests: Issues #10-#15 — multi-fix batch

Fixes:
  #10 — pages new auto-switches active context
  #11 — switchPage brings tab to front (screenshot correct tab)
  #12 — browser-launch Connect-with hint includes --profile
  #13 — profile delete 404 returns cross-zone hint
  #14 — session prune removes zombie sessions
  #15 — session list shows zone field
"""
from __future__ import annotations

import os
import sys
import time

import httpx
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../sdk/python"))

PORT = os.environ.get("AGENTMB_PORT", "19315")
BASE_URL = f"http://127.0.0.1:{PORT}"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def daemon_running() -> bool:
    try:
        httpx.get(f"{BASE_URL}/health", timeout=2).raise_for_status()
        return True
    except Exception:
        return False


pytestmark = pytest.mark.skipif(
    not daemon_running(),
    reason="agentmb daemon not running"
)


def new_session(client: httpx.Client, **kwargs) -> str:
    r = client.post("/api/v1/sessions", json={"headless": True, **kwargs})
    assert r.status_code == 201, r.text
    return r.json()["session_id"]


def close_session(client: httpx.Client, sid: str) -> None:
    client.delete(f"/api/v1/sessions/{sid}")


# ---------------------------------------------------------------------------
# Issue #10: pages new auto-switches active page
# ---------------------------------------------------------------------------

class TestIssue10PagesNewAutoSwitch:
    def test_new_page_becomes_active(self):
        """After POST /pages, the new page should be the active page."""
        with httpx.Client(base_url=BASE_URL, timeout=15) as c:
            sid = new_session(c)
            try:
                # Get the initial page list to find the existing page
                initial_r = c.get(f"/api/v1/sessions/{sid}/pages")
                assert initial_r.status_code == 200
                initial_pages = initial_r.json()["pages"]
                assert len(initial_pages) == 1
                original_id = initial_pages[0]["page_id"]
                assert initial_pages[0]["active"] is True

                # Create a new page
                create_r = c.post(f"/api/v1/sessions/{sid}/pages")
                assert create_r.status_code == 201, create_r.text
                new_page_id = create_r.json()["page_id"]
                assert new_page_id != original_id

                # The new page must now be active
                pages_r = c.get(f"/api/v1/sessions/{sid}/pages")
                assert pages_r.status_code == 200
                pages = pages_r.json()["pages"]
                active_ids = [p["page_id"] for p in pages if p["active"]]
                assert active_ids == [new_page_id], (
                    f"Expected new page {new_page_id} to be active, got active={active_ids}"
                )
            finally:
                close_session(c, sid)

    def test_original_page_deactivated_after_new(self):
        """Original page must not remain active after creating a new page."""
        with httpx.Client(base_url=BASE_URL, timeout=15) as c:
            sid = new_session(c)
            try:
                pages_before = c.get(f"/api/v1/sessions/{sid}/pages").json()["pages"]
                orig_id = pages_before[0]["page_id"]

                c.post(f"/api/v1/sessions/{sid}/pages")

                pages_after = c.get(f"/api/v1/sessions/{sid}/pages").json()["pages"]
                orig_entry = next(p for p in pages_after if p["page_id"] == orig_id)
                assert orig_entry["active"] is False, (
                    f"Original page {orig_id} should not be active after new page created"
                )
            finally:
                close_session(c, sid)


# ---------------------------------------------------------------------------
# Issue #11: switchPage returns 200 OK
# ---------------------------------------------------------------------------

class TestIssue11SwitchPage:
    def test_switch_page_returns_ok(self):
        """POST /pages/switch should succeed and change the active page."""
        with httpx.Client(base_url=BASE_URL, timeout=15) as c:
            sid = new_session(c)
            try:
                # Create a second page so we have something to switch to
                create_r = c.post(f"/api/v1/sessions/{sid}/pages")
                assert create_r.status_code == 201
                new_pid = create_r.json()["page_id"]

                # Get the original page
                pages = c.get(f"/api/v1/sessions/{sid}/pages").json()["pages"]
                orig_pid = next(p["page_id"] for p in pages if p["page_id"] != new_pid)

                # Switch back to original
                sw_r = c.post(
                    f"/api/v1/sessions/{sid}/pages/switch",
                    json={"page_id": orig_pid},
                )
                assert sw_r.status_code == 200, sw_r.text
                assert sw_r.json()["active_page_id"] == orig_pid

                # Verify active state
                pages_after = c.get(f"/api/v1/sessions/{sid}/pages").json()["pages"]
                active = [p["page_id"] for p in pages_after if p["active"]]
                assert active == [orig_pid]
            finally:
                close_session(c, sid)

    def test_switch_to_nonexistent_page_returns_404(self):
        """Switching to a non-existent page_id should return 404."""
        with httpx.Client(base_url=BASE_URL, timeout=15) as c:
            sid = new_session(c)
            try:
                sw_r = c.post(
                    f"/api/v1/sessions/{sid}/pages/switch",
                    json={"page_id": "page_nonexistent"},
                )
                assert sw_r.status_code == 404, sw_r.text
            finally:
                close_session(c, sid)


# ---------------------------------------------------------------------------
# Issue #13: profile delete 404 cross-zone hint
# ---------------------------------------------------------------------------

class TestIssue13ProfileDeleteHint:
    def test_profile_delete_nonexistent_returns_404(self):
        """Deleting a profile that doesn't exist returns 404."""
        with httpx.Client(base_url=BASE_URL, timeout=10) as c:
            r = c.delete("/api/v1/profiles/nonexistent-r10c07-test?zone=managed")
            assert r.status_code == 404, r.text
            body = r.json()
            assert "error" in body

    def test_profile_delete_404_has_error_field(self):
        """404 response must always include 'error' field."""
        with httpx.Client(base_url=BASE_URL, timeout=10) as c:
            r = c.delete("/api/v1/profiles/totally-made-up-profile-xyz?zone=stable")
            assert r.status_code == 404
            assert "error" in r.json()


# ---------------------------------------------------------------------------
# Issue #14: session prune
# ---------------------------------------------------------------------------

class TestIssue14SessionPrune:
    def test_prune_returns_pruned_count(self):
        """DELETE /api/v1/sessions?state=zombie returns pruned count."""
        with httpx.Client(base_url=BASE_URL, timeout=15) as c:
            r = c.delete("/api/v1/sessions?state=zombie")
            assert r.status_code == 200, r.text
            body = r.json()
            assert "pruned" in body
            assert "ids" in body
            assert isinstance(body["pruned"], int)
            assert isinstance(body["ids"], list)

    def test_prune_dry_run_does_not_remove(self):
        """dry_run=true returns what would be pruned but doesn't remove anything."""
        with httpx.Client(base_url=BASE_URL, timeout=15) as c:
            # Get baseline zombie count
            r1 = c.delete("/api/v1/sessions?state=zombie&dry_run=true")
            assert r1.status_code == 200, r1.text
            body1 = r1.json()
            assert body1["dry_run"] is True
            dry_count = body1["pruned"]

            # Get actual zombie count from session list
            sessions_r = c.get("/api/v1/sessions")
            zombie_ids = [s["session_id"] for s in sessions_r.json() if s["state"] == "zombie"]
            assert dry_count == len(zombie_ids), (
                f"Dry-run count {dry_count} should match actual zombie count {len(zombie_ids)}"
            )

    def test_prune_invalid_state_returns_400(self):
        """Pruning with state!=zombie returns 400."""
        with httpx.Client(base_url=BASE_URL, timeout=10) as c:
            r = c.delete("/api/v1/sessions?state=live")
            assert r.status_code == 400, r.text


# ---------------------------------------------------------------------------
# Issue #15: session list shows zone field
# ---------------------------------------------------------------------------

class TestIssue15SessionListZone:
    def test_session_list_includes_zone(self):
        """GET /api/v1/sessions must include 'zone' field for each session."""
        with httpx.Client(base_url=BASE_URL, timeout=15) as c:
            sid = new_session(c)
            try:
                sessions_r = c.get("/api/v1/sessions")
                assert sessions_r.status_code == 200
                sessions = sessions_r.json()
                our_session = next((s for s in sessions if s.get("session_id") == sid), None)
                assert our_session is not None, f"Session {sid} not found in list"
                assert "zone" in our_session, f"'zone' field missing from session: {our_session}"
                assert our_session["zone"] in ("managed", "stable"), (
                    f"zone must be 'managed' or 'stable', got: {our_session['zone']}"
                )
            finally:
                close_session(c, sid)

    def test_chromium_session_zone_is_managed(self):
        """Default (Chromium) managed session should have zone='managed'."""
        with httpx.Client(base_url=BASE_URL, timeout=15) as c:
            sid = new_session(c)
            try:
                sessions = c.get("/api/v1/sessions").json()
                our = next(s for s in sessions if s.get("session_id") == sid)
                assert our["zone"] == "managed", f"Expected zone=managed, got {our['zone']}"
            finally:
                close_session(c, sid)
