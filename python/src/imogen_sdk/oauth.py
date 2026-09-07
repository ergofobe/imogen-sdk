"""The OAuth 2.1 client a native application needs.

Discover the server, register itself, run authorization code with PKCE, and refresh. No
client secret is involved, because a secret shipped inside a mobile app is not a secret.
"""

from __future__ import annotations

import base64
import hashlib
import secrets
import time
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal
from urllib.parse import parse_qs, urlencode, urlparse

import httpx

from .models import (
    DEFAULT_SCOPES,
    AuthorizationServerMetadata,
    ClientRegistrationResponse,
    PairingClaim,
    PairingClaimRequest,
    ProtectedResourceMetadata,
    TokenResponse,
)

__all__ = ["OAuthClient", "PairedDevice", "PendingAuthorization", "StoredTokens"]

#: A resource the server publishes a protected-resource document for: the REST API, or MCP.
ProtectedResourcePath = Literal["", "/mcp"]


@dataclass(frozen=True)
class PendingAuthorization:
    """Hold these until the redirect comes back; they complete the exchange."""

    authorization_url: str
    code_verifier: str
    state: str
    redirect_uri: str
    client_id: str
    #: The RFC 8707 resource this authorization asked for, or None for a token valid at
    #: every surface. Carried here rather than passed again at the exchange because the
    #: server refuses a token request naming a resource the code did not record: the two
    #: halves cannot disagree if only one of them holds it.
    resource: str | None = None


@dataclass(frozen=True)
class StoredTokens:
    tokens: TokenResponse
    #: Unix seconds, so expiry is computable without keeping the clock that read it.
    obtained_at: float

    def is_expired(self, skew_seconds: int = 60) -> bool:
        """True when the token is expired or close enough that it should be refreshed."""
        return time.time() >= self.obtained_at + max(0, self.tokens.expires_in - skew_seconds)


class OAuthError(Exception):
    pass


@dataclass(frozen=True)
class PairedDevice:
    """What comes back from :meth:`OAuthClient.pair`: an account, and its client."""

    #: Registered for this device alone. Needed again to refresh.
    client_id: str
    tokens: StoredTokens
    scope: str


