"""The resources: assets, albums, people, the vault, auth, and administration.

Each is a thin, typed layer over :class:`~imogen_sdk.http.HttpClient`; none of them know
anything about HTTP beyond the path they call.
"""

from __future__ import annotations

import asyncio
import json
import mimetypes
import os
from collections.abc import AsyncIterator, Callable, Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .http import HttpClient
from .models import (
    BULK_UPLOAD_CONCURRENCY,
    RESUMABLE_THRESHOLD_BYTES,
    UPLOAD_CHUNK_BYTES,
    AdminClient,
    AdminSession,
    AdminShareLink,
    AdminUser,
    AdminUserUpdate,
    Album,
    AlbumAssetsResult,
    AlbumCreate,
    AlbumUpdate,
    AlbumWithAssets,
    Asset,
    AssetPage,
    AssetQuery,
    AssetSelection,
    AssetUpdate,
    AssetUploadMetadata,
    AssetUploadResult,
    AssetVariant,
    AuthConfig,
    DetectedFace,
    FaceStatus,
    Invite,
    InviteCreate,
    InviteCreated,
    LibraryStats,
    LoginRequest,
    PairingClaim,
    PairingClaimRequest,
    PairingStatus,
    PairingTicket,
    PasswordChangeRequest,
    Person,
    PersonUpdate,
    PersonWithPhotos,
    ProfileUpdate,
    QueueHealth,
    ServerSettings,
    ServerSettingsUpdate,
    ShareLink,
    ShareLinkCreate,
    SignupRequest,
    StorageReport,
    TilePage,
    Timeline,
    TimelineBucketQuery,
    TimelineQuery,
    UploadSession,
    UploadSessionCreate,
    User,
    VaultStatus,
    as_json,
)

__all__ = [
    "Admin",
    "Albums",
    "Assets",
    "Auth",
    "BulkUploadResult",
    "People",
    "UploadProgress",
    "Vault",
]


@dataclass(frozen=True)
class UploadProgress:
    #: Bytes transferred so far for this file.
    loaded: int
    total: int


@dataclass
class BulkUploadResult:
    """The outcome of one file in a bulk upload.

    Each file settles independently, so one bad photo in a folder of three thousand does
    not abandon the rest.
    """

    path: Path
    result: AssetUploadResult | None = None
    error: Exception | None = None


def _selection_body(selection: Iterable[str] | AssetSelection) -> dict[str, Any]:
    """The id list is the older, shorter way of saying the same thing."""
    if isinstance(selection, AssetSelection):
        return as_json(selection) or {}
    return as_json(AssetSelection(asset_ids=list(selection))) or {}


@dataclass
class _Resource:
    http: HttpClient = field(repr=False)


