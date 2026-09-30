"""A multipart body is sent once.

A 401 still asks the caller to refresh. Only a request with no upload is
resent, and the token the caller passed stays the token later calls read.
"""

from __future__ import annotations

import io
import json
from typing import Any

import pytest

from conftest import Reply
from imogen_sdk import ImogenClient, ImogenError

_PAYLOAD = b"harbour-bytes-not-empty"
_PAGE = json.dumps({"items": [], "nextCursor": None, "total": 0})
_UNAUTHORIZED = json.dumps({"error": {"code": "unauthorized", "message": "x"}})
_UNAVAILABLE = json.dumps({"error": {"code": "unavailable", "message": "x"}})


class _Store:
    def __init__(self) -> None:
        self.access_token = "from-provider"


class _Upload:
    """A body httpx can stream once. It cannot seek, and it refuses to be read whole."""

    def __init__(self, payload: bytes) -> None:
        self.name = "harbour.jpg"
        self._payload = payload
        self._pos = 0

    def tell(self) -> int:
        return self._pos

    def seek(self, offset: int, whence: int = 0) -> int:
        raise io.UnsupportedOperation("seek")

    def read(self, n: int = -1) -> bytes:
        if n is None or n < 0:
            raise io.UnsupportedOperation("refusing to buffer the upload")
        chunk = self._payload[self._pos : self._pos + n]
        self._pos += len(chunk)
        return chunk


def _provider(store: _Store, reads: list[str]) -> Any:
    def token() -> str:
        reads.append(store.access_token)
        return store.access_token

    return token


async def _refresh() -> str:
    return "from-refresh"


def _reject_once(status: int, body: str) -> Any:
    def responder(_request: Any, index: int) -> Reply:
        if index == 0:
            return Reply(status, body)
        return Reply(body=_PAGE)

    return responder


async def test_a_callable_token_is_read_again_after_a_refresh(serve: Any) -> None:
    store = _Store()
    reads: list[str] = []
    stub = serve(_reject_once(401, _UNAUTHORIZED))
    async with ImogenClient(
        stub.base_url,
        token=_provider(store, reads),
        on_unauthorized=_refresh,
    ) as client:
        first = await client.assets.list()
        second = await client.assets.list()

    assert first.items == []
    assert second.items == []
    assert [call.headers["authorization"] for call in stub.calls] == [
        "Bearer from-provider",
        "Bearer from-refresh",
        "Bearer from-provider",
    ]
    assert reads == ["from-provider", "from-provider"]


async def test_an_unauthorized_upload_is_an_auth_error_and_is_not_resent(serve: Any) -> None:
    refreshed: list[str] = []

    async def refresh() -> str:
        refreshed.append("from-refresh")
        return "from-refresh"

    handle = _Upload(_PAYLOAD)
    stub = serve(lambda _request, _index: Reply(401, _UNAUTHORIZED))
    async with ImogenClient(stub.base_url, token="stale", on_unauthorized=refresh) as client:
        with pytest.raises(ImogenError) as caught:
            await client.http.request(
                "POST",
                "/api/v1/assets",
                files={"file": ("harbour.jpg", handle, "image/jpeg")},
            )

    assert caught.value.status == 401
    assert caught.value.is_auth_error
    assert caught.value.code == "unauthorized"
    assert refreshed == ["from-refresh"]
    assert len(stub.calls) == 1
    assert stub.calls[0].headers["authorization"] == "Bearer stale"
    assert _PAYLOAD in stub.calls[0].body
    assert b'filename="harbour.jpg"' in stub.calls[0].body


async def test_a_multipart_server_error_is_not_resent(serve: Any) -> None:
    handle = _Upload(_PAYLOAD)
    stub = serve(lambda _request, _index: Reply(503, _UNAVAILABLE))
    async with ImogenClient(stub.base_url, token="stale", on_unauthorized=_refresh) as client:
        with pytest.raises(ImogenError) as caught:
            await client.http.request(
                "POST",
                "/api/v1/assets",
                files={"file": ("harbour.jpg", handle, "image/jpeg")},
            )

    assert caught.value.status == 503
    assert len(stub.calls) == 1
    assert stub.calls[0].headers["authorization"] == "Bearer stale"
    assert _PAYLOAD in stub.calls[0].body


async def test_a_rejected_token_is_resent_once_when_retries_are_zero(serve: Any) -> None:
    store = _Store()
    reads: list[str] = []
    stub = serve(_reject_once(401, _UNAUTHORIZED))
    async with ImogenClient(
        stub.base_url,
        token=_provider(store, reads),
        on_unauthorized=_refresh,
        max_retries=0,
    ) as client:
        page = await client.assets.list()
        later = await client.assets.list()

    assert page.items == []
    assert later.items == []
    assert len(stub.calls) == 3
    assert [call.headers["authorization"] for call in stub.calls] == [
        "Bearer from-provider",
        "Bearer from-refresh",
        "Bearer from-provider",
    ]
    assert reads == ["from-provider", "from-provider"]
