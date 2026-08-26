@file:Suppress("unused")

package com.imogen.sdk

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * The API contract, as Kotlin types.
 *
 * JSON keys are camelCase and so are Kotlin properties, so almost nothing here needs
 * `@SerialName`. The exception is the OAuth payloads, which are snake_case on the wire.
 *
 * Timestamps stay `String` rather than becoming `Instant`. The contract specifies ISO-8601
 * and nothing else, and a client that reformats on the way through is a client that
 * eventually sends back something the server did not give it.
 */

/**
 * One encoder for the whole client. Nulls are dropped on the way out, so a patch carries
 * only the fields it means to change, and unknown keys are ignored on the way in, so a
 * newer server does not break an older client.
 */
val wireJson: Json = Json {
    ignoreUnknownKeys = true
    encodeDefaults = false
    explicitNulls = false
    isLenient = true
}

// --- assets ---

@Serializable
enum class AssetType {
    @SerialName("image") IMAGE,
    @SerialName("video") VIDEO,
}

@Serializable
enum class AssetVariant(val wire: String) {
    @SerialName("original") ORIGINAL("original"),
    @SerialName("preview") PREVIEW("preview"),
    @SerialName("thumbnail") THUMBNAIL("thumbnail"),
}

/** Processing lifecycle. Clients show a placeholder until an asset reaches [READY]. */
@Serializable
enum class AssetStatus {
    @SerialName("pending") PENDING,
    @SerialName("processing") PROCESSING,
    @SerialName("ready") READY,
    @SerialName("failed") FAILED,
}

@Serializable
data class ExifData(
    val make: String? = null,
    val model: String? = null,
    val lens: String? = null,
    val fNumber: Double? = null,
    val exposureTime: Double? = null,
    val iso: Long? = null,
    val focalLength: Double? = null,
    val orientation: Long? = null,
)

@Serializable
data class GeoPoint(
    val latitude: Double,
    val longitude: Double,
    val altitude: Double? = null,
    /** Reverse-geocoded place name, when available. */
    val place: String? = null,
)

@Serializable
data class Asset(
    val id: String,
    val ownerId: String,
    val type: AssetType,
    val status: AssetStatus,
    val originalFilename: String,
    val mimeType: String,
    /** SHA-256 of the original bytes. Stable identity across re-uploads. */
    val checksum: String,
    val sizeBytes: Long,
    val width: Int? = null,
    val height: Int? = null,
    /** Seconds. Null for images. */
    val duration: Double? = null,
    val capturedAt: String,
    /** True when [capturedAt] came from EXIF rather than a fallback. */
    val capturedAtIsExact: Boolean,
    /** The capture date before the owner corrected it, or null if never corrected. */
    val capturedAtOriginal: String? = null,
    val capturedAtOriginalIsExact: Boolean? = null,
    val createdAt: String,
    val updatedAt: String,
    val deletedAt: String? = null,
    val favorite: Boolean,
    val archived: Boolean,
    val description: String? = null,
    val exif: ExifData? = null,
    val location: GeoPoint? = null,
    /** Dominant colour of the thumbnail, for grid placeholders. */
    val placeholderColor: String? = null,
    /** The paired video of an iPhone Live Photo, if this asset has one. */
    val livePhotoVideoId: String? = null,
    /** Client-supplied stable id, used by mobile apps to avoid re-uploading. */
    val deviceAssetId: String? = null,
)

@Serializable
data class AssetUpdate(
    val favorite: Boolean? = null,
    val archived: Boolean? = null,
    val description: String? = null,
    val capturedAt: String? = null,
    /** Puts back the date the file was imported with, discarding any correction. */
    val resetCapturedAt: Boolean? = null,
    val location: GeoPoint? = null,
)

/** Metadata a client may attach at upload time. All fields are hints; EXIF wins. */
@Serializable
data class AssetUploadMetadata(
    val deviceAssetId: String? = null,
    val capturedAt: String? = null,
    val favorite: Boolean? = null,
    val filename: String? = null,
)

@Serializable
data class AssetUploadResult(
    val asset: Asset,
    /** True when the checksum already existed and no new file was stored. */
    val duplicate: Boolean,
)

@Serializable
data class AssetPage(
    val items: List<Asset> = emptyList(),
    val nextCursor: String? = null,
    /** Total matching rows, when cheap to compute. Null means "not counted". */
    val total: Long? = null,
)