class Assets(_Resource):
    async def list(self, query: AssetQuery | None = None) -> AssetPage:
        params = (query or AssetQuery()).to_params()
        return AssetPage.model_validate(
            await self.http.request("GET", "/api/v1/assets", params=params)
        )

    async def iterate(self, query: AssetQuery | None = None) -> AsyncIterator[Asset]:
        """Walks every page, so a caller can ``async for`` the whole library."""
        current = (query or AssetQuery()).model_copy()
        while True:
            page = await self.list(current)
            for asset in page.items:
                yield asset
            if not page.next_cursor:
                return
            current = current.model_copy(update={"cursor": page.next_cursor})

    async def get(self, asset_id: str) -> Asset:
        return Asset.model_validate(await self.http.request("GET", f"/api/v1/assets/{asset_id}"))

    async def update(self, asset_id: str, patch: AssetUpdate) -> Asset:
        return Asset.model_validate(
            await self.http.request("PATCH", f"/api/v1/assets/{asset_id}", json=as_json(patch))
        )

    async def share_link(self, asset_id: str) -> ShareLink | None:
        """The live public link for one photo, or ``None``."""
        body = await self.http.request("GET", f"/api/v1/assets/{asset_id}/share")
        return ShareLink.model_validate(body) if body else None

    async def share(self, asset_id: str, input: ShareLinkCreate | None = None) -> ShareLink:
        """Publishes one photo. Replaces any existing link for it."""
        body = as_json(input or ShareLinkCreate())
        return ShareLink.model_validate(
            await self.http.request("POST", f"/api/v1/assets/{asset_id}/share", json=body)
        )

    async def unshare(self, asset_id: str) -> None:
        await self.http.request("DELETE", f"/api/v1/assets/{asset_id}/share")

    async def trash(self, selection: Iterable[str] | AssetSelection) -> int:
        body = await self.http.request(
            "POST", "/api/v1/assets/trash", json=_selection_body(selection)
        )
        return int(body["count"])

    async def restore(self, selection: Iterable[str] | AssetSelection) -> int:
        body = await self.http.request(
            "POST", "/api/v1/assets/restore", json=_selection_body(selection)
        )
        return int(body["count"])

    async def timeline(self, query: TimelineQuery | None = None) -> Timeline:
        params = (query or TimelineQuery()).to_params()
        return Timeline.model_validate(
            await self.http.request("GET", "/api/v1/assets/timeline", params=params)
        )

    async def timeline_bucket(self, query: TimelineBucketQuery) -> TilePage:
        """Every tile in one period, in one round trip, for a grid that lays itself out.

        ``limit`` defaults server-side, so a caller need only supply ``period``.
        """
        return TilePage.model_validate(
            await self.http.request(
                "GET", "/api/v1/assets/timeline/bucket", params=query.to_params()
            )
        )

    async def stats(self) -> LibraryStats:
        return LibraryStats.model_validate(await self.http.request("GET", "/api/v1/assets/stats"))

    def url_for(self, asset_id: str, variant: AssetVariant = "thumbnail") -> str:
        """A URL suitable for an image tag. Browsers send the session cookie themselves."""
        return self.http.url(f"/api/v1/assets/{asset_id}/{variant}")

    def download_url(self, asset_id: str) -> str:
        return self.http.url(f"/api/v1/assets/{asset_id}/download")

    async def bytes(self, asset_id: str, variant: AssetVariant = "preview") -> bytes:
        """Fetches image bytes with an Authorization header, for non-browser clients."""
        response = await self.http.send("GET", f"/api/v1/assets/{asset_id}/{variant}")
        return response.content

    async def upload(
        self,
        path: str | os.PathLike[str],
        metadata: AssetUploadMetadata | None = None,
        on_progress: Callable[[UploadProgress], None] | None = None,
    ) -> AssetUploadResult:
        """Uploads one file, choosing the protocol by size.

        Small files go in a single request; large ones use a resumable session so a
        dropped connection costs one chunk rather than the whole video.
        """
        path = Path(path)
        size = path.stat().st_size
        metadata = metadata or AssetUploadMetadata()

        if size >= RESUMABLE_THRESHOLD_BYTES:
            return await self._upload_resumable(path, size, metadata, on_progress)

        mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        # The contract lets a client name the file something other than what it is called
        # on disk — an importer restoring a name an export truncated, for instance.
        name = metadata.filename or path.name
        form: dict[str, Any] = {}
        if metadata.filename:
            form["filename"] = metadata.filename
        if metadata.device_asset_id:
            form["deviceAssetId"] = metadata.device_asset_id
        if metadata.captured_at:
            form["capturedAt"] = metadata.captured_at
        if metadata.favorite is not None:
            form["favorite"] = str(metadata.favorite).lower()
        if metadata.description:
            form["description"] = metadata.description
        if metadata.location:
            form["location"] = json.dumps(as_json(metadata.location))

        with path.open("rb") as handle:
            body = await self.http.request(
                "POST",
                "/api/v1/assets",
                files={"file": (name, handle, mime)},
                data=form or None,
            )

        if on_progress:
            on_progress(UploadProgress(loaded=size, total=size))
        return AssetUploadResult.model_validate(body)

    async def _upload_resumable(
        self,
        path: Path,
        size: int,
        metadata: AssetUploadMetadata,
        on_progress: Callable[[UploadProgress], None] | None,
    ) -> AssetUploadResult:
        create = UploadSessionCreate(
            filename=metadata.filename or path.name,
            size_bytes=size,
            mime_type=mimetypes.guess_type(path.name)[0] or "application/octet-stream",
            device_asset_id=metadata.device_asset_id,
            captured_at=metadata.captured_at,
            favorite=metadata.favorite,
            description=metadata.description,
            location=metadata.location,
        )
        session = UploadSession.model_validate(
            await self.http.request("POST", "/api/v1/uploads", json=as_json(create))
        )

        # The server already had these bytes; nothing to transfer.
        if session.existing:
            if on_progress:
                on_progress(UploadProgress(loaded=size, total=size))
            return session.existing

        offset = session.offset
        with path.open("rb") as handle:
            while offset < size:
                handle.seek(offset)
                chunk = handle.read(UPLOAD_CHUNK_BYTES)
                body = await self.http.request(
                    "PATCH",
                    f"/api/v1/uploads/{session.id}",
                    content=chunk,
                    headers={
                        "Upload-Offset": str(offset),
                        "Content-Type": "application/octet-stream",
                    },
                )
                offset = int(body["offset"])
                if on_progress:
                    on_progress(UploadProgress(loaded=offset, total=size))

        return AssetUploadResult.model_validate(
            await self.http.request("POST", f"/api/v1/uploads/{session.id}/complete")
        )

    async def upload_many(
        self,
        paths: Iterable[str | os.PathLike[str]],
        *,
        concurrency: int = BULK_UPLOAD_CONCURRENCY,
        metadata_for: Callable[[Path], AssetUploadMetadata] | None = None,
        on_file_complete: Callable[[BulkUploadResult, int, int], None] | None = None,
    ) -> list[BulkUploadResult]:
        """Uploads many files with bounded concurrency."""
        files = [Path(p) for p in paths]
        limit = asyncio.Semaphore(max(1, concurrency))
        results: list[BulkUploadResult] = [BulkUploadResult(path=p) for p in files]
        completed = 0

        async def one(index: int, path: Path) -> None:
            nonlocal completed
            async with limit:
                try:
                    metadata = metadata_for(path) if metadata_for else None
                    results[index].result = await self.upload(path, metadata)
                except Exception as error:  # noqa: BLE001 — each file settles alone.
                    results[index].error = error
            completed += 1
            if on_file_complete:
                on_file_complete(results[index], completed, len(files))

        await asyncio.gather(*(one(i, p) for i, p in enumerate(files)))
        return results


