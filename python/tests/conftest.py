"""A stub imogen, small enough to keep in one file.

The conformance suite needs a server that records what it was asked and answers
predictably. Standing up a real framework to get that would mean the tests depend on more
than the package does, so this uses the standard library's HTTP server on a thread.
"""

from __future__ import annotations

import json
import threading
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import pytest

CONFORMANCE = Path(__file__).resolve().parents[2] / "conformance"


@dataclass
class Recorded:
    method: str
    path: str
    query: str
    headers: dict[str, str]
    body: bytes


@dataclass
class Reply:
    status: int = 200
    body: str = "{}"


@dataclass
class Stub:
    base_url: str
    calls: list[Recorded] = field(default_factory=list)

    @property
    def call_count(self) -> int:
        return len(self.calls)


Responder = Callable[[Recorded, int], Reply]


def _handler_for(stub: Stub, responder: Responder) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *args: Any) -> None:  # noqa: D102 — silence the test run.
            pass

        def _respond(self) -> None:
            length = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(length) if length else b""
            parsed = urlparse(self.path)

            request = Recorded(
                method=self.command,
                path=parsed.path,
                query=parsed.query,
                headers={k.lower(): v for k, v in self.headers.items()},
                body=body,
            )
            index = len(stub.calls)
            stub.calls.append(request)

            reply = responder(request, index)
            payload = reply.body.encode()

            self.send_response(reply.status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        do_GET = _respond
        do_POST = _respond
        do_PATCH = _respond
        do_PUT = _respond
        do_DELETE = _respond

    return Handler


@pytest.fixture
def serve() -> Iterator[Callable[[Responder], Stub]]:
    """Starts a stub on an ephemeral port and tears it down after the test."""
    servers: list[ThreadingHTTPServer] = []

    def start(responder: Responder) -> Stub:
        stub = Stub(base_url="")
        server = ThreadingHTTPServer(("127.0.0.1", 0), _handler_for(stub, responder))
        stub.base_url = f"http://127.0.0.1:{server.server_address[1]}"
        servers.append(server)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        return stub

    yield start

    for server in servers:
        server.shutdown()
        server.server_close()


def load(name: str) -> Any:
    return json.loads((CONFORMANCE / name).read_text())


@pytest.fixture(scope="session")
def endpoints() -> Any:
    return load("endpoints.json")


@pytest.fixture(scope="session")
def models() -> Any:
    return load("models.json")


@pytest.fixture(scope="session")
def errors() -> Any:
    return load("errors.json")
