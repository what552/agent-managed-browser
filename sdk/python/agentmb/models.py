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
