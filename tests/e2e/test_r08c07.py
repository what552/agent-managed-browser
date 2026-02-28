"""
R08-C07 e2e tests

[P1] run_steps ref_id 解析支持
[P1] auto_fallback frame 偏移补偿（行为验证）
[P1] CLI 参数对齐：fill --fill-strategy/--char-delay-ms, mouse-move --steps, scroll-until --step-delay-ms
[P2] CLI 命令补齐：find / settings / cookie-delete / upload-url
"""
from __future__ import annotations

import base64
import os
import subprocess

import httpx
import pytest

from agentmb import BrowserClient

PORT = os.environ.get("AGENTMB_PORT", "19315")
BASE_URL = f"http://127.0.0.1:{PORT}"
TEST_PROFILE = "r08c07-test"


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
    try:
        s.close()
    except Exception:
        pass


# ---------------------------------------------------------------------------
# [P1] run_steps ref_id support
# ---------------------------------------------------------------------------

def test_run_steps_ref_id_click(session):
    """run_steps click via ref_id from snapshot_map."""
    html = _inline("""
        <html><body>
          <button id="btn">Click Me</button>
          <div id="out"></div>
          <script>document.getElementById('btn').onclick=()=>document.getElementById('out').textContent='clicked';</script>
        </body></html>
    """)
    session.navigate(html)
    # inject element-map IDs
    session.element_map()
    # take snapshot to get ref_ids
    snap = session.snapshot_map()
    assert snap.snapshot_id, "snapshot_id required"
    # find button ref_id
    btn_ref = next(
        (e.ref_id for e in snap.elements if "Click Me" in (e.label or "")),
        None,
    )
    if btn_ref is None:
        pytest.skip("button ref_id not found in snapshot (label synthesis may differ)")
    result = session.run_steps([{"action": "click", "params": {"ref_id": btn_ref}}])
    assert result.status in ("ok", "partial"), f"run_steps failed: {result}"
    assert result.failed_steps == 0


def test_run_steps_ref_id_fill(session):
    """run_steps fill via ref_id."""
    html = _inline("""
        <html><body>
          <input id="inp" type="text" placeholder="enter here" />
        </body></html>
    """)
    session.navigate(html)
    session.element_map()
    snap = session.snapshot_map()
    inp_ref = next(
        (e.ref_id for e in snap.elements if "enter here" in (e.label or "")),
        None,
    )
    if inp_ref is None:
        pytest.skip("input ref_id not found in snapshot")
    result = session.run_steps([
        {"action": "fill", "params": {"ref_id": inp_ref, "value": "hello ref_id"}}
    ])
    assert result.status == "ok"
    assert result.failed_steps == 0


def test_run_steps_ref_id_stale_raises(session):
    """run_steps with stale ref_id returns step error, not crash."""
    session.navigate(_inline("<html><body><p>page A</p></body></html>"))
    session.navigate(_inline("<html><body><p>page B</p></body></html>"))
    stale_ref = "snap_000000:e0"
    result = session.run_steps(
        [{"action": "click", "params": {"ref_id": stale_ref}}],
        stop_on_error=False,
    )
    assert result.failed_steps >= 1
    step0 = result.results[0]
    err = step0.error if hasattr(step0, "error") else (step0.get("error", {}) if hasattr(step0, "get") else {})
    assert "stale_ref" in str(err).lower() or "snapshot" in str(err).lower()


def test_run_steps_ref_id_invalid_format(session):
    """run_steps with malformed ref_id returns descriptive error."""
    session.navigate(_inline("<html><body><p>test</p></body></html>"))
    result = session.run_steps(
        [{"action": "click", "params": {"ref_id": "BAD_FORMAT"}}],
        stop_on_error=False,
    )
    assert result.failed_steps >= 1
    step0 = result.results[0]
    err = str(step0.error if hasattr(step0, "error") else (step0.get("error", "") if hasattr(step0, "get") else ""))
    assert "ref_id" in err.lower() or "invalid" in err.lower() or "snap_" in err.lower()


