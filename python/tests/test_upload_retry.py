"""What a retried upload is allowed to send.

imogen-sdk#51. A second request that continues from where the first read
finished stores an empty or truncated file. A multipart body is not retried
after a transport failure. A 401 may resend once, from the caller's position,
with the token the refresh returned.
"""

from __future__ import annotations

import errno
import io
import json
from collections.abc import Callable
from typing import Any

import pytest

from conftest import Reply
from imogen_sdk import ImogenClient, ImogenError

_PAYLOAD = b"harbour-bytes-not-empty"
_PREFIX = b"HARBOUR-PREFIX-"
_TAIL = b"SHOULD-NOT-REPEAT-TAIL-BYTES"

_STORED = json.dumps(
    {
        "duplicate": False,
        "asset": {
            "id": "asset-1",
            "ownerId": "owner-1",
            "type": "image",
            "status": "ready",
            "originalFilename": "harbour.jpg",
            "mimeType": "image/jpeg",
            "checksum": "abc",
            "sizeBytes": len(_PAYLOAD),
            "capturedAt": "2024-06-01T09:30:00.000Z",
            "capturedAtIsExact": True,
            "createdAt": "2024-06-02T11:00:00.000Z",
            "updatedAt": "2024-06-02T11:05:00.000Z",
            "favorite": False,
            "archived": False,
        },
    }
)


class _Body:
    """A binary upload whose later seeks can fail once the first read is finished."""

    def __init__(
        self,
        payload: bytes,
        on_seek: Callable[[], Exception] | None = None,
        *,
        defer: bool = False,
    ) -> None:
        self._bio = io.BytesIO(payload)
        self._on_seek = on_seek
        self._defer = defer
        self._spent = False

    def read(self, n: int = -1) -> bytes:
        data = self._bio.read(-1 if n is None else n)
        if data == b"":
            self._spent = True
        return data

    def tell(self) -> int:
        return self._bio.tell()

    def seek(self, offset: int, whence: int = 0) -> int:
        if self._on_seek is not None and (self._spent or not self._defer):
            raise self._on_seek()
        return self._bio.seek(offset, whence)


def _then_stored(status: int) -> Callable[[Any, int], Reply]:
    def responder(_request: Any, index: int) -> Reply:
        if index == 0:
            code = "unauthorized" if status == 401 else "unavailable"
            return Reply(status, json.dumps({"error": {"code": code, "message": "again"}}))
        return Reply(body=_STORED)

    return responder


async def _refresh() -> str:
    return "fresh"


@pytest.mark.parametrize("status", [401, 503])
async def test_a_spent_upload_is_not_sent_again(serve: Any, status: int) -> None:
    handle = _Body(
        _PAYLOAD,
        lambda: io.UnsupportedOperation("seek"),
        defer=True,
    )
    stub = serve(_then_stored(status))
    async with ImogenClient(stub.base_url, token="stale", on_unauthorized=_refresh) as client:
        with pytest.raises(ImogenError):
            await client.http.request(
                "POST",
                "/api/v1/assets",
                files={"file": ("harbour.jpg", handle, "image/jpeg")},
            )

    assert len(stub.calls) == 1
    assert _PAYLOAD in stub.calls[0].body


async def test_a_pipe_error_on_replay_is_an_imogen_error(serve: Any) -> None:
    handle = _Body(
        _PAYLOAD,
        lambda: OSError(errno.ESPIPE, "Illegal seek"),
        defer=True,
    )
    stub = serve(_then_stored(401))
    async with ImogenClient(stub.base_url, token="stale", on_unauthorized=_refresh) as client:
        with pytest.raises(ImogenError):
            await client.http.request(
                "POST",
                "/api/v1/assets",
                files={"file": ("harbour.jpg", handle, "image/jpeg")},
            )

    assert len(stub.calls) == 1
    assert _PAYLOAD in stub.calls[0].body


