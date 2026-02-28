"""agentmb Python SDK — sync and async clients."""

from __future__ import annotations

import os
from contextlib import asynccontextmanager, contextmanager
from typing import AsyncGenerator, Generator, List, Optional

import httpx

from .models import (
    ActionResult,
    AuditEntry,
    DaemonStatus,
    DownloadResult,
    EvalResult,
    ExtractResult,
    HandoffResult,
    HoverResult,
    NavigateResult,
    NewPageResult,
    PageListResult,
    PressResult,
    ScreenshotResult,
    ScrollResult,
    SelectResult,
    SessionInfo,
    TypeResult,
    UploadResult,
    WaitForResponseResult,
    WaitForSelectorResult,
    WaitForUrlResult,
)

_DEFAULT_BASE_URL = "http://127.0.0.1:19315"


def _base_url() -> str:
    port = os.environ.get("AGENTMB_PORT", "19315")
    return f"http://127.0.0.1:{port}"


def _base_headers(api_token: Optional[str], operator: Optional[str] = None) -> dict:
    """Headers that go on every request (no content-type — set per-method)."""
    h: dict = {}
    if api_token:
        h["X-API-Token"] = api_token
    if operator:
        h["X-Operator"] = operator
    return h


def _headers(api_token: Optional[str]) -> dict:
    """Legacy alias — not used for client default headers anymore."""
    return _base_headers(api_token)


# ---------------------------------------------------------------------------
# Sync session handle
# ---------------------------------------------------------------------------

