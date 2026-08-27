@file:Suppress("unused")

package com.imogen.sdk

import io.ktor.client.HttpClient as KtorClient
import io.ktor.client.request.forms.submitForm
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.URLBuilder
import io.ktor.http.Url
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import io.ktor.http.parameters
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

/** Hold these until the redirect comes back; they complete the exchange. */
data class PendingAuthorization(
    val authorizationUrl: String,
    val codeVerifier: String,
    val state: String,
    val redirectUri: String,
    val clientId: String,
)

data class StoredTokens(
    val tokens: TokenResponse,
    /** Unix milliseconds, so expiry is computable without keeping the clock that read it. */
    val obtainedAt: Long,
) {
    /** True when the access token is expired or close enough that it should be refreshed. */
    fun isExpired(skewSeconds: Long = 60): Boolean =
        System.currentTimeMillis() >= obtainedAt + maxOf(0, tokens.expiresIn - skewSeconds) * 1000
}

class OAuthException(message: String) : Exception(message)

/** What comes back from [OAuthClient.pair]: an account, and the client it belongs to. */
data class PairedDevice(
    /** Registered for this device alone. Needed again to refresh. */
    val clientId: String,
    val tokens: StoredTokens,
    val scope: String,
)

/**
 * The OAuth 2.1 client a native application needs: discover the server, register itself, run
 * authorization code with PKCE, and refresh. No client secret is involved, because a secret
 * shipped inside a mobile app is not a secret.
 *
 * ```kotlin
 * val oauth = OAuthClient("https://photos.example.com")
 * val registered = oauth.register("My Photo App", listOf("myapp://oauth"))
 * val pending = oauth.beginAuthorization(registered.clientId, "myapp://oauth")
 * // open pending.authorizationUrl in the system browser, then on the callback:
 * val stored = oauth.completeAuthorization(pending, callbackUrl)
 * ```
 */
class OAuthClient(baseUrl: String, engine: KtorClient? = null) : AutoCloseable {
    private val baseUrl = baseUrl.trimEnd('/')
    private val ownsClient = engine == null
    private val http = engine ?: KtorClient()
    private val lock = Mutex()
    private var metadata: AuthorizationServerMetadata? = null

    suspend fun discover(): AuthorizationServerMetadata = lock.withLock {
        metadata?.let { return it }

        val response = http.get("$baseUrl/.well-known/oauth-authorization-server")
        if (!response.status.isSuccess()) {
            throw OAuthException("Could not read the authorization server metadata")
        }

        wireJson.decodeFromString<AuthorizationServerMetadata>(response.bodyAsText())
            .also { metadata = it }
    }

    /** RFC 7591 dynamic registration, so an app never ships a hard-coded client id. */
    suspend fun register(
        name: String,
        redirectUris: List<String>,
        scopes: List<String> = DEFAULT_SCOPES,
    ): ClientRegistrationResponse {
        val metadata = discover()
        val response = http.post(metadata.registrationEndpoint) {
            contentType(ContentType.Application.Json)
            setBody(
                jsonBody(
                    "client_name" to name,
                    "redirect_uris" to redirectUris,
                    "token_endpoint_auth_method" to "none",
                    "grant_types" to listOf("authorization_code", "refresh_token"),
                    "response_types" to listOf("code"),
                    "scope" to scopes.joinToString(" "),
                )
            )
        }

        if (!response.status.isSuccess()) {
            throw OAuthException("Registration failed: ${response.bodyAsText()}")
        }
        return wireJson.decodeFromString(response.bodyAsText())
    }

    suspend fun beginAuthorization(
        clientId: String,
        redirectUri: String,
        scopes: List<String> = DEFAULT_SCOPES,
    ): PendingAuthorization {
        val metadata = discover()
        val codeVerifier = randomString(32)
        val state = randomString(16)

        val builder = URLBuilder(metadata.authorizationEndpoint)
        builder.parameters.apply {
            append("response_type", "code")
            append("client_id", clientId)
            append("redirect_uri", redirectUri)
            append("scope", scopes.joinToString(" "))
            append("state", state)
            append("code_challenge", s256(codeVerifier))
            append("code_challenge_method", "S256")
        }

        return PendingAuthorization(
            authorizationUrl = builder.buildString(),
            codeVerifier = codeVerifier,
            state = state,
            redirectUri = redirectUri,
            clientId = clientId,
        )
    }

