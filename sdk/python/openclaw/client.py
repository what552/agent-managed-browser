"""openclaw-browser Python SDK — sync and async clients."""

from __future__ import annotations

import os
from contextlib import asynccontextmanager, contextmanager
from typing import AsyncGenerator, Generator, List, Optional

import httpx

from .models import (
    ActionResult,
    AuditEntry,
    DaemonStatus,
    EvalResult,
    ExtractResult,
    HandoffResult,
    NavigateResult,
    ScreenshotResult,
    SessionInfo,
)

_DEFAULT_BASE_URL = "http://127.0.0.1:19315"


def _base_url() -> str:
    port = os.environ.get("OPENCLAW_PORT", "19315")
    return f"http://127.0.0.1:{port}"


def _base_headers(api_token: Optional[str]) -> dict:
    """Headers that go on every request (no content-type — set per-method)."""
    h: dict = {}
    if api_token:
        h["X-API-Token"] = api_token
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
    """Synchronous openclaw-browser client.

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
    ) -> None:
        self._base_url = base_url or _base_url()
        self._api_token = api_token or os.environ.get("OPENCLAW_API_TOKEN")
        self._http = httpx.Client(
            base_url=self._base_url,
            headers=_base_headers(self._api_token),
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
    ) -> Session:
        info = self._client._post(
            "/api/v1/sessions",
            {"profile": profile, "headless": headless, "agent_id": agent_id},
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
    """Async openclaw-browser client (for use with asyncio / LangGraph).

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
    ) -> None:
        self._base_url = base_url or _base_url()
        self._api_token = api_token or os.environ.get("OPENCLAW_API_TOKEN")
        self._timeout = timeout
        self._http: Optional[httpx.AsyncClient] = None
        self.sessions = _AsyncSessionManager(self)

    async def _ensure_client(self) -> httpx.AsyncClient:
        if self._http is None:
            self._http = httpx.AsyncClient(
                base_url=self._base_url,
                headers=_base_headers(self._api_token),
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
    ) -> AsyncSession:
        info = await self._client._post(
            "/api/v1/sessions",
            {"profile": profile, "headless": headless, "agent_id": agent_id},
            SessionInfo,
        )
        return AsyncSession(info.session_id, self._client)

    async def list(self) -> List[SessionInfo]:
        raw = await self._client._get("/api/v1/sessions")
        return [SessionInfo.model_validate(s) for s in raw]

    async def get(self, session_id: str) -> SessionInfo:
        return await self._client._get(f"/api/v1/sessions/{session_id}", SessionInfo)
