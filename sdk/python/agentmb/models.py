"""Pydantic v2 models for agentmb SDK responses."""

from __future__ import annotations

import base64
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class SessionInfo(BaseModel):
    session_id: str
    profile: str
    headless: bool
    created_at: str
    state: str = "live"  # 'live' | 'zombie'
    agent_id: Optional[str] = None
    accept_downloads: bool = False


class NavigateResult(BaseModel):
    status: str
    url: str
    title: str
    duration_ms: int


class ActionResult(BaseModel):
    status: str
    selector: Optional[str] = None
    duration_ms: int


class EvalResult(BaseModel):
    status: str
    result: Any
    duration_ms: int


class ScreenshotResult(BaseModel):
    status: str
    data: str  # base64-encoded PNG or JPEG
    format: str
    duration_ms: int

    def to_bytes(self) -> bytes:
        """Decode base64 data to raw bytes."""
        return base64.b64decode(self.data)

    def save(self, path: str) -> None:
        """Write screenshot bytes to a file."""
        with open(path, "wb") as f:
            f.write(self.to_bytes())


class ExtractResult(BaseModel):
    status: str
    selector: str
    items: List[Dict[str, Any]]
    count: int
    duration_ms: int


class TypeResult(BaseModel):
    status: str
    selector: str
    duration_ms: int


class PressResult(BaseModel):
    status: str
    selector: str
    key: str
    duration_ms: int


class SelectResult(BaseModel):
    status: str
    selector: str
    selected: List[str]
    duration_ms: int


class HoverResult(BaseModel):
    status: str
    selector: str
    duration_ms: int


class WaitForSelectorResult(BaseModel):
    status: str
    selector: str
    state: str
    duration_ms: int


class WaitForUrlResult(BaseModel):
    status: str
    url: str
    duration_ms: int


class WaitForResponseResult(BaseModel):
    status: str
    url: str
    status_code: int
    duration_ms: int


class UploadResult(BaseModel):
    status: str
    selector: str
    filename: str
    size_bytes: int
    duration_ms: int


class PageInfo(BaseModel):
    page_id: str
    url: str
    active: bool


class PageListResult(BaseModel):
    session_id: str
    pages: List[PageInfo]


class NewPageResult(BaseModel):
    session_id: str
    page_id: str
    url: str


class RouteMock(BaseModel):
    status: Optional[int] = 200
    headers: Optional[Dict[str, str]] = None
    body: Optional[str] = None
    content_type: Optional[str] = None


class RouteEntry(BaseModel):
    pattern: str
    mock: RouteMock


class RouteListResult(BaseModel):
    session_id: str
    routes: List[RouteEntry]


class DownloadResult(BaseModel):
    status: str
    filename: str
    data: str  # base64-encoded file content
    size_bytes: int
    duration_ms: int

    def to_bytes(self) -> bytes:
        """Decode base64 data to raw bytes."""
        return base64.b64decode(self.data)

    def save(self, path: str) -> None:
        """Write downloaded file bytes to a file."""
        with open(path, "wb") as f:
            f.write(self.to_bytes())


class TraceResult(BaseModel):
    session_id: str
    data: str  # base64-encoded ZIP
    format: str  # always 'zip'
    size_bytes: int

    def to_bytes(self) -> bytes:
        return base64.b64decode(self.data)

    def save(self, path: str) -> None:
        with open(path, "wb") as f:
            f.write(self.to_bytes())


class AuditEntry(BaseModel):
    ts: Optional[str] = None
    v: Optional[int] = None
    session_id: Optional[str] = None
    action_id: Optional[str] = None
    type: str
    action: Optional[str] = None
    url: Optional[str] = None
    selector: Optional[str] = None
    params: Optional[Dict[str, Any]] = None
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    purpose: Optional[str] = None    # why this action is being taken
    operator: Optional[str] = None   # who/what is invoking


class HandoffResult(BaseModel):
    session_id: str
    mode: str  # 'headed' | 'headless'
    message: str


class DaemonStatus(BaseModel):
    status: str
    version: str
    uptime_s: int
    sessions_active: int



class PolicyInfo(BaseModel):
    """Current safety policy for a session (r06-c02)."""
    session_id: str
    profile: str  # 'safe' | 'permissive' | 'disabled'
    domain_min_interval_ms: int
    jitter_ms: List[int]
    cooldown_after_error_ms: int
    max_retries_per_domain: int
    max_actions_per_minute: int
    allow_sensitive_actions: bool


# ---------------------------------------------------------------------------
# R07-T01: element_map models
# ---------------------------------------------------------------------------

class ElementRect(BaseModel):
    x: int
    y: int
    width: int
    height: int


class ElementInfo(BaseModel):
    """A single element entry from element_map (r07-c01)."""
    element_id: str      # stable ID, e.g. 'e1', 'e2'
    tag: str
    role: str
    text: str
    name: str
    placeholder: str
    href: str
    type: str
    overlay_blocked: bool
    rect: ElementRect


class ElementMapResult(BaseModel):
    """Result of POST /sessions/:id/element_map."""
    status: str
    url: str
    elements: List[ElementInfo]
    count: int
    duration_ms: int


