package com.imogen.sdk

import io.ktor.http.Url
import io.ktor.http.parseQueryString
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.KSerializer
import kotlinx.serialization.serializer
import java.io.File
import java.io.RandomAccessFile
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * The Kotlin half of the shared conformance suite.
 *
 * Everything asserted here comes out of `../../conformance`, so this file and its
 * TypeScript, Rust, Python and Swift counterparts are checking the same contract rather
 * than five independent opinions about it.
 */
class ConformanceTest {

    private val conformance = File(System.getProperty("user.dir")).parentFile
        .resolve("conformance")

    private fun fixture(name: String): JsonObject =
        Json.parseToJsonElement(conformance.resolve(name).readText()) as JsonObject

    /** Walks a dotted path, so a failure names the field rather than dumping the model. */
    private fun at(value: JsonElement?, path: String): JsonElement? {
        var current = value
        for (key in path.split(".")) {
            current = when (val node = current) {
                is JsonArray -> key.toIntOrNull()?.let { node.getOrNull(it) }
                is JsonObject -> node[key]
                else -> null
            }
            if (current is JsonNull) return null
        }
        return current
    }

    /**
     * The stub's default answers. The resumable handshake is the only part that needs real
     * ones: it opens a session, then chunks until the reported offset reaches the end, so a
     * stub that always says nought loops for ever.
     */
    private val defaultReply: (Recorded, Int) -> Reply = { request, _ ->
        val threshold = UploadLimits.RESUMABLE_THRESHOLD_BYTES
        when {
            request.path == "/api/v1/uploads" && request.method == "POST" -> Reply.json(
                """{"id":"SESSION","offset":0,"sizeBytes":$threshold,""" +
                    """"expiresAt":"2030-01-01T00:00:00.000Z","existing":null}"""
            )
            request.path.startsWith("/api/v1/uploads/") -> Reply.json("""{"offset":$threshold}""")
            else -> Reply.json("""{"items":[],"nextCursor":null,"total":0}""")
        }
    }

    private fun client(stub: Stub, maxRetries: Int = 2, token: String? = null) =
        ImogenClient(
            ClientOptions(
                baseUrl = BASE,
                token = token?.let { { it } },
                maxRetries = maxRetries,
                engine = stub.engine,
            )
        )

    // --- the endpoint table ---

