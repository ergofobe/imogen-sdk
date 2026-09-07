"""The API contract, as pydantic models.

Timestamps stay ``str`` rather than becoming ``datetime``. The contract specifies
ISO-8601 and nothing else, and a client that reformats on the way through is a client
that eventually sends back something the server did not give it.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

__all__ = [
    "AdminClient",
    "AdminJob",
    "AdminSession",
    "AdminShareLink",
    "AdminUser",
    "AdminUserUpdate",
    "Album",
    "AlbumAssetsResult",
    "AlbumCreate",
    "AlbumUpdate",
    "AlbumWithAssets",
    "ApiError",
    "ApiErrorBody",
    "Asset",
    "AssetFilter",
    "AssetPage",
    "AssetQuery",
    "AssetSelection",
    "AssetSort",
    "AssetStatus",
    "AssetType",
    "AssetUpdate",
    "AssetUploadMetadata",
    "AssetUploadResult",
    "AssetVariant",
    "AuthConfig",
    "AuthorizationServerMetadata",
    "BULK_UPLOAD_CONCURRENCY",
    "ClientRegistrationResponse",
    "DEFAULT_SCOPES",
    "DetectedFace",
    "ERROR_CODES",
    "ExifData",
    "FaceModel",
    "FaceStatus",
    "GeoPoint",
    "Health",
    "Invite",
    "InviteCreate",
    "InviteCreated",
    "LibraryStats",
    "LoginRequest",
    "OAuthScope",
    "OidcConfig",
    "PAIRING_URI_SCHEME",
    "PairingClaim",
    "PairingClaimRequest",
    "PairingStatus",
    "PairingTicket",
    "PasswordChangeRequest",
    "Person",
    "PersonUpdate",
    "PersonWithPhotos",
    "ProfileUpdate",
    "ProtectedResourceMetadata",
    "QueueHealth",
    "RESUMABLE_THRESHOLD_BYTES",
    "SCOPE_DESCRIPTIONS",
    "ServerSettings",
    "ServerSettingsUpdate",
    "ShareLink",
    "ShareLinkCreate",
    "SignupRequest",
    "SortOrder",
    "StoragePerUser",
    "StorageReport",
    "TilePage",
    "Timeline",
    "TimelineBucket",
    "TimelineBucketQuery",
    "TimelineQuery",
    "TimelineTile",
    "TokenResponse",
    "UPLOAD_CHUNK_BYTES",
    "UploadSession",
    "UploadSessionCreate",
    "User",
    "UserRole",
    "VaultStatus",
    "as_json",
]


class Contract(BaseModel):
    """Base for everything on the wire: camelCase outside, snake_case inside."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="ignore",
    )


# --- assets ---

AssetType = Literal["image", "video"]
AssetVariant = Literal["original", "preview", "thumbnail"]
#: Processing lifecycle. Clients show a placeholder until an asset reaches ``ready``.
AssetStatus = Literal["pending", "processing", "ready", "failed"]


class ExifData(Contract):
    make: str | None = None
    model: str | None = None
    lens: str | None = None
    f_number: float | None = None
    exposure_time: float | None = None
    iso: int | None = None
    focal_length: float | None = None
    orientation: int | None = None


class GeoPoint(Contract):
    latitude: float
    longitude: float
    altitude: float | None = None
    #: Reverse-geocoded place name, when available.
    place: str | None = None


class Asset(Contract):
    id: str
    owner_id: str
    type: AssetType
    status: AssetStatus
    original_filename: str
    mime_type: str
    #: SHA-256 of the original bytes. Stable identity across re-uploads.
    checksum: str
    size_bytes: int
    width: int | None = None
    height: int | None = None
    #: Seconds. ``None`` for images.
    duration: float | None = None
    captured_at: str
    #: True when ``captured_at`` came from EXIF rather than a fallback.
    captured_at_is_exact: bool
    #: The capture date before the owner corrected it, or ``None`` if never corrected.
    captured_at_original: str | None = None
    captured_at_original_is_exact: bool | None = None
    created_at: str
    updated_at: str
    deleted_at: str | None = None
    favorite: bool
    archived: bool
    description: str | None = None
    exif: ExifData | None = None
    location: GeoPoint | None = None
    #: Dominant colour of the thumbnail, for grid placeholders.
    placeholder_color: str | None = None
    #: The paired video of an iPhone Live Photo, if this asset has one.
    live_photo_video_id: str | None = None
    #: Client-supplied stable id, used by mobile apps to avoid re-uploading.
    device_asset_id: str | None = None