async def test_a_closed_file_on_replay_is_an_imogen_error(serve: Any) -> None:
    handle = _Body(
        _PAYLOAD,
        lambda: ValueError("I/O operation on closed file."),
        defer=True,
    )
    stub = serve(_then_stored(401))
    async with ImogenClient(stub.base_url, token="stale", on_unauthorized=_refresh) as client:
        with pytest.raises(ImogenError):
            await client.http.request(
                "POST",
                "/api/v1/assets",
                files={"file": ("harbour.jpg", handle, "image/jpeg")},
            )

    assert len(stub.calls) == 1
    assert _PAYLOAD in stub.calls[0].body


async def test_an_unauthorized_upload_is_resent_with_the_refreshed_token(
    serve: Any, tmp_path: Any
) -> None:
    path = tmp_path / "harbour.jpg"
    path.write_bytes(_PAYLOAD)
    stub = serve(_then_stored(401))
    async with ImogenClient(stub.base_url, token="stale", on_unauthorized=_refresh) as client:
        result = await client.assets.upload(path)

    assert result.asset.id == "asset-1"
    assert [call.headers["authorization"] for call in stub.calls] == [
        "Bearer stale",
        "Bearer fresh",
    ]
    assert _PAYLOAD in stub.calls[0].body
    assert _PAYLOAD in stub.calls[1].body


async def test_an_unauthorized_upload_still_refreshes_when_retries_are_zero(
    serve: Any, tmp_path: Any
) -> None:
    path = tmp_path / "harbour.jpg"
    path.write_bytes(_PAYLOAD)
    stub = serve(_then_stored(401))
    async with ImogenClient(
        stub.base_url, token="stale", on_unauthorized=_refresh, max_retries=0
    ) as client:
        result = await client.assets.upload(path)

    assert result.asset.id == "asset-1"
    assert len(stub.calls) == 2
    assert stub.calls[1].headers["authorization"] == "Bearer fresh"
    assert _PAYLOAD in stub.calls[1].body


async def test_a_seekable_upload_is_not_resent_after_a_server_error(
    serve: Any, tmp_path: Any
) -> None:
    path = tmp_path / "harbour.jpg"
    path.write_bytes(_PAYLOAD)
    stub = serve(_then_stored(503))
    async with ImogenClient(stub.base_url, token="stale", on_unauthorized=_refresh) as client:
        with pytest.raises(ImogenError) as caught:
            await client.assets.upload(path)

    assert caught.value.status == 503
    assert len(stub.calls) == 1
    assert _PAYLOAD in stub.calls[0].body


async def test_a_resend_starts_at_the_callers_position(serve: Any) -> None:
    handle = io.BytesIO(_PREFIX + _TAIL)
    handle.seek(len(_PREFIX))
    stub = serve(_then_stored(401))
    async with ImogenClient(stub.base_url, token="stale", on_unauthorized=_refresh) as client:
        result = await client.http.request(
            "POST",
            "/api/v1/assets",
            files={"file": ("harbour.jpg", handle, "image/jpeg")},
        )

    assert result["asset"]["id"] == "asset-1"
    assert len(stub.calls) == 2
    assert stub.calls[1].headers["authorization"] == "Bearer fresh"
    assert _TAIL in stub.calls[1].body
    assert _PREFIX + _TAIL not in stub.calls[1].body


async def test_a_rejected_token_is_refreshed_when_retries_are_zero(serve: Any) -> None:
    def responder(_request: Any, index: int) -> Reply:
        if index == 0:
            return Reply(401, json.dumps({"error": {"code": "unauthorized", "message": "x"}}))
        return Reply(body=json.dumps({"items": [], "nextCursor": None, "total": 0}))

    stub = serve(responder)
    async with ImogenClient(
        stub.base_url, token="stale", on_unauthorized=_refresh, max_retries=0
    ) as client:
        page = await client.assets.list()

    assert page.items == []
    assert len(stub.calls) == 2
    assert stub.calls[1].headers["authorization"] == "Bearer fresh"