    /**
     * Performs one operation from the contract. Returns false when the client has no way to
     * perform it, which is itself a conformance failure.
     */
    private suspend fun invoke(
        imogen: ImogenClient,
        key: String,
        big: File,
        small: File,
    ): Boolean {
        val ids = listOf("ASSET")

        val call: suspend () -> Unit = when (key) {
            "client.health" -> ({ imogen.health(); Unit })

            "assets.list" -> ({ imogen.assets.list(); Unit })
            "assets.get" -> ({ imogen.assets.get("ASSET"); Unit })
            "assets.update" -> ({ imogen.assets.update("ASSET", AssetUpdate(favorite = true)); Unit })
            "assets.shareLink" -> ({ imogen.assets.shareLink("ASSET"); Unit })
            "assets.share" -> ({ imogen.assets.share("ASSET"); Unit })
            "assets.unshare" -> ({ imogen.assets.unshare("ASSET") })
            "assets.trash" -> ({ imogen.assets.trash(ids); Unit })
            "assets.restore" -> ({ imogen.assets.restore(ids); Unit })
            "assets.timeline" -> ({ imogen.assets.timeline(); Unit })
            "assets.timelineBucket" ->
                ({ imogen.assets.timelineBucket(TimelineBucketQuery(period = "2024-06")); Unit })
            "assets.stats" -> ({ imogen.assets.stats(); Unit })
            "assets.variant" -> ({ imogen.assets.bytes("ASSET", AssetVariant.THUMBNAIL); Unit })
            "assets.download" ->
                ({ imogen.http.send("GET", "/api/v1/assets/ASSET/download"); Unit })
            "assets.upload" -> ({ imogen.assets.upload(small); Unit })
            "assets.createUploadSession", "assets.uploadChunk", "assets.completeUpload" ->
                ({ imogen.assets.upload(big); Unit })

            "albums.list" -> ({ imogen.albums.list(); Unit })
            "albums.get" -> ({ imogen.albums.get("ALBUM"); Unit })
            "albums.create" -> ({ imogen.albums.create(AlbumCreate(name = "A")); Unit })
            "albums.update" -> ({ imogen.albums.update("ALBUM", AlbumUpdate(name = "B")); Unit })
            "albums.remove" -> ({ imogen.albums.remove("ALBUM") })
            "albums.addAssets" -> ({ imogen.albums.addAssets("ALBUM", ids); Unit })
            "albums.removeAssets" -> ({ imogen.albums.removeAssets("ALBUM", ids); Unit })
            "albums.shareLink" -> ({ imogen.albums.shareLink("ALBUM"); Unit })
            "albums.share" -> ({ imogen.albums.share("ALBUM"); Unit })
            "albums.unshare" -> ({ imogen.albums.unshare("ALBUM") })

            "people.status" -> ({ imogen.people.status(); Unit })
            "people.setEnabled" -> ({ imogen.people.setEnabled(true) })
            "people.list" -> ({ imogen.people.list(); Unit })
            "people.get" -> ({ imogen.people.get("PERSON"); Unit })
            "people.update" -> ({ imogen.people.update("PERSON", PersonUpdate(name = "Ada")) })
            "people.merge" -> ({ imogen.people.merge("PERSON", listOf("OTHER")); Unit })
            "people.reassign" -> ({ imogen.people.reassign(listOf("FACE"), null) })
            "people.facesIn" -> ({ imogen.people.facesIn("ASSET"); Unit })
            "people.thumbnail" ->
                ({ imogen.http.send("GET", "/api/v1/people/thumbnail/FACE"); Unit })

            "vault.status" -> ({ imogen.vault.status(); Unit })
            "vault.setPassphrase" -> ({ imogen.vault.setPassphrase("open sesame") })
            "vault.unlock" -> ({ imogen.vault.unlock("open sesame") })
            "vault.lock" -> ({ imogen.vault.lock() })
            "vault.list" -> ({ imogen.vault.list(); Unit })
            "vault.timeline" -> ({ imogen.vault.timeline(); Unit })
            "vault.timelineBucket" -> ({ imogen.vault.timelineBucket("2024-06"); Unit })
            "vault.moveIn" -> ({ imogen.vault.moveIn(ids); Unit })
            "vault.moveOut" -> ({ imogen.vault.moveOut(ids); Unit })

            "auth.config" -> ({ imogen.auth.config(); Unit })
            "auth.login" ->
                ({ imogen.auth.login(LoginRequest("a@b.c", "x")); Unit })
            "auth.signup" ->
                ({ imogen.auth.signup(SignupRequest("a@b.c", "x", "A")); Unit })
            "auth.logout" -> ({ imogen.auth.logout() })
            "auth.logoutEverywhere" -> ({ imogen.auth.logoutEverywhere() })
            "auth.me" -> ({ imogen.auth.me(); Unit })
            "auth.updateProfile" -> ({ imogen.auth.updateProfile(ProfileUpdate(name = "A")); Unit })
            "auth.changePassword" ->
                ({ imogen.auth.changePassword(PasswordChangeRequest(newPassword = "x".repeat(10))) })
            "auth.oidcStart" -> ({ imogen.http.send("GET", "/api/v1/auth/oidc/start"); Unit })

            "admin.users" -> ({ imogen.admin.users(); Unit })
            "admin.updateUser" ->
                ({ imogen.admin.updateUser("USER", AdminUserUpdate(role = UserRole.USER)); Unit })
            "admin.deleteUser" -> ({ imogen.admin.deleteUser("USER") })
            "admin.resetPassword" -> ({ imogen.admin.resetPassword("USER", "x".repeat(10)) })
            "admin.invites" -> ({ imogen.admin.invites(); Unit })
            "admin.createInvite" -> ({ imogen.admin.createInvite(); Unit })
            "admin.revokeInvite" -> ({ imogen.admin.revokeInvite("INVITE") })
            "admin.queue" -> ({ imogen.admin.queue(); Unit })
            "admin.retryJob" -> ({ imogen.admin.retryJob("JOB") })
            "admin.retryAllJobs" -> ({ imogen.admin.retryAllJobs(); Unit })
            "admin.discardJob" -> ({ imogen.admin.discardJob("JOB") })
            "admin.clients" -> ({ imogen.admin.clients(); Unit })
            "admin.revokeClient" -> ({ imogen.admin.revokeClient("CLIENT") })
            "admin.sessions" -> ({ imogen.admin.sessions(); Unit })
            "admin.revokeSession" -> ({ imogen.admin.revokeSession("SESSION") })
            "admin.storage" -> ({ imogen.admin.storage(); Unit })
            "admin.settings" -> ({ imogen.admin.settings(); Unit })
            "admin.updateSettings" ->
                ({ imogen.admin.updateSettings(ServerSettingsUpdate(allowSignup = true)); Unit })
            "admin.shares" -> ({ imogen.admin.shares(); Unit })
            "admin.revokeShare" -> ({ imogen.admin.revokeShare("SHARE") })

            "pairing.create" -> ({ imogen.pairing.create(); Unit })
            "pairing.status" -> ({ imogen.pairing.status("TICKET"); Unit })
            "pairing.claim" -> ({
                imogen.pairing.claim(
                    PairingClaimRequest(
                        code = "imog_pair_x",
                        clientId = "CLIENT",
                        redirectUri = "imogen://oauth",
                        codeChallenge = "x".repeat(43),
                    )
                )
                Unit
            })

            "oauth.discover" ->
                ({ imogen.http.send("GET", "/.well-known/oauth-authorization-server"); Unit })

            "oauth.protectedResource" ->
                ({ imogen.http.send("GET", "/.well-known/oauth-protected-resource"); Unit })

            "oauth.protectedResourceMcp" ->
                ({ imogen.http.send("GET", "/.well-known/oauth-protected-resource/mcp"); Unit })

            else -> return false
        }

        // The stub's body is nonsense; the path is the point.
        runCatching { call() }
        return true
    }

