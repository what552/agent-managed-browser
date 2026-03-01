"""R09-C02 — Profile persistence, bbox 409 stale_ref, ephemeral isolation.

P0: Named profiles store userDataDir in ~/.agentmb/profiles/<name>.
    Login state (cookies) survives session close+reopen with same profile.

P1: bbox with ref_id → 409 stale_ref when element is no longer in DOM,
    consistent with resolveTarget semantics in actions.ts.
"""
import os
import pytest
import requests

BASE = f"http://127.0.0.1:{os.environ.get('AGENTMB_PORT', '19315')}"
REQUEST_TIMEOUT_S = 120


def api(method: str, path: str, **kwargs):
    return getattr(requests, method)(f"{BASE}{path}", timeout=REQUEST_TIMEOUT_S, **kwargs)


def new_session(profile: str = "default", ephemeral: bool = False) -> str:
    body: dict = {"profile": profile}
    if ephemeral:
        body = {"ephemeral": True}
    r = api("post", "/api/v1/sessions", json=body)
    assert r.status_code == 201, f"session create failed: {r.text}"
    return r.json()["session_id"]


def rm_session(sid: str) -> None:
    api("delete", f"/api/v1/sessions/{sid}")


def navigate(sid: str, url: str) -> None:
    r = api("post", f"/api/v1/sessions/{sid}/navigate", json={"url": url})
    assert r.status_code == 200, f"navigate failed: {r.text}"


def evl(sid: str, expr: str) -> str:
    r = api("post", f"/api/v1/sessions/{sid}/eval", json={"expression": expr})
    assert r.status_code == 200, f"eval failed: {r.text}"
    return str(r.json().get("result", ""))


# ---------------------------------------------------------------------------
# P0 — Profile persistence
# ---------------------------------------------------------------------------

class TestProfilePersistence:

    def test_cookie_persists_across_sessions(self):
        """Cookie set in session A survives close; visible in session B (same profile)."""
        profile = "r09c02-persist"
        sid_a = new_session(profile)
        try:
            navigate(sid_a, "https://example.com")
            # Set a persistent cookie (far-future expiry so it survives session close)
            evl(sid_a, (
                "document.cookie = 'agentmb_r09c02=persist_ok; "
                "path=/; max-age=86400'; document.cookie"
            ))
            cookie_before = evl(sid_a, "document.cookie")
            assert "agentmb_r09c02=persist_ok" in cookie_before
        finally:
            rm_session(sid_a)

        # Open new session with SAME profile — cookies should survive
        sid_b = new_session(profile)
        try:
            navigate(sid_b, "https://example.com")
            cookie_after = evl(sid_b, "document.cookie")
            assert "agentmb_r09c02=persist_ok" in cookie_after, (
                f"Cookie did not persist across sessions. Got: {cookie_after!r}"
            )
        finally:
            rm_session(sid_b)

    def test_profile_dir_listed_in_profiles_api(self):
        """Profile must appear in GET /api/v1/profiles after session creation."""
        profile = "r09c02-dircheck"
        sid = new_session(profile)
        try:
            r = api("get", "/api/v1/profiles")
            assert r.status_code == 200
            names = [p["name"] for p in r.json().get("profiles", [])]
            assert profile in names, (
                f"Profile '{profile}' not found in /api/v1/profiles. Got: {names}"
            )
        finally:
            rm_session(sid)

    def test_ephemeral_session_flag(self):
        """Ephemeral sessions are created successfully and flagged correctly."""
        sid = new_session(ephemeral=True)
        try:
            r = api("get", f"/api/v1/sessions/{sid}")
            assert r.status_code == 200
            assert r.json().get("ephemeral") is True
        finally:
            rm_session(sid)

    def test_different_profiles_isolated(self):
        """Two profiles share no cookie state."""
        sid_a = new_session("r09c02-iso-a")
        sid_b = new_session("r09c02-iso-b")
        try:
            navigate(sid_a, "https://example.com")
            navigate(sid_b, "https://example.com")
            evl(sid_a, "document.cookie = 'only_in_a=yes; path=/'")
            cookie_b = evl(sid_b, "document.cookie")
            assert "only_in_a" not in cookie_b, (
                "Cookie from profile A leaked into profile B"
            )
        finally:
            rm_session(sid_a)
            rm_session(sid_b)


# ---------------------------------------------------------------------------
# P1 — bbox returns 409 stale_ref for ref_id cases
# ---------------------------------------------------------------------------

