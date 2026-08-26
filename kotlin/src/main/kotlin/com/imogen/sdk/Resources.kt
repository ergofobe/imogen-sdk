@file:Suppress("unused")

package com.imogen.sdk

import io.ktor.client.request.forms.MultiPartFormDataContent
import io.ktor.client.request.forms.formData
import io.ktor.client.statement.readRawBytes
import io.ktor.http.Headers
import io.ktor.http.HttpHeaders
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.io.File
import java.io.RandomAccessFile

// The resources. Each is a thin, typed layer over [HttpClient]; none of them know anything
// about HTTP beyond the path they call.

data class UploadProgress(
    /** Bytes transferred so far for this file. */
    val loaded: Long,
    val total: Long,
)

data class UploadOptions(
    val metadata: AssetUploadMetadata = AssetUploadMetadata(),
    val onProgress: ((UploadProgress) -> Unit)? = null,
)

/**
 * The outcome of one file in a bulk upload. Each settles independently, so one bad photo in
 * a folder of three thousand does not abandon the rest.
 */
data class BulkUploadResult(
    val file: File,
    val result: AssetUploadResult? = null,
    val error: Throwable? = null,
)

internal fun jsonBody(vararg pairs: Pair<String, Any?>): String {
    fun encode(value: Any?): kotlinx.serialization.json.JsonElement = when (value) {
        null -> JsonNull
        is String -> JsonPrimitive(value)
        is Boolean -> JsonPrimitive(value)
        is Number -> JsonPrimitive(value)
        is List<*> -> JsonArray(value.map(::encode))
        else -> error("unsupported body value: $value")
    }
    return JsonObject(pairs.associate { (key, value) -> key to encode(value) }).toString()
}

internal val jsonHeaders = mapOf("Content-Type" to "application/json")

class Assets internal constructor(private val http: HttpClient) {

    suspend fun list(query: AssetQuery = AssetQuery()): AssetPage =
        http.request("GET", "/api/v1/assets", RequestOptions(query = query.toParameters()))

    /** Walks every page, so a caller can collect the whole library. */
    fun iterate(query: AssetQuery = AssetQuery()): Flow<Asset> = flow {
        var current = query
        while (true) {
            val page = list(current)
            page.items.forEach { emit(it) }
            val cursor = page.nextCursor ?: break
            current = current.copy(cursor = cursor)
        }
    }

    suspend fun get(assetId: String): Asset = http.request("GET", "/api/v1/assets/$assetId")

    suspend fun update(assetId: String, patch: AssetUpdate): Asset = http.request(
        "PATCH",
        "/api/v1/assets/$assetId",
        RequestOptions(body = wireJson.encodeToString(patch), headers = jsonHeaders),
    )

    /** The live public link for one photo, or null. */
    suspend fun shareLink(assetId: String): ShareLink? =
        http.request("GET", "/api/v1/assets/$assetId/share")

    /** Publishes one photo. Replaces any existing link for it. */
    suspend fun share(assetId: String, input: ShareLinkCreate = ShareLinkCreate()): ShareLink =
        http.request(
            "POST",
            "/api/v1/assets/$assetId/share",
            RequestOptions(body = wireJson.encodeToString(input), headers = jsonHeaders),
        )

    suspend fun unshare(assetId: String) {
        http.requestText("DELETE", "/api/v1/assets/$assetId/share")
    }

    suspend fun trash(assetIds: List<String>): Long {
        val result: AffectedCount = http.request(
            "POST",
            "/api/v1/assets/trash",
            RequestOptions(body = jsonBody("assetIds" to assetIds), headers = jsonHeaders),
        )
        return result.count
    }

    suspend fun restore(assetIds: List<String>): Long {
        val result: AffectedCount = http.request(
            "POST",
            "/api/v1/assets/restore",
            RequestOptions(body = jsonBody("assetIds" to assetIds), headers = jsonHeaders),
        )
        return result.count
    }

    suspend fun timeline(): Timeline = http.request("GET", "/api/v1/assets/timeline")

    suspend fun stats(): LibraryStats = http.request("GET", "/api/v1/assets/stats")

    /** A URL suitable for an image view. Browsers send the session cookie themselves. */
    fun urlFor(assetId: String, variant: AssetVariant = AssetVariant.THUMBNAIL): String =
        http.url("/api/v1/assets/$assetId/${variant.wire}")

