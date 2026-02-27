#!/usr/bin/env python3
"""R07-T09: agentmb MCP adapter PoC

Minimal MCP (Model Context Protocol) server that exposes agentmb browser
automation capabilities as MCP tools. Communicates over stdin/stdout using
the JSON-RPC 2.0 framing required by MCP.

This is a **standalone external adapter** — it does NOT modify the core
agentmb daemon. Start it alongside an already-running agentmb daemon.

Usage::

    # Start the agentmb daemon first:
    agentmb start

    # Then run this adapter (stdio transport, for use with an MCP host):
    python3 adapters/mcp/agentmb_mcp.py

    # Or with a custom daemon URL:
    AGENTMB_BASE_URL=http://127.0.0.1:19315 python3 adapters/mcp/agentmb_mcp.py

Exposed MCP tools (5):
  - agentmb_create_session  — create a new browser session
  - agentmb_navigate        — navigate to a URL
  - agentmb_click           — click an element by CSS selector
  - agentmb_extract         — extract text/attributes from elements
  - agentmb_screenshot      — take a screenshot (returns base64)

Requirements: Python 3.9+, agentmb Python SDK (pip install agentmb)
"""

from __future__ import annotations

import json
import os
import sys
import traceback
from typing import Any, Dict, Optional

# ---------------------------------------------------------------------------
# Minimal JSON-RPC 2.0 + MCP protocol helpers
# ---------------------------------------------------------------------------

def _send(obj: dict) -> None:
    # Use binary stdout with explicit UTF-8 encoding to avoid locale-dependent
    # text-mode translations (e.g. CRLF on Windows, wrong codec on non-UTF-8 locales).
    line = (json.dumps(obj, ensure_ascii=False) + "\n").encode("utf-8")
    sys.stdout.buffer.write(line)
    sys.stdout.buffer.flush()


def _error_response(req_id: Any, code: int, message: str) -> dict:
    return {"jsonrpc": "2.0", "id": req_id, "error": {"code": code, "message": message}}


def _ok_response(req_id: Any, result: Any) -> dict:
    return {"jsonrpc": "2.0", "id": req_id, "result": result}


# ---------------------------------------------------------------------------
# MCP tool definitions
# ---------------------------------------------------------------------------

TOOLS = [
    {
        "name": "agentmb_create_session",
        "description": "Create a new agentmb browser session and return its session_id.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "profile": {"type": "string", "description": "Browser profile name (default: 'default')"},
                "headless": {"type": "boolean", "description": "Run headless (default: true)"},
            },
        },
    },
    {
        "name": "agentmb_navigate",
        "description": "Navigate an agentmb session to a URL.",
        "inputSchema": {
            "type": "object",
            "required": ["session_id", "url"],
            "properties": {
                "session_id": {"type": "string"},
                "url": {"type": "string", "description": "URL to navigate to"},
                "wait_until": {"type": "string", "enum": ["load", "networkidle", "commit", "domcontentloaded"], "default": "load"},
            },
        },
    },
    {
        "name": "agentmb_click",
        "description": "Click an element in an agentmb session using a CSS selector.",
        "inputSchema": {
            "type": "object",
            "required": ["session_id", "selector"],
            "properties": {
                "session_id": {"type": "string"},
                "selector": {"type": "string", "description": "CSS selector for the element to click"},
            },
        },
    },
    {
        "name": "agentmb_extract",
        "description": "Extract text or attribute values from elements matching a CSS selector.",
        "inputSchema": {
            "type": "object",
            "required": ["session_id", "selector"],
            "properties": {
                "session_id": {"type": "string"},
                "selector": {"type": "string"},
                "attribute": {"type": "string", "description": "Attribute name to extract (default: text content)"},
            },
        },
    },
    {
        "name": "agentmb_screenshot",
        "description": "Take a screenshot of the current page and return base64-encoded PNG data.",
        "inputSchema": {
            "type": "object",
            "required": ["session_id"],
            "properties": {
                "session_id": {"type": "string"},
                "full_page": {"type": "boolean", "description": "Capture full page (default: false)"},
            },
        },
    },
]

# ---------------------------------------------------------------------------
# Tool handlers
# ---------------------------------------------------------------------------