    suspend fun completeAuthorization(
        pending: PendingAuthorization,
        callbackUrl: String,
    ): StoredTokens {
        val parameters = Url(callbackUrl).parameters

        parameters["error"]?.let { error ->
            throw OAuthException(
                parameters["error_description"] ?: "Authorization failed: $error"
            )
        }
        // Checking state is what stops a code from another session being injected here.
        if (parameters["state"] != pending.state) {
            throw OAuthException(
                "Authorization state did not match; the response may have been tampered with"
            )
        }
        val code = parameters["code"]
            ?: throw OAuthException("The callback carried no authorization code")

        return exchange(
            mapOf(
                "grant_type" to "authorization_code",
                "client_id" to pending.clientId,
                "code" to code,
                "code_verifier" to pending.codeVerifier,
                "redirect_uri" to pending.redirectUri,
            )
        )
    }

    /**
     * The whole pairing sequence, from a scanned QR code to tokens.
     *
     * Registers a client for this device, spends the pairing code on an authorization code,
     * and exchanges it. The verifier never leaves this process, so the pairing code on its
     * own — photographed off somebody's screen, say — cannot be turned into a session.
     *
     * ```kotlin
     * val invitation = parsePairingUri(scanned) ?: return
     * val oauth = OAuthClient(invitation.serverUrl)
     * val paired = oauth.pair(invitation.code, "imogen for Android", "imogen://oauth", Build.MODEL)
     * ```
     */
    suspend fun pair(
        pairingCode: String,
        clientName: String,
        redirectUri: String,
        deviceName: String? = null,
        scopes: List<String> = DEFAULT_SCOPES,
    ): PairedDevice {
        val registered = register(clientName, listOf(redirectUri), scopes)
        val verifier = randomString(32)

        val response = http.post("$baseUrl/api/v1/pairing/claim") {
            contentType(ContentType.Application.Json)
            setBody(
                wireJson.encodeToString(
                    PairingClaimRequest(
                        code = pairingCode,
                        clientId = registered.clientId,
                        redirectUri = redirectUri,
                        codeChallenge = s256(verifier),
                        scope = scopes.joinToString(" "),
                        deviceName = deviceName,
                    )
                )
            )
        }
        if (!response.status.isSuccess()) {
            // The imogen error envelope, not the OAuth one: this is an API route.
            val described = runCatching {
                wireJson.parseToJsonElement(response.bodyAsText())
                    .jsonObject["error"]?.jsonObject?.get("message")?.jsonPrimitive?.content
            }.getOrNull()
            throw OAuthException(described ?: "That pairing code could not be used")
        }

        val claim = wireJson.decodeFromString<PairingClaim>(response.bodyAsText())
        val tokens = exchange(
            mapOf(
                "grant_type" to "authorization_code",
                "client_id" to registered.clientId,
                "code" to claim.code,
                "code_verifier" to verifier,
                "redirect_uri" to claim.redirectUri,
            )
        )
        return PairedDevice(registered.clientId, tokens, claim.scope)
    }

    suspend fun refresh(clientId: String, refreshToken: String): StoredTokens = exchange(
        mapOf(
            "grant_type" to "refresh_token",
            "client_id" to clientId,
            "refresh_token" to refreshToken,
        )
    )

    suspend fun revoke(token: String) {
        val metadata = discover()
        runCatching {
            http.submitForm(
                metadata.revocationEndpoint,
                parameters { append("token", token) },
            )
        }
    }

    private suspend fun exchange(params: Map<String, String>): StoredTokens {
        val metadata = discover()
        val response = http.submitForm(
            metadata.tokenEndpoint,
            parameters { params.forEach { (key, value) -> append(key, value) } },
        )

        if (!response.status.isSuccess()) {
            val body = response.bodyAsText()
            val described = runCatching {
                val json = wireJson.parseToJsonElement(body).jsonObject
                (json["error_description"] ?: json["error"])?.jsonPrimitive?.content
            }.getOrNull() ?: "Token request failed"
            throw OAuthException(described)
        }

        return StoredTokens(
            tokens = wireJson.decodeFromString(response.bodyAsText()),
            obtainedAt = System.currentTimeMillis(),
        )
    }

    override fun close() {
        if (ownsClient) http.close()
    }
}

private val encoder: Base64.Encoder = Base64.getUrlEncoder().withoutPadding()
private val random = SecureRandom()

internal fun randomString(byteLength: Int): String {
    val bytes = ByteArray(byteLength)
    random.nextBytes(bytes)
    return encoder.encodeToString(bytes)
}

internal fun s256(verifier: String): String =
    encoder.encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray()))
