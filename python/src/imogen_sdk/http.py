"""The transport every resource shares.

URL building, auth, the error envelope, and one retry policy live here. Resources above
this layer contain no HTTP details at all.
"""

from __future__ import annotations

import asyncio
import inspect
import io
import random
from collections.abc import Awaitable, Callable, Mapping
from typing import Any

import httpx

from .errors import ImogenError

__all__ = ["HttpClient", "TokenProvider"]

#: A bearer token, or something that produces one. Omit in a browser-like context that
#: already holds a session cookie.
TokenProvider = str | Callable[[], str | None] | Callable[[], Awaitable[str | None]]


class HttpClient:
    def __init__(
        self,
        base_url: str,
        *,
        token: TokenProvider | None = None,
        on_unauthorized: Callable[[], Awaitable[str | None]] | None = None,
        max_retries: int = 2,
        client: httpx.AsyncClient | None = None,
        timeout: float = 30.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self._token = token
        self._on_unauthorized = on_unauthorized
        self._max_retries = max_retries
        self._owns_client = client is None
        self._client = client or httpx.AsyncClient(timeout=timeout, follow_redirects=True)

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    def url(self, path: str, params: dict[str, Any] | None = None) -> str:
        url = httpx.URL(f"{self.base_url}{path}")
        if params:
            url = url.copy_merge_params({k: str(v) for k, v in params.items() if v is not None})
        return str(url)

    async def _authorization(self) -> str | None:
        token = self._token
        if token is None:
            return None

        if callable(token):
            value = token()
            if inspect.isawaitable(value):
                value = await value
        else:
            value = token

        return f"Bearer {value}" if value else None

    async def request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: Any | None = None,
        files: Any | None = None,
        data: Any | None = None,
        content: bytes | None = None,
        headers: dict[str, str] | None = None,
    ) -> Any:
        """Sends, decodes, and hands back the parsed body. 204 decodes as ``None``."""
        response = await self.send(
            method,
            path,
            params=params,
            json=json,
            files=files,
            data=data,
            content=content,
            headers=headers,
        )
        if response.status_code == 204 or not response.content:
            return None
        return response.json()

    async def send(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: Any | None = None,
        files: Any | None = None,
        data: Any | None = None,
        content: bytes | None = None,
        headers: dict[str, str] | None = None,
    ) -> httpx.Response:
        """Sends and hands back the raw response, for bytes rather than JSON."""
        # Materialize the mapping once. A multipart body is not retried: the other ports
        # and the README refuse to hold the file and send it again after a 5xx or a drop.
        # A 401 may resend once, with the refreshed token, and that resend is not a retry.
        uploads = _file_entries(files) if files else None
        origins = _capture_origins(uploads) if uploads is not None else None
        refreshed = False
        attempt = 0

        while attempt <= self._max_retries:
            try:
                response = await self._attempt(
                    method,
                    path,
                    params=params,
                    json=json,
                    files=uploads,
                    data=data,
                    content=content,
                    headers=headers,
                )
            except httpx.RequestError:
                if uploads is not None or attempt == self._max_retries:
                    raise
                await _backoff(attempt)
                attempt += 1
                continue

            if (
                response.status_code == 401
                and attempt == 0
                and not refreshed
                and self._on_unauthorized is not None
            ):
                fresh = await self._on_unauthorized()
                if fresh:
                    refreshed = True
                    self._token = fresh
                    if uploads is not None:
                        uploads = _files_for_replay(uploads, origins)
                    continue

            if response.is_success:
                return response

            error = ImogenError.from_response(
                response.status_code, response.reason_phrase, response.content
            )
            if uploads is None and error.is_retryable and attempt < self._max_retries:
                await _backoff(attempt)
                attempt += 1
                continue
            raise error

        raise ImogenError(0, "http_error", "Request failed")

    async def _attempt(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None,
        json: Any | None,
        files: Any | None,
        data: Any | None,
        content: bytes | None,
        headers: dict[str, str] | None,
    ) -> httpx.Response:
        merged = dict(headers or {})
        authorization = await self._authorization()
        if authorization:
            merged["Authorization"] = authorization

        return await self._client.request(
            method,
            self.url(path, params),
            json=json,
            files=files,
            data=data,
            content=content,
            headers=merged,
        )


def _file_entries(files: Any) -> list[tuple[Any, Any]]:
    if isinstance(files, Mapping):
        return list(files.items())
    return [(name, value) for name, value in files]


def _upload_handle(value: Any) -> Any:
    if isinstance(value, tuple) and len(value) >= 2:
        return value[1]
    return value


def _with_upload_handle(value: Any, handle: bytes) -> Any:
    if isinstance(value, tuple) and len(value) >= 2:
        return (value[0], handle, *value[2:])
    return handle


def _capture_origins(entries: list[tuple[Any, Any]]) -> list[Any]:
    """Where each handle was when the call began. ``None`` is already bytes."""
    origins: list[Any] = []
    for _name, value in entries:
        handle = _upload_handle(value)
        if isinstance(handle, (str, bytes, bytearray)):
            origins.append(None)
            continue
        tell = getattr(handle, "tell", None)
        if not callable(tell):
            origins.append(False)
            continue
        try:
            origins.append(tell())
        except (io.UnsupportedOperation, OSError, ValueError):
            origins.append(False)
    return origins


def _files_for_replay(entries: list[tuple[Any, Any]], origins: list[Any]) -> list[tuple[Any, Any]]:
    """Bytes for one resend, from the caller's position rather than 0.

    httpx seeks a seekable handle to 0 before reading it. That repeats a prefix
    the caller had already moved past, and a handle that cannot seek back would
    send whatever is left. Either way this does not ask httpx to read the handle
    again.
    """
    replayed: list[tuple[Any, Any]] = []
    for (name, value), origin in zip(entries, origins, strict=True):
        if origin is None:
            replayed.append((name, value))
            continue
        if origin is False:
            raise ImogenError(0, "http_error", "The upload cannot be sent again")
        handle = _upload_handle(value)
        try:
            handle.seek(origin)
            payload = handle.read()
        except (io.UnsupportedOperation, OSError, ValueError) as error:
            raise ImogenError(0, "http_error", "The upload cannot be sent again") from error
        if not isinstance(payload, (bytes, bytearray)):
            raise ImogenError(0, "http_error", "The upload cannot be sent again")
        replayed.append((name, _with_upload_handle(value, bytes(payload))))
    return replayed


async def _backoff(attempt: int) -> None:
    await asyncio.sleep(backoff_delay(attempt))


def backoff_delay(attempt: int) -> float:
    """Exponential backoff with full jitter, in seconds.

    A fleet of phones retrying after an outage should not arrive in lockstep.
    """
    base = 0.25 * (2**attempt)
    return base + random.random() * base
