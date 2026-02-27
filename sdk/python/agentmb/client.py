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

    def click(self, selector: str, timeout_ms: int = 5000, purpose: Optional[str] = None, operator: Optional[str] = None) -> ActionResult:
        body: dict = {"selector": selector, "timeout_ms": timeout_ms}
        if purpose:
            body["purpose"] = purpose
        if operator:
            body["operator"] = operator
        return self._client._post(f"/api/v1/sessions/{self.id}/click", body, ActionResult)

    def fill(self, selector: str, value: str, purpose: Optional[str] = None, operator: Optional[str] = None) -> ActionResult:
        body: dict = {"selector": selector, "value": value}
        if purpose:
            body["purpose"] = purpose
        if operator:
            body["operator"] = operator
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

    def type(self, selector: str, text: str, delay_ms: int = 0, purpose: Optional[str] = None, operator: Optional[str] = None) -> TypeResult:
        body: dict = {"selector": selector, "text": text, "delay_ms": delay_ms}
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return self._client._post(f"/api/v1/sessions/{self.id}/type", body, TypeResult)

    def press(self, selector: str, key: str, purpose: Optional[str] = None, operator: Optional[str] = None) -> PressResult:
        body: dict = {"selector": selector, "key": key}
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return self._client._post(f"/api/v1/sessions/{self.id}/press", body, PressResult)

    def select(self, selector: str, values: List[str], purpose: Optional[str] = None, operator: Optional[str] = None) -> SelectResult:
        body: dict = {"selector": selector, "values": values}
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return self._client._post(f"/api/v1/sessions/{self.id}/select", body, SelectResult)

    def hover(self, selector: str, purpose: Optional[str] = None, operator: Optional[str] = None) -> HoverResult:
        body: dict = {"selector": selector}
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

    def upload(self, selector: str, file_path: str, mime_type: str = "application/octet-stream", purpose: Optional[str] = None, operator: Optional[str] = None) -> UploadResult:
        import base64 as _b64
        import os as _os
        with open(file_path, "rb") as f:
            content = _b64.b64encode(f.read()).decode()
        body: dict = {"selector": selector, "content": content, "filename": _os.path.basename(file_path), "mime_type": mime_type}
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return self._client._post(f"/api/v1/sessions/{self.id}/upload", body, UploadResult)

    def download(self, selector: str, timeout_ms: int = 30000, purpose: Optional[str] = None, operator: Optional[str] = None) -> DownloadResult:
        body: dict = {"selector": selector, "timeout_ms": timeout_ms}
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
        purpose: Optional[str] = None,
        operator: Optional[str] = None,
    ) -> "ElementMapResult":
        """Scan the page for interactive elements and assign stable element IDs.

        Returns a list of ElementInfo objects. Each element has an element_id
        (e.g. 'e1', 'e2') that can be used in place of a CSS selector in
        click(), fill(), hover(), type(), press() calls.

        Args:
            scope: Optional CSS selector to limit the scan to a subtree.
            limit: Max number of elements to return (default 500).
        """
        from .models import ElementMapResult
        body: dict = {"limit": limit}
        if scope:
            body["scope"] = scope
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

    async def click(self, selector: str, timeout_ms: int = 5000, purpose: Optional[str] = None, operator: Optional[str] = None) -> ActionResult:
        body: dict = {"selector": selector, "timeout_ms": timeout_ms}
        if purpose:
            body["purpose"] = purpose
        if operator:
            body["operator"] = operator
        return await self._client._post(f"/api/v1/sessions/{self.id}/click", body, ActionResult)

    async def fill(self, selector: str, value: str, purpose: Optional[str] = None, operator: Optional[str] = None) -> ActionResult:
        body: dict = {"selector": selector, "value": value}
        if purpose:
            body["purpose"] = purpose
        if operator:
            body["operator"] = operator
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

    async def type(self, selector: str, text: str, delay_ms: int = 0, purpose: Optional[str] = None, operator: Optional[str] = None) -> TypeResult:
        body: dict = {"selector": selector, "text": text, "delay_ms": delay_ms}
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return await self._client._post(f"/api/v1/sessions/{self.id}/type", body, TypeResult)

    async def press(self, selector: str, key: str, purpose: Optional[str] = None, operator: Optional[str] = None) -> PressResult:
        body: dict = {"selector": selector, "key": key}
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return await self._client._post(f"/api/v1/sessions/{self.id}/press", body, PressResult)

    async def select(self, selector: str, values: List[str], purpose: Optional[str] = None, operator: Optional[str] = None) -> SelectResult:
        body: dict = {"selector": selector, "values": values}
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return await self._client._post(f"/api/v1/sessions/{self.id}/select", body, SelectResult)

    async def hover(self, selector: str, purpose: Optional[str] = None, operator: Optional[str] = None) -> HoverResult:
        body: dict = {"selector": selector}
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

    async def upload(self, selector: str, file_path: str, mime_type: str = "application/octet-stream", purpose: Optional[str] = None, operator: Optional[str] = None) -> UploadResult:
        import base64 as _b64
        import os as _os
        import asyncio as _asyncio
        def _read() -> str:
            with open(file_path, "rb") as f:
                return _b64.b64encode(f.read()).decode()
        content = await _asyncio.to_thread(_read)
        body: dict = {"selector": selector, "content": content, "filename": _os.path.basename(file_path), "mime_type": mime_type}
        if purpose: body["purpose"] = purpose
        if operator: body["operator"] = operator
        return await self._client._post(f"/api/v1/sessions/{self.id}/upload", body, UploadResult)

    async def download(self, selector: str, timeout_ms: int = 30000, purpose: Optional[str] = None, operator: Optional[str] = None) -> DownloadResult:
        body: dict = {"selector": selector, "timeout_ms": timeout_ms}
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
        purpose: Optional[str] = None,
        operator: Optional[str] = None,
    ) -> "ElementMapResult":
        """Scan the page for interactive elements and assign stable element IDs."""
        from .models import ElementMapResult
        body: dict = {"limit": limit}
        if scope:
            body["scope"] = scope
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