class AssetUpdate(Contract):
    favorite: bool | None = None
    archived: bool | None = None
    description: str | None = None
    captured_at: str | None = None
    #: Puts back the date the file was imported with, discarding any correction.
    reset_captured_at: bool | None = None
    location: GeoPoint | None = None


class AssetUploadMetadata(Contract):
    """Metadata a client may attach at upload time. All fields are hints; EXIF wins where
    it has an opinion.

    ``description`` and ``location`` are here so an importer carrying metadata from
    somewhere else — a Google Takeout sidecar, say — can land a photograph complete in one
    request rather than an upload followed by a patch for every file it moves.
    """

    device_asset_id: str | None = None
    captured_at: str | None = None
    favorite: bool | None = None
    filename: str | None = None
    description: str | None = None
    location: GeoPoint | None = None


class AssetUploadResult(Contract):
    asset: Asset
    #: True when the checksum already existed and no new file was stored.
    duplicate: bool


class AssetPage(Contract):
    items: list[Asset]
    next_cursor: str | None = None
    #: Total matching rows, when cheap to compute. ``None`` means "not counted".
    total: int | None = None


# --- queries ---

AssetSort = Literal["capturedAt", "createdAt", "filename"]
SortOrder = Literal["asc", "desc"]


class AssetFilter(Contract):
    """The filters every listing shares: the timeline, the bucket endpoint, and a
    query-based selection cannot drift from what ``GET /assets`` accepts.
    """

    q: str | None = None
    type: AssetType | None = None
    album_id: str | None = None
    #: Photographs a given person appears in.
    person_id: str | None = None
    favorite: bool | None = None
    archived: bool | None = None
    #: When true, returns only trashed assets. Trashed assets are hidden otherwise.
    trashed: bool | None = None
    taken_after: str | None = None
    taken_before: str | None = None
    #: Bounding box filter: ``minLat,minLon,maxLat,maxLon``.
    bbox: str | None = None

    def to_params(self) -> dict[str, str]:
        """Flattened to the query string the API expects."""
        params: dict[str, str] = {}
        for key, value in self.model_dump(by_alias=True, exclude_none=True).items():
            params[key] = str(value).lower() if isinstance(value, bool) else str(value)
        return params


class AssetQuery(Contract):
    """Cursor pagination.

    Offsets are wrong for a timeline that grows while you scroll: an upload shifts every
    later page by one. The cursor encodes the last seen ``(capturedAt, id)`` pair.
    """

    cursor: str | None = None
    limit: int | None = None
    #: Free-text over filename, description, camera, and place.
    q: str | None = None
    type: AssetType | None = None
    album_id: str | None = None
    #: Photographs a given person appears in.
    person_id: str | None = None
    favorite: bool | None = None
    archived: bool | None = None
    #: When true, returns only trashed assets. Trashed assets are hidden otherwise.
    trashed: bool | None = None
    taken_after: str | None = None
    taken_before: str | None = None
    #: Bounding box filter: ``minLat,minLon,maxLat,maxLon``.
    bbox: str | None = None
    sort: AssetSort | None = None
    order: SortOrder | None = None

    def to_params(self) -> dict[str, str]:
        """Flattened to the query string the API expects.

        Absent fields stay absent, so the server applies its own defaults rather than
        ours.
        """
        params: dict[str, str] = {}
        for key, value in self.model_dump(by_alias=True, exclude_none=True).items():
            params[key] = str(value).lower() if isinstance(value, bool) else str(value)
        return params