class OAuthClient:
    """
    >>> oauth = OAuthClient("https://photos.example.com")            # doctest: +SKIP
    >>> client = await oauth.register("My App", ["myapp://oauth"])   # doctest: +SKIP
    >>> pending = await oauth.begin_authorization(                   # doctest: +SKIP
    ...     client.client_id, "myapp://oauth"
    ... )
    >>> # open pending.authorization_url in the system browser, then on the callback:
    >>> tokens = await oauth.complete_authorization(pending, url)    # doctest: +SKIP
    """

    def __init__(self, base_url: str, client: httpx.AsyncClient | None = None) -> None:
        self.base_url = base_url.rstrip("/")
        self._owns_client = client is None
        self._client = client or httpx.AsyncClient(timeout=30.0)
        self._metadata: AuthorizationServerMetadata | None = None

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def discover(self) -> AuthorizationServerMetadata:
        if self._metadata:
            return self._metadata

        response = await self._client.get(f"{self.base_url}/.well-known/oauth-authorization-server")
        if not response.is_success:
            raise OAuthError("Could not read the authorization server metadata")

        self._metadata = AuthorizationServerMetadata.model_validate(response.json())
        return self._metadata

    async def discover_protected_resource(
        self, path: ProtectedResourcePath = ""
    ) -> ProtectedResourceMetadata:
        """RFC 9728: the document describing one resource this server protects.

        Read the identifier to bind a token to from ``resource`` here rather than
        building it — see :class:`~imogen_sdk.models.ProtectedResourceMetadata`.
        """
        response = await self._client.get(
            f"{self.base_url}/.well-known/oauth-protected-resource{path}"
        )
        if not response.is_success:
            raise OAuthError("Could not read the protected resource metadata")

        return ProtectedResourceMetadata.model_validate(response.json())

    async def register(
        self,
        name: str,
        redirect_uris: Sequence[str],
        scopes: Sequence[str] = DEFAULT_SCOPES,
    ) -> ClientRegistrationResponse:
        """RFC 7591 dynamic registration, so an app never ships a hard-coded client id."""
        metadata = await self.discover()
        response = await self._client.post(
            metadata.registration_endpoint,
            json={
                "client_name": name,
                "redirect_uris": list(redirect_uris),
                "token_endpoint_auth_method": "none",
                "grant_types": ["authorization_code", "refresh_token"],
                "response_types": ["code"],
                "scope": " ".join(scopes),
            },
        )
        if not response.is_success:
            raise OAuthError(f"Registration failed: {response.text}")
        return ClientRegistrationResponse.model_validate(response.json())

    async def begin_authorization(
        self,
        client_id: str,
        redirect_uri: str,
        scopes: Sequence[str] = DEFAULT_SCOPES,
        resource: str | None = None,
    ) -> PendingAuthorization:
        """Build the authorization URL, and the state needed to complete the exchange.

        ``resource`` is RFC 8707. When given, the token is bound to that one resource and
        is refused everywhere else; take the value from
        :meth:`discover_protected_resource`. Leave it None for a token valid at every
        surface, which is what pairing has to use — the claim endpoint mints its code
        server-side and cannot record a resource.
        """
        metadata = await self.discover()
        code_verifier = _random_string(32)
        state = _random_string(16)

        params = {
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "scope": " ".join(scopes),
            "state": state,
            "code_challenge": _s256(code_verifier),
            "code_challenge_method": "S256",
        }
        if resource is not None:
            params["resource"] = resource
        query = urlencode(params)
        separator = "&" if urlparse(metadata.authorization_endpoint).query else "?"

        return PendingAuthorization(
            authorization_url=f"{metadata.authorization_endpoint}{separator}{query}",
            code_verifier=code_verifier,
            state=state,
            redirect_uri=redirect_uri,
            client_id=client_id,
            resource=resource,
        )

    async def complete_authorization(
        self, pending: PendingAuthorization, callback_url: str
    ) -> StoredTokens:
        params = {k: v[0] for k, v in parse_qs(urlparse(callback_url).query).items()}

        if "error" in params:
            raise OAuthError(
                params.get("error_description") or f"Authorization failed: {params['error']}"
            )
        # Checking state is what stops a code from another session being injected here.
        if params.get("state") != pending.state:
            raise OAuthError(
                "Authorization state did not match; the response may have been tampered with"
            )
        if "code" not in params:
            raise OAuthError("The callback carried no authorization code")

        exchange = {
            "grant_type": "authorization_code",
            "client_id": pending.client_id,
            "code": params["code"],
            "code_verifier": pending.code_verifier,
            "redirect_uri": pending.redirect_uri,
        }
        if pending.resource is not None:
            exchange["resource"] = pending.resource
        return await self._exchange(exchange)

    async def pair(
        self,
        pairing_code: str,
        client_name: str,
        redirect_uri: str,
        device_name: str | None = None,
        scopes: Sequence[str] = DEFAULT_SCOPES,
    ) -> PairedDevice:
        """The whole pairing sequence, from a scanned QR code to tokens.

        Registers a client for this device, spends the pairing code on an authorization
        code, and exchanges it. The verifier never leaves this process, so the pairing code
        on its own — photographed off somebody's screen, say — cannot be turned into a
        session.
        """
        registered = await self.register(client_name, [redirect_uri], scopes)
        verifier = _random_string()

        request = PairingClaimRequest(
            code=pairing_code,
            client_id=registered.client_id,
            redirect_uri=redirect_uri,
            code_challenge=_s256(verifier),
            scope=" ".join(scopes),
            device_name=device_name,
        )
        response = await self._client.post(
            f"{self.base_url}/api/v1/pairing/claim",
            json=request.model_dump(by_alias=True, exclude_none=True),
        )
        if response.is_error:
            # The imogen error envelope, not the OAuth one: this is an API route.
            described = "That pairing code could not be used"
            try:
                described = response.json()["error"]["message"]
            except Exception:  # noqa: BLE001 — any malformed body means we keep the default.
                pass
            raise OAuthError(described)

        claim = PairingClaim.model_validate(response.json())
        tokens = await self._exchange(
            {
                "grant_type": "authorization_code",
                "client_id": registered.client_id,
                "code": claim.code,
                "code_verifier": verifier,
                "redirect_uri": claim.redirect_uri,
            }
        )
        return PairedDevice(client_id=registered.client_id, tokens=tokens, scope=claim.scope)

    async def refresh(self, client_id: str, refresh_token: str) -> StoredTokens:
        return await self._exchange(
            {
                "grant_type": "refresh_token",
                "client_id": client_id,
                "refresh_token": refresh_token,
            }
        )

    async def revoke(self, token: str) -> None:
        metadata = await self.discover()
        await self._client.post(metadata.revocation_endpoint, data={"token": token})

    async def _exchange(self, params: dict[str, str]) -> StoredTokens:
        metadata = await self.discover()
        response = await self._client.post(metadata.token_endpoint, data=params)

        if not response.is_success:
            described = "Token request failed"
            try:
                body = response.json()
                described = body.get("error_description") or body.get("error") or described
            except ValueError:
                pass
            raise OAuthError(described)

        return StoredTokens(
            tokens=TokenResponse.model_validate(response.json()),
            obtained_at=time.time(),
        )


def _base64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _random_string(byte_length: int = 32) -> str:
    return _base64url(secrets.token_bytes(byte_length))


def _s256(verifier: str) -> str:
    return _base64url(hashlib.sha256(verifier.encode()).digest())