def _get_client():
    """Lazy-import and construct BrowserClient with configured base URL."""
    try:
        from agentmb import BrowserClient
    except ImportError:
        raise RuntimeError("agentmb Python SDK not installed. Run: pip install agentmb")
    base_url = os.environ.get("AGENTMB_BASE_URL", "http://127.0.0.1:19315")
    return BrowserClient(base_url=base_url)


def handle_create_session(args: dict) -> dict:
    client = _get_client()
    session = client.sessions.create(
        profile=args.get("profile", "default"),
        headless=args.get("headless", True),
    )
    return {"session_id": session.id, "profile": args.get("profile", "default")}


def handle_navigate(args: dict) -> dict:
    client = _get_client()
    session = client.sessions.get_handle(args["session_id"])
    result = session.navigate(args["url"], wait_until=args.get("wait_until", "load"))
    return {"status": result.status, "url": result.url, "title": result.title, "duration_ms": result.duration_ms}


def handle_click(args: dict) -> dict:
    client = _get_client()
    session = client.sessions.get_handle(args["session_id"])
    result = session.click(selector=args["selector"])
    return {"status": result.status, "selector": result.selector, "duration_ms": result.duration_ms}


def handle_extract(args: dict) -> dict:
    client = _get_client()
    session = client.sessions.get_handle(args["session_id"])
    kwargs = {"selector": args["selector"]}
    if "attribute" in args:
        kwargs["attribute"] = args["attribute"]  # type: ignore[assignment]
    result = session.extract(**kwargs)  # type: ignore[arg-type]
    return {"status": result.status, "count": result.count, "items": result.items}


def handle_screenshot(args: dict) -> dict:
    client = _get_client()
    session = client.sessions.get_handle(args["session_id"])
    result = session.screenshot(full_page=args.get("full_page", False))
    return {"status": result.status, "data": result.data, "format": result.format, "duration_ms": result.duration_ms}


HANDLERS = {
    "agentmb_create_session": handle_create_session,
    "agentmb_navigate": handle_navigate,
    "agentmb_click": handle_click,
    "agentmb_extract": handle_extract,
    "agentmb_screenshot": handle_screenshot,
}

# ---------------------------------------------------------------------------
# MCP message dispatch
# ---------------------------------------------------------------------------

def dispatch(req: dict) -> Optional[dict]:
    req_id = req.get("id")
    method = req.get("method", "")
    params = req.get("params", {})

    # Notifications (no id) — ignore
    if req_id is None and method.startswith("notifications/"):
        return None

    # MCP initialize handshake
    if method == "initialize":
        return _ok_response(req_id, {
            "protocolVersion": "2024-11-05",
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "agentmb-mcp", "version": "0.1.0"},
        })

    if method == "initialized":
        return None  # notification, no response

    # tools/list
    if method == "tools/list":
        return _ok_response(req_id, {"tools": TOOLS})

    # tools/call
    if method == "tools/call":
        tool_name = params.get("name", "")
        tool_args = params.get("arguments", {})
        handler = HANDLERS.get(tool_name)
        if not handler:
            return _error_response(req_id, -32601, f"Unknown tool: {tool_name}")
        try:
            data = handler(tool_args)
            return _ok_response(req_id, {
                "content": [{"type": "text", "text": json.dumps(data, ensure_ascii=False)}],
                "isError": False,
            })
        except Exception as exc:
            tb = traceback.format_exc()
            return _ok_response(req_id, {
                "content": [{"type": "text", "text": f"Error: {exc}\n{tb}"}],
                "isError": True,
            })

    # Unknown method
    if req_id is not None:
        return _error_response(req_id, -32601, f"Method not found: {method}")
    return None


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def main() -> None:
    sys.stderr.write("[agentmb-mcp] MCP adapter started (stdin/stdout transport)\n")
    sys.stderr.flush()
    # Read binary stdin with explicit UTF-8 decoding to avoid locale codec issues
    # and CRLF translation on Windows.  Each message is a single newline-terminated
    # JSON object as per MCP stdio transport spec (2024-11-05).
    stdin = sys.stdin.buffer
    while True:
        raw = stdin.readline()
        if not raw:
            break  # EOF
        line = raw.strip().decode("utf-8", errors="replace")
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError as e:
            _send(_error_response(None, -32700, f"Parse error: {e}"))
            continue
        response = dispatch(req)
        if response is not None:
            _send(response)


if __name__ == "__main__":
    main()