class Session:
    """Handle for a single browser session (synchronous)."""

    def __init__(self, session_id: str, client: "BrowserClient") -> None:
        self.id = session_id
        self._client = client

    def navigate(self, url: str, wait_until: str = "load", purpose: Optional[str] = None, operator: Optional[str] = None) -> NavigateResult:
        body: dict = {"url": url, "wait_until": wait_until}
        if purpose:
            body["purpose"] = purpose
        if operator:
            body["operator"] = operator
        return self._client._post(f"/api/v1/sessions/{self.id}/navigate", body, NavigateResult)

    def click(self, selector: Optional[str] = None, element_id: Optional[str] = None, ref_id: Optional[str] = None, timeout_ms: int = 5000, purpose: Optional[str] = None, operator: Optional[str] = None, executor: Optional[str] = None, stability: Optional[dict] = None, frame: Optional[dict] = None) -> ActionResult:
        if not selector and not element_id and not ref_id:
            raise ValueError("Either 'selector', 'element_id', or 'ref_id' is required")
        body: dict = {"timeout_ms": timeout_ms}
        if selector:
            body["selector"] = selector
        if element_id:
            body["element_id"] = element_id
        if ref_id:
            body["ref_id"] = ref_id
        if purpose:
            body["purpose"] = purpose
        if operator:
            body["operator"] = operator
        if executor:
            body["executor"] = executor
        if stability:
            body["stability"] = stability
        if frame:
            body["frame"] = frame
        return self._client._post(f"/api/v1/sessions/{self.id}/click", body, ActionResult)

    def fill(self, selector: Optional[str] = None, value: str = "", element_id: Optional[str] = None, ref_id: Optional[str] = None, purpose: Optional[str] = None, operator: Optional[str] = None, stability: Optional[dict] = None) -> ActionResult:
        if not selector and not element_id and not ref_id:
            raise ValueError("Either 'selector', 'element_id', or 'ref_id' is required")
        body: dict = {"value": value}
        if selector:
            body["selector"] = selector
        if element_id:
            body["element_id"] = element_id
        if ref_id:
            body["ref_id"] = ref_id
        if purpose:
            body["purpose"] = purpose
        if operator:
            body["operator"] = operator
        if stability:
            body["stability"] = stability
        return self._client._post(f"/api/v1/sessions/{self.id}/fill", body, ActionResult)

    def eval(self, expression: str, purpose: Optional[str] = None, operator: Optional[str] = None) -> EvalResult:
        body: dict = {"expression": expression}
        if purpose:
            body["purpose"] = purpose
        if operator:
            body["operator"] = operator
        return self._client._post(f"/api/v1/sessions/{self.id}/eval", body, EvalResult)

    def extract(self, selector: str, attribute: Optional[str] = None, purpose: Optional[str] = None, operator: Optional[str] = None) -> ExtractResult:
        body: dict = {"selector": selector}
        if attribute:
            body["attribute"] = attribute
        if purpose:
            body["purpose"] = purpose
        if operator:
            body["operator"] = operator
        return self._client._post(f"/api/v1/sessions/{self.id}/extract", body, ExtractResult)

    def screenshot(self, format: str = "png", full_page: bool = False, purpose: Optional[str] = None, operator: Optional[str] = None) -> ScreenshotResult:
        body: dict = {"format": format, "full_page": full_page}
        if purpose:
            body["purpose"] = purpose
        if operator:
            body["operator"] = operator
        return self._client._post(f"/api/v1/sessions/{self.id}/screenshot", body, ScreenshotResult)

    def logs(self, tail: int = 20) -> List[AuditEntry]:
        raw = self._client._get(f"/api/v1/sessions/{self.id}/logs?tail={tail}")
        return [AuditEntry.model_validate(e) for e in raw]

    def cdp_info(self) -> dict:
        """Return CDP target info for this session's page."""
        return self._client._get(f"/api/v1/sessions/{self.id}/cdp")

    def cdp_send(self, method: str, params: Optional[dict] = None) -> dict:
        """Send a single CDP command and return the result."""
        return self._client._post(
            f"/api/v1/sessions/{self.id}/cdp",
            {"method": method, "params": params or {}},
            dict,
        )

    def cdp_ws_url(self) -> dict:
        """Return the browser-level CDP WebSocket URL for native DevTools connection."""
        return self._client._get(f"/api/v1/sessions/{self.id}/cdp/ws")

    # ------------------------------------------------------------------
    # Trace export (T08)
    # ------------------------------------------------------------------

    def trace_start(self, screenshots: bool = True, snapshots: bool = True) -> dict:
        """Start Playwright trace recording for this session."""
        return self._client._post(
            f"/api/v1/sessions/{self.id}/trace/start",
            {"screenshots": screenshots, "snapshots": snapshots},
            dict,
        )

    def trace_stop(self) -> "TraceResult":
        """Stop trace recording and return the trace ZIP as base64."""
        from .models import TraceResult as _T
        return self._client._post(f"/api/v1/sessions/{self.id}/trace/stop", {}, _T)

    # ------------------------------------------------------------------
    # Network route mocks (T07)
    # ------------------------------------------------------------------

    def routes(self) -> "RouteListResult":
        """List all active network route mocks for this session."""
        from .models import RouteListResult as _R
        return self._client._get(f"/api/v1/sessions/{self.id}/routes", _R)

    def route(self, pattern: str, mock: Optional[dict] = None) -> dict:
        """Register a network route mock (intercept requests matching pattern)."""
        return self._client._post(
            f"/api/v1/sessions/{self.id}/route",
            {"pattern": pattern, "mock": mock or {}},
            dict,
        )

    def unroute(self, pattern: str) -> None:
        """Remove a network route mock."""
        self._client._delete_with_body(f"/api/v1/sessions/{self.id}/route", {"pattern": pattern})

    def type(self, selector: Optional[str] = None, text: str = "", element_id: Optional[str] = None, ref_id: Optional[str] = None, delay_ms: int = 0, purpose: Optional[str] = None, operator: Optional[str] = None) -> TypeResult:
        body: dict = {"text": text, "delay_ms": delay_ms}
        if ref_id: body["ref_id"] = ref_id
        elif element_id: body["element_id"] = element_id
        elif selector: body["selector"] = selector
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return self._client._post(f"/api/v1/sessions/{self.id}/type", body, TypeResult)

    def press(self, selector: Optional[str] = None, key: str = "", element_id: Optional[str] = None, ref_id: Optional[str] = None, purpose: Optional[str] = None, operator: Optional[str] = None) -> PressResult:
        body: dict = {"key": key}
        if ref_id: body["ref_id"] = ref_id
        elif element_id: body["element_id"] = element_id
        elif selector: body["selector"] = selector
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return self._client._post(f"/api/v1/sessions/{self.id}/press", body, PressResult)

    def select(self, selector: str, values: List[str], purpose: Optional[str] = None, operator: Optional[str] = None) -> SelectResult:
        body: dict = {"selector": selector, "values": values}
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return self._client._post(f"/api/v1/sessions/{self.id}/select", body, SelectResult)

    def hover(self, selector: Optional[str] = None, element_id: Optional[str] = None, ref_id: Optional[str] = None, purpose: Optional[str] = None, operator: Optional[str] = None) -> HoverResult:
        body: dict = {}
        if ref_id: body["ref_id"] = ref_id
        elif element_id: body["element_id"] = element_id
        elif selector: body["selector"] = selector
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return self._client._post(f"/api/v1/sessions/{self.id}/hover", body, HoverResult)

    def wait_for_selector(self, selector: str, state: str = "visible", timeout_ms: int = 5000, purpose: Optional[str] = None, operator: Optional[str] = None) -> WaitForSelectorResult:
        body: dict = {"selector": selector, "state": state, "timeout_ms": timeout_ms}
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return self._client._post(f"/api/v1/sessions/{self.id}/wait_for_selector", body, WaitForSelectorResult)

    def wait_for_url(self, url_pattern: str, timeout_ms: int = 5000, purpose: Optional[str] = None, operator: Optional[str] = None) -> WaitForUrlResult:
        body: dict = {"url_pattern": url_pattern, "timeout_ms": timeout_ms}
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return self._client._post(f"/api/v1/sessions/{self.id}/wait_for_url", body, WaitForUrlResult)

    def wait_for_response(self, url_pattern: str, timeout_ms: int = 10000, trigger: Optional[dict] = None, purpose: Optional[str] = None, operator: Optional[str] = None) -> WaitForResponseResult:
        body: dict = {"url_pattern": url_pattern, "timeout_ms": timeout_ms}
        if trigger: body["trigger"] = trigger
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return self._client._post(f"/api/v1/sessions/{self.id}/wait_for_response", body, WaitForResponseResult)

    def upload(self, selector: str, file_path: str, mime_type: Optional[str] = None, purpose: Optional[str] = None, operator: Optional[str] = None) -> UploadResult:
        import base64 as _b64
        import mimetypes as _mt
        import os as _os
        with open(file_path, "rb") as f:
            content = _b64.b64encode(f.read()).decode()
        if mime_type is None:
            guessed, _ = _mt.guess_type(file_path)
            mime_type = guessed or "application/octet-stream"
        body: dict = {"selector": selector, "content": content, "filename": _os.path.basename(file_path), "mime_type": mime_type}
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return self._client._post(f"/api/v1/sessions/{self.id}/upload", body, UploadResult)

    def download(self, selector: Optional[str] = None, element_id: Optional[str] = None, ref_id: Optional[str] = None, timeout_ms: int = 30000, purpose: Optional[str] = None, operator: Optional[str] = None) -> DownloadResult:
        body: dict = {"timeout_ms": timeout_ms}
        if ref_id: body["ref_id"] = ref_id
        elif element_id: body["element_id"] = element_id
        elif selector: body["selector"] = selector
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return self._client._post(f"/api/v1/sessions/{self.id}/download", body, DownloadResult)

    # ------------------------------------------------------------------
    # Multi-page management (T03)
    # ------------------------------------------------------------------

    def pages(self) -> PageListResult:
        """List all open pages in this session."""
        return self._client._get(f"/api/v1/sessions/{self.id}/pages", PageListResult)

    def new_page(self) -> NewPageResult:
        """Open a new tab/page in this session."""
        return self._client._post(f"/api/v1/sessions/{self.id}/pages", {}, NewPageResult)

    def switch_page(self, page_id: str) -> dict:
        """Make the given page_id the active target for actions."""
        return self._client._post(f"/api/v1/sessions/{self.id}/pages/switch", {"page_id": page_id}, dict)

    def close_page(self, page_id: str) -> None:
        """Close a specific page by page_id."""
        self._client._delete(f"/api/v1/sessions/{self.id}/pages/{page_id}")

    def switch_mode(self, mode: str) -> None:
        """Switch between 'headless' and 'headed' mode."""
        self._client._post(
            f"/api/v1/sessions/{self.id}/mode",
            {"mode": mode},
            dict,
        )

    def handoff_start(self) -> HandoffResult:
        """Switch to headed mode for human login. Call handoff_complete() when done."""
        return self._client._post(
            f"/api/v1/sessions/{self.id}/handoff/start",
            {},
            HandoffResult,
        )

    def handoff_complete(self) -> HandoffResult:
        """Return session to headless mode after human login is complete."""
        return self._client._post(
            f"/api/v1/sessions/{self.id}/handoff/complete",
            {},
            HandoffResult,
        )

    def set_policy(self, profile: str, allow_sensitive_actions: Optional[bool] = None) -> "PolicyInfo":
        """Override the safety execution policy for this session (r06-c02).

        Args:
            profile: 'safe' | 'permissive' | 'disabled'
            allow_sensitive_actions: Explicitly enable/disable sensitive action guardrail.
        """
        from .models import PolicyInfo
        body: dict = {"profile": profile}
        if allow_sensitive_actions is not None:
            body["allow_sensitive_actions"] = allow_sensitive_actions
        return self._client._post(f"/api/v1/sessions/{self.id}/policy", body, PolicyInfo)

    def get_policy(self) -> "PolicyInfo":
        """Get the current safety execution policy for this session."""
        from .models import PolicyInfo
        return self._client._get(f"/api/v1/sessions/{self.id}/policy", PolicyInfo)

    # -----------------------------------------------------------------------
    # R07-T01/T02/T07: element map, read primitives, stability gate
    # -----------------------------------------------------------------------

    def element_map(
        self,
        scope: Optional[str] = None,
        limit: int = 500,
        include_unlabeled: bool = False,
        purpose: Optional[str] = None,
        operator: Optional[str] = None,
    ) -> "ElementMapResult":
        """Scan the page for interactive elements and assign stable element IDs.

        Returns a list of ElementInfo objects. Each element has an element_id
        (e.g. 'e1', 'e2') that can be used in place of a CSS selector in
        click(), fill(), hover(), type(), press() calls.

        Each element now includes a `label` (synthesized from aria-label, title,
        aria-labelledby, SVG title/desc, innerText, or placeholder) and `label_source`.

        Args:
            scope: Optional CSS selector to limit the scan to a subtree.
            limit: Max number of elements to return (default 500).
            include_unlabeled: When True, icon-only elements with no accessible text
                receive a synthesized '[tag @ x,y]' fallback label instead of empty string.
        """
        from .models import ElementMapResult
        body: dict = {"limit": limit}
        if scope:
            body["scope"] = scope
        if include_unlabeled:
            body["include_unlabeled"] = True
        if purpose:
            body["purpose"] = purpose
        if operator:
            body["operator"] = operator
        return self._client._post(f"/api/v1/sessions/{self.id}/element_map", body, ElementMapResult)

    def get(
        self,
        property: str,
        selector: Optional[str] = None,
        element_id: Optional[str] = None,
        attr_name: Optional[str] = None,
        purpose: Optional[str] = None,
        operator: Optional[str] = None,
    ) -> "GetPropertyResult":
        """Read a property from a page element.

        Args:
            property: One of 'text', 'html', 'value', 'attr', 'count', 'box'.
            selector: CSS selector (mutually exclusive with element_id).
            element_id: element_id from element_map() (mutually exclusive with selector).
            attr_name: Required when property='attr'.
        """
        from .models import GetPropertyResult
        body: dict = {"property": property}
        if selector:
            body["selector"] = selector
        if element_id:
            body["element_id"] = element_id
        if attr_name:
            body["attr_name"] = attr_name
        if purpose:
            body["purpose"] = purpose
        if operator:
            body["operator"] = operator
        return self._client._post(f"/api/v1/sessions/{self.id}/get", body, GetPropertyResult)

    def assert_state(
        self,
        property: str,
        selector: Optional[str] = None,
        element_id: Optional[str] = None,
        expected: bool = True,
        purpose: Optional[str] = None,
        operator: Optional[str] = None,
    ) -> "AssertResult":
        """Assert an element state property.

        Args:
            property: One of 'visible', 'enabled', 'checked'.
            selector: CSS selector (mutually exclusive with element_id).
            element_id: element_id from element_map() (mutually exclusive with selector).
            expected: Expected value (default True).
        """
        from .models import AssertResult
        body: dict = {"property": property, "expected": expected}
        if selector:
            body["selector"] = selector
        if element_id:
            body["element_id"] = element_id
        if purpose:
            body["purpose"] = purpose
        if operator:
            body["operator"] = operator
        return self._client._post(f"/api/v1/sessions/{self.id}/assert", body, AssertResult)

    def wait_page_stable(
        self,
        timeout_ms: int = 10000,
        dom_stable_ms: int = 300,
        overlay_selector: Optional[str] = None,
        purpose: Optional[str] = None,
        operator: Optional[str] = None,
    ) -> "StableResult":
        """Wait for the page to be stable (network idle + DOM quiescence).

        Args:
            timeout_ms: Max wait time in ms (default 10000).
            dom_stable_ms: DOM must be mutation-free for this many ms (default 300).
            overlay_selector: If given, also waits until no element matches.
        """
        from .models import StableResult
        body: dict = {"timeout_ms": timeout_ms, "dom_stable_ms": dom_stable_ms}
        if overlay_selector:
            body["overlay_selector"] = overlay_selector
        if purpose:
            body["purpose"] = purpose
        if operator:
            body["operator"] = operator
        return self._client._post(f"/api/v1/sessions/{self.id}/wait_page_stable", body, StableResult)

    # ── R07-T13: snapshot_map ────────────────────────────────────────────────

    def snapshot_map(
        self,
        scope: Optional[str] = None,
        limit: int = 500,
        include_unlabeled: bool = False,
        purpose: Optional[str] = None,
        operator: Optional[str] = None,
    ) -> "SnapshotMapResult":
        """Scan page elements and store a server-side snapshot with page_rev tracking.

        Returns ref_id for each element (format: 'snap_XXXXXX:eN').
        Use ref_id in actions to get stale_ref detection (HTTP 409) when page changes.

        Limitation: elements with no accessible text (aria-label, title, placeholder,
        innerText) will have an empty label. Use include_unlabeled=True to synthesize
        a '[tag @ x,y]' fallback label for icon-only elements.
        """
        from .models import SnapshotMapResult
        body: dict = {"limit": limit}
        if scope:
            body["scope"] = scope
        if include_unlabeled:
            body["include_unlabeled"] = True
        if purpose:
            body["purpose"] = purpose
        if operator:
            body["operator"] = operator
        return self._client._post(f"/api/v1/sessions/{self.id}/snapshot_map", body, SnapshotMapResult)

    def page_rev(self) -> "PageRevResult":
        """Return current page revision counter (R08-R12). Use to detect page changes since last snapshot."""
        from .models import PageRevResult
        return self._client._get(f"/api/v1/sessions/{self.id}/page_rev", PageRevResult)

    # ── R07-T03: Interaction primitives ─────────────────────────────────────

    def dblclick(self, selector: Optional[str] = None, element_id: Optional[str] = None, ref_id: Optional[str] = None, timeout_ms: int = 5000, purpose: Optional[str] = None, operator: Optional[str] = None) -> ActionResult:
        if not selector and not element_id and not ref_id:
            raise ValueError("Either 'selector', 'element_id', or 'ref_id' is required")
        body: dict = {"timeout_ms": timeout_ms}
        if selector: body["selector"] = selector
        if element_id: body["element_id"] = element_id
        if ref_id: body["ref_id"] = ref_id
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return self._client._post(f"/api/v1/sessions/{self.id}/dblclick", body, ActionResult)

    def focus(self, selector: Optional[str] = None, element_id: Optional[str] = None, ref_id: Optional[str] = None, purpose: Optional[str] = None, operator: Optional[str] = None) -> ActionResult:
        if not selector and not element_id and not ref_id:
            raise ValueError("Either 'selector', 'element_id', or 'ref_id' is required")
        body: dict = {}
        if selector: body["selector"] = selector
        if element_id: body["element_id"] = element_id
        if ref_id: body["ref_id"] = ref_id
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return self._client._post(f"/api/v1/sessions/{self.id}/focus", body, ActionResult)

    def check(self, selector: Optional[str] = None, element_id: Optional[str] = None, ref_id: Optional[str] = None, timeout_ms: int = 5000, purpose: Optional[str] = None, operator: Optional[str] = None) -> ActionResult:
        if not selector and not element_id and not ref_id:
            raise ValueError("Either 'selector', 'element_id', or 'ref_id' is required")
        body: dict = {"timeout_ms": timeout_ms}
        if selector: body["selector"] = selector
        if element_id: body["element_id"] = element_id
        if ref_id: body["ref_id"] = ref_id
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return self._client._post(f"/api/v1/sessions/{self.id}/check", body, ActionResult)

    def uncheck(self, selector: Optional[str] = None, element_id: Optional[str] = None, ref_id: Optional[str] = None, timeout_ms: int = 5000, purpose: Optional[str] = None, operator: Optional[str] = None) -> ActionResult:
        if not selector and not element_id and not ref_id:
            raise ValueError("Either 'selector', 'element_id', or 'ref_id' is required")
        body: dict = {"timeout_ms": timeout_ms}
        if selector: body["selector"] = selector
        if element_id: body["element_id"] = element_id
        if ref_id: body["ref_id"] = ref_id
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return self._client._post(f"/api/v1/sessions/{self.id}/uncheck", body, ActionResult)

    def scroll(self, selector: Optional[str] = None, element_id: Optional[str] = None, ref_id: Optional[str] = None, delta_x: int = 0, delta_y: int = 300, purpose: Optional[str] = None, operator: Optional[str] = None) -> ScrollResult:
        if not selector and not element_id and not ref_id:
            raise ValueError("Either 'selector', 'element_id', or 'ref_id' is required")
        body: dict = {"delta_x": delta_x, "delta_y": delta_y}
        if selector: body["selector"] = selector
        if element_id: body["element_id"] = element_id
        if ref_id: body["ref_id"] = ref_id
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return self._client._post(f"/api/v1/sessions/{self.id}/scroll", body, ScrollResult)

    def scroll_into_view(self, selector: Optional[str] = None, element_id: Optional[str] = None, ref_id: Optional[str] = None, purpose: Optional[str] = None, operator: Optional[str] = None) -> ActionResult:
        if not selector and not element_id and not ref_id:
            raise ValueError("Either 'selector', 'element_id', or 'ref_id' is required")
        body: dict = {}
        if selector: body["selector"] = selector
        if element_id: body["element_id"] = element_id
        if ref_id: body["ref_id"] = ref_id
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return self._client._post(f"/api/v1/sessions/{self.id}/scroll_into_view", body, ActionResult)

    def drag(self, source: Optional[str] = None, target: Optional[str] = None, source_element_id: Optional[str] = None, target_element_id: Optional[str] = None, source_ref_id: Optional[str] = None, target_ref_id: Optional[str] = None, purpose: Optional[str] = None, operator: Optional[str] = None) -> "DragResult":
        from .models import DragResult
        body: dict = {}
        if source: body["source"] = source
        if target: body["target"] = target
        if source_element_id: body["source_element_id"] = source_element_id
        if target_element_id: body["target_element_id"] = target_element_id
        if source_ref_id: body["source_ref_id"] = source_ref_id
        if target_ref_id: body["target_ref_id"] = target_ref_id
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return self._client._post(f"/api/v1/sessions/{self.id}/drag", body, DragResult)

    def mouse_move(self, x: Optional[int] = None, y: Optional[int] = None, ref_id: Optional[str] = None, element_id: Optional[str] = None, selector: Optional[str] = None, purpose: Optional[str] = None, operator: Optional[str] = None) -> "MouseResult":
        """Move mouse to coordinates or to center of element referenced by ref_id/element_id/selector (R08-R05)."""
        from .models import MouseResult
        body: dict = {}
        if x is not None: body["x"] = x
        if y is not None: body["y"] = y
        if ref_id: body["ref_id"] = ref_id
        if element_id: body["element_id"] = element_id
        if selector: body["selector"] = selector
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return self._client._post(f"/api/v1/sessions/{self.id}/mouse_move", body, MouseResult)

    def mouse_down(self, x: Optional[int] = None, y: Optional[int] = None, button: str = "left", purpose: Optional[str] = None, operator: Optional[str] = None) -> "MouseResult":
        from .models import MouseResult
        body: dict = {"button": button}
        if x is not None: body["x"] = x
        if y is not None: body["y"] = y
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return self._client._post(f"/api/v1/sessions/{self.id}/mouse_down", body, MouseResult)

    def mouse_up(self, button: str = "left", purpose: Optional[str] = None, operator: Optional[str] = None) -> "MouseResult":
        from .models import MouseResult
        body: dict = {"button": button}
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return self._client._post(f"/api/v1/sessions/{self.id}/mouse_up", body, MouseResult)

    def key_down(self, key: str, purpose: Optional[str] = None, operator: Optional[str] = None) -> "KeyResult":
        from .models import KeyResult
        body: dict = {"key": key}
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return self._client._post(f"/api/v1/sessions/{self.id}/key_down", body, KeyResult)

    def key_up(self, key: str, purpose: Optional[str] = None, operator: Optional[str] = None) -> "KeyResult":
        from .models import KeyResult
        body: dict = {"key": key}
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return self._client._post(f"/api/v1/sessions/{self.id}/key_up", body, KeyResult)

    # ── R07-T04: Wait / navigation ───────────────────────────────────────────

    def back(self, timeout_ms: int = 5000, wait_until: str = "load", purpose: Optional[str] = None, operator: Optional[str] = None) -> "NavResult":
        from .models import NavResult
        body: dict = {"timeout_ms": timeout_ms, "wait_until": wait_until}
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return self._client._post(f"/api/v1/sessions/{self.id}/back", body, NavResult)

    def forward(self, timeout_ms: int = 5000, wait_until: str = "load", purpose: Optional[str] = None, operator: Optional[str] = None) -> "NavResult":
        from .models import NavResult
        body: dict = {"timeout_ms": timeout_ms, "wait_until": wait_until}
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return self._client._post(f"/api/v1/sessions/{self.id}/forward", body, NavResult)

    def reload(self, timeout_ms: int = 10000, wait_until: str = "load", purpose: Optional[str] = None, operator: Optional[str] = None) -> "NavResult":
        from .models import NavResult
        body: dict = {"timeout_ms": timeout_ms, "wait_until": wait_until}
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return self._client._post(f"/api/v1/sessions/{self.id}/reload", body, NavResult)

    def wait_text(self, text: str, timeout_ms: int = 5000, purpose: Optional[str] = None, operator: Optional[str] = None) -> "WaitTextResult":
        from .models import WaitTextResult
        body: dict = {"text": text, "timeout_ms": timeout_ms}
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return self._client._post(f"/api/v1/sessions/{self.id}/wait_text", body, WaitTextResult)

    def wait_load_state(self, state: str = "load", timeout_ms: int = 10000, purpose: Optional[str] = None, operator: Optional[str] = None) -> "WaitLoadStateResult":
        from .models import WaitLoadStateResult
        body: dict = {"state": state, "timeout_ms": timeout_ms}
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return self._client._post(f"/api/v1/sessions/{self.id}/wait_load_state", body, WaitLoadStateResult)

    def wait_function(self, expression: str, timeout_ms: int = 5000, purpose: Optional[str] = None, operator: Optional[str] = None) -> "WaitFunctionResult":
        from .models import WaitFunctionResult
        body: dict = {"expression": expression, "timeout_ms": timeout_ms}
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return self._client._post(f"/api/v1/sessions/{self.id}/wait_function", body, WaitFunctionResult)

    # ── R07-T08: Scroll primitives ───────────────────────────────────────────

    def scroll_until(self, direction: str = "down", scroll_selector: Optional[str] = None, stop_selector: Optional[str] = None, stop_text: Optional[str] = None, max_scrolls: int = 20, scroll_delta: int = 400, stall_ms: int = 500, purpose: Optional[str] = None, operator: Optional[str] = None) -> "ScrollUntilResult":
        from .models import ScrollUntilResult
        body: dict = {"direction": direction, "max_scrolls": max_scrolls, "scroll_delta": scroll_delta, "stall_ms": stall_ms}
        if scroll_selector: body["scroll_selector"] = scroll_selector
        if stop_selector: body["stop_selector"] = stop_selector
        if stop_text: body["stop_text"] = stop_text
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return self._client._post(f"/api/v1/sessions/{self.id}/scroll_until", body, ScrollUntilResult)

    def load_more_until(self, load_more_selector: str, content_selector: str, item_count: Optional[int] = None, stop_text: Optional[str] = None, max_loads: int = 10, stall_ms: int = 800, purpose: Optional[str] = None, operator: Optional[str] = None) -> "LoadMoreResult":
        from .models import LoadMoreResult
        body: dict = {"load_more_selector": load_more_selector, "content_selector": content_selector, "max_loads": max_loads, "stall_ms": stall_ms}
        if item_count is not None: body["item_count"] = item_count
        if stop_text: body["stop_text"] = stop_text
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return self._client._post(f"/api/v1/sessions/{self.id}/load_more_until", body, LoadMoreResult)

    # ── R07-T05: Cookie and storage state ────────────────────────────────────

    def cookies(self, urls: Optional[list] = None) -> "CookieListResult":
        """List all cookies for this session. Optionally filter by URL list."""
        from .models import CookieListResult
        qs = ("?urls=" + ",".join(urls)) if urls else ""
        return self._client._get(f"/api/v1/sessions/{self.id}/cookies{qs}", CookieListResult)

    def add_cookies(self, cookies: list) -> dict:
        """Add cookies to this session. Each cookie must have at least name, value, domain."""
        return self._client._post(f"/api/v1/sessions/{self.id}/cookies", {"cookies": cookies}, dict)

    def clear_cookies(self) -> None:
        """Clear all cookies for this session."""
        self._client._delete(f"/api/v1/sessions/{self.id}/cookies")

    def storage_state(self) -> "StorageStateResult":
        """Export the full Playwright storageState (cookies + origins) for this session."""
        from .models import StorageStateResult
        return self._client._get(f"/api/v1/sessions/{self.id}/storage_state", StorageStateResult)

    def restore_storage_state(self, storage_state: dict) -> "StorageStateRestoreResult":
        """Restore cookies from a previously exported storage_state dict.

        .. note::

            **Only cookies are restored.**  The ``origins`` array
            (localStorage / sessionStorage) cannot be injected into a running
            Playwright context.  Check ``result.origins_skipped`` to see how
            many origin entries were silently ignored.  To restore localStorage,
            navigate to the target origin first, then write values via
            :meth:`eval`.
        """
        from .models import StorageStateRestoreResult
        return self._client._post(
            f"/api/v1/sessions/{self.id}/storage_state",
            {"storage_state": storage_state},
            StorageStateRestoreResult,
        )

    # ── R07-T15: Annotated screenshot ─────────────────────────────────────

    def annotated_screenshot(
        self,
        highlights: list,
        format: str = "png",
        full_page: bool = False,
        purpose: Optional[str] = None,
        operator: Optional[str] = None,
    ) -> "AnnotatedScreenshotResult":
        """Take a screenshot with element highlight overlays.

        Args:
            highlights: list of dicts with keys: selector (str), color (optional str),
                        label (optional str).
        """
        from .models import AnnotatedScreenshotResult
        body: dict = {"highlights": highlights, "format": format, "full_page": full_page}
        if purpose:
            body["purpose"] = purpose
        if operator:
            body["operator"] = operator
        return self._client._post(
            f"/api/v1/sessions/{self.id}/annotated_screenshot", body, AnnotatedScreenshotResult
        )

    # ── R07-T16/T17: Console log + page errors ───────────────────────────

    def console_log(self, tail: Optional[int] = None) -> "ConsoleLogResult":
        """Return collected console log entries (from page.on('console'))."""
        from .models import ConsoleLogResult
        qs = f"?tail={tail}" if tail is not None else ""
        return self._client._get(f"/api/v1/sessions/{self.id}/console{qs}", ConsoleLogResult)

    def clear_console_log(self) -> None:
        """Clear the console log buffer for this session."""
        self._client._delete(f"/api/v1/sessions/{self.id}/console")

    def page_errors(self, tail: Optional[int] = None) -> "PageErrorListResult":
        """Return collected uncaught page error entries (from page.on('pageerror'))."""
        from .models import PageErrorListResult
        qs = f"?tail={tail}" if tail is not None else ""
        return self._client._get(f"/api/v1/sessions/{self.id}/page_errors{qs}", PageErrorListResult)

    def clear_page_errors(self) -> None:
        """Clear the page error buffer for this session."""
        self._client._delete(f"/api/v1/sessions/{self.id}/page_errors")

    # ── R07-T19: Coordinate-based input primitives ───────────────────────────

    def click_at(self, x: float, y: float, button: str = "left", click_count: int = 1, delay_ms: int = 0, purpose: Optional[str] = None, operator: Optional[str] = None) -> "ClickAtResult":
        """Click at (x, y) coordinates on the page (bypasses selector resolution)."""
        from .models import ClickAtResult
        body: dict = {"x": x, "y": y, "button": button, "click_count": click_count, "delay_ms": delay_ms}
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return self._client._post(f"/api/v1/sessions/{self.id}/click_at", body, ClickAtResult)

    def wheel(self, dx: float = 0, dy: float = 0, purpose: Optional[str] = None, operator: Optional[str] = None) -> "WheelAtResult":
        """Dispatch a mouse wheel event at the current cursor position."""
        from .models import WheelAtResult
        body: dict = {"dx": dx, "dy": dy}
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return self._client._post(f"/api/v1/sessions/{self.id}/wheel", body, WheelAtResult)

    def insert_text(self, text: str, purpose: Optional[str] = None, operator: Optional[str] = None) -> "InsertTextResult":
        """Insert text into the focused element, bypassing key events (supports emoji/CJK)."""
        from .models import InsertTextResult
        body: dict = {"text": text}
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return self._client._post(f"/api/v1/sessions/{self.id}/insert_text", body, InsertTextResult)

    # ── R07-T20: Bounding box retrieval ─────────────────────────────────────

    def bbox(self, selector: Optional[str] = None, element_id: Optional[str] = None, ref_id: Optional[str] = None, purpose: Optional[str] = None, operator: Optional[str] = None) -> "BboxResult":
        """Return the bounding box of an element (selector, element_id, or ref_id)."""
        from .models import BboxResult
        if not selector and not element_id and not ref_id:
            raise ValueError("selector, element_id, or ref_id is required")
        body: dict = {}
        if selector: body["selector"] = selector
        if element_id: body["element_id"] = element_id
        if ref_id: body["ref_id"] = ref_id
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return self._client._post(f"/api/v1/sessions/{self.id}/bbox", body, BboxResult)

    # ── R07-T22: Dialog observability ────────────────────────────────────────

    def dialogs(self, tail: Optional[int] = None) -> "DialogListResult":
        """List auto-dismissed dialog history for this session."""
        from .models import DialogListResult
        qs = f"?tail={tail}" if tail is not None else ""
        return self._client._get(f"/api/v1/sessions/{self.id}/dialogs{qs}", DialogListResult)

    def clear_dialogs(self) -> None:
        """Clear the dialog history buffer for this session."""
        self._client._delete(f"/api/v1/sessions/{self.id}/dialogs")

    # ── R07-T23: Clipboard ───────────────────────────────────────────────────

    def clipboard_write(self, text: str, purpose: Optional[str] = None, operator: Optional[str] = None) -> "ClipboardWriteResult":
        """Write text to the clipboard via the Clipboard API (or execCommand fallback)."""
        from .models import ClipboardWriteResult
        body: dict = {"text": text}
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return self._client._post(f"/api/v1/sessions/{self.id}/clipboard", body, ClipboardWriteResult)

    def clipboard_read(self, purpose: Optional[str] = None, operator: Optional[str] = None) -> "ClipboardReadResult":
        """Read text from the clipboard. Requires clipboard-read permission."""
        from .models import ClipboardReadResult
        return self._client._get(f"/api/v1/sessions/{self.id}/clipboard", ClipboardReadResult)

    # ── R07-T24: Viewport emulation ──────────────────────────────────────────

    def set_viewport(self, width: int, height: int, purpose: Optional[str] = None, operator: Optional[str] = None) -> "ViewportResult":
        """Resize the page viewport to width × height pixels."""
        from .models import ViewportResult
        body: dict = {"width": width, "height": height}
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return self._client._put(f"/api/v1/sessions/{self.id}/viewport", body, ViewportResult)

    # ── R07-T25: Network conditions ──────────────────────────────────────────

    def set_network_conditions(self, offline: bool = False, latency_ms: int = 0, download_kbps: float = -1, upload_kbps: float = -1) -> "NetworkConditionsResult":
        """Emulate network throttling or offline mode via CDP."""
        from .models import NetworkConditionsResult
        body: dict = {"offline": offline, "latency_ms": latency_ms, "download_kbps": download_kbps, "upload_kbps": upload_kbps}
        return self._client._post(f"/api/v1/sessions/{self.id}/network_conditions", body, NetworkConditionsResult)

    def reset_network_conditions(self) -> None:
        """Reset network conditions to normal (no throttling)."""
        self._client._delete(f"/api/v1/sessions/{self.id}/network_conditions")

    def close(self) -> None:
        self._client._delete(f"/api/v1/sessions/{self.id}")

    def __enter__(self) -> "Session":
        return self

    def __exit__(self, *_) -> None:
        self.close()