class TimelineBucket(Contract):
    """A day bucket in the timeline, used to size the scroller before assets load."""

    date: str
    count: int
    #: The newest ready asset in the bucket, for an overview's period card. Null unless
    #: ``covers`` was asked for.
    cover_asset_id: str | None = None


class Timeline(Contract):
    buckets: list[TimelineBucket]


class TimelineQuery(AssetFilter):
    covers: bool | None = None


class TimelineTile(Contract):
    """Everything a grid tile draws, and nothing else."""

    id: str
    captured_at: str
    width: int | None = None
    height: int | None = None
    type: AssetType
    status: AssetStatus
    favorite: bool
    duration: float | None = None
    placeholder_color: str | None = None
    live_photo_video_id: str | None = None


class TilePage(Contract):
    items: list[TimelineTile]
    next_cursor: str | None = None
    #: Total matching rows, when cheap to compute. ``None`` means "not counted".
    total: int | None = None


class TimelineBucketQuery(AssetFilter):
    """``YYYY-MM`` or ``YYYY-MM-DD``. A bare year is refused server-side: it would be a
    whole-library scan asked for by accident.
    """

    period: str
    cursor: str | None = None
    limit: int | None = None


class AssetSelection(Contract):
    """What a bulk mutation acts on: an explicit id list, or the filter minus whatever was
    unticked.
    """

    asset_ids: list[str] | None = None
    query: AssetFilter | None = None
    #: Capped deliberately: past this, an interface should not be offering a selection.
    except_: list[str] | None = Field(default=None, alias="except")

    def problem(self) -> str | None:
        """Why this selection cannot be sent, or ``None`` when it can.

        Every method that sends one checks this first, so a client learns of a
        contradictory selection here rather than from a 400 after the request has gone.
        """
        if (self.asset_ids is None) == (self.query is None):
            return "Provide exactly one of assetIds or query"
        # ``except`` narrows a filter; beside an explicit list it is a contradiction, and
        # the server's id branch never reads it -- so honouring the request would act on
        # the very photographs the caller excluded. Rejecting matches the cap rule: a
        # destructive action silently narrowed is undetectable until somebody goes looking
        # for a picture that is no longer there.
        if self.asset_ids is not None and self.except_ is not None:
            return (
                "except narrows a query selection only; with assetIds, leave the "
                "unwanted ids out of the list"
            )
        return None


class LibraryStats(Contract):
    asset_count: int
    image_count: int
    video_count: int
    album_count: int
    favorite_count: int
    trashed_count: int
    storage_bytes: int
    earliest_captured_at: str | None = None
    latest_captured_at: str | None = None


# --- albums ---


class Album(Contract):
    id: str
    owner_id: str
    name: str
    description: str | None = None
    cover_asset_id: str | None = None
    asset_count: int
    created_at: str
    updated_at: str
    #: Set when the album has an active public share link.
    share_slug: str | None = None


class AlbumWithAssets(Album):
    assets: list[Asset] = Field(default_factory=list)


class AlbumCreate(Contract):
    name: str
    description: str | None = None
    asset_ids: list[str] | None = None


class AlbumUpdate(Contract):
    name: str | None = None
    description: str | None = None
    cover_asset_id: str | None = None


class AlbumAssetsResult(Contract):
    """Adding assets is idempotent, so the result reports what actually changed."""

    added: int
    skipped: int
    asset_count: int


# --- sharing ---


class ShareLink(Contract):
    slug: str
    url: str
    #: Exactly one of these is set: a link points at an album or at one photograph.
    album_id: str | None = None
    asset_id: str | None = None
    expires_at: str | None = None
    allow_download: bool
    created_at: str


class ShareLinkCreate(Contract):
    expires_at: str | None = None
    allow_download: bool = True
    password: str | None = None


# --- uploads ---


class UploadSessionCreate(Contract):
    filename: str
    size_bytes: int
    mime_type: str
    #: Optional SHA-256 known in advance; lets the server short-circuit a duplicate.
    checksum: str | None = None
    device_asset_id: str | None = None
    captured_at: str | None = None
    favorite: bool | None = None
    description: str | None = None
    location: GeoPoint | None = None