    fun downloadUrl(assetId: String): String = http.url("/api/v1/assets/$assetId/download")

    /** Fetches image bytes with an Authorization header, for non-browser clients. */
    suspend fun bytes(assetId: String, variant: AssetVariant = AssetVariant.PREVIEW): ByteArray =
        http.send("GET", "/api/v1/assets/$assetId/${variant.wire}").readRawBytes()

    /**
     * Uploads one file, choosing the protocol by size: small files go in a single request,
     * large ones use a resumable session so a dropped connection costs one chunk rather than
     * the whole video.
     */
    suspend fun upload(file: File, options: UploadOptions = UploadOptions()): AssetUploadResult {
        val size = file.length()
        if (size >= UploadLimits.RESUMABLE_THRESHOLD_BYTES) {
            return uploadResumable(file, size, options)
        }

        val bytes = withContext(Dispatchers.IO) { file.readBytes() }
        val form = MultiPartFormDataContent(
            formData {
                append(
                    "file",
                    bytes,
                    Headers.build {
                        append(HttpHeaders.ContentType, mimeTypeFor(file))
                        append(HttpHeaders.ContentDisposition, "filename=\"${file.name}\"")
                    },
                )
                options.metadata.deviceAssetId?.let { append("deviceAssetId", it) }
                options.metadata.capturedAt?.let { append("capturedAt", it) }
                options.metadata.favorite?.let { append("favorite", it.toString()) }
            }
        )

        val result: AssetUploadResult = http.request(
            "POST",
            "/api/v1/assets",
            RequestOptions(body = form, isMultipart = true),
        )
        options.onProgress?.invoke(UploadProgress(size, size))
        return result
    }

    private suspend fun uploadResumable(
        file: File,
        size: Long,
        options: UploadOptions,
    ): AssetUploadResult {
        val create = UploadSessionCreate(
            filename = file.name,
            sizeBytes = size,
            mimeType = mimeTypeFor(file),
            deviceAssetId = options.metadata.deviceAssetId,
            capturedAt = options.metadata.capturedAt,
            favorite = options.metadata.favorite,
        )

        val session: UploadSession = http.request(
            "POST",
            "/api/v1/uploads",
            RequestOptions(body = wireJson.encodeToString(create), headers = jsonHeaders),
        )

        // The server already had these bytes; nothing to transfer.
        session.existing?.let {
            options.onProgress?.invoke(UploadProgress(size, size))
            return it
        }

        var offset = session.offset
        withContext(Dispatchers.IO) { RandomAccessFile(file, "r") }.use { handle ->
            while (offset < size) {
                val length = minOf(UploadLimits.CHUNK_BYTES, size - offset).toInt()
                val chunk = ByteArray(length)
                withContext(Dispatchers.IO) {
                    handle.seek(offset)
                    handle.readFully(chunk)
                }

                val progress: UploadOffset = http.request(
                    "PATCH",
                    "/api/v1/uploads/${session.id}",
                    RequestOptions(
                        body = chunk,
                        headers = mapOf(
                            "Upload-Offset" to offset.toString(),
                            "Content-Type" to "application/octet-stream",
                        ),
                    ),
                )
                offset = progress.offset
                options.onProgress?.invoke(UploadProgress(offset, size))
            }
        }

        return http.request("POST", "/api/v1/uploads/${session.id}/complete")
    }

    /** Uploads many files with bounded concurrency. */
    suspend fun uploadMany(
        files: List<File>,
        concurrency: Int = UploadLimits.BULK_CONCURRENCY,
        metadataFor: ((File) -> AssetUploadMetadata)? = null,
    ): List<BulkUploadResult> = coroutineScope {
        val permits = Semaphore(maxOf(1, concurrency))
        files.map { file ->
            async {
                permits.withPermit {
                    try {
                        val metadata = metadataFor?.invoke(file) ?: AssetUploadMetadata()
                        BulkUploadResult(file, upload(file, UploadOptions(metadata)))
                    } catch (error: Throwable) {
                        BulkUploadResult(file, error = error)
                    }
                }
            }
        }.map { it.await() }
    }
}

class Albums internal constructor(private val http: HttpClient) {

    suspend fun list(): List<Album> {
        val page: Items<Album> = http.request("GET", "/api/v1/albums")
        return page.items
    }

    suspend fun get(albumId: String): AlbumWithAssets = http.request("GET", "/api/v1/albums/$albumId")

