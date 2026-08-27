from __future__ import annotations

from collections.abc import Awaitable, Callable
from types import TracebackType

import httpx

from .http import HttpClient, TokenProvider
from .models import Health
from .resources import Admin, Albums, Assets, Auth, Pairing, People, Vault

__all__ = ["ImogenClient"]


class ImogenClient:
    """The imogen client.

    >>> async with ImogenClient("https://photos.example.com", token="…") as imogen:
    ...     page = await imogen.assets.list(AssetQuery(q="harbour", limit=50))

    In a context served by imogen itself, omit ``token``: the session cookie is enough.
    """

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
        self.http = HttpClient(
            base_url,
            token=token,
            on_unauthorized=on_unauthorized,
            max_retries=max_retries,
            client=client,
            timeout=timeout,
        )
        self.assets = Assets(self.http)
        self.albums = Albums(self.http)
        self.admin = Admin(self.http)
        self.auth = Auth(self.http)
        self.vault = Vault(self.http)
        self.people = People(self.http)
        self.pairing = Pairing(self.http)

    @property
    def base_url(self) -> str:
        return self.http.base_url

    async def health(self) -> Health:
        """Confirms the server is reachable and reports its version."""
        return Health.model_validate(await self.http.request("GET", "/api/v1/health"))

    async def aclose(self) -> None:
        await self.http.aclose()

    async def __aenter__(self) -> ImogenClient:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        await self.aclose()
