"""The transport every resource shares.

URL building, auth, the error envelope, and one retry policy live here. Resources above
this layer contain no HTTP details at all.
"""

from __future__ import annotations

import asyncio
import inspect
import random
from collections.abc import Awaitable, Callable
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
        # A multipart body is never sent twice. A 401 elsewhere is resent once.
        multipart = bool(files)
        refreshed = False
        retry_authorization: str | None = None
        attempt = 0

        while True:
            authorization = retry_authorization
            retry_authorization = None
            try:
                response = await self._attempt(
                    method,
                    path,
                    params=params,
                    json=json,
                    files=files,
                    data=data,
                    content=content,
                    headers=headers,
                    authorization=authorization,
                )
            except httpx.RequestError:
                if multipart or attempt == self._max_retries:
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
                refreshed = True
                fresh = await self._on_unauthorized()
                if fresh and not multipart:
                    retry_authorization = f"Bearer {fresh}"
                    continue

            if response.is_success:
                return response

            error = ImogenError.from_response(
                response.status_code, response.reason_phrase, response.content
            )
            if not multipart and error.is_retryable and attempt < self._max_retries:
                await _backoff(attempt)
                attempt += 1
                continue
            raise error

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
        authorization: str | None = None,
    ) -> httpx.Response:
        merged = dict(headers or {})
        if authorization is None:
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


async def _backoff(attempt: int) -> None:
    await asyncio.sleep(backoff_delay(attempt))


def backoff_delay(attempt: int) -> float:
    """Exponential backoff with full jitter, in seconds.

    A fleet of phones retrying after an outage should not arrive in lockstep.
    """
    base = 0.25 * (2**attempt)
    return base + random.random() * base
