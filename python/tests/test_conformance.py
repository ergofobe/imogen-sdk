"""The Python half of the shared conformance suite.

Everything asserted here comes out of ``../../conformance``, so this file and its
TypeScript, Rust, Swift and Kotlin counterparts are checking the same contract rather
than five independent opinions about it.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

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
    AssetUpdate,
    AuthConfig,
    DetectedFace,
    FaceStatus,
    ImogenClient,
    ImogenError,
    LibraryStats,
    LoginRequest,
    PairingClaim,
    PairingClaimRequest,
    PairingStatus,
    PairingTicket,
    PasswordChangeRequest,
    Person,
    PersonUpdate,
    ProfileUpdate,
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