    suspend fun create(input: AlbumCreate): Album = http.request(
        "POST",
        "/api/v1/albums",
        RequestOptions(body = wireJson.encodeToString(input), headers = jsonHeaders),
    )

    suspend fun update(albumId: String, patch: AlbumUpdate): Album = http.request(
        "PATCH",
        "/api/v1/albums/$albumId",
        RequestOptions(body = wireJson.encodeToString(patch), headers = jsonHeaders),
    )

    suspend fun remove(albumId: String) {
        http.requestText("DELETE", "/api/v1/albums/$albumId")
    }

    suspend fun addAssets(albumId: String, assetIds: List<String>): AlbumAssetsResult = http.request(
        "POST",
        "/api/v1/albums/$albumId/assets",
        RequestOptions(body = jsonBody("assetIds" to assetIds), headers = jsonHeaders),
    )

    suspend fun removeAssets(albumId: String, assetIds: List<String>): Long {
        val result: RemovedCount = http.request(
            "DELETE",
            "/api/v1/albums/$albumId/assets",
            RequestOptions(body = jsonBody("assetIds" to assetIds), headers = jsonHeaders),
        )
        return result.removed
    }

    /** The live public link for this album, or null. */
    suspend fun shareLink(albumId: String): ShareLink? =
        http.request("GET", "/api/v1/albums/$albumId/share")

    suspend fun share(albumId: String, input: ShareLinkCreate = ShareLinkCreate()): ShareLink =
        http.request(
            "POST",
            "/api/v1/albums/$albumId/share",
            RequestOptions(body = wireJson.encodeToString(input), headers = jsonHeaders),
        )

    suspend fun unshare(albumId: String) {
        http.requestText("DELETE", "/api/v1/albums/$albumId/share")
    }
}

/**
 * People, as grouped by face recognition.
 *
 * The feature is off until a server administrator enables it, so every method here can
 * legitimately return nothing — check [status] before showing a person interface.
 */
class People internal constructor(private val http: HttpClient) {

    suspend fun status(): FaceStatus = http.request("GET", "/api/v1/people/status")

    /** Administrator only. Enabling downloads the models and scans the library. */
    suspend fun setEnabled(enabled: Boolean) {
        http.requestText(
            "POST",
            "/api/v1/people/enable",
            RequestOptions(body = jsonBody("enabled" to enabled), headers = jsonHeaders),
        )
    }

    suspend fun list(includeHidden: Boolean = false): List<Person> {
        val page: Items<Person> = http.request(
            "GET",
            "/api/v1/people",
            RequestOptions(query = listOf("includeHidden" to includeHidden.toString())),
        )
        return page.items
    }

    suspend fun get(personId: String): PersonWithPhotos = http.request("GET", "/api/v1/people/$personId")

    suspend fun update(personId: String, patch: PersonUpdate) {
        http.requestText(
            "PATCH",
            "/api/v1/people/$personId",
            RequestOptions(body = wireJson.encodeToString(patch), headers = jsonHeaders),
        )
    }

    /** Folds several clusters into one. Use when grouping split a person in two. */
    suspend fun merge(keepId: String, mergeIds: List<String>): Long {
        val result: MovedCount = http.request(
            "POST",
            "/api/v1/people/merge",
            RequestOptions(
                body = jsonBody("keepId" to keepId, "mergeIds" to mergeIds),
                headers = jsonHeaders,
            ),
        )
        return result.moved
    }

    /** Moves specific faces to another person, or detaches them with null. */
    suspend fun reassign(faceIds: List<String>, personId: String?) {
        http.requestText(
            "POST",
            "/api/v1/people/reassign",
            RequestOptions(
                body = jsonBody("faceIds" to faceIds, "personId" to personId),
                headers = jsonHeaders,
            ),
        )
    }

    suspend fun facesIn(assetId: String): List<DetectedFace> {
        val page: Items<DetectedFace> = http.request("GET", "/api/v1/people/faces/$assetId")
        return page.items
    }

    /** A person's thumbnail, cropped from the photo their best face was found in. */
    fun thumbnailUrl(faceId: String): String = http.url("/api/v1/people/thumbnail/$faceId")
}

/**
 * Photographs kept out of the ordinary library entirely — absent from the timeline, search,
 * albums, shared links, and anything an AI assistant can reach.
 *
 * It opens only for a signed-in browser session that re-enters the vault passphrase. A
 * bearer token cannot open it, so these methods are unavailable to API clients by design
 * rather than by omission.
 */