# ---------------------------------------------------------------------------
# Async session handle
# ---------------------------------------------------------------------------

class AsyncSession:
    """Handle for a single browser session (async)."""

    def __init__(self, session_id: str, client: "AsyncBrowserClient") -> None:
        self.id = session_id
        self._client = client

    async def navigate(self, url: str, wait_until: str = "load", purpose: Optional[str] = None, operator: Optional[str] = None) -> NavigateResult:
        body: dict = {"url": url, "wait_until": wait_until}
        if purpose:
            body["purpose"] = purpose
        if operator:
            body["operator"] = operator
        return await self._client._post(f"/api/v1/sessions/{self.id}/navigate", body, NavigateResult)

    async def click(self, selector: Optional[str] = None, element_id: Optional[str] = None, ref_id: Optional[str] = None, timeout_ms: int = 5000, purpose: Optional[str] = None, operator: Optional[str] = None, executor: Optional[str] = None, stability: Optional[dict] = None, frame: Optional[dict] = None) -> ActionResult:
        if not selector and not element_id and not ref_id:
            raise ValueError("Either 'selector', 'element_id', or 'ref_id' is required")
        body: dict = {"timeout_ms": timeout_ms}
        if selector:
            body["selector"] = selector
        if element_id:
            body["element_id"] = element_id
        if ref_id:
            body["ref_id"] = ref_id
        if purpose:
            body["purpose"] = purpose
        if operator:
            body["operator"] = operator
        if executor:
            body["executor"] = executor
        if stability:
            body["stability"] = stability
        if frame:
            body["frame"] = frame
        return await self._client._post(f"/api/v1/sessions/{self.id}/click", body, ActionResult)

    async def fill(self, selector: Optional[str] = None, value: str = "", element_id: Optional[str] = None, ref_id: Optional[str] = None, purpose: Optional[str] = None, operator: Optional[str] = None, stability: Optional[dict] = None) -> ActionResult:
        if not selector and not element_id and not ref_id:
            raise ValueError("Either 'selector', 'element_id', or 'ref_id' is required")
        body: dict = {"value": value}
        if selector:
            body["selector"] = selector
        if element_id:
            body["element_id"] = element_id
        if ref_id:
            body["ref_id"] = ref_id
        if purpose:
            body["purpose"] = purpose
        if operator:
            body["operator"] = operator
        if stability:
            body["stability"] = stability
        return await self._client._post(f"/api/v1/sessions/{self.id}/fill", body, ActionResult)

    async def eval(self, expression: str, purpose: Optional[str] = None, operator: Optional[str] = None) -> EvalResult:
        body: dict = {"expression": expression}
        if purpose:
            body["purpose"] = purpose
        if operator:
            body["operator"] = operator
        return await self._client._post(f"/api/v1/sessions/{self.id}/eval", body, EvalResult)

    async def extract(self, selector: str, attribute: Optional[str] = None, purpose: Optional[str] = None, operator: Optional[str] = None) -> ExtractResult:
        body: dict = {"selector": selector}
        if attribute:
            body["attribute"] = attribute
        if purpose:
            body["purpose"] = purpose
        if operator:
            body["operator"] = operator
        return await self._client._post(f"/api/v1/sessions/{self.id}/extract", body, ExtractResult)

    async def screenshot(self, format: str = "png", full_page: bool = False, purpose: Optional[str] = None, operator: Optional[str] = None) -> ScreenshotResult:
        body: dict = {"format": format, "full_page": full_page}
        if purpose:
            body["purpose"] = purpose
        if operator:
            body["operator"] = operator
        return await self._client._post(f"/api/v1/sessions/{self.id}/screenshot", body, ScreenshotResult)

    async def logs(self, tail: int = 20) -> List[AuditEntry]:
        raw = await self._client._get(f"/api/v1/sessions/{self.id}/logs?tail={tail}")
        return [AuditEntry.model_validate(e) for e in raw]

    async def cdp_info(self) -> dict:
        """Return CDP target info for this session's page."""
        return await self._client._get(f"/api/v1/sessions/{self.id}/cdp")

    async def cdp_send(self, method: str, params: Optional[dict] = None) -> dict:
        """Send a single CDP command and return the result."""
        return await self._client._post(
            f"/api/v1/sessions/{self.id}/cdp",
            {"method": method, "params": params or {}},
            dict,
        )

    async def cdp_ws_url(self) -> dict:
        """Return the browser-level CDP WebSocket URL for native DevTools connection."""
        return await self._client._get(f"/api/v1/sessions/{self.id}/cdp/ws")

    # ------------------------------------------------------------------
    # Trace export (T08)
    # ------------------------------------------------------------------

    async def trace_start(self, screenshots: bool = True, snapshots: bool = True) -> dict:
        """Start Playwright trace recording for this session."""
        return await self._client._post(
            f"/api/v1/sessions/{self.id}/trace/start",
            {"screenshots": screenshots, "snapshots": snapshots},
            dict,
        )

    async def trace_stop(self) -> "TraceResult":
        """Stop trace recording and return the trace ZIP as base64."""
        from .models import TraceResult as _T
        return await self._client._post(f"/api/v1/sessions/{self.id}/trace/stop", {}, _T)

    # ------------------------------------------------------------------
    # Network route mocks (T07)
    # ------------------------------------------------------------------

    async def routes(self) -> "RouteListResult":
        """List all active network route mocks for this session."""
        from .models import RouteListResult as _R
        return await self._client._get(f"/api/v1/sessions/{self.id}/routes", _R)

    async def route(self, pattern: str, mock: Optional[dict] = None) -> dict:
        """Register a network route mock."""
        return await self._client._post(
            f"/api/v1/sessions/{self.id}/route",
            {"pattern": pattern, "mock": mock or {}},
            dict,
        )

    async def unroute(self, pattern: str) -> None:
        """Remove a network route mock."""
        await self._client._delete_with_body(f"/api/v1/sessions/{self.id}/route", {"pattern": pattern})

    async def type(self, selector: Optional[str] = None, text: str = "", element_id: Optional[str] = None, ref_id: Optional[str] = None, delay_ms: int = 0, purpose: Optional[str] = None, operator: Optional[str] = None) -> TypeResult:
        body: dict = {"text": text, "delay_ms": delay_ms}
        if ref_id: body["ref_id"] = ref_id
        elif element_id: body["element_id"] = element_id
        elif selector: body["selector"] = selector
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return await self._client._post(f"/api/v1/sessions/{self.id}/type", body, TypeResult)

    async def press(self, selector: Optional[str] = None, key: str = "", element_id: Optional[str] = None, ref_id: Optional[str] = None, purpose: Optional[str] = None, operator: Optional[str] = None) -> PressResult:
        body: dict = {"key": key}
        if ref_id: body["ref_id"] = ref_id
        elif element_id: body["element_id"] = element_id
        elif selector: body["selector"] = selector
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return await self._client._post(f"/api/v1/sessions/{self.id}/press", body, PressResult)

    async def select(self, selector: str, values: List[str], purpose: Optional[str] = None, operator: Optional[str] = None) -> SelectResult:
        body: dict = {"selector": selector, "values": values}
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return await self._client._post(f"/api/v1/sessions/{self.id}/select", body, SelectResult)

    async def hover(self, selector: Optional[str] = None, element_id: Optional[str] = None, ref_id: Optional[str] = None, purpose: Optional[str] = None, operator: Optional[str] = None) -> HoverResult:
        body: dict = {}
        if ref_id: body["ref_id"] = ref_id
        elif element_id: body["element_id"] = element_id
        elif selector: body["selector"] = selector
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return await self._client._post(f"/api/v1/sessions/{self.id}/hover", body, HoverResult)

    async def wait_for_selector(self, selector: str, state: str = "visible", timeout_ms: int = 5000, purpose: Optional[str] = None, operator: Optional[str] = None) -> WaitForSelectorResult:
        body: dict = {"selector": selector, "state": state, "timeout_ms": timeout_ms}
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return await self._client._post(f"/api/v1/sessions/{self.id}/wait_for_selector", body, WaitForSelectorResult)

    async def wait_for_url(self, url_pattern: str, timeout_ms: int = 5000, purpose: Optional[str] = None, operator: Optional[str] = None) -> WaitForUrlResult:
        body: dict = {"url_pattern": url_pattern, "timeout_ms": timeout_ms}
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return await self._client._post(f"/api/v1/sessions/{self.id}/wait_for_url", body, WaitForUrlResult)

    async def wait_for_response(self, url_pattern: str, timeout_ms: int = 10000, trigger: Optional[dict] = None, purpose: Optional[str] = None, operator: Optional[str] = None) -> WaitForResponseResult:
        body: dict = {"url_pattern": url_pattern, "timeout_ms": timeout_ms}
        if trigger: body["trigger"] = trigger
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return await self._client._post(f"/api/v1/sessions/{self.id}/wait_for_response", body, WaitForResponseResult)

    async def upload(self, selector: str, file_path: str, mime_type: Optional[str] = None, purpose: Optional[str] = None, operator: Optional[str] = None) -> UploadResult:
        import base64 as _b64
        import mimetypes as _mt
        import os as _os
        import asyncio as _asyncio
        def _read() -> str:
            with open(file_path, "rb") as f:
                return _b64.b64encode(f.read()).decode()
        content = await _asyncio.to_thread(_read)
        if mime_type is None:
            guessed, _ = _mt.guess_type(file_path)
            mime_type = guessed or "application/octet-stream"
        body: dict = {"selector": selector, "content": content, "filename": _os.path.basename(file_path), "mime_type": mime_type}
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return await self._client._post(f"/api/v1/sessions/{self.id}/upload", body, UploadResult)

    async def download(self, selector: Optional[str] = None, element_id: Optional[str] = None, ref_id: Optional[str] = None, timeout_ms: int = 30000, purpose: Optional[str] = None, operator: Optional[str] = None) -> DownloadResult:
        body: dict = {"timeout_ms": timeout_ms}
        if ref_id: body["ref_id"] = ref_id
        elif element_id: body["element_id"] = element_id
        elif selector: body["selector"] = selector
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return await self._client._post(f"/api/v1/sessions/{self.id}/download", body, DownloadResult)

    # ------------------------------------------------------------------
    # Multi-page management (T03)
    # ------------------------------------------------------------------

    async def pages(self) -> PageListResult:
        return await self._client._get(f"/api/v1/sessions/{self.id}/pages", PageListResult)

    async def new_page(self) -> NewPageResult:
        return await self._client._post(f"/api/v1/sessions/{self.id}/pages", {}, NewPageResult)

    async def switch_page(self, page_id: str) -> dict:
        return await self._client._post(f"/api/v1/sessions/{self.id}/pages/switch", {"page_id": page_id}, dict)

    async def close_page(self, page_id: str) -> None:
        await self._client._delete(f"/api/v1/sessions/{self.id}/pages/{page_id}")

    async def handoff_start(self) -> HandoffResult:
        """Switch to headed mode for human login. Call handoff_complete() when done."""
        return await self._client._post(
            f"/api/v1/sessions/{self.id}/handoff/start",
            {},
            HandoffResult,
        )

    async def handoff_complete(self) -> HandoffResult:
        """Return session to headless mode after human login is complete."""
        return await self._client._post(
            f"/api/v1/sessions/{self.id}/handoff/complete",
            {},
            HandoffResult,
        )

    async def set_policy(self, profile: str, allow_sensitive_actions: Optional[bool] = None) -> "PolicyInfo":
        """Override the safety execution policy for this session."""
        from .models import PolicyInfo
        body: dict = {"profile": profile}
        if allow_sensitive_actions is not None:
            body["allow_sensitive_actions"] = allow_sensitive_actions
        return await self._client._post(f"/api/v1/sessions/{self.id}/policy", body, PolicyInfo)

    async def get_policy(self) -> "PolicyInfo":
        """Get the current safety execution policy for this session."""
        from .models import PolicyInfo
        return await self._client._get(f"/api/v1/sessions/{self.id}/policy", PolicyInfo)

    async def element_map(
        self,
        scope: Optional[str] = None,
        limit: int = 500,
        include_unlabeled: bool = False,
        purpose: Optional[str] = None,
        operator: Optional[str] = None,
    ) -> "ElementMapResult":
        """Scan the page for interactive elements and assign stable element IDs."""
        from .models import ElementMapResult
        body: dict = {"limit": limit}
        if scope:
            body["scope"] = scope
        if include_unlabeled:
            body["include_unlabeled"] = True
        if purpose:
            body["purpose"] = purpose
        if operator:
            body["operator"] = operator
        return await self._client._post(f"/api/v1/sessions/{self.id}/element_map", body, ElementMapResult)

    async def get(
        self,
        property: str,
        selector: Optional[str] = None,
        element_id: Optional[str] = None,
        attr_name: Optional[str] = None,
        purpose: Optional[str] = None,
        operator: Optional[str] = None,
    ) -> "GetPropertyResult":
        """Read a property from a page element."""
        from .models import GetPropertyResult
        body: dict = {"property": property}
        if selector:
            body["selector"] = selector
        if element_id:
            body["element_id"] = element_id
        if attr_name:
            body["attr_name"] = attr_name
        if purpose:
            body["purpose"] = purpose
        if operator:
            body["operator"] = operator
        return await self._client._post(f"/api/v1/sessions/{self.id}/get", body, GetPropertyResult)

    async def assert_state(
        self,
        property: str,
        selector: Optional[str] = None,
        element_id: Optional[str] = None,
        expected: bool = True,
        purpose: Optional[str] = None,
        operator: Optional[str] = None,
    ) -> "AssertResult":
        """Assert an element state property."""
        from .models import AssertResult
        body: dict = {"property": property, "expected": expected}
        if selector:
            body["selector"] = selector
        if element_id:
            body["element_id"] = element_id
        if purpose:
            body["purpose"] = purpose
        if operator:
            body["operator"] = operator
        return await self._client._post(f"/api/v1/sessions/{self.id}/assert", body, AssertResult)

    async def wait_page_stable(
        self,
        timeout_ms: int = 10000,
        dom_stable_ms: int = 300,
        overlay_selector: Optional[str] = None,
        purpose: Optional[str] = None,
        operator: Optional[str] = None,
    ) -> "StableResult":
        """Wait for the page to be stable (network idle + DOM quiescence)."""
        from .models import StableResult
        body: dict = {"timeout_ms": timeout_ms, "dom_stable_ms": dom_stable_ms}
        if overlay_selector:
            body["overlay_selector"] = overlay_selector
        if purpose:
            body["purpose"] = purpose
        if operator:
            body["operator"] = operator
        return await self._client._post(f"/api/v1/sessions/{self.id}/wait_page_stable", body, StableResult)

    async def snapshot_map(self, scope: Optional[str] = None, limit: int = 500, include_unlabeled: bool = False, purpose: Optional[str] = None, operator: Optional[str] = None) -> "SnapshotMapResult":
        """Snapshot page elements with page_rev tracking. Use include_unlabeled=True for icon-only elements."""
        from .models import SnapshotMapResult
        body: dict = {"limit": limit}
        if scope: body["scope"] = scope
        if include_unlabeled: body["include_unlabeled"] = True
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return await self._client._post(f"/api/v1/sessions/{self.id}/snapshot_map", body, SnapshotMapResult)

    async def page_rev(self) -> "PageRevResult":
        """Return current page revision counter (R08-R12)."""
        from .models import PageRevResult
        return await self._client._get(f"/api/v1/sessions/{self.id}/page_rev", PageRevResult)

    async def dblclick(self, selector: Optional[str] = None, element_id: Optional[str] = None, ref_id: Optional[str] = None, timeout_ms: int = 5000, purpose: Optional[str] = None, operator: Optional[str] = None) -> ActionResult:
        if not selector and not element_id and not ref_id: raise ValueError("selector, element_id, or ref_id required")
        body: dict = {"timeout_ms": timeout_ms}
        if selector: body["selector"] = selector
        if element_id: body["element_id"] = element_id
        if ref_id: body["ref_id"] = ref_id
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return await self._client._post(f"/api/v1/sessions/{self.id}/dblclick", body, ActionResult)

    async def focus(self, selector: Optional[str] = None, element_id: Optional[str] = None, ref_id: Optional[str] = None, purpose: Optional[str] = None, operator: Optional[str] = None) -> ActionResult:
        if not selector and not element_id and not ref_id: raise ValueError("selector, element_id, or ref_id required")
        body: dict = {}
        if selector: body["selector"] = selector
        if element_id: body["element_id"] = element_id
        if ref_id: body["ref_id"] = ref_id
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return await self._client._post(f"/api/v1/sessions/{self.id}/focus", body, ActionResult)

    async def check(self, selector: Optional[str] = None, element_id: Optional[str] = None, ref_id: Optional[str] = None, timeout_ms: int = 5000, purpose: Optional[str] = None, operator: Optional[str] = None) -> ActionResult:
        if not selector and not element_id and not ref_id: raise ValueError("selector, element_id, or ref_id required")
        body: dict = {"timeout_ms": timeout_ms}
        if selector: body["selector"] = selector
        if element_id: body["element_id"] = element_id
        if ref_id: body["ref_id"] = ref_id
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return await self._client._post(f"/api/v1/sessions/{self.id}/check", body, ActionResult)

    async def uncheck(self, selector: Optional[str] = None, element_id: Optional[str] = None, ref_id: Optional[str] = None, timeout_ms: int = 5000, purpose: Optional[str] = None, operator: Optional[str] = None) -> ActionResult:
        if not selector and not element_id and not ref_id: raise ValueError("selector, element_id, or ref_id required")
        body: dict = {"timeout_ms": timeout_ms}
        if selector: body["selector"] = selector
        if element_id: body["element_id"] = element_id
        if ref_id: body["ref_id"] = ref_id
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return await self._client._post(f"/api/v1/sessions/{self.id}/uncheck", body, ActionResult)

    async def back(self, timeout_ms: int = 5000, wait_until: str = "load", purpose: Optional[str] = None, operator: Optional[str] = None) -> "NavResult":
        from .models import NavResult
        body: dict = {"timeout_ms": timeout_ms, "wait_until": wait_until}
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return await self._client._post(f"/api/v1/sessions/{self.id}/back", body, NavResult)

    async def forward(self, timeout_ms: int = 5000, wait_until: str = "load", purpose: Optional[str] = None, operator: Optional[str] = None) -> "NavResult":
        from .models import NavResult
        body: dict = {"timeout_ms": timeout_ms, "wait_until": wait_until}
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return await self._client._post(f"/api/v1/sessions/{self.id}/forward", body, NavResult)

    async def reload(self, timeout_ms: int = 10000, wait_until: str = "load", purpose: Optional[str] = None, operator: Optional[str] = None) -> "NavResult":
        from .models import NavResult
        body: dict = {"timeout_ms": timeout_ms, "wait_until": wait_until}
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return await self._client._post(f"/api/v1/sessions/{self.id}/reload", body, NavResult)

    async def wait_text(self, text: str, timeout_ms: int = 5000, purpose: Optional[str] = None, operator: Optional[str] = None) -> "WaitTextResult":
        from .models import WaitTextResult
        body: dict = {"text": text, "timeout_ms": timeout_ms}
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return await self._client._post(f"/api/v1/sessions/{self.id}/wait_text", body, WaitTextResult)

    async def scroll_until(self, direction: str = "down", scroll_selector: Optional[str] = None, stop_selector: Optional[str] = None, stop_text: Optional[str] = None, max_scrolls: int = 20, scroll_delta: int = 400, stall_ms: int = 500, purpose: Optional[str] = None, operator: Optional[str] = None) -> "ScrollUntilResult":
        from .models import ScrollUntilResult
        body: dict = {"direction": direction, "max_scrolls": max_scrolls, "scroll_delta": scroll_delta, "stall_ms": stall_ms}
        if scroll_selector: body["scroll_selector"] = scroll_selector
        if stop_selector: body["stop_selector"] = stop_selector
        if stop_text: body["stop_text"] = stop_text
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return await self._client._post(f"/api/v1/sessions/{self.id}/scroll_until", body, ScrollUntilResult)

    async def drag(self, source: Optional[str] = None, target: Optional[str] = None, source_element_id: Optional[str] = None, target_element_id: Optional[str] = None, source_ref_id: Optional[str] = None, target_ref_id: Optional[str] = None, purpose: Optional[str] = None, operator: Optional[str] = None) -> "DragResult":
        from .models import DragResult
        body: dict = {}
        if source: body["source"] = source
        if target: body["target"] = target
        if source_element_id: body["source_element_id"] = source_element_id
        if target_element_id: body["target_element_id"] = target_element_id
        if source_ref_id: body["source_ref_id"] = source_ref_id
        if target_ref_id: body["target_ref_id"] = target_ref_id
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return await self._client._post(f"/api/v1/sessions/{self.id}/drag", body, DragResult)

    async def mouse_move(self, x: Optional[int] = None, y: Optional[int] = None, ref_id: Optional[str] = None, element_id: Optional[str] = None, selector: Optional[str] = None, purpose: Optional[str] = None, operator: Optional[str] = None) -> "MouseResult":
        """Move mouse to coordinates or to center of element via ref_id/element_id/selector (R08-R05)."""
        from .models import MouseResult
        body: dict = {}
        if x is not None: body["x"] = x
        if y is not None: body["y"] = y
        if ref_id: body["ref_id"] = ref_id
        if element_id: body["element_id"] = element_id
        if selector: body["selector"] = selector
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return await self._client._post(f"/api/v1/sessions/{self.id}/mouse_move", body, MouseResult)

    async def mouse_down(self, x: Optional[int] = None, y: Optional[int] = None, button: str = "left", purpose: Optional[str] = None, operator: Optional[str] = None) -> "MouseResult":
        from .models import MouseResult
        body: dict = {"button": button}
        if x is not None: body["x"] = x
        if y is not None: body["y"] = y
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return await self._client._post(f"/api/v1/sessions/{self.id}/mouse_down", body, MouseResult)

    async def mouse_up(self, button: str = "left", purpose: Optional[str] = None, operator: Optional[str] = None) -> "MouseResult":
        from .models import MouseResult
        body: dict = {"button": button}
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return await self._client._post(f"/api/v1/sessions/{self.id}/mouse_up", body, MouseResult)

    async def load_more_until(self, load_more_selector: str, content_selector: str, item_count: Optional[int] = None, stop_text: Optional[str] = None, max_loads: int = 10, stall_ms: int = 800, purpose: Optional[str] = None, operator: Optional[str] = None) -> "LoadMoreResult":
        from .models import LoadMoreResult
        body: dict = {"load_more_selector": load_more_selector, "content_selector": content_selector, "max_loads": max_loads, "stall_ms": stall_ms}
        if item_count is not None: body["item_count"] = item_count
        if stop_text: body["stop_text"] = stop_text
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return await self._client._post(f"/api/v1/sessions/{self.id}/load_more_until", body, LoadMoreResult)

    # ── R07-T19: Coordinate-based input primitives ───────────────────────────

    async def click_at(self, x: float, y: float, button: str = "left", click_count: int = 1, delay_ms: int = 0, purpose: Optional[str] = None, operator: Optional[str] = None) -> "ClickAtResult":
        from .models import ClickAtResult
        body: dict = {"x": x, "y": y, "button": button, "click_count": click_count, "delay_ms": delay_ms}
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return await self._client._post(f"/api/v1/sessions/{self.id}/click_at", body, ClickAtResult)

    async def wheel(self, dx: float = 0, dy: float = 0, purpose: Optional[str] = None, operator: Optional[str] = None) -> "WheelAtResult":
        from .models import WheelAtResult
        body: dict = {"dx": dx, "dy": dy}
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return await self._client._post(f"/api/v1/sessions/{self.id}/wheel", body, WheelAtResult)

    async def insert_text(self, text: str, purpose: Optional[str] = None, operator: Optional[str] = None) -> "InsertTextResult":
        from .models import InsertTextResult
        body: dict = {"text": text}
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return await self._client._post(f"/api/v1/sessions/{self.id}/insert_text", body, InsertTextResult)

    # ── R07-T20: Bounding box retrieval ─────────────────────────────────────

    async def bbox(self, selector: Optional[str] = None, element_id: Optional[str] = None, ref_id: Optional[str] = None, purpose: Optional[str] = None, operator: Optional[str] = None) -> "BboxResult":
        from .models import BboxResult
        if not selector and not element_id and not ref_id:
            raise ValueError("selector, element_id, or ref_id is required")
        body: dict = {}
        if selector: body["selector"] = selector
        if element_id: body["element_id"] = element_id
        if ref_id: body["ref_id"] = ref_id
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return await self._client._post(f"/api/v1/sessions/{self.id}/bbox", body, BboxResult)

    # ── R07-T22: Dialog observability ────────────────────────────────────────

    async def dialogs(self, tail: Optional[int] = None) -> "DialogListResult":
        from .models import DialogListResult
        qs = f"?tail={tail}" if tail is not None else ""
        return await self._client._get(f"/api/v1/sessions/{self.id}/dialogs{qs}", DialogListResult)

    async def clear_dialogs(self) -> None:
        await self._client._delete(f"/api/v1/sessions/{self.id}/dialogs")

    # ── R07-T23: Clipboard ───────────────────────────────────────────────────

    async def clipboard_write(self, text: str, purpose: Optional[str] = None, operator: Optional[str] = None) -> "ClipboardWriteResult":
        from .models import ClipboardWriteResult
        body: dict = {"text": text}
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return await self._client._post(f"/api/v1/sessions/{self.id}/clipboard", body, ClipboardWriteResult)

    async def clipboard_read(self, purpose: Optional[str] = None, operator: Optional[str] = None) -> "ClipboardReadResult":
        from .models import ClipboardReadResult
        return await self._client._get(f"/api/v1/sessions/{self.id}/clipboard", ClipboardReadResult)

    # ── R07-T24: Viewport emulation ──────────────────────────────────────────

    async def set_viewport(self, width: int, height: int, purpose: Optional[str] = None, operator: Optional[str] = None) -> "ViewportResult":
        from .models import ViewportResult
        body: dict = {"width": width, "height": height}
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return await self._client._put(f"/api/v1/sessions/{self.id}/viewport", body, ViewportResult)

    # ── R07-T25: Network conditions ──────────────────────────────────────────

    async def set_network_conditions(self, offline: bool = False, latency_ms: int = 0, download_kbps: float = -1, upload_kbps: float = -1) -> "NetworkConditionsResult":
        from .models import NetworkConditionsResult
        body: dict = {"offline": offline, "latency_ms": latency_ms, "download_kbps": download_kbps, "upload_kbps": upload_kbps}
        return await self._client._post(f"/api/v1/sessions/{self.id}/network_conditions", body, NetworkConditionsResult)

    async def reset_network_conditions(self) -> None:
        await self._client._delete(f"/api/v1/sessions/{self.id}/network_conditions")

    async def close(self) -> None:
        await self._client._delete(f"/api/v1/sessions/{self.id}")

    async def __aenter__(self) -> "AsyncSession":
        return self

    async def __aexit__(self, *_) -> None:
        await self.close()