    private fun concrete(path: String): String = PLACEHOLDERS.entries.fold(path) { acc, (k, v) ->
        acc.replace(k, v)
    }

    @Test
    fun `every operation in the contract reaches the right endpoint`() = runTest {
        val directory = File(System.getProperty("java.io.tmpdir"))
        val small = directory.resolve("imogen-conformance-small.jpg")
        small.writeBytes("not really a jpeg".toByteArray())

        // The resumable path needs a file over the threshold. A sparse one costs no disk.
        val big = directory.resolve("imogen-conformance-big.mov")
        RandomAccessFile(big, "rw").use { it.setLength(UploadLimits.RESUMABLE_THRESHOLD_BYTES) }

        val stub = Stub(defaultReply)
        val table = fixture("endpoints.json")["resources"] as JsonObject

        val missing = mutableListOf<String>()
        val wrong = mutableListOf<String>()

        for ((resource, operations) in table) {
            for (endpoint in operations as JsonArray) {
                val entry = endpoint as JsonObject
                val operation = (entry["operation"] as JsonPrimitive).content
                val method = (entry["method"] as JsonPrimitive).content
                val path = concrete((entry["path"] as JsonPrimitive).content)
                val key = "$resource.$operation"

                val before = stub.callCount
                client(stub, maxRetries = 0).use { imogen ->
                    if (!invoke(imogen, key, big, small)) {
                        missing.add(key)
                        return@use
                    }

                    val made = stub.calls.drop(before).map { it.method to it.path }
                    if ((method to path) !in made) {
                        wrong.add("$key: wanted $method $path, saw $made")
                    }
                }
            }
        }

        assertEquals(
            emptyList(),
            missing,
            "the contract names operations the client cannot perform",
        )
        assertEquals(emptyList(), wrong)
    }

    // --- models ---

    /**
     * Decodes a fixture into [T], re-encodes it, and checks the asserted fields survived.
     * The round trip is the point: a field the type forgot would decode fine and then vanish
     * on the way back out.
     */
    private inline fun <reified T> check(name: String) {
        val entry = fixture("models.json")[name] as JsonObject
        val serializer: KSerializer<T> = serializer()

        val decoded = roundTripJson.decodeFromJsonElement(serializer, entry["payload"]!!)
        val encoded = roundTripJson.encodeToJsonElement(serializer, decoded)

        for ((path, expected) in entry["assert"] as JsonObject) {
            val actual = at(encoded, path)
            if (expected is JsonNull) {
                assertNull(actual, "$name.$path should be absent or null")
            } else {
                assertEquals(expected.toString(), actual.toString(), "$name.$path")
            }
        }
    }