class TestBbox409StaleRef:

    def test_bbox_missing_snapshot_returns_409(self):
        """bbox with ref_id whose snapshot doesn't exist → 409 stale_ref."""
        sid = new_session("r09c02-bbox1")
        try:
            navigate(sid, "https://example.com")
            r = api("post", f"/api/v1/sessions/{sid}/bbox",
                    json={"ref_id": "snap_deadbeef:e1"})
            assert r.status_code == 409, f"Expected 409, got {r.status_code}: {r.text}"
            assert r.json()["error"] == "stale_ref"
        finally:
            rm_session(sid)

    def test_bbox_stale_after_navigation(self):
        """bbox ref_id from snapshot taken before navigation → 409 (page_rev changed)."""
        sid = new_session("r09c02-bbox2")
        try:
            navigate(sid, "https://example.com")
            # Take snapshot to get a valid ref_id
            r = api("post", f"/api/v1/sessions/{sid}/snapshot_map", json={})
            assert r.status_code == 200
            elements = r.json().get("elements", [])
            if not elements:
                pytest.skip("No snapshot elements on example.com; skipping stale-nav test")
            ref_id = elements[0]["ref_id"]

            # Navigate — page_rev increments, snapshot becomes stale
            navigate(sid, "https://example.com")

            r = api("post", f"/api/v1/sessions/{sid}/bbox", json={"ref_id": ref_id})
            assert r.status_code == 409, (
                f"Expected 409 stale_ref after navigation, got {r.status_code}: {r.text}"
            )
            assert r.json()["error"] == "stale_ref"
        finally:
            rm_session(sid)

    def test_bbox_ref_id_element_removed_from_dom(self):
        """bbox ref_id valid snapshot but element removed from DOM → 409 stale_ref (P1 fix)."""
        sid = new_session("r09c02-bbox3")
        try:
            navigate(sid, "https://example.com")
            # element_map injects data-agentmb-eid; snapshot_map records page_rev
            r_em = api("post", f"/api/v1/sessions/{sid}/element_map", json={})
            assert r_em.status_code == 200
            elements = r_em.json().get("elements", [])
            if not elements:
                pytest.skip("No elements found; skipping DOM-removal test")

            # Take snapshot to get valid ref_ids
            r_snap = api("post", f"/api/v1/sessions/{sid}/snapshot_map", json={})
            assert r_snap.status_code == 200
            snap_elements = r_snap.json().get("elements", [])
            if not snap_elements:
                pytest.skip("No snapshot elements; skipping DOM-removal test")

            ref_id = snap_elements[0]["ref_id"]
            # Extract eid from ref_id (format: snap_XXXXXX:eN)
            eid = ref_id.split(":")[1]  # e.g. "e1"

            # Remove the element from DOM without navigating (page_rev unchanged)
            evl(sid, f"var el = document.querySelector('[data-agentmb-eid=\"{eid}\"]'); if(el) el.remove();")

            # bbox should return 409 now that element is gone (P1 fix)
            r = api("post", f"/api/v1/sessions/{sid}/bbox", json={"ref_id": ref_id})
            assert r.status_code == 409, (
                f"Expected 409 stale_ref when element removed from DOM, got {r.status_code}: {r.text}"
            )
            assert r.json()["error"] == "stale_ref"
        finally:
            rm_session(sid)

    def test_bbox_selector_not_found_returns_200(self):
        """bbox with CSS selector (not ref_id) that matches nothing → 200 found:false (unchanged)."""
        sid = new_session("r09c02-bbox4")
        try:
            navigate(sid, "https://example.com")
            r = api("post", f"/api/v1/sessions/{sid}/bbox",
                    json={"selector": "#agentmb-r09c02-nonexistent"})
            assert r.status_code == 200, f"Expected 200 for selector not found, got {r.status_code}"
            assert r.json()["found"] is False
        finally:
            rm_session(sid)

    def test_bbox_element_id_not_found_returns_200(self):
        """bbox with element_id (not ref_id) that matches nothing → 200 found:false (unchanged)."""
        sid = new_session("r09c02-bbox5")
        try:
            navigate(sid, "https://example.com")
            r = api("post", f"/api/v1/sessions/{sid}/bbox",
                    json={"element_id": "e9999"})
            assert r.status_code == 200, f"Expected 200 for element_id not found, got {r.status_code}"
            assert r.json()["found"] is False
        finally:
            rm_session(sid)