class UploadSession(Contract):
    id: str
    #: Bytes already stored. A resuming client PATCHes from this offset.
    offset: int
    size_bytes: int
    expires_at: str
    #: Set when the server recognised the checksum and no upload is needed.
    existing: AssetUploadResult | None = None


BULK_UPLOAD_CONCURRENCY = 6
#: Files at or above this size use the resumable protocol.
RESUMABLE_THRESHOLD_BYTES = 64 * 1024 * 1024
UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024


# --- auth ---

UserRole = Literal["admin", "user"]


class User(Contract):
    id: str
    email: str
    name: str
    role: UserRole
    avatar_url: str | None = None
    #: Present when the account is linked to an external identity provider.
    oidc_subject: str | None = None
    #: False for OIDC-only accounts, which have no local password.
    has_password: bool
    created_at: str
    quota_bytes: int | None = None
    used_bytes: int


class LoginRequest(Contract):
    email: str
    password: str


class SignupRequest(Contract):
    email: str
    password: str
    name: str
    #: An invitation token. Admits one account to a server with sign-up closed.
    invite: str | None = None


class PasswordChangeRequest(Contract):
    current_password: str | None = None
    new_password: str


class ProfileUpdate(Contract):
    """Editing your own profile.

    Accounts linked to an identity provider cannot change these here — the provider owns
    them, and imogen re-reads them at every sign-in.
    """

    name: str | None = None
    email: str | None = None
    #: Required to change the email address on an account that has a password.
    current_password: str | None = None


class OidcConfig(Contract):
    enabled: bool
    label: str | None = None
    start_url: str | None = None
    #: Where to send someone to edit the details the provider owns, if known.
    account_url: str | None = None


class AuthConfig(Contract):
    """What the login page needs in order to render before anyone has authenticated."""

    allow_signup: bool
    #: True until the first account exists; the first signup becomes the admin.
    needs_setup: bool
    oidc: OidcConfig


class Health(Contract):
    status: str
    version: str


# --- OAuth 2.1 ---

OAuthScope = Literal["library:read", "library:write", "albums:read", "albums:write", "profile"]

DEFAULT_SCOPES: tuple[str, ...] = (
    "library:read",
    "library:write",
    "albums:read",
    "albums:write",
)

SCOPE_DESCRIPTIONS: dict[str, str] = {
    "library:read": "View your photos and videos",
    "library:write": "Upload, edit, and delete photos and videos",
    "albums:read": "View your albums",
    "albums:write": "Create and modify your albums",
    "profile": "Read your name and email address",
}


class Wire(BaseModel):
    """For the OAuth payloads, which are snake_case on the wire already."""

    model_config = ConfigDict(extra="ignore")


class ClientRegistrationResponse(Wire):
    client_id: str
    client_secret: str | None = None
    client_id_issued_at: int = 0
    client_secret_expires_at: int = 0
    client_name: str | None = None
    redirect_uris: list[str] = Field(default_factory=list)
    grant_types: list[str] = Field(default_factory=list)
    response_types: list[str] = Field(default_factory=list)
    token_endpoint_auth_method: str = ""
    scope: str = ""


class TokenResponse(Wire):
    access_token: str
    token_type: str
    expires_in: int
    refresh_token: str | None = None
    scope: str = ""


class AuthorizationServerMetadata(Wire):
    issuer: str
    authorization_endpoint: str
    token_endpoint: str
    registration_endpoint: str = ""
    revocation_endpoint: str = ""
    scopes_supported: list[str] = Field(default_factory=list)
    code_challenge_methods_supported: list[str] = Field(default_factory=list)


class ProtectedResourceMetadata(Wire):
    """RFC 9728 protected resource metadata.

    ``resource`` is the identifier to echo back as the RFC 8707 ``resource`` parameter.
    The server compares it against the single spelling it publishes here, so a client
    that rebuilds the string from its own base URL can produce a near-miss — a stray
    port, a trailing slash — that comes back as ``invalid_target``.
    """

    resource: str
    authorization_servers: list[str] = Field(default_factory=list)
    scopes_supported: list[str] = Field(default_factory=list)
    bearer_methods_supported: list[str] = Field(default_factory=list)
    resource_documentation: str = ""