class Albums(_Resource):
    async def list(self) -> list[Album]:
        body = await self.http.request("GET", "/api/v1/albums")
        return [Album.model_validate(item) for item in body["items"]]

    async def get(self, album_id: str) -> AlbumWithAssets:
        return AlbumWithAssets.model_validate(
            await self.http.request("GET", f"/api/v1/albums/{album_id}")
        )

    async def create(self, input: AlbumCreate) -> Album:
        return Album.model_validate(
            await self.http.request("POST", "/api/v1/albums", json=as_json(input))
        )

    async def update(self, album_id: str, patch: AlbumUpdate) -> Album:
        return Album.model_validate(
            await self.http.request("PATCH", f"/api/v1/albums/{album_id}", json=as_json(patch))
        )

    async def remove(self, album_id: str) -> None:
        await self.http.request("DELETE", f"/api/v1/albums/{album_id}")

    async def add_assets(
        self, album_id: str, selection: Iterable[str] | AssetSelection
    ) -> AlbumAssetsResult:
        return AlbumAssetsResult.model_validate(
            await self.http.request(
                "POST",
                f"/api/v1/albums/{album_id}/assets",
                json=_selection_body(selection),
            )
        )

    async def remove_assets(self, album_id: str, selection: Iterable[str] | AssetSelection) -> int:
        body = await self.http.request(
            "DELETE",
            f"/api/v1/albums/{album_id}/assets",
            json=_selection_body(selection),
        )
        return int(body["removed"])

    async def share_link(self, album_id: str) -> ShareLink | None:
        """The live public link for this album, or ``None``."""
        body = await self.http.request("GET", f"/api/v1/albums/{album_id}/share")
        return ShareLink.model_validate(body) if body else None

    async def share(self, album_id: str, input: ShareLinkCreate | None = None) -> ShareLink:
        body = as_json(input or ShareLinkCreate())
        return ShareLink.model_validate(
            await self.http.request("POST", f"/api/v1/albums/{album_id}/share", json=body)
        )

    async def unshare(self, album_id: str) -> None:
        await self.http.request("DELETE", f"/api/v1/albums/{album_id}/share")


