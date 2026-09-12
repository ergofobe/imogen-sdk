"""The Python half of the shared conformance suite.

Everything asserted here comes out of ``../../conformance``, so this file and its
TypeScript, Rust, Swift and Kotlin counterparts are checking the same contract rather
than five independent opinions about it.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

import pytest

from conftest import Reply
from imogen_sdk import (
    BULK_UPLOAD_CONCURRENCY,
    RESUMABLE_THRESHOLD_BYTES,
    UPLOAD_CHUNK_BYTES,
    AdminUser,
    AdminUserUpdate,
    Album,
    AlbumAssetsResult,
    AlbumCreate,
    AlbumUpdate,
    Asset,
    AssetPage,
    AssetQuery,
    AssetSelection,
    AssetUpdate,
    AuthConfig,
    DetectedFace,
    FaceStatus,
    ImogenClient,
    ImogenError,
    LibraryStats,
    LoginRequest,
    OAuthClient,
    PairingClaim,
    PairingClaimRequest,
    PairingStatus,
    PairingTicket,
    PasswordChangeRequest,
    Person,
    PersonUpdate,
    ProfileUpdate,
    ProtectedResourceMetadata,
    QueueHealth,
    ServerSettings,
    ServerSettingsUpdate,
    ShareLink,
    SignupRequest,
    StorageReport,
    Timeline,
    TimelineBucket,
    TimelineBucketQuery,
    TimelineTile,
    TokenResponse,
    UploadSession,
    User,
    VaultStatus,
)

PLACEHOLDERS = {
    "{assetId}": "ASSET",
    "{albumId}": "ALBUM",
    "{personId}": "PERSON",
    "{faceId}": "FACE",
    "{userId}": "USER",
    "{inviteId}": "INVITE",
    "{jobId}": "JOB",
    "{clientId}": "CLIENT",
    "{sessionId}": "SESSION",
    "{shareId}": "SHARE",
    "{ticketId}": "TICKET",
    "{variant}": "thumbnail",
}


def concrete(path: str) -> str:
    for token, value in PLACEHOLDERS.items():
        path = path.replace(token, value)
    return path


def at(value: Any, path: str) -> Any:
    """Walks a dotted path, so a failure names the field rather than dumping the model."""
    for key in path.split("."):
        if value is None:
            return None
        value = value[int(key)] if isinstance(value, list) else value.get(key)
    return value


def default_reply(request: Any, _index: int) -> Reply:
    """Enough of a server for the client to get through a call.

    The resumable handshake is the only part that needs real answers: it opens a session,
    then chunks until the reported offset reaches the end, so a stub that always says
    nought loops for ever.
    """
    if request.path == "/api/v1/uploads" and request.method == "POST":
        return Reply(
            body=json.dumps(
                {
                    "id": "SESSION",
                    "offset": 0,
                    "sizeBytes": RESUMABLE_THRESHOLD_BYTES,
                    "expiresAt": "2030-01-01T00:00:00.000Z",
                    "existing": None,
                }
            )
        )
    if request.path.startswith("/api/v1/uploads/"):
        return Reply(body=json.dumps({"offset": RESUMABLE_THRESHOLD_BYTES}))
    return Reply(body=json.dumps({"items": [], "nextCursor": None, "total": 0}))


async def invoke(client: ImogenClient, key: str, big_file: Path, small_file: Path) -> bool:
    """Performs one operation from the contract.

    Returns False when the client has no way to perform it, which is itself a conformance
    failure.
    """
    ids = ["ASSET"]

    calls = {
        "client.health": lambda: client.health(),
        "assets.list": lambda: client.assets.list(),
        "assets.get": lambda: client.assets.get("ASSET"),
        "assets.update": lambda: client.assets.update("ASSET", AssetUpdate(favorite=True)),
        "assets.shareLink": lambda: client.assets.share_link("ASSET"),
        "assets.share": lambda: client.assets.share("ASSET"),
        "assets.unshare": lambda: client.assets.unshare("ASSET"),
        "assets.trash": lambda: client.assets.trash(ids),
        "assets.restore": lambda: client.assets.restore(ids),
        "assets.timeline": lambda: client.assets.timeline(),
        "assets.timelineBucket": lambda: client.assets.timeline_bucket(
            TimelineBucketQuery(period="2011-08")
        ),
        "assets.stats": lambda: client.assets.stats(),
        "assets.variant": lambda: client.assets.bytes("ASSET", "thumbnail"),
        "assets.download": lambda: client.http.send("GET", "/api/v1/assets/ASSET/download"),
        "assets.upload": lambda: client.assets.upload(small_file),
        "assets.createUploadSession": lambda: client.assets.upload(big_file),
        "assets.uploadChunk": lambda: client.assets.upload(big_file),
        "assets.completeUpload": lambda: client.assets.upload(big_file),
        "albums.list": lambda: client.albums.list(),
        "albums.get": lambda: client.albums.get("ALBUM"),
        "albums.create": lambda: client.albums.create(AlbumCreate(name="A")),
        "albums.update": lambda: client.albums.update("ALBUM", AlbumUpdate(name="B")),
        "albums.remove": lambda: client.albums.remove("ALBUM"),
        "albums.addAssets": lambda: client.albums.add_assets("ALBUM", ids),
        "albums.removeAssets": lambda: client.albums.remove_assets("ALBUM", ids),
        "albums.shareLink": lambda: client.albums.share_link("ALBUM"),
        "albums.share": lambda: client.albums.share("ALBUM"),
        "albums.unshare": lambda: client.albums.unshare("ALBUM"),
        "people.status": lambda: client.people.status(),
        "people.setEnabled": lambda: client.people.set_enabled(True),
        "people.list": lambda: client.people.list(),
        "people.get": lambda: client.people.get("PERSON"),
        "people.update": lambda: client.people.update("PERSON", PersonUpdate(name="Ada")),
        "people.merge": lambda: client.people.merge("PERSON", ["OTHER"]),
        "people.reassign": lambda: client.people.reassign(["FACE"], None),
        "people.facesIn": lambda: client.people.faces_in("ASSET"),
        "people.thumbnail": lambda: client.http.send("GET", "/api/v1/people/thumbnail/FACE"),
        "vault.status": lambda: client.vault.status(),
        "vault.setPassphrase": lambda: client.vault.set_passphrase("open sesame"),
        "vault.unlock": lambda: client.vault.unlock("open sesame"),
        "vault.lock": lambda: client.vault.lock(),
        "vault.list": lambda: client.vault.list(),
        "vault.timeline": lambda: client.vault.timeline(),
        "vault.timelineBucket": lambda: client.vault.timeline_bucket("2024-06"),
        "vault.moveIn": lambda: client.vault.move_in(ids),
        "vault.moveOut": lambda: client.vault.move_out(ids),
        "auth.config": lambda: client.auth.config(),
        "auth.login": lambda: client.auth.login(LoginRequest(email="a@b.c", password="x")),
        "auth.signup": lambda: client.auth.signup(
            SignupRequest(email="a@b.c", password="x", name="A")
        ),
        "auth.logout": lambda: client.auth.logout(),
        "auth.logoutEverywhere": lambda: client.auth.logout_everywhere(),
        "auth.me": lambda: client.auth.me(),
        "auth.updateProfile": lambda: client.auth.update_profile(ProfileUpdate(name="A")),
        "auth.changePassword": lambda: client.auth.change_password(
            PasswordChangeRequest(new_password="x" * 10)
        ),
        "auth.oidcStart": lambda: client.http.send("GET", "/api/v1/auth/oidc/start"),
        "admin.users": lambda: client.admin.users(),
        "admin.updateUser": lambda: client.admin.update_user("USER", AdminUserUpdate(role="user")),
        "admin.deleteUser": lambda: client.admin.delete_user("USER"),
        "admin.resetPassword": lambda: client.admin.reset_password("USER", "x" * 10),
        "admin.invites": lambda: client.admin.invites(),
        "admin.createInvite": lambda: client.admin.create_invite(),
        "admin.revokeInvite": lambda: client.admin.revoke_invite("INVITE"),
        "admin.queue": lambda: client.admin.queue(),
        "admin.retryJob": lambda: client.admin.retry_job("JOB"),
        "admin.retryAllJobs": lambda: client.admin.retry_all_jobs(),
        "admin.discardJob": lambda: client.admin.discard_job("JOB"),
        "admin.clients": lambda: client.admin.clients(),
        "admin.revokeClient": lambda: client.admin.revoke_client("CLIENT"),
        "admin.sessions": lambda: client.admin.sessions(),
        "admin.revokeSession": lambda: client.admin.revoke_session("SESSION"),
        "admin.storage": lambda: client.admin.storage(),
        "admin.settings": lambda: client.admin.settings(),
        "admin.updateSettings": lambda: client.admin.update_settings(
            ServerSettingsUpdate(allow_signup=True)
        ),
        "admin.shares": lambda: client.admin.shares(),
        "admin.revokeShare": lambda: client.admin.revoke_share("SHARE"),
        "pairing.create": lambda: client.pairing.create(),
        "pairing.status": lambda: client.pairing.status("TICKET"),
        "pairing.claim": lambda: client.pairing.claim(
            PairingClaimRequest(
                code="imog_pair_x",
                client_id="CLIENT",
                redirect_uri="imogen://oauth",
                code_challenge="x" * 43,
            )
        ),
        "oauth.discover": lambda: client.http.send(
            "GET", "/.well-known/oauth-authorization-server"
        ),
        "oauth.protectedResource": lambda: client.http.send(
            "GET", "/.well-known/oauth-protected-resource"
        ),
        "oauth.protectedResourceMcp": lambda: client.http.send(
            "GET", "/.well-known/oauth-protected-resource/mcp"
        ),
    }

    call = calls.get(key)
    if call is None:
        return False

    try:
        await call()
    except Exception:  # noqa: BLE001 — the stub's body is nonsense; the path is the point.
        pass
    return True


@pytest.fixture(scope="session")
def big_file(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """A file over the resumable threshold. Sparse, so it costs no disk."""
    path = tmp_path_factory.mktemp("uploads") / "holiday.mov"
    with path.open("wb") as handle:
        handle.truncate(RESUMABLE_THRESHOLD_BYTES)
    return path


@pytest.fixture(scope="session")
def small_file(tmp_path_factory: pytest.TempPathFactory) -> Path:
    path = tmp_path_factory.mktemp("uploads-small") / "harbour.jpg"
    path.write_bytes(b"not really a jpeg")
    return path


async def test_every_operation_in_the_contract_reaches_the_right_endpoint(
    serve: Any, endpoints: Any, big_file: Path, small_file: Path
) -> None:
    stub = serve(default_reply)
    missing: list[str] = []
    wrong: list[str] = []

    for resource, operations in endpoints["resources"].items():
        for endpoint in operations:
            key = f"{resource}.{endpoint['operation']}"
            want = (endpoint["method"], concrete(endpoint["path"]))
            before = stub.call_count

            async with ImogenClient(stub.base_url, max_retries=0) as client:
                if not await invoke(client, key, big_file, small_file):
                    missing.append(key)
                    continue

            made = [(c.method, c.path) for c in stub.calls[before:]]
            if want not in made:
                wrong.append(f"{key}: wanted {want}, saw {made}")

    assert missing == [], f"the contract names operations the client cannot perform: {missing}"
    assert wrong == []


MODEL_TYPES = {
    "asset": Asset,
    "assetMinimal": Asset,
    "assetLocationUnset": Asset,
    "assetLocationHalfPair": Asset,
    "assetLocationLatitudeOutOfRange": Asset,
    "assetLocationLongitudeOutOfRange": Asset,
    "assetLocationAtTheBounds": Asset,
    "assetPage": AssetPage,
    "album": Album,
    "albumAssetsResult": AlbumAssetsResult,
    "shareLink": ShareLink,
    "user": User,
    "authConfigOidcOff": AuthConfig,
    "authConfigOidcOn": AuthConfig,
    "person": Person,
    "personUnnamed": Person,
    "detectedFace": DetectedFace,
    "faceStatus": FaceStatus,
    "vaultStatusLocked": VaultStatus,
    "vaultStatusUnlocked": VaultStatus,
    "timeline": Timeline,
    "timelineBucket": TimelineBucket,
    "timelineTile": TimelineTile,
    "libraryStats": LibraryStats,
    "uploadSession": UploadSession,
    "adminUser": AdminUser,
    "queueHealth": QueueHealth,
    "storageReport": StorageReport,
    "serverSettings": ServerSettings,
    "tokenResponse": TokenResponse,
    "protectedResourceMetadata": ProtectedResourceMetadata,
    "protectedResourceMetadataMinimal": ProtectedResourceMetadata,
    "pairingTicket": PairingTicket,
    "pairingStatusUnclaimed": PairingStatus,
    "pairingStatusClaimed": PairingStatus,
    "pairingClaim": PairingClaim,
}


@pytest.mark.parametrize("name", sorted(MODEL_TYPES))
def test_models_decode_as_the_contract_says(models: Any, name: str) -> None:
    """Decode the fixture, re-encode it, and check the asserted fields survived.

    The round trip is the point: a field the model forgot would decode fine and then
    vanish on the way back out.
    """
    fixture = models[name]
    decoded = MODEL_TYPES[name].model_validate(fixture["payload"])
    encoded = decoded.model_dump(by_alias=True)

    for path, expected in fixture["assert"].items():
        assert at(encoded, path) == expected, f"{name}.{path}"


def test_errors_are_classified_as_the_contract_says(errors: Any) -> None:
    for case in errors["cases"]:
        body = case.get("bodyRaw") or json.dumps(case["body"])
        want = case["expect"]
        error = ImogenError.from_response(case["status"], "", body)

        assert error.status == want["status"], case["name"]
        assert error.code == want["code"], case["name"]
        assert error.is_retryable is want["retryable"], case["name"]
        assert error.is_auth_error is want["authError"], case["name"]
        assert error.details == want.get("details"), case["name"]

        if "message" in want:
            assert error.message == want["message"], case["name"]


def test_tuning_constants_match_the_contract(errors: Any) -> None:
    upload = errors["upload"]
    assert BULK_UPLOAD_CONCURRENCY == upload["bulkConcurrency"]
    assert RESUMABLE_THRESHOLD_BYTES == upload["resumableThresholdBytes"]
    assert UPLOAD_CHUNK_BYTES == upload["chunkBytes"]


async def test_retries_a_retryable_rejection_and_then_succeeds(serve: Any) -> None:
    def responder(_request: Any, index: int) -> Reply:
        if index < 2:
            return Reply(429, json.dumps({"error": {"code": "rate_limited", "message": "slow"}}))
        return Reply(body=json.dumps({"status": "ok", "version": "0.1.0"}))

    stub = serve(responder)
    async with ImogenClient(stub.base_url) as client:
        health = await client.health()

    assert health.status == "ok"
    assert stub.call_count == 3


async def test_does_not_retry_a_rejection_the_server_will_keep_rejecting(serve: Any) -> None:
    stub = serve(
        lambda _r, _i: Reply(404, json.dumps({"error": {"code": "not_found", "message": "no"}}))
    )

    async with ImogenClient(stub.base_url) as client:
        with pytest.raises(ImogenError) as caught:
            await client.assets.get("nope")

    assert caught.value.status == 404
    assert stub.call_count == 1


async def test_sends_the_bearer_token(serve: Any) -> None:
    stub = serve(default_reply)
    async with ImogenClient(stub.base_url, token="abc123") as client:
        await client.assets.list()

    assert stub.calls[0].headers["authorization"] == "Bearer abc123"


async def test_asks_for_a_fresh_token_once_when_the_server_rejects_the_old_one(
    serve: Any,
) -> None:
    def responder(request: Any, index: int) -> Reply:
        if index == 0:
            return Reply(401, json.dumps({"error": {"code": "unauthorized", "message": "x"}}))
        return default_reply(request, index)

    refreshed = False

    async def refresh() -> str:
        nonlocal refreshed
        refreshed = True
        return "fresh"

    stub = serve(responder)
    async with ImogenClient(stub.base_url, token="stale", on_unauthorized=refresh) as client:
        await client.assets.list()

    assert refreshed
    assert stub.call_count == 2


def test_builds_image_urls_without_a_request() -> None:
    client = ImogenClient("https://photos.example.test/")

    assert client.assets.url_for("A1") == "https://photos.example.test/api/v1/assets/A1/thumbnail"
    assert (
        client.assets.url_for("A1", "preview")
        == "https://photos.example.test/api/v1/assets/A1/preview"
    )
    assert (
        client.assets.download_url("A1") == "https://photos.example.test/api/v1/assets/A1/download"
    )


def test_asset_selection_dumps_except_as_the_reserved_word_it_is() -> None:
    """``except`` is a Python keyword, so the model stores it as ``except_`` with an
    explicit alias. That alias must win over the class's ``to_camel`` generator, which
    would otherwise emit ``"except_"``, not the wire name the server expects.
    """
    body = AssetSelection(except_=["b"]).model_dump(by_alias=True, exclude_none=True)

    assert body == {"except": ["b"]}
    assert "except_" not in body


ASSET_JSON = {
    "id": "a",
    "ownerId": "o",
    "type": "image",
    "status": "ready",
    "originalFilename": "a.jpg",
    "mimeType": "image/jpeg",
    "checksum": "c",
    "sizeBytes": 1,
    "width": None,
    "height": None,
    "duration": None,
    "capturedAt": "2024-01-01T00:00:00.000Z",
    "capturedAtIsExact": True,
    "capturedAtOriginal": None,
    "capturedAtOriginalIsExact": None,
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z",
    "deletedAt": None,
    "favorite": False,
    "archived": False,
    "description": None,
    "exif": None,
    "location": None,
    "placeholderColor": None,
    "livePhotoVideoId": None,
    "deviceAssetId": None,
}


async def test_refuses_an_id_list_with_exclusions_rather_than_sending_it(serve: Any) -> None:
    """``except`` narrows a filter.

    Beside an explicit id list it is a contradiction the server's id branch never reads,
    so honouring it would trash the very photographs the caller excluded. Refused before
    the request leaves rather than learned from a 400.
    """
    stub = serve(lambda _request, _index: Reply(body='{"count":0}'))

    async with ImogenClient(stub.base_url) as client:
        with pytest.raises(ValueError, match="except"):
            await client.assets.trash(AssetSelection(asset_ids=["a", "b"], except_=["a"]))

    assert stub.call_count == 0


async def test_the_vault_listing_says_how_big_the_vault_is(serve: Any) -> None:
    """The listing is capped, and the cap has to be visible.

    A return type carrying only the rows cannot say "there are four thousand of these and
    you have two hundred", which is the difference between a sample and the whole vault.
    """
    payload = json.dumps({"items": [], "nextCursor": None, "total": 4096})
    stub = serve(lambda _request, _index: Reply(body=payload))

    async with ImogenClient(stub.base_url) as client:
        page = await client.vault.list()

    assert page.items == []
    assert page.total == 4096


async def test_the_vault_spine_asks_for_one_period_and_carries_no_filter(serve: Any) -> None:
    """``period``, ``cursor`` and ``limit`` and nothing else: the vault spine takes no
    filter, so there is nothing a caller can send that widens what comes back.
    """
    payload = json.dumps({"items": [], "nextCursor": None, "total": 0})
    stub = serve(lambda _request, _index: Reply(body=payload))

    async with ImogenClient(stub.base_url) as client:
        await client.vault.timeline_bucket("2011-08")

    assert stub.calls[-1].path == "/api/v1/vault/timeline/bucket"
    assert stub.calls[-1].query == "period=2011-08"


async def test_iterates_every_page_exactly_once(serve: Any) -> None:
    def responder(_request: Any, index: int) -> Reply:
        if index == 0:
            return Reply(
                body=json.dumps(
                    {"items": [{**ASSET_JSON, "id": "a"}], "nextCursor": "c1", "total": 2}
                )
            )
        return Reply(
            body=json.dumps({"items": [{**ASSET_JSON, "id": "b"}], "nextCursor": None, "total": 2})
        )

    stub = serve(responder)
    async with ImogenClient(stub.base_url) as client:
        seen = [asset.id async for asset in client.assets.iterate(AssetQuery())]

    assert seen == ["a", "b"]


def _oauth_responder(holder: dict[str, str]) -> Any:
    """Answers discovery, then hands back a token for whatever is exchanged.

    The stub's port is only known once it is listening, so the endpoints it advertises
    are read out of ``holder`` at request time rather than captured when it is built.
    """

    def responder(request: Any, _index: int) -> Reply:
        base = holder["base_url"]
        if request.path == "/.well-known/oauth-authorization-server":
            return Reply(
                body=json.dumps(
                    {
                        "issuer": base,
                        "authorization_endpoint": f"{base}/oauth/authorize",
                        "token_endpoint": f"{base}/oauth/token",
                        "registration_endpoint": f"{base}/oauth/register",
                    }
                )
            )
        return Reply(
            body=json.dumps(
                {
                    "access_token": "at",
                    "token_type": "Bearer",
                    "expires_in": 3600,
                    "scope": "library:read",
                }
            )
        )

    return responder


async def test_the_resource_indicator_travels_on_both_legs_or_neither(
    serve: Any, endpoints: Any
) -> None:
    for case in endpoints["oauthResourceIndicator"]["cases"]:
        holder: dict[str, str] = {}
        stub = serve(_oauth_responder(holder))
        holder["base_url"] = stub.base_url

        oauth = OAuthClient(stub.base_url)
        try:
            pending = await oauth.begin_authorization(
                "CLIENT", "app://callback", ["library:read"], case["resource"]
            )
            # keep_blank_values, because `resource=` is not the same as no resource: the
            # server reads an empty one as invalid_target, and the default would discard
            # exactly the mistake the null case exists to catch.
            query = parse_qs(urlparse(pending.authorization_url).query, keep_blank_values=True)
            got = query.get("resource", [None])[0]
            assert got == case["expectAuthorizationParam"], case["name"]

            before = stub.call_count
            await oauth.complete_authorization(
                pending, f"app://callback?code=CODE&state={pending.state}"
            )
            body = parse_qs(stub.calls[before].body.decode(), keep_blank_values=True)
            assert body.get("resource", [None])[0] == case["expectTokenParam"], case["name"]
        finally:
            await oauth.aclose()


async def test_each_resource_identifier_is_read_from_its_document(
    serve: Any, endpoints: Any
) -> None:
    identifiers = endpoints["oauthResourceIndicator"]["identifiers"]

    def responder(request: Any, _index: int) -> Reply:
        # Answers with the identifier for whichever document was asked for, so a client
        # that read the wrong one is caught by the value and not just by the path.
        which = "mcp" if request.path.endswith("/mcp") else "root"
        return Reply(body=json.dumps({"resource": identifiers[which]}))

    stub = serve(responder)
    oauth = OAuthClient(stub.base_url)
    try:
        root = await oauth.discover_protected_resource()
        mcp = await oauth.discover_protected_resource("/mcp")
    finally:
        await oauth.aclose()

    assert root.resource == identifiers["root"]
    assert mcp.resource == identifiers["mcp"]
    assert [c.path for c in stub.calls] == [
        _endpoint_path(endpoints, "protectedResource"),
        _endpoint_path(endpoints, "protectedResourceMcp"),
    ]


def _endpoint_path(endpoints: Any, operation: str) -> str:
    for row in endpoints["resources"]["oauth"]:
        if row["operation"] == operation:
            return str(row["path"])
    raise AssertionError(f"the contract names no oauth.{operation}")


async def test_the_pairing_resource_indicator_travels_on_both_legs_or_neither(
    serve: Any, endpoints: Any
) -> None:
    """A paired device binds its token by naming the resource on the claim.

    The reason is not visible from the call site: the claim is where the code is minted,
    so it is the only leg that can record a resource, and the exchange has to echo what
    was recorded or the server answers invalid_target. Pinned here because pushing
    ``resource`` down into the shared ``_exchange`` helper would get one leg and not the
    other.
    """
    for case in endpoints["pairingResourceIndicator"]["cases"]:
        holder: dict[str, str] = {}

        def responder(request: Any, index: int, holder: dict[str, str] = holder) -> Reply:
            if request.path == "/api/v1/pairing/claim":
                return Reply(
                    body=json.dumps(
                        {"code": "ac_x", "redirectUri": "imogen://oauth", "scope": "library:read"}
                    )
                )
            if request.path == "/oauth/register":
                return Reply(body=json.dumps({"client_id": "CLIENT"}))
            return _oauth_responder(holder)(request, index)

        stub = serve(responder)
        holder["base_url"] = stub.base_url

        oauth = OAuthClient(stub.base_url)
        try:
            await oauth.pair("imog_pair_x", "A Device", "imogen://oauth", resource=case["resource"])
        finally:
            await oauth.aclose()

        claims = [c for c in stub.calls if c.path == "/api/v1/pairing/claim"]
        assert claims, f"{case['name']}: pairing did not reach the claim endpoint"
        # A null is not the same as an absent key: the request schema refuses one, so the
        # unbound case asserts the field is gone rather than merely falsy, which reading it
        # back with .get would not distinguish.
        claimed = json.loads(claims[0].body.decode())
        assert ("resource" in claimed) == (case["expectClaimField"] is not None), case["name"]
        assert claimed.get("resource") == case["expectClaimField"], case["name"]

        exchanges = [c for c in stub.calls if c.path == "/oauth/token"]
        assert exchanges, f"{case['name']}: pairing did not reach the token endpoint"
        for call in exchanges:
            body = parse_qs(call.body.decode(), keep_blank_values=True)
            assert body.get("resource", [None])[0] == case["expectTokenParam"], case["name"]
