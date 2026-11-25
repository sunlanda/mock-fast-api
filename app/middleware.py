"""ASGI middleware: mock-only CORS and request logging."""

from __future__ import annotations

import json
import time
from typing import Any

from starlette.responses import Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from . import store
from .config import LOG_BODY_LIMIT

REDACT_HEADERS = {
    "authorization",
    "cookie",
    "set-cookie",
    "x-api-key",
    "proxy-authorization",
}
CORS_HEADERS = [
    (b"access-control-allow-origin", b"*"),
    (b"access-control-allow-methods", b"GET, POST, PUT, PATCH, DELETE, OPTIONS"),
    (
        b"access-control-allow-headers",
        b"Content-Type, Authorization, X-Requested-With, X-Mock-Client",
    ),
    (
        b"access-control-expose-headers",
        b"X-Mock-Project, X-Mock-Table, X-Mock-Format, "
        b"X-Mock-Total, X-Mock-Page, X-Mock-TotalPages, X-Mock-Delay",
    ),
    (b"access-control-max-age", b"86400"),
]


def _decode_headers(raw_headers: list[tuple[bytes, bytes]]) -> dict[str, str]:
    headers: dict[str, str] = {}
    for key, value in raw_headers:
        name = key.decode("latin-1").lower()
        text = value.decode("latin-1")
        if name in REDACT_HEADERS:
            text = "•••••• (redacted)"
        headers[name] = text
    return headers


class MockCorsMiddleware:
    """Only mock endpoints get permissive CORS; admin APIs stay same-origin."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not scope.get("path", "").startswith("/mock"):
            await self.app(scope, receive, send)
            return
        if scope.get("method") == "OPTIONS":
            response = Response(status_code=204)
            for key, value in CORS_HEADERS:
                response.headers[key.decode()] = value.decode()
            await response(scope, receive, send)
            return

        async def send_with_cors(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                existing = {key.lower() for key, _ in headers}
                for key, value in CORS_HEADERS:
                    if key not in existing:
                        headers.append((key, value))
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_with_cors)


class RequestLogMiddleware:
    """Capture mock + SQL console requests, including headers and timing."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path = scope.get("path", "")
        method = scope.get("method", "GET")
        should_log = path.startswith("/mock/") or (
            path.startswith("/api/connections/") and path.endswith("/query")
        )
        if not should_log or method == "OPTIONS":
            await self.app(scope, receive, send)
            return

        started = time.perf_counter()
        request_body = bytearray()
        response_body = bytearray()
        status_code = 0
        response_headers: list[tuple[bytes, bytes]] = []
        error_text: str | None = None

        async def receive_wrapper() -> Message:
            message = await receive()
            if message["type"] == "http.request":
                chunk = message.get("body", b"")
                remaining = 32768 - len(request_body)
                if remaining > 0:
                    request_body.extend(chunk[:remaining])
            return message

        async def send_wrapper(message: Message) -> None:
            nonlocal status_code, response_headers
            if message["type"] == "http.response.start":
                status_code = int(message.get("status", 0))
                response_headers = list(message.get("headers", []))
            elif message["type"] == "http.response.body":
                remaining = 65536 - len(response_body)
                if remaining > 0:
                    response_body.extend(message.get("body", b"")[:remaining])
            await send(message)

        try:
            await self.app(scope, receive_wrapper, send_wrapper)
        except Exception as exc:
            status_code = 500
            error_text = str(exc)[:300]
            raise
        finally:
            duration_ms = round((time.perf_counter() - started) * 1000, 2)
            try:
                request_headers = _decode_headers(scope.get("headers", []))
                response_headers_dict = _decode_headers(response_headers)
                query = scope.get("query_string", b"").decode("utf-8", "replace")
                body_text = request_body.decode("utf-8", "replace")
                preview = response_body.decode("utf-8", "replace")[:LOG_BODY_LIMIT]
                content_type = request_headers.get("content-type", "")
                if request_body and not any(
                    token in content_type
                    for token in ("json", "text", "x-www-form-urlencoded")
                ):
                    body_text = f"<{len(request_body)} bytes binary body>"
                size_header = response_headers_dict.get("content-length")
                try:
                    size = int(size_header) if size_header else len(response_body)
                except ValueError:
                    size = len(response_body)
                slug = None
                parts = path.split("/")
                if path.startswith("/mock/") and len(parts) > 2:
                    slug = parts[2]
                kind = "mock" if path.startswith("/mock/") else "sql"
                store.insert_log(
                    {
                        "kind": kind,
                        "method": method,
                        "path": path,
                        "status": status_code,
                        "duration_ms": duration_ms,
                        "req_headers": request_headers,
                        "req_body": body_text[:LOG_BODY_LIMIT],
                        "query": query[:2000],
                        "resp_headers": response_headers_dict,
                        "resp_preview": preview,
                        "size": size,
                        "project_slug": slug,
                        "client": (
                            ":".join(str(part) for part in scope.get("client", []))
                            if scope.get("client")
                            else None
                        ),
                        "error": error_text,
                    }
                )
            except Exception:
                # Logging must never break the API response.
                pass