class People(_Resource):
    """People, as grouped by face recognition.

    The feature is off until a server administrator enables it, so every method here can
    legitimately return nothing — check :meth:`status` before showing a person interface.
    """

    async def status(self) -> FaceStatus:
        return FaceStatus.model_validate(await self.http.request("GET", "/api/v1/people/status"))

    async def set_enabled(self, enabled: bool) -> None:
        """Administrator only. Enabling downloads the models and scans the library."""
        await self.http.request("POST", "/api/v1/people/enable", json={"enabled": enabled})

    async def list(self, include_hidden: bool = False) -> list[Person]:
        body = await self.http.request(
            "GET",
            "/api/v1/people",
            params={"includeHidden": str(include_hidden).lower()},
        )
        return [Person.model_validate(item) for item in body["items"]]

    async def get(self, person_id: str) -> PersonWithPhotos:
        return PersonWithPhotos.model_validate(
            await self.http.request("GET", f"/api/v1/people/{person_id}")
        )

    async def update(self, person_id: str, patch: PersonUpdate) -> None:
        await self.http.request("PATCH", f"/api/v1/people/{person_id}", json=as_json(patch))

    async def merge(self, keep_id: str, merge_ids: Iterable[str]) -> int:
        """Folds several clusters into one. Use when grouping split a person in two."""
        body = await self.http.request(
            "POST",
            "/api/v1/people/merge",
            json={"keepId": keep_id, "mergeIds": list(merge_ids)},
        )
        return int(body["moved"])

    async def reassign(self, face_ids: Iterable[str], person_id: str | None) -> None:
        """Moves specific faces to another person, or detaches them with ``None``."""
        await self.http.request(
            "POST",
            "/api/v1/people/reassign",
            json={"faceIds": list(face_ids), "personId": person_id},
        )

    async def faces_in(self, asset_id: str) -> list[DetectedFace]:
        body = await self.http.request("GET", f"/api/v1/people/faces/{asset_id}")
        return [DetectedFace.model_validate(item) for item in body["items"]]

    def thumbnail_url(self, face_id: str) -> str:
        """A person's thumbnail, cropped from the photo their best face was found in."""
        return self.http.url(f"/api/v1/people/thumbnail/{face_id}")


class Pairing(_Resource):
    """Handing a device an account without making anybody type a hostname.

    The two halves of this run in different places and are meant to. A browser that is
    already signed in calls :meth:`create` and renders the ticket as a QR code; a phone
    that knows nothing at all reads the code out of it and calls :meth:`claim`. Between
    them the device learns where the server is and gets an authorization code for it, in
    one gesture.

    What :meth:`claim` returns is an ordinary OAuth code bound to a PKCE challenge the
    device generated, so a photographed QR code is not on its own enough to reach a
    library.
    """

    async def create(self) -> PairingTicket:
        """Makes a ticket. Needs a browser session, not a bearer token.

        A paired device that could mint tickets would be a device that could pair others.
        The code is legible only in this response.
        """
        return PairingTicket.model_validate(await self.http.request("POST", "/api/v1/pairing"))

    async def status(self, ticket_id: str) -> PairingStatus:
        """Whether a device has taken the ticket yet, and what it called itself."""
        return PairingStatus.model_validate(
            await self.http.request("GET", f"/api/v1/pairing/{ticket_id}")
        )

    async def claim(self, request: PairingClaimRequest) -> PairingClaim:
        """Spends a ticket. Called by the device, not by the browser that made it."""
        return PairingClaim.model_validate(
            await self.http.request(
                "POST",
                "/api/v1/pairing/claim",
                json=request.model_dump(by_alias=True, exclude_none=True),
            )
        )