# --- pairing ---


class PairingTicket(Contract):
    """A ticket a signed-in browser makes so a device is never asked for a hostname."""

    id: str
    #: The one-time secret. Legible only in the response that created the ticket.
    code: str
    server_url: str
    #: Server and secret in one string — this is what goes into the QR code.
    uri: str
    expires_at: str


class PairingStatus(Contract):
    id: str
    expires_at: str
    #: None until a device takes the ticket.
    claimed_at: str | None = None
    device_name: str | None = None


class PairingClaimRequest(Contract):
    code: str
    #: The client the device registered for itself through RFC 7591.
    client_id: str
    redirect_uri: str
    code_challenge: str
    code_challenge_method: str = "S256"
    #: Space-separated. None to take everything a paired device is allowed.
    scope: str | None = None
    #: Shown to whoever made the ticket, and in the connected-applications list.
    device_name: str | None = None


class PairingClaim(Contract):
    """An ordinary authorization code.

    Exchange it at the token endpoint with the verifier that produced the challenge; on
    its own it grants nothing.
    """

    code: str
    redirect_uri: str
    scope: str


#: The scheme an application registers so ``imogen://pair?…`` opens it.
PAIRING_URI_SCHEME = "imogen"


# --- people ---


class Person(Contract):
    """One cluster of faces the library believes belong to the same person."""

    id: str
    #: ``None`` until somebody names them. An unnamed person is still browsable.
    name: str | None = None
    #: The face used as their thumbnail.
    cover_face_id: str | None = None
    photo_count: int
    hidden: bool


class PersonWithPhotos(Person):
    photos: list[Asset] = Field(default_factory=list)


class DetectedFace(Contract):
    """Where a face sits in its photo, in the original image's pixels."""

    id: str
    asset_id: str
    person_id: str | None = None
    #: ``None`` when this person has not been named yet.
    person_name: str | None = None
    x: int
    y: int
    width: int
    height: int
    score: float


class PersonUpdate(Contract):
    name: str | None = None
    hidden: bool | None = None


class FaceModel(Contract):
    name: str
    present: bool
    bytes: int
    expected_bytes: int


class FaceStatus(Contract):
    """What the settings screen needs to describe the feature's state."""

    enabled: bool
    #: False until the models have been downloaded onto the server.
    models_ready: bool
    models: list[FaceModel] = Field(default_factory=list)
    people_count: int
    #: Photos still waiting to be scanned.
    pending: int


# --- vault ---


class VaultStatus(Contract):
    configured: bool
    unlocked: bool
    #: Only present while unlocked: a locked vault does not reveal its size.
    count: int | None = None


# --- administration ---


class AdminUser(Contract):
    """An account as an administrator sees it.

    Deliberately not the same shape as ``User``: this carries what is needed to decide
    what to do about someone, and carries no secret of any kind.
    """

    id: str
    email: str
    name: str
    role: UserRole
    #: How this account signs in. An SSO account has no password to reset.
    signs_in_with: Literal["password", "sso", "both"]
    #: Suspended: the rows are all still here, but nobody can sign in as them.
    disabled: bool
    photo_count: int
    used_bytes: int
    #: ``None`` when the account draws on whatever the server has.
    quota_bytes: int | None = None
    created_at: str
    updated_at: str


class AdminUserUpdate(Contract):
    role: UserRole | None = None
    disabled: bool | None = None


class Invite(Contract):
    """An outstanding invitation.

    The token is absent on purpose: it is shown once, when the invitation is made, and is
    stored only as a hash.
    """

    id: str
    email: str | None = None
    role: UserRole
    created_at: str
    expires_at: str
    accepted_at: str | None = None
    state: Literal["pending", "accepted", "expired"]


class InviteCreate(Contract):
    #: When set, only this address may use the link.
    email: str | None = None
    role: UserRole = "user"
    expires_in_days: int = 7