// --- queries ---

@Serializable
enum class AssetSort(val wire: String) {
    @SerialName("capturedAt") CAPTURED_AT("capturedAt"),
    @SerialName("createdAt") CREATED_AT("createdAt"),
    @SerialName("filename") FILENAME("filename"),
}

@Serializable
enum class SortOrder(val wire: String) {
    @SerialName("asc") ASC("asc"),
    @SerialName("desc") DESC("desc"),
}

/**
 * Cursor pagination. Offsets are wrong for a timeline that grows while you scroll: an
 * upload shifts every later page by one. The cursor encodes the last seen
 * `(capturedAt, id)` pair, so results stay stable.
 */
data class AssetQuery(
    val cursor: String? = null,
    val limit: Int? = null,
    /** Free-text over filename, description, camera, and place. */
    val q: String? = null,
    val type: AssetType? = null,
    val albumId: String? = null,
    val favorite: Boolean? = null,
    val archived: Boolean? = null,
    /** When true, returns only trashed assets. Trashed assets are hidden otherwise. */
    val trashed: Boolean? = null,
    val takenAfter: String? = null,
    val takenBefore: String? = null,
    /** Bounding box filter: `minLat,minLon,maxLat,maxLon`. */
    val bbox: String? = null,
    val sort: AssetSort? = null,
    val order: SortOrder? = null,
) {
    /**
     * Flattened to the query string the API expects. Absent fields stay absent, so the
     * server applies its own defaults rather than ours.
     */
    fun toParameters(): List<Pair<String, String>> = buildList {
        cursor?.let { add("cursor" to it) }
        limit?.let { add("limit" to it.toString()) }
        q?.let { add("q" to it) }
        type?.let { add("type" to if (it == AssetType.IMAGE) "image" else "video") }
        albumId?.let { add("albumId" to it) }
        favorite?.let { add("favorite" to it.toString()) }
        archived?.let { add("archived" to it.toString()) }
        trashed?.let { add("trashed" to it.toString()) }
        takenAfter?.let { add("takenAfter" to it) }
        takenBefore?.let { add("takenBefore" to it) }
        bbox?.let { add("bbox" to it) }
        sort?.let { add("sort" to it.wire) }
        order?.let { add("order" to it.wire) }
    }
}

/** A day bucket in the timeline, used to size the scroller before assets load. */
@Serializable
data class TimelineBucket(val date: String, val count: Long)

@Serializable
data class Timeline(val buckets: List<TimelineBucket> = emptyList())

@Serializable
data class LibraryStats(
    val assetCount: Long,
    val imageCount: Long,
    val videoCount: Long,
    val albumCount: Long,
    val favoriteCount: Long,
    val trashedCount: Long,
    val storageBytes: Long,
    val earliestCapturedAt: String? = null,
    val latestCapturedAt: String? = null,
)

// --- albums ---

@Serializable
data class Album(
    val id: String,
    val ownerId: String,
    val name: String,
    val description: String? = null,
    val coverAssetId: String? = null,
    val assetCount: Long,
    val createdAt: String,
    val updatedAt: String,
    /** Set when the album has an active public share link. */
    val shareSlug: String? = null,
)

@Serializable
data class AlbumWithAssets(
    val id: String,
    val ownerId: String,
    val name: String,
    val description: String? = null,
    val coverAssetId: String? = null,
    val assetCount: Long,
    val createdAt: String,
    val updatedAt: String,
    val shareSlug: String? = null,
    val assets: List<Asset> = emptyList(),
)

@Serializable
data class AlbumCreate(
    val name: String,
    val description: String? = null,
    val assetIds: List<String>? = null,
)

@Serializable
data class AlbumUpdate(
    val name: String? = null,
    val description: String? = null,
    val coverAssetId: String? = null,
)

/** Adding assets is idempotent, so the result reports what actually changed. */
@Serializable
data class AlbumAssetsResult(val added: Long, val skipped: Long, val assetCount: Long)

// --- sharing ---

@Serializable
data class ShareLink(
    val slug: String,
    val url: String,
    /** Exactly one of these is set: a link points at an album or at one photograph. */
    val albumId: String? = null,
    val assetId: String? = null,
    val expiresAt: String? = null,
    val allowDownload: Boolean,
    val createdAt: String,
)

