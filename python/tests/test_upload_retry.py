"""A retried upload has to send the file again.

imogen-sdk#51. The small-file upload opens the photograph once and hands that
handle to every attempt. The first attempt reads it to the end, so a retry that
does not start over encodes an empty file part.
"""

from __future__ import annotations

import json
from typing import Any

import pytest

from conftest import Reply
from imogen_sdk import ImogenClient

_PAYLOAD = b"harbour-bytes-not-empty"

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


@pytest.mark.parametrize("status", [401, 503])
async def test_a_retried_upload_sends_the_file_bytes_again(
    serve: Any, tmp_path: Any, status: int
) -> None:
    path = tmp_path / "harbour.jpg"
    path.write_bytes(_PAYLOAD)

    def responder(_request: Any, index: int) -> Reply:
        if index == 0:
            code = "unauthorized" if status == 401 else "unavailable"
            return Reply(status, json.dumps({"error": {"code": code, "message": "again"}}))
        return Reply(body=_STORED)

    async def refresh() -> str:
        return "fresh"

    stub = serve(responder)
    async with ImogenClient(stub.base_url, token="stale", on_unauthorized=refresh) as client:
        result = await client.assets.upload(path)

    assert result.asset.id == "asset-1"
    assert [(call.method, call.path) for call in stub.calls] == [
        ("POST", "/api/v1/assets"),
        ("POST", "/api/v1/assets"),
    ]
    assert _PAYLOAD in stub.calls[0].body
    assert _PAYLOAD in stub.calls[1].body