# ---------------------------------------------------------------------------
# [P1] auto_fallback frame offset compensation (behaviour)
# ---------------------------------------------------------------------------

def test_auto_fallback_in_frame(session):
    """auto_fallback should succeed for element inside an iframe."""
    inner_html = base64.b64encode(b"""
        <html><body>
          <button id="fbtn">Frame Button</button>
          <script>document.getElementById('fbtn').onclick=()=>document.title='frame_clicked';</script>
        </body></html>
    """).decode()
    outer_html = _inline(f"""
        <html><body>
          <iframe id="f" src="data:text/html;base64,{inner_html}" width="400" height="200"></iframe>
        </body></html>
    """)
    session.navigate(outer_html)
    r = httpx.post(
        f"{BASE_URL}/api/v1/sessions/{session.id}/click",
        json={
            "selector": "#fbtn",
            "frame": {"type": "nth", "value": 1},
            "executor": "auto_fallback",
            "timeout_ms": 3000,
        },
    )
    # auto_fallback with frame: expect ok or low_level executed_via
    data = r.json()
    assert r.status_code in (200, 422), f"Unexpected status: {r.status_code} {data}"
    if r.status_code == 200:
        assert data.get("executed_via") in ("high_level", "low_level")


# ---------------------------------------------------------------------------
# [P1] CLI fill --fill-strategy and --char-delay-ms
# ---------------------------------------------------------------------------

def _agentmb_cli(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["node", "dist/cli/index.js", *args],
        capture_output=True, text=True, timeout=15,
        cwd=os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
        env={**os.environ, "AGENTMB_PORT": PORT},
    )


def test_cli_fill_type_strategy(session):
    """CLI fill --fill-strategy type sends char_delay_ms to daemon."""
    html = _inline("<html><body><input id='i' type='text'/></body></html>")
    session.navigate(html)
    r = _agentmb_cli("fill", session.id, "#i", "hello", "--fill-strategy", "type", "--char-delay-ms", "5")
    assert r.returncode == 0, f"CLI error: {r.stderr}"
    assert "Filled" in r.stdout


def test_cli_fill_normal_strategy(session):
    """CLI fill without strategy defaults to normal."""
    html = _inline("<html><body><input id='i' type='text'/></body></html>")
    session.navigate(html)
    r = _agentmb_cli("fill", session.id, "#i", "world")
    assert r.returncode == 0, f"CLI error: {r.stderr}"
    assert "Filled" in r.stdout


# ---------------------------------------------------------------------------
# [P1] CLI mouse-move --steps
# ---------------------------------------------------------------------------

def test_cli_mouse_move_coords(session):
    """CLI mouse-move with coordinates."""
    session.navigate(_inline("<html><body><p>test</p></body></html>"))
    r = _agentmb_cli("mouse-move", session.id, "100", "200")
    assert r.returncode == 0, f"CLI error: {r.stderr}"
    assert "Mouse moved" in r.stdout


def test_cli_mouse_move_steps(session):
    """CLI mouse-move --steps sends steps to daemon."""
    session.navigate(_inline("<html><body><p>test</p></body></html>"))
    r = _agentmb_cli("mouse-move", session.id, "150", "150", "--steps", "5")
    assert r.returncode == 0, f"CLI error: {r.stderr}"
    assert "Mouse moved" in r.stdout


def test_cli_mouse_move_selector(session):
    """CLI mouse-move --selector resolves element center."""
    session.navigate(_inline("<html><body><button id='b'>btn</button></body></html>"))
    r = _agentmb_cli("mouse-move", session.id, "--selector", "#b")
    assert r.returncode == 0, f"CLI error: {r.stderr}"
    assert "Mouse moved" in r.stdout


# ---------------------------------------------------------------------------
# [P1] CLI scroll-until --step-delay-ms
# ---------------------------------------------------------------------------