# ---------------------------------------------------------------------------
# Sync client
# ---------------------------------------------------------------------------

class BrowserClient:
    """Synchronous agentmb client.

    Usage::

        client = BrowserClient()
        with client.sessions.create(profile="myprofile") as sess:
            sess.navigate("https://example.com")
            shot = sess.screenshot()
            shot.save("/tmp/out.png")
    """

    def __init__(
        self,
        base_url: Optional[str] = None,
        api_token: Optional[str] = None,
        timeout: float = 30.0,
        operator: Optional[str] = None,
    ) -> None:
        self._base_url = base_url or _base_url()
        self._api_token = api_token or os.environ.get("AGENTMB_API_TOKEN")
        self._operator = operator or os.environ.get("AGENTMB_OPERATOR")
        self._http = httpx.Client(
            base_url=self._base_url,
            headers=_base_headers(self._api_token, self._operator),
            timeout=timeout,
        )
        self.sessions = _SyncSessionManager(self)

    def health(self) -> DaemonStatus:
        return self._get("/health", DaemonStatus)

    def _post(self, path: str, body: dict, model=None):
        resp = self._http.post(path, json=body, headers={"content-type": "application/json"})
        resp.raise_for_status()
        data = resp.json()
        if model and model is not dict:
            return model.model_validate(data)
        return data

    def _get(self, path: str, model=None):
        resp = self._http.get(path)
        resp.raise_for_status()
        data = resp.json()
        if model:
            return model.model_validate(data)
        return data

    def _delete(self, path: str) -> None:
        resp = self._http.delete(path)
        if resp.status_code not in (200, 204, 404):
            resp.raise_for_status()

    def _put(self, path: str, body: dict, model=None):
        resp = self._http.put(path, json=body, headers={"content-type": "application/json"})
        resp.raise_for_status()
        data = resp.json()
        if model and model is not dict:
            return model.model_validate(data)
        return data

    def _delete_with_body(self, path: str, body: dict) -> None:
        resp = self._http.request("DELETE", path, json=body, headers={"content-type": "application/json"})
        if resp.status_code not in (200, 204, 404):
            resp.raise_for_status()

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> "BrowserClient":
        return self

    def __exit__(self, *_) -> None:
        self.close()