@Serializable
data class ShareLinkCreate(
    val expiresAt: String? = null,
    val allowDownload: Boolean = true,
    val password: String? = null,
)

// --- uploads ---

@Serializable
data class UploadSessionCreate(
    val filename: String,
    val sizeBytes: Long,
    val mimeType: String,
    /** Optional SHA-256 known in advance; lets the server short-circuit a duplicate. */
    val checksum: String? = null,
    val deviceAssetId: String? = null,
    val capturedAt: String? = null,
    val favorite: Boolean? = null,
)

@Serializable
data class UploadSession(
    val id: String,
    /** Bytes already stored. A resuming client PATCHes from this offset. */
    val offset: Long,
    val sizeBytes: Long,
    val expiresAt: String,
    /** Set when the server recognised the checksum and no upload is needed. */
    val existing: AssetUploadResult? = null,
)

@Serializable
internal data class UploadOffset(val offset: Long)

object UploadLimits {
    const val BULK_CONCURRENCY = 6

    /** Files at or above this size use the resumable protocol. */
    const val RESUMABLE_THRESHOLD_BYTES = 64L * 1024 * 1024
    const val CHUNK_BYTES = 8L * 1024 * 1024
}

// --- auth ---

@Serializable
enum class UserRole {
    @SerialName("admin") ADMIN,
    @SerialName("user") USER,
}

@Serializable
data class User(
    val id: String,
    val email: String,
    val name: String,
    val role: UserRole,
    val avatarUrl: String? = null,
    /** Present when the account is linked to an external identity provider. */
    val oidcSubject: String? = null,
    /** False for OIDC-only accounts, which have no local password. */
    val hasPassword: Boolean,
    val createdAt: String,
    val quotaBytes: Long? = null,
    val usedBytes: Long,
)

@Serializable
data class LoginRequest(val email: String, val password: String)

@Serializable
data class SignupRequest(
    val email: String,
    val password: String,
    val name: String,
    /** An invitation token. Admits one account to a server with sign-up closed. */
    val invite: String? = null,
)

@Serializable
data class PasswordChangeRequest(
    val currentPassword: String? = null,
    val newPassword: String,
)

/**
 * Editing your own profile. Accounts linked to an identity provider cannot change these
 * here — the provider owns them, and imogen re-reads them at every sign-in.
 */
@Serializable
data class ProfileUpdate(
    val name: String? = null,
    val email: String? = null,
    /** Required to change the email address on an account that has a password. */
    val currentPassword: String? = null,
)

@Serializable
data class OidcConfig(
    val enabled: Boolean,
    val label: String? = null,
    val startUrl: String? = null,
    /** Where to send someone to edit the details the provider owns, if known. */
    val accountUrl: String? = null,
)

/** What the login page needs in order to render before anyone has authenticated. */
@Serializable
data class AuthConfig(
    val allowSignup: Boolean,
    /** True until the first account exists; the first signup becomes the admin. */
    val needsSetup: Boolean,
    val oidc: OidcConfig,
)

@Serializable
data class Health(val status: String, val version: String)

// --- OAuth 2.1 ---

val DEFAULT_SCOPES: List<String> =
    listOf("library:read", "library:write", "albums:read", "albums:write")

@Serializable
data class ClientRegistrationResponse(
    @SerialName("client_id") val clientId: String,
    @SerialName("client_secret") val clientSecret: String? = null,
    @SerialName("client_id_issued_at") val clientIdIssuedAt: Long = 0,
    @SerialName("client_secret_expires_at") val clientSecretExpiresAt: Long = 0,
    @SerialName("client_name") val clientName: String? = null,
    @SerialName("redirect_uris") val redirectUris: List<String> = emptyList(),
    @SerialName("grant_types") val grantTypes: List<String> = emptyList(),
    @SerialName("response_types") val responseTypes: List<String> = emptyList(),
    @SerialName("token_endpoint_auth_method") val tokenEndpointAuthMethod: String = "",
    val scope: String = "",
)

@Serializable
data class TokenResponse(
    @SerialName("access_token") val accessToken: String,
    @SerialName("token_type") val tokenType: String,
    @SerialName("expires_in") val expiresIn: Long,
    @SerialName("refresh_token") val refreshToken: String? = null,
    val scope: String = "",
)