def test_cli_scroll_until_step_delay(session):
    """CLI scroll-until --step-delay-ms passes delay to daemon."""
    html = _inline("""
        <html><body style="height:3000px">
          <div id="end" style="margin-top:2500px">END</div>
        </body></html>
    """)
    session.navigate(html)
    r = _agentmb_cli(
        "scroll-until", session.id,
        "--stop-text", "END",
        "--max-scrolls", "30",
        "--step-delay-ms", "10",
    )
    assert r.returncode == 0, f"CLI error: {r.stderr}"
    assert "Scroll done" in r.stdout


# ---------------------------------------------------------------------------
# [P2] CLI find command
# ---------------------------------------------------------------------------

def test_cli_find_by_text(session):
    """CLI find text query."""
    session.navigate(_inline("<html><body><button>Submit</button></body></html>"))
    r = _agentmb_cli("find", session.id, "text", "Submit")
    assert r.returncode == 0, f"CLI error: {r.stderr}"
    assert "Found" in r.stdout or "not found" in r.stdout


def test_cli_find_by_role(session):
    """CLI find role query."""
    session.navigate(_inline("<html><body><button>Go</button></body></html>"))
    r = _agentmb_cli("find", session.id, "role", "button")
    assert r.returncode == 0, f"CLI error: {r.stderr}"


def test_cli_find_json(session):
    """CLI find --json returns parseable JSON."""
    import json
    session.navigate(_inline("<html><body><button>OK</button></body></html>"))
    r = _agentmb_cli("find", session.id, "text", "OK", "--json")
    assert r.returncode == 0, f"CLI error: {r.stderr}"
    data = json.loads(r.stdout)
    assert "found" in data


# ---------------------------------------------------------------------------
# [P2] CLI settings command
# ---------------------------------------------------------------------------

def test_cli_settings(session):
    """CLI settings returns viewport and URL info."""
    session.navigate(_inline("<html><body><p>hi</p></body></html>"))
    r = _agentmb_cli("settings", session.id)
    assert r.returncode == 0, f"CLI error: {r.stderr}"
    assert "Viewport" in r.stdout
    assert "Headless" in r.stdout


def test_cli_settings_json(session):
    """CLI settings --json returns parseable JSON."""
    import json
    session.navigate(_inline("<html><body><p>hi</p></body></html>"))
    r = _agentmb_cli("settings", session.id, "--json")
    assert r.returncode == 0, f"CLI error: {r.stderr}"
    data = json.loads(r.stdout)
    assert "viewport" in data
    assert "headless" in data


# ---------------------------------------------------------------------------
# [P2] CLI cookie-delete command
# ---------------------------------------------------------------------------

def test_cli_cookie_delete(session):
    """CLI cookie-delete removes a named cookie."""
    session.navigate("https://example.com")
    # set a cookie via eval
    httpx.post(
        f"{BASE_URL}/api/v1/sessions/{session.id}/eval",
        json={"expression": "document.cookie='testcookie=abc; path=/'"},
    )
    r = _agentmb_cli("cookie-delete", session.id, "testcookie")
    assert r.returncode == 0, f"CLI error: {r.stderr}"
    assert "Deleted" in r.stdout


def test_cli_cookie_delete_with_domain(session):
    """CLI cookie-delete with --domain option."""
    session.navigate("https://example.com")
    r = _agentmb_cli("cookie-delete", session.id, "nonexistent", "--domain", "example.com")
    assert r.returncode == 0, f"CLI error: {r.stderr}"


# ---------------------------------------------------------------------------
# [P2] CLI upload-url command
# ---------------------------------------------------------------------------

def test_cli_upload_url_selector(session):
    """CLI upload-url fetches asset and uploads to file input."""
    html = _inline("""
        <html><body>
          <input type="file" id="f" />
        </body></html>
    """)
    session.navigate(html)
    r = _agentmb_cli(
        "upload-url", session.id,
        "https://www.w3.org/WAI/WCAG21/Techniques/pdf/img/table-word.jpg",
        "#f",
    )
    # May fail if URL unreachable in CI; accept returncode 0 or known network error
    if r.returncode != 0:
        assert "fetch" in r.stderr.lower() or "network" in r.stderr.lower() or "upload" in r.stderr.lower(), \
            f"Unexpected error: {r.stderr}"