class _SyncSessionManager:
    def __init__(self, client: BrowserClient) -> None:
        self._client = client

    def create(
        self,
        profile: str = "default",
        headless: bool = True,
        agent_id: Optional[str] = None,
        accept_downloads: bool = False,
    ) -> Session:
        info = self._client._post(
            "/api/v1/sessions",
            {"profile": profile, "headless": headless, "agent_id": agent_id, "accept_downloads": accept_downloads},
            SessionInfo,
        )
        return Session(info.session_id, self._client)

    def list(self) -> List[SessionInfo]:
        raw = self._client._get("/api/v1/sessions")
        return [SessionInfo.model_validate(s) for s in raw]

    def get(self, session_id: str) -> SessionInfo:
        return self._client._get(f"/api/v1/sessions/{session_id}", SessionInfo)

    def get_handle(self, session_id: str) -> Session:
        """Return a Session handle for an existing session_id (no network call)."""
        return Session(session_id, self._client)


# ---------------------------------------------------------------------------
# Async client
# ---------------------------------------------------------------------------

class AsyncBrowserClient:
    """Async agentmb client (for use with asyncio / LangGraph).

    Usage::

        async with AsyncBrowserClient() as client:
            async with client.sessions.create() as sess:
                await sess.navigate("https://example.com")
                result = await sess.eval("document.title")
    """

    def __init__(
        self,
        base_url: Optional[str] = None,
        api_token: Optional[str] = None,
        timeout: float = 30.0,
        operator: Optional[str] = None,
    ) -> None:
        self._base_url = base_url or _base_url()
        self._api_token = api_token or os.environ.get("AGENTMB_API_TOKEN")
        self._operator = operator or os.environ.get("AGENTMB_OPERATOR")
        self._timeout = timeout
        self._http: Optional[httpx.AsyncClient] = None
        self.sessions = _AsyncSessionManager(self)

    async def _ensure_client(self) -> httpx.AsyncClient:
        if self._http is None:
            self._http = httpx.AsyncClient(
                base_url=self._base_url,
                headers=_base_headers(self._api_token, self._operator),
                timeout=self._timeout,
            )
        return self._http

    async def health(self) -> DaemonStatus:
        return await self._get("/health", DaemonStatus)

    async def _post(self, path: str, body: dict, model=None):
        client = await self._ensure_client()
        resp = await client.post(path, json=body, headers={"content-type": "application/json"})
        resp.raise_for_status()
        data = resp.json()
        if model and model is not dict:
            return model.model_validate(data)
        return data

    async def _get(self, path: str, model=None):
        client = await self._ensure_client()
        resp = await client.get(path)
        resp.raise_for_status()
        data = resp.json()
        if model:
            return model.model_validate(data)
        return data

    async def _delete(self, path: str) -> None:
        client = await self._ensure_client()
        resp = await client.delete(path)
        if resp.status_code not in (200, 204, 404):
            resp.raise_for_status()

    async def _put(self, path: str, body: dict, model=None):
        client = await self._ensure_client()
        resp = await client.put(path, json=body, headers={"content-type": "application/json"})
        resp.raise_for_status()
        data = resp.json()
        if model and model is not dict:
            return model.model_validate(data)
        return data

    async def _delete_with_body(self, path: str, body: dict) -> None:
        client = await self._ensure_client()
        resp = await client.request("DELETE", path, json=body, headers={"content-type": "application/json"})
        if resp.status_code not in (200, 204, 404):
            resp.raise_for_status()

    async def close(self) -> None:
        if self._http:
            await self._http.aclose()
            self._http = None

    async def __aenter__(self) -> "AsyncBrowserClient":
        return self

    async def __aexit__(self, *_) -> None:
        await self.close()


class _AsyncSessionManager:
    def __init__(self, client: AsyncBrowserClient) -> None:
        self._client = client

    async def create(
        self,
        profile: str = "default",
        headless: bool = True,
        agent_id: Optional[str] = None,
        accept_downloads: bool = False,
    ) -> AsyncSession:
        info = await self._client._post(
            "/api/v1/sessions",
            {"profile": profile, "headless": headless, "agent_id": agent_id, "accept_downloads": accept_downloads},
            SessionInfo,
        )
        return AsyncSession(info.session_id, self._client)

    async def list(self) -> List[SessionInfo]:
        raw = await self._client._get("/api/v1/sessions")
        return [SessionInfo.model_validate(s) for s in raw]

    async def get(self, session_id: str) -> SessionInfo:
        return await self._client._get(f"/api/v1/sessions/{session_id}", SessionInfo)