    @Test
    fun `models decode as the contract says`() {
        check<Asset>("asset")
        check<Asset>("assetMinimal")
        check<AssetPage>("assetPage")
        check<Album>("album")
        check<AlbumAssetsResult>("albumAssetsResult")
        check<ShareLink>("shareLink")
        check<User>("user")
        check<AuthConfig>("authConfigOidcOff")
        check<AuthConfig>("authConfigOidcOn")
        check<Person>("person")
        check<Person>("personUnnamed")
        check<DetectedFace>("detectedFace")
        check<FaceStatus>("faceStatus")
        check<VaultStatus>("vaultStatusLocked")
        check<VaultStatus>("vaultStatusUnlocked")
        check<Timeline>("timeline")
        check<TimelineBucket>("timelineBucket")
        check<TimelineTile>("timelineTile")
        check<LibraryStats>("libraryStats")
        check<UploadSession>("uploadSession")
        check<AdminUser>("adminUser")
        check<QueueHealth>("queueHealth")
        check<StorageReport>("storageReport")
        check<ServerSettings>("serverSettings")
        check<TokenResponse>("tokenResponse")
        check<ProtectedResourceMetadata>("protectedResourceMetadata")
        check<PairingTicket>("pairingTicket")
        check<PairingStatus>("pairingStatusUnclaimed")
        check<PairingStatus>("pairingStatusClaimed")
        check<PairingClaim>("pairingClaim")
    }

    // --- errors ---

    @Test
    fun `errors are classified as the contract says`() {
        val cases = fixture("errors.json")["cases"] as JsonArray

        for (element in cases) {
            val case = element as JsonObject
            val name = (case["name"] as JsonPrimitive).content
            val status = (case["status"] as JsonPrimitive).content.toInt()
            val want = case["expect"] as JsonObject

            val body = (case["bodyRaw"] as? JsonPrimitive)?.content ?: case["body"].toString()
            val error = ImogenException.from(status, "", body)

            assertEquals(status, error.status, name)
            assertEquals((want["code"] as JsonPrimitive).content, error.code, name)
            assertEquals(
                (want["retryable"] as JsonPrimitive).content.toBoolean(),
                error.isRetryable,
                name,
            )
            assertEquals(
                (want["authError"] as JsonPrimitive).content.toBoolean(),
                error.isAuthError,
                name,
            )

            (want["message"] as? JsonPrimitive)?.let {
                assertEquals(it.content, error.message, name)
            }

            when (val details = want["details"]) {
                is JsonObject -> {
                    val actual = error.details ?: fail("$name: expected field detail")
                    for ((field, messages) in details) {
                        val expected = (messages as JsonArray).map { (it as JsonPrimitive).content }
                        assertEquals(expected, actual[field], "$name: details.$field")
                    }
                }
                else -> assertNull(error.details, "$name: expected no detail")
            }
        }
    }

    @Test
    fun `tuning constants match the contract`() {
        val upload = fixture("errors.json")["upload"] as JsonObject
        fun number(key: String) = (upload[key] as JsonPrimitive).content.toLong()

        assertEquals(number("bulkConcurrency"), UploadLimits.BULK_CONCURRENCY.toLong())
        assertEquals(number("resumableThresholdBytes"), UploadLimits.RESUMABLE_THRESHOLD_BYTES)
        assertEquals(number("chunkBytes"), UploadLimits.CHUNK_BYTES)
    }

    // --- transport ---

    @Test
    fun `retries a retryable rejection and then succeeds`() = runTest {
        val stub = Stub { _, index ->
            if (index < 2) {
                Reply.status(429, """{"error":{"code":"rate_limited","message":"slow"}}""")
            } else {
                Reply.json("""{"status":"ok","version":"0.1.0"}""")
            }
        }

        client(stub).use { imogen ->
            assertEquals("ok", imogen.health().status)
        }
        assertEquals(3, stub.callCount)
    }

    @Test
    fun `does not retry a rejection the server will keep rejecting`() = runTest {
        val stub = Stub { _, _ ->
            Reply.status(404, """{"error":{"code":"not_found","message":"no"}}""")
        }

        client(stub).use { imogen ->
            val error = runCatching { imogen.assets.get("nope") }.exceptionOrNull()
            assertTrue(error is ImogenException)
            assertEquals(404, error.status)
        }
        assertEquals(1, stub.callCount)
    }