@Serializable
data class AuthorizationServerMetadata(
    val issuer: String,
    @SerialName("authorization_endpoint") val authorizationEndpoint: String,
    @SerialName("token_endpoint") val tokenEndpoint: String,
    @SerialName("registration_endpoint") val registrationEndpoint: String = "",
    @SerialName("revocation_endpoint") val revocationEndpoint: String = "",
    @SerialName("scopes_supported") val scopesSupported: List<String> = emptyList(),
    @SerialName("code_challenge_methods_supported")
    val codeChallengeMethodsSupported: List<String> = emptyList(),
)

// --- people ---

/** One cluster of faces the library believes belong to the same person. */
@Serializable
data class Person(
    val id: String,
    /** Null until somebody names them. An unnamed person is still browsable. */
    val name: String? = null,
    /** The face used as their thumbnail. */
    val coverFaceId: String? = null,
    val photoCount: Long,
    val hidden: Boolean,
)

@Serializable
data class PersonWithPhotos(
    val id: String,
    val name: String? = null,
    val coverFaceId: String? = null,
    val photoCount: Long,
    val hidden: Boolean,
    val photos: List<Asset> = emptyList(),
)

/** Where a face sits in its photo, in the original image's pixels. */
@Serializable
data class DetectedFace(
    val id: String,
    val assetId: String,
    val personId: String? = null,
    /** Null when this person has not been named yet. */
    val personName: String? = null,
    val x: Long,
    val y: Long,
    val width: Long,
    val height: Long,
    val score: Double,
)

@Serializable
data class PersonUpdate(val name: String? = null, val hidden: Boolean? = null)

@Serializable
data class FaceModel(
    val name: String,
    val present: Boolean,
    val bytes: Long,
    val expectedBytes: Long,
)

/** What the settings screen needs to describe the feature's state. */
@Serializable
data class FaceStatus(
    val enabled: Boolean,
    /** False until the models have been downloaded onto the server. */
    val modelsReady: Boolean,
    val models: List<FaceModel> = emptyList(),
    val peopleCount: Long,
    /** Photos still waiting to be scanned. */
    val pending: Long,
)

// --- vault ---

@Serializable
data class VaultStatus(
    val configured: Boolean,
    val unlocked: Boolean,
    /** Only present while unlocked: a locked vault does not reveal its size. */
    val count: Long? = null,
)

// --- administration ---

@Serializable
enum class SignsInWith {
    @SerialName("password") PASSWORD,
    @SerialName("sso") SSO,
    @SerialName("both") BOTH,
}

/**
 * An account as an administrator sees it.
 *
 * Deliberately not the same shape as [User]: this carries what is needed to decide what to
 * do about someone, and carries no secret of any kind.
 */
@Serializable
data class AdminUser(
    val id: String,
    val email: String,
    val name: String,
    val role: UserRole,
    /** How this account signs in. An SSO account has no password to reset. */
    val signsInWith: SignsInWith,
    /** Suspended: the rows are all still here, but nobody can sign in as them. */
    val disabled: Boolean,
    val photoCount: Long,
    val usedBytes: Long,
    /** Null when the account draws on whatever the server has. */
    val quotaBytes: Long? = null,
    val createdAt: String,
    val updatedAt: String,
)

@Serializable
data class AdminUserUpdate(val role: UserRole? = null, val disabled: Boolean? = null)

@Serializable
enum class InviteState {
    @SerialName("pending") PENDING,
    @SerialName("accepted") ACCEPTED,
    @SerialName("expired") EXPIRED,
}

/**
 * An outstanding invitation. The token is absent on purpose: it is shown once, when the
 * invitation is made, and is stored only as a hash.
 */
@Serializable
data class Invite(
    val id: String,
    val email: String? = null,
    val role: UserRole,
    val createdAt: String,
    val expiresAt: String,
    val acceptedAt: String? = null,
    val state: InviteState,
)

@Serializable
data class InviteCreate(
    /** When set, only this address may use the link. */
    val email: String? = null,
    val role: UserRole = UserRole.USER,
    val expiresInDays: Int = 7,
)

/** The one and only time the token is legible. */
@Serializable
data class InviteCreated(
    val id: String,
    val email: String? = null,
    val role: UserRole,
    val createdAt: String,
    val expiresAt: String,
    val acceptedAt: String? = null,
    val state: InviteState,
    val token: String,
)