class Vault(_Resource):
    """Photographs kept out of the ordinary library entirely.

    The vault is absent from the timeline, search, albums, shared links, and anything an
    AI assistant can reach. It opens only for a signed-in browser session that re-enters
    the vault passphrase. A bearer token cannot open it, so these methods are unavailable
    to API clients by design rather than by omission.
    """

    async def status(self) -> VaultStatus:
        return VaultStatus.model_validate(await self.http.request("GET", "/api/v1/vault/status"))

    async def set_passphrase(self, passphrase: str) -> None:
        """Sets the passphrase. Changing an existing one requires the vault to be open."""
        await self.http.request("POST", "/api/v1/vault/setup", json={"passphrase": passphrase})

    async def unlock(self, passphrase: str) -> None:
        await self.http.request("POST", "/api/v1/vault/unlock", json={"passphrase": passphrase})

    async def lock(self) -> None:
        await self.http.request("POST", "/api/v1/vault/lock")

    async def list(self, limit: int = 200) -> AssetPage:
        """A sample of the vault, newest first, and how big the vault actually is.

        The ordinary :class:`AssetPage` rather than a bare list, because the server
        answers ``pageOf(Asset)`` here as it does everywhere else. This endpoint is
        capped, and the cap used to be invisible: two hundred photographs with no cursor
        and no count reads as "that is all of them", which for a larger vault was simply
        untrue. ``next_cursor`` is always ``None`` -- this endpoint does not page -- and
        ``total`` is what makes the cap visible instead of silent. A caller that wants the
        whole vault wants :meth:`timeline` and :meth:`timeline_bucket`.
        """
        return AssetPage.model_validate(
            await self.http.request("GET", "/api/v1/vault/assets", params={"limit": limit})
        )

    async def timeline(self, covers: bool | None = None) -> Timeline:
        """One row per day in the vault, for sizing the grid before any tile arrives.

        The vault has a spine of its own because it cannot have a filter:
        :class:`AssetFilter` deliberately cannot express "inside the vault", so the
        scoping is done server-side behind the unlock rather than by anything the caller
        sends. ``covers`` is the only parameter the route reads, so it is the only one
        this takes.
        """
        params = {} if covers is None else {"covers": str(covers).lower()}
        return Timeline.model_validate(
            await self.http.request("GET", "/api/v1/vault/timeline", params=params)
        )

    async def timeline_bucket(
        self, period: str, cursor: str | None = None, limit: int | None = None
    ) -> TilePage:
        """Every tile in one period of the vault, in one round trip.

        ``period``, ``cursor`` and ``limit`` and nothing else: a filter this accepted
        would be a filter that could widen what the vault hands back. ``limit`` left as
        ``None`` takes the server's default rather than a number this client shipped with.
        """
        params: dict[str, Any] = {"period": period}
        if cursor is not None:
            params["cursor"] = cursor
        if limit is not None:
            params["limit"] = limit
        return TilePage.model_validate(
            await self.http.request("GET", "/api/v1/vault/timeline/bucket", params=params)
        )

    async def move_in(self, selection: Iterable[str] | AssetSelection) -> int:
        body = await self.http.request(
            "POST", "/api/v1/vault/assets", json=_selection_body(selection)
        )
        return int(body["moved"])

    async def move_out(self, selection: Iterable[str] | AssetSelection) -> int:
        body = await self.http.request(
            "DELETE", "/api/v1/vault/assets", json=_selection_body(selection)
        )
        return int(body["moved"])


class Auth(_Resource):
    async def config(self) -> AuthConfig:
        """What the sign-in screen needs before anyone has authenticated."""
        return AuthConfig.model_validate(await self.http.request("GET", "/api/v1/auth/config"))

    async def login(self, request: LoginRequest) -> User:
        return User.model_validate(
            await self.http.request("POST", "/api/v1/auth/login", json=as_json(request))
        )

    async def signup(self, request: SignupRequest) -> User:
        return User.model_validate(
            await self.http.request("POST", "/api/v1/auth/signup", json=as_json(request))
        )

    async def logout(self) -> None:
        await self.http.request("POST", "/api/v1/auth/logout")

    async def logout_everywhere(self) -> None:
        await self.http.request("POST", "/api/v1/auth/logout-everywhere")

    async def me(self) -> User:
        return User.model_validate(await self.http.request("GET", "/api/v1/auth/me"))

    async def update_profile(self, patch: ProfileUpdate) -> User:
        """Edits your own name or email. Not available to provider-managed accounts."""
        return User.model_validate(
            await self.http.request("PATCH", "/api/v1/auth/me", json=as_json(patch))
        )

    async def change_password(self, request: PasswordChangeRequest) -> None:
        await self.http.request("POST", "/api/v1/auth/password", json=as_json(request))

    def oidc_start_url(self, return_to: str = "/") -> str:
        """Where to send a browser to begin single sign-on."""
        return self.http.url("/api/v1/auth/oidc/start", {"returnTo": return_to})