    @Test
    fun `sends the bearer token`() = runTest {
        val stub = Stub(defaultReply)

        client(stub, token = "abc123").use { imogen -> imogen.assets.list() }

        assertEquals("Bearer abc123", stub.calls.first().headers["authorization"])
    }

    @Test
    fun `asks for a fresh token once when the server rejects the old one`() = runTest {
        val stub = Stub { request, index ->
            if (index == 0) {
                Reply.status(401, """{"error":{"code":"unauthorized","message":"x"}}""")
            } else {
                defaultReply(request, index)
            }
        }

        var refreshed = false
        ImogenClient(
            ClientOptions(
                baseUrl = BASE,
                token = { "stale" },
                onUnauthorized = {
                    refreshed = true
                    "fresh"
                },
                engine = stub.engine,
            )
        ).use { imogen -> imogen.assets.list() }

        assertTrue(refreshed)
        assertEquals(2, stub.callCount)
    }

    @Test
    fun `builds image URLs without a request`() {
        ImogenClient("$BASE/").use { imogen ->
            assertEquals("$BASE/api/v1/assets/A1/thumbnail", imogen.assets.urlFor("A1"))
            assertEquals(
                "$BASE/api/v1/assets/A1/preview",
                imogen.assets.urlFor("A1", AssetVariant.PREVIEW),
            )
            assertEquals("$BASE/api/v1/assets/A1/download", imogen.assets.downloadUrl("A1"))
        }
    }

    @Test
    fun `iterates every page exactly once`() = runTest {
        fun page(id: String, cursor: String?) = """
            {"items":[{"id":"$id","ownerId":"o","type":"image","status":"ready",
            "originalFilename":"$id.jpg","mimeType":"image/jpeg","checksum":"c","sizeBytes":1,
            "width":null,"height":null,"duration":null,
            "capturedAt":"2024-01-01T00:00:00.000Z","capturedAtIsExact":true,
            "capturedAtOriginal":null,"capturedAtOriginalIsExact":null,
            "createdAt":"2024-01-01T00:00:00.000Z","updatedAt":"2024-01-01T00:00:00.000Z",
            "deletedAt":null,"favorite":false,"archived":false,"description":null,
            "exif":null,"location":null,"placeholderColor":null,"livePhotoVideoId":null,
            "deviceAssetId":null}],
            "nextCursor":${cursor?.let { "\"$it\"" } ?: "null"},"total":2}
        """.trimIndent().replace("\n", "")

        val stub = Stub { _, index ->
            Reply.json(if (index == 0) page("a", "c1") else page("b", null))
        }

        client(stub).use { imogen ->
            assertEquals(listOf("a", "b"), imogen.assets.iterate().toList().map { it.id })
        }
    }

    // --- the RFC 8707 resource indicator ---

    /** Answers discovery, then hands back a token for whatever is exchanged. */
    private fun oauthReply(request: Recorded, index: Int): Reply =
        if (request.path == "/.well-known/oauth-authorization-server") {
            val fields = listOf(
                """"issuer":"$BASE"""",
                """"authorization_endpoint":"$BASE/oauth/authorize"""",
                """"token_endpoint":"$BASE/oauth/token"""",
                """"registration_endpoint":"$BASE/oauth/register"""",
            )
            Reply.json(fields.joinToString(",", prefix = "{", postfix = "}"))
        } else {
            Reply.json(
                """{"access_token":"at","token_type":"Bearer","expires_in":3600,"scope":"library:read"}"""
            )
        }

    /** The path the contract gives for one `oauth` operation. */
    private fun oauthPath(operation: String): String {
        val rows = fixture("endpoints.json")["resources"]!!.jsonObject["oauth"] as JsonArray
        val row = rows.map { it.jsonObject }.firstOrNull {
            it["operation"]!!.jsonPrimitive.content == operation
        } ?: fail("the contract names no oauth.$operation")
        return row["path"]!!.jsonPrimitive.content
    }