class Vault internal constructor(private val http: HttpClient) {

    suspend fun status(): VaultStatus = http.request("GET", "/api/v1/vault/status")

    /** Sets the passphrase. Changing an existing one requires the vault to be open. */
    suspend fun setPassphrase(passphrase: String) {
        http.requestText(
            "POST",
            "/api/v1/vault/setup",
            RequestOptions(body = jsonBody("passphrase" to passphrase), headers = jsonHeaders),
        )
    }

    suspend fun unlock(passphrase: String) {
        http.requestText(
            "POST",
            "/api/v1/vault/unlock",
            RequestOptions(body = jsonBody("passphrase" to passphrase), headers = jsonHeaders),
        )
    }

    suspend fun lock() {
        http.requestText("POST", "/api/v1/vault/lock")
    }

    suspend fun list(limit: Int = 200): List<Asset> {
        val page: Items<Asset> = http.request(
            "GET",
            "/api/v1/vault/assets",
            RequestOptions(query = listOf("limit" to limit.toString())),
        )
        return page.items
    }

    suspend fun moveIn(assetIds: List<String>): Long {
        val result: MovedCount = http.request(
            "POST",
            "/api/v1/vault/assets",
            RequestOptions(body = jsonBody("assetIds" to assetIds), headers = jsonHeaders),
        )
        return result.moved
    }

    suspend fun moveOut(assetIds: List<String>): Long {
        val result: MovedCount = http.request(
            "DELETE",
            "/api/v1/vault/assets",
            RequestOptions(body = jsonBody("assetIds" to assetIds), headers = jsonHeaders),
        )
        return result.moved
    }
}

class Auth internal constructor(private val http: HttpClient) {

    /** What the sign-in screen needs before anyone has authenticated. */
    suspend fun config(): AuthConfig = http.request("GET", "/api/v1/auth/config")

    suspend fun login(request: LoginRequest): User = http.request(
        "POST",
        "/api/v1/auth/login",
        RequestOptions(body = wireJson.encodeToString(request), headers = jsonHeaders),
    )

    suspend fun signup(request: SignupRequest): User = http.request(
        "POST",
        "/api/v1/auth/signup",
        RequestOptions(body = wireJson.encodeToString(request), headers = jsonHeaders),
    )

    suspend fun logout() {
        http.requestText("POST", "/api/v1/auth/logout")
    }

    suspend fun logoutEverywhere() {
        http.requestText("POST", "/api/v1/auth/logout-everywhere")
    }

    suspend fun me(): User = http.request("GET", "/api/v1/auth/me")

    /** Edits your own name or email. Not available to provider-managed accounts. */
    suspend fun updateProfile(patch: ProfileUpdate): User = http.request(
        "PATCH",
        "/api/v1/auth/me",
        RequestOptions(body = wireJson.encodeToString(patch), headers = jsonHeaders),
    )

    suspend fun changePassword(request: PasswordChangeRequest) {
        http.requestText(
            "POST",
            "/api/v1/auth/password",
            RequestOptions(body = wireJson.encodeToString(request), headers = jsonHeaders),
        )
    }

    /** Where to send a browser to begin single sign-on. */
    fun oidcStartUrl(returnTo: String = "/"): String =
        http.url("/api/v1/auth/oidc/start", listOf("returnTo" to returnTo))
}

/**
 * Server administration.
 *
 * Every endpoint here answers 404 rather than 403 to anyone who is not an administrator, so
 * a refusal is indistinguishable from a route that does not exist. Treat a not-found from
 * these methods as "you may not", not as a bug.
 */
class Admin internal constructor(private val http: HttpClient) {

    /** Every account on the server, oldest first. Deleted accounts are not included. */
    suspend fun users(): List<AdminUser> {
        val page: Items<AdminUser> = http.request("GET", "/api/v1/admin/users")
        return page.items
    }

    /** Changes a role, or suspends and restores access. */
    suspend fun updateUser(userId: String, patch: AdminUserUpdate): AdminUser = http.request(
        "PATCH",
        "/api/v1/admin/users/$userId",
        RequestOptions(body = wireJson.encodeToString(patch), headers = jsonHeaders),
    )

    /** Removes the account. Its photographs go to the trash, not the incinerator. */
    suspend fun deleteUser(userId: String) {
        http.requestText("DELETE", "/api/v1/admin/users/$userId")
    }