class InviteCreated(Invite):
    """The one and only time the token is legible."""

    token: str


class AdminJob(Contract):
    id: str
    name: str
    status: Literal["queued", "running", "done", "failed"]
    attempts: int
    max_attempts: int
    last_error: str | None = None
    run_at: str
    created_at: str
    finished_at: str | None = None


class QueueHealth(Contract):
    """The state of the work queue.

    ``stuck`` counts photographs the pipeline never finished with. Without it a failed
    transcode leaves a photo saying "processing" for ever and nothing says why.
    """

    queued: int
    running: int
    failed: int
    stuck: int
    #: The oldest thing still waiting, so a jammed queue is obvious.
    oldest_queued_at: str | None = None
    failures: list[AdminJob] = Field(default_factory=list)


class AdminClient(Contract):
    id: str
    name: str
    redirect_uris: list[str] = Field(default_factory=list)
    scopes: list[str] = Field(default_factory=list)
    #: With RFC 7591 open, anything that asks gets a client. This separates what an
    #: administrator set up deliberately from what simply turned up.
    dynamically_registered: bool
    #: Public clients hold no secret and rely on PKCE. Native apps and MCP are these.
    is_public: bool
    created_at: str
    active_tokens: int


class AdminSession(Contract):
    id: str
    user_id: str
    user_email: str
    user_agent: str | None = None
    ip_address: str | None = None
    created_at: str
    last_used_at: str
    expires_at: str
    #: True for the session making this request, so it is not revoked by accident.
    current: bool


class StoragePerUser(Contract):
    user_id: str
    email: str
    used_bytes: int
    photo_count: int


class StorageReport(Contract):
    data_dir: str
    original_bytes: int
    derivative_bytes: int
    trashed_count: int
    trashed_bytes: int
    trash_retention_days: int
    #: The next thing due to be destroyed, so the sweep is not a black box.
    next_sweep_at: str | None = None
    #: Rows whose file is missing. Counted rather than listed.
    missing_files: int
    per_user: list[StoragePerUser] = Field(default_factory=list)


class ServerSettings(Contract):
    """Settings that can be changed without restarting the server.

    What is stored wins over the environment, so a deployment that sets nothing keeps
    behaving exactly as it did.
    """

    allow_signup: bool
    trash_retention_days: int
    faces_enabled: bool


class ServerSettingsUpdate(Contract):
    allow_signup: bool | None = None
    trash_retention_days: int | None = None
    faces_enabled: bool | None = None


class AdminShareLink(Contract):
    """A public link, as the person responsible for the server sees it."""

    id: str
    slug: str
    url: str
    kind: Literal["album", "photo"]
    #: The album's name, or the photograph's filename.
    target: str
    created_by_email: str
    created_at: str
    expires_at: str | None = None
    has_password: bool
    allow_download: bool


# --- error envelope ---


class ApiErrorBody(Wire):
    code: str
    message: str
    #: Field-level detail for validation failures: path -> messages.
    details: dict[str, list[str]] | None = None


class ApiError(Wire):
    error: ApiErrorBody


ERROR_CODES: dict[str, str] = {
    "BAD_REQUEST": "bad_request",
    "VALIDATION_FAILED": "validation_failed",
    "UNAUTHORIZED": "unauthorized",
    "FORBIDDEN": "forbidden",
    "INSUFFICIENT_SCOPE": "insufficient_scope",
    "NOT_FOUND": "not_found",
    "CONFLICT": "conflict",
    "PAYLOAD_TOO_LARGE": "payload_too_large",
    "UNSUPPORTED_MEDIA_TYPE": "unsupported_media_type",
    "QUOTA_EXCEEDED": "quota_exceeded",
    "RATE_LIMITED": "rate_limited",
    "INTERNAL": "internal_error",
}


def as_json(model: BaseModel | None, **kwargs: Any) -> dict[str, Any] | None:
    """Serialises a request body the way the API reads it: camelCase, no empty keys."""
    if model is None:
        return None
    return model.model_dump(by_alias=True, exclude_none=True, **kwargs)