class Admin(_Resource):
    """Server administration.

    Every endpoint here answers 404 rather than 403 to anyone who is not an administrator,
    so a refusal is indistinguishable from a route that does not exist. Treat a not-found
    from these methods as "you may not", not as a bug.
    """

    async def users(self) -> list[AdminUser]:
        """Every account on the server, oldest first. Deleted accounts are not included."""
        body = await self.http.request("GET", "/api/v1/admin/users")
        return [AdminUser.model_validate(item) for item in body["items"]]

    async def update_user(self, user_id: str, patch: AdminUserUpdate) -> AdminUser:
        """Changes a role, or suspends and restores access."""
        return AdminUser.model_validate(
            await self.http.request("PATCH", f"/api/v1/admin/users/{user_id}", json=as_json(patch))
        )

    async def delete_user(self, user_id: str) -> None:
        """Removes the account. Its photographs go to the trash, not the incinerator."""
        await self.http.request("DELETE", f"/api/v1/admin/users/{user_id}")

    async def reset_password(self, user_id: str, password: str) -> None:
        """Sets someone's password and ends every session they had."""
        await self.http.request(
            "POST",
            f"/api/v1/admin/users/{user_id}/password",
            json={"password": password},
        )

    async def invites(self) -> list[Invite]:
        body = await self.http.request("GET", "/api/v1/admin/invites")
        return [Invite.model_validate(item) for item in body["items"]]

    async def create_invite(self, input: InviteCreate | None = None) -> InviteCreated:
        """The returned token is the only legible copy. It is stored hashed."""
        return InviteCreated.model_validate(
            await self.http.request(
                "POST", "/api/v1/admin/invites", json=as_json(input or InviteCreate())
            )
        )

    async def revoke_invite(self, invite_id: str) -> None:
        await self.http.request("DELETE", f"/api/v1/admin/invites/{invite_id}")

    async def queue(self) -> QueueHealth:
        """Queue depth, what is running, and what the pipeline gave up on."""
        return QueueHealth.model_validate(await self.http.request("GET", "/api/v1/admin/queue"))

    async def retry_job(self, job_id: str) -> None:
        """Puts one failed job back in the queue with its attempts cleared."""
        await self.http.request("POST", f"/api/v1/admin/queue/{job_id}/retry")

    async def retry_all_jobs(self) -> int:
        body = await self.http.request("POST", "/api/v1/admin/queue/retry")
        return int(body["count"])

    async def discard_job(self, job_id: str) -> None:
        await self.http.request("DELETE", f"/api/v1/admin/queue/{job_id}")

    async def clients(self) -> list[AdminClient]:
        """Applications allowed to act on someone's behalf."""
        body = await self.http.request("GET", "/api/v1/admin/clients")
        return [AdminClient.model_validate(item) for item in body["items"]]

    async def revoke_client(self, client_id: str) -> None:
        """Removes an application. Its tokens go with it."""
        await self.http.request("DELETE", f"/api/v1/admin/clients/{client_id}")

    async def sessions(self) -> list[AdminSession]:
        body = await self.http.request("GET", "/api/v1/admin/sessions")
        return [AdminSession.model_validate(item) for item in body["items"]]

    async def revoke_session(self, session_id: str) -> None:
        """Ends a session. Refuses the one making the request."""
        await self.http.request("DELETE", f"/api/v1/admin/sessions/{session_id}")

    async def storage(self) -> StorageReport:
        """Where the bytes are, per variant and per account."""
        return StorageReport.model_validate(await self.http.request("GET", "/api/v1/admin/storage"))

    async def settings(self) -> ServerSettings:
        return ServerSettings.model_validate(
            await self.http.request("GET", "/api/v1/admin/settings")
        )

    async def update_settings(self, patch: ServerSettingsUpdate) -> ServerSettings:
        """Takes effect at once. The stored value wins over the environment."""
        return ServerSettings.model_validate(
            await self.http.request("PATCH", "/api/v1/admin/settings", json=as_json(patch))
        )

    async def shares(self) -> list[AdminShareLink]:
        """Every link that is public right now, across all accounts."""
        body = await self.http.request("GET", "/api/v1/admin/shares")
        return [AdminShareLink.model_validate(item) for item in body["items"]]

    async def revoke_share(self, share_id: str) -> None:
        """Closes a link, whoever made it."""
        await self.http.request("DELETE", f"/api/v1/admin/shares/{share_id}")