    /** Sets someone's password and ends every session they had. */
    suspend fun resetPassword(userId: String, password: String) {
        http.requestText(
            "POST",
            "/api/v1/admin/users/$userId/password",
            RequestOptions(body = jsonBody("password" to password), headers = jsonHeaders),
        )
    }

    suspend fun invites(): List<Invite> {
        val page: Items<Invite> = http.request("GET", "/api/v1/admin/invites")
        return page.items
    }

    /** The returned token is the only legible copy. It is stored hashed. */
    suspend fun createInvite(input: InviteCreate = InviteCreate()): InviteCreated = http.request(
        "POST",
        "/api/v1/admin/invites",
        RequestOptions(
            // Defaults are meaningful here, so they go on the wire rather than being dropped.
            body = jsonBody(
                "email" to input.email,
                "role" to if (input.role == UserRole.ADMIN) "admin" else "user",
                "expiresInDays" to input.expiresInDays,
            ),
            headers = jsonHeaders,
        ),
    )

    suspend fun revokeInvite(inviteId: String) {
        http.requestText("DELETE", "/api/v1/admin/invites/$inviteId")
    }

    /** Queue depth, what is running, and what the pipeline gave up on. */
    suspend fun queue(): QueueHealth = http.request("GET", "/api/v1/admin/queue")

    /** Puts one failed job back in the queue with its attempts cleared. */
    suspend fun retryJob(jobId: String) {
        http.requestText("POST", "/api/v1/admin/queue/$jobId/retry")
    }

    suspend fun retryAllJobs(): Long {
        val result: AffectedCount = http.request("POST", "/api/v1/admin/queue/retry")
        return result.count
    }

    suspend fun discardJob(jobId: String) {
        http.requestText("DELETE", "/api/v1/admin/queue/$jobId")
    }

    /** Applications allowed to act on someone's behalf. */
    suspend fun clients(): List<AdminClient> {
        val page: Items<AdminClient> = http.request("GET", "/api/v1/admin/clients")
        return page.items
    }

    /** Removes an application. Its tokens go with it. */
    suspend fun revokeClient(clientId: String) {
        http.requestText("DELETE", "/api/v1/admin/clients/$clientId")
    }

    suspend fun sessions(): List<AdminSession> {
        val page: Items<AdminSession> = http.request("GET", "/api/v1/admin/sessions")
        return page.items
    }

    /** Ends a session. Refuses the one making the request. */
    suspend fun revokeSession(sessionId: String) {
        http.requestText("DELETE", "/api/v1/admin/sessions/$sessionId")
    }

    /** Where the bytes are, per variant and per account. */
    suspend fun storage(): StorageReport = http.request("GET", "/api/v1/admin/storage")

    suspend fun settings(): ServerSettings = http.request("GET", "/api/v1/admin/settings")

    /** Takes effect at once. The stored value wins over the environment. */
    suspend fun updateSettings(patch: ServerSettingsUpdate): ServerSettings = http.request(
        "PATCH",
        "/api/v1/admin/settings",
        RequestOptions(body = wireJson.encodeToString(patch), headers = jsonHeaders),
    )

    /** Every link that is public right now, across all accounts. */
    suspend fun shares(): List<AdminShareLink> {
        val page: Items<AdminShareLink> = http.request("GET", "/api/v1/admin/shares")
        return page.items
    }

    /** Closes a link, whoever made it. */
    suspend fun revokeShare(shareId: String) {
        http.requestText("DELETE", "/api/v1/admin/shares/$shareId")
    }
}

/**
 * Enough of a guess for the server to accept the part. The server re-sniffs the bytes
 * anyway, so this never becomes the last word on what a file is.
 */
internal fun mimeTypeFor(file: File): String = when (file.extension.lowercase()) {
    "jpg", "jpeg" -> "image/jpeg"
    "png" -> "image/png"
    "gif" -> "image/gif"
    "webp" -> "image/webp"
    "heic" -> "image/heic"
    "heif" -> "image/heif"
    "avif" -> "image/avif"
    "tif", "tiff" -> "image/tiff"
    "mp4", "m4v" -> "video/mp4"
    "mov" -> "video/quicktime"
    "webm" -> "video/webm"
    "avi" -> "video/x-msvideo"
    else -> "application/octet-stream"
}
