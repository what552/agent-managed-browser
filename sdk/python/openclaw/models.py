"""Pydantic v2 models for openclaw-browser SDK responses."""

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


class HandoffResult(BaseModel):
    session_id: str
    mode: str  # 'headed' | 'headless'
    message: str


class DaemonStatus(BaseModel):
    status: str
    version: str
    uptime_s: int
    sessions_active: int