# ---------------------------------------------------------------------------
# R07-T02: get / assert models
# ---------------------------------------------------------------------------

class GetPropertyResult(BaseModel):
    """Result of POST /sessions/:id/get."""
    status: str
    selector: str
    property: str
    value: Any
    duration_ms: int


class AssertResult(BaseModel):
    """Result of POST /sessions/:id/assert."""
    status: str
    selector: str
    property: str
    actual: bool
    expected: bool
    passed: bool
    duration_ms: int


# ---------------------------------------------------------------------------
# R07-T07: wait_page_stable model
# ---------------------------------------------------------------------------

class StableResult(BaseModel):
    """Result of POST /sessions/:id/wait_page_stable."""
    status: str
    url: str
    waited_ms: int
    duration_ms: int


# ---------------------------------------------------------------------------
# R07-T13: snapshot_map models
# ---------------------------------------------------------------------------

class SnapshotElement(BaseModel):
    """A single element entry from snapshot_map (includes ref_id)."""
    ref_id: str          # e.g. 'snap_abc123:e5' — server-tracked reference
    element_id: str      # DOM-injected ID (e.g. 'e5')
    tag: str
    role: str
    text: str
    name: str
    placeholder: str
    href: str
    type: str
    overlay_blocked: bool
    rect: ElementRect


class SnapshotMapResult(BaseModel):
    """Result of POST /sessions/:id/snapshot_map."""
    status: str
    snapshot_id: str   # e.g. 'snap_abc123'
    page_rev: int      # monotonic page revision counter
    url: str
    elements: List[SnapshotElement]
    count: int
    duration_ms: int


# ---------------------------------------------------------------------------
# R07-T18: stale_ref error
# ---------------------------------------------------------------------------

class StaleRefError(Exception):
    """Raised when a ref_id is used after the page has changed (HTTP 409)."""
    def __init__(self, ref_id: str, snapshot_page_rev: int, current_page_rev: int, message: str):
        super().__init__(message)
        self.ref_id = ref_id
        self.snapshot_page_rev = snapshot_page_rev
        self.current_page_rev = current_page_rev


# ---------------------------------------------------------------------------
# R07-T03: Interaction primitive results
# ---------------------------------------------------------------------------

class DragResult(BaseModel):
    status: str
    source: str
    target: str
    duration_ms: int


class MouseResult(BaseModel):
    status: str
    duration_ms: int


class KeyResult(BaseModel):
    status: str
    key: str
    duration_ms: int


# ---------------------------------------------------------------------------
# R07-T04: Wait / navigation results
# ---------------------------------------------------------------------------

class NavResult(BaseModel):
    """Result of back / forward / reload."""
    status: str
    url: str
    duration_ms: int


class WaitTextResult(BaseModel):
    status: str
    text: str
    duration_ms: int


class WaitLoadStateResult(BaseModel):
    status: str
    state: str
    url: str
    duration_ms: int


class WaitFunctionResult(BaseModel):
    status: str
    url: str
    duration_ms: int


# ---------------------------------------------------------------------------
# R07-T08: Scroll primitive results
# ---------------------------------------------------------------------------

class ScrollUntilResult(BaseModel):
    status: str
    scrolls_performed: int
    stop_reason: str
    duration_ms: int


class LoadMoreResult(BaseModel):
    status: str
    loads_performed: int
    final_count: int
    stop_reason: str
    duration_ms: int


# ---------------------------------------------------------------------------
# R07-T05: Cookie and storage state models
# ---------------------------------------------------------------------------

class CookieInfo(BaseModel):
    name: str
    value: str
    domain: str
    path: str
    expires: Optional[float] = None
    http_only: Optional[bool] = None
    secure: Optional[bool] = None
    same_site: Optional[str] = None


class CookieListResult(BaseModel):
    session_id: str
    cookies: List[Dict[str, Any]]
    count: int


class StorageStateResult(BaseModel):
    session_id: str
    storage_state: Dict[str, Any]


class StorageStateRestoreResult(BaseModel):
    status: str
    cookies_restored: int


# ---------------------------------------------------------------------------
# R07-T15: Annotated screenshot
# ---------------------------------------------------------------------------

class AnnotatedScreenshotResult(BaseModel):
    status: str
    data: str       # base64-encoded PNG or JPEG
    format: str
    highlight_count: int
    duration_ms: int

    def to_bytes(self) -> bytes:
        return base64.b64decode(self.data)

    def save(self, path: str) -> None:
        with open(path, "wb") as f:
            f.write(self.to_bytes())


# ---------------------------------------------------------------------------
# R07-T16/T17: Console log + page error models
# ---------------------------------------------------------------------------

class ConsoleEntry(BaseModel):
    ts: str
    type: str    # 'log' | 'warn' | 'error' | 'info' | ...
    text: str
    url: str


class ConsoleLogResult(BaseModel):
    session_id: str
    entries: List[ConsoleEntry]
    count: int


class PageErrorEntry(BaseModel):
    ts: str
    message: str
    url: str


class PageErrorListResult(BaseModel):
    session_id: str
    entries: List[PageErrorEntry]
    count: int