@Serializable
enum class JobStatus {
    @SerialName("queued") QUEUED,
    @SerialName("running") RUNNING,
    @SerialName("done") DONE,
    @SerialName("failed") FAILED,
}

@Serializable
data class AdminJob(
    val id: String,
    val name: String,
    val status: JobStatus,
    val attempts: Int,
    val maxAttempts: Int,
    val lastError: String? = null,
    val runAt: String,
    val createdAt: String,
    val finishedAt: String? = null,
)

/**
 * The state of the work queue.
 *
 * [stuck] counts photographs the pipeline never finished with. Without it a failed
 * transcode leaves a photo saying "processing" for ever and nothing says why.
 */
@Serializable
data class QueueHealth(
    val queued: Long,
    val running: Long,
    val failed: Long,
    val stuck: Long,
    /** The oldest thing still waiting, so a jammed queue is obvious. */
    val oldestQueuedAt: String? = null,
    val failures: List<AdminJob> = emptyList(),
)

@Serializable
data class AdminClient(
    val id: String,
    val name: String,
    val redirectUris: List<String> = emptyList(),
    val scopes: List<String> = emptyList(),
    /**
     * With RFC 7591 open, anything that asks gets a client. This separates what an
     * administrator set up deliberately from what simply turned up.
     */
    val dynamicallyRegistered: Boolean,
    /** Public clients hold no secret and rely on PKCE. Native apps and MCP are these. */
    val isPublic: Boolean,
    val createdAt: String,
    val activeTokens: Long,
)

@Serializable
data class AdminSession(
    val id: String,
    val userId: String,
    val userEmail: String,
    val userAgent: String? = null,
    val ipAddress: String? = null,
    val createdAt: String,
    val lastUsedAt: String,
    val expiresAt: String,
    /** True for the session making this request, so it is not revoked by accident. */
    val current: Boolean,
)

@Serializable
data class StoragePerUser(
    val userId: String,
    val email: String,
    val usedBytes: Long,
    val photoCount: Long,
)

@Serializable
data class StorageReport(
    val dataDir: String,
    val originalBytes: Long,
    val derivativeBytes: Long,
    val trashedCount: Long,
    val trashedBytes: Long,
    val trashRetentionDays: Int,
    /** The next thing due to be destroyed, so the sweep is not a black box. */
    val nextSweepAt: String? = null,
    /** Rows whose file is missing. Counted rather than listed. */
    val missingFiles: Long,
    val perUser: List<StoragePerUser> = emptyList(),
)

/**
 * Settings that can be changed without restarting the server. What is stored wins over the
 * environment, so a deployment that sets nothing keeps behaving exactly as it did.
 */
@Serializable
data class ServerSettings(
    val allowSignup: Boolean,
    val trashRetentionDays: Int,
    val facesEnabled: Boolean,
)

@Serializable
data class ServerSettingsUpdate(
    val allowSignup: Boolean? = null,
    val trashRetentionDays: Int? = null,
    val facesEnabled: Boolean? = null,
)

@Serializable
enum class ShareKind {
    @SerialName("album") ALBUM,
    @SerialName("photo") PHOTO,
}

/**
 * A public link, named by what it points at rather than by its slug: an administrator
 * deciding whether something should still be public is asking what it is.
 */
@Serializable
data class AdminShareLink(
    val id: String,
    val slug: String,
    val url: String,
    val kind: ShareKind,
    /** The album's name, or the photograph's filename. */
    val target: String,
    val createdByEmail: String,
    val createdAt: String,
    val expiresAt: String? = null,
    val hasPassword: Boolean,
    val allowDownload: Boolean,
)

// --- envelopes ---

@Serializable
internal data class ApiErrorBody(
    val code: String,
    val message: String,
    /** Field-level detail for validation failures: path -> messages. */
    val details: Map<String, List<String>>? = null,
)

@Serializable
internal data class ApiErrorEnvelope(val error: ApiErrorBody)

/** A page of anything the API returns as `{ items }`. */
@Serializable
internal data class Items<T>(val items: List<T> = emptyList())

@Serializable
internal data class AffectedCount(val count: Long)

@Serializable
internal data class RemovedCount(val removed: Long)

@Serializable
internal data class MovedCount(val moved: Long)