    @Test
    fun `the resource indicator travels on both legs or neither`() = runTest {
        val cases = fixture("endpoints.json")["oauthResourceIndicator"]!!
            .jsonObject["cases"] as JsonArray

        for (case in cases) {
            val item = case.jsonObject
            val name = item["name"]!!.jsonPrimitive.content
            val resource = item["resource"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.content }
            val stub = Stub(::oauthReply)

            OAuthClient(BASE, stub.engine).use { oauth ->
                val pending = oauth.beginAuthorization(
                    "CLIENT", "app://callback", listOf("library:read"), resource
                )

                assertEquals(
                    expected(item["expectAuthorizationParam"]!!),
                    Url(pending.authorizationUrl).parameters["resource"],
                    "$name: the authorization request",
                )

                val before = stub.callCount
                oauth.completeAuthorization(
                    pending, "app://callback?code=CODE&state=${pending.state}"
                )

                val body = String(stub.calls[before].body)
                assertEquals(
                    expected(item["expectTokenParam"]!!),
                    parseQueryString(body)["resource"],
                    "$name: the token request",
                )
            }
        }
    }

    @Test
    fun `each resource identifier is read from its document`() = runTest {
        val identifiers = fixture("endpoints.json")["oauthResourceIndicator"]!!
            .jsonObject["identifiers"]!!.jsonObject
        val root = identifiers["root"]!!.jsonPrimitive.content
        val mcp = identifiers["mcp"]!!.jsonPrimitive.content

        val stub = Stub { request, _ ->
            // Answers with the identifier for whichever document was asked for, so a
            // client that read the wrong one is caught by the value and not just by the
            // path.
            val resource = if (request.path.endsWith("/mcp")) mcp else root
            Reply.json("""{"resource":"$resource"}""")
        }

        OAuthClient(BASE, stub.engine).use { oauth ->
            assertEquals(root, oauth.discoverProtectedResource().resource)
            assertEquals(mcp, oauth.discoverProtectedResource(ProtectedResourcePath.MCP).resource)
        }

        assertEquals(
            listOf(oauthPath("protectedResource"), oauthPath("protectedResourceMcp")),
            stub.calls.map { it.path },
        )
    }

    /**
     * Pairing must stay unbound, and the reason is not visible from the call site.
     *
     * `/api/v1/pairing/claim` mints its authorization code server-side and cannot record a
     * resource, so a token request naming one is refused — every paired device breaks at
     * once. Nothing in [OAuthClient.pair] itself says so, which is why this is pinned
     * here: pushing `resource` down into the shared exchange helper would do it silently.
     */
    @Test
    fun `pairing names no resource`() = runTest {
        val stub = Stub { request, index ->
            when (request.path) {
                "/oauth/register" -> Reply.json("""{"client_id":"CLIENT"}""")
                "/api/v1/pairing/claim" -> Reply.json(
                    """{"code":"ac_x","redirectUri":"imogen://oauth","scope":"library:read"}"""
                )
                else -> oauthReply(request, index)
            }
        }

        OAuthClient(BASE, stub.engine).use { oauth ->
            oauth.pair("imog_pair_x", "A Device", "imogen://oauth")
        }

        val exchanges = stub.calls.filter { it.path == "/oauth/token" }
        assertTrue(exchanges.isNotEmpty(), "pairing did not reach the token endpoint")
        for (call in exchanges) {
            assertNull(parseQueryString(String(call.body))["resource"])
        }
    }

    private fun expected(value: JsonElement): String? =
        if (value is JsonNull) null else value.jsonPrimitive.content

    companion object {
        const val BASE = "https://photos.example.test"

        /**
         * The round trip needs nulls written out, unlike the wire encoder, which drops them
         * so a patch carries only what it means to change.
         */
        val roundTripJson = Json {
            ignoreUnknownKeys = true
            encodeDefaults = true
            explicitNulls = true
        }

        val PLACEHOLDERS = mapOf(
            "{assetId}" to "ASSET",
            "{albumId}" to "ALBUM",
            "{personId}" to "PERSON",
            "{faceId}" to "FACE",
            "{userId}" to "USER",
            "{inviteId}" to "INVITE",
            "{jobId}" to "JOB",
            "{clientId}" to "CLIENT",
            "{sessionId}" to "SESSION",
            "{shareId}" to "SHARE",
            "{ticketId}" to "TICKET",
            "{variant}" to "thumbnail",
        )
    }
}
