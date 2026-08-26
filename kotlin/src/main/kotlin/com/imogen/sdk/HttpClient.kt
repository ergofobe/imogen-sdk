package com.imogen.sdk

import io.ktor.client.HttpClient as KtorClient
import io.ktor.client.request.HttpRequestBuilder
import io.ktor.client.request.headers
import io.ktor.client.request.request
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.URLBuilder
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import io.ktor.util.StringValues
import kotlinx.coroutines.delay
import kotlinx.serialization.json.Json
import kotlin.math.pow
import kotlin.random.Random

/**
 * Every failure from the API arrives as one of these, so a caller writes one `catch` rather
 * than inspecting status codes at each call site.
 */
class ImogenException(
    val status: Int,
    val code: String,
    override val message: String,
    val details: Map<String, List<String>>? = null,
) : Exception(message) {

    /** True when re-sending the same request might succeed. */
    val isRetryable: Boolean get() = status == 429 || status >= 500

    val isAuthError: Boolean get() = status == 401 || status == 403

    override fun toString(): String = "ImogenException(status=$status, code=$code, message=$message)"

    companion object {
        /**
         * Builds the typed error from a rejection. A body that is not the envelope still
         * yields an [ImogenException], because callers should never have to handle two
         * shapes.
         */
        fun from(status: Int, reason: String, body: String): ImogenException {
            val envelope = runCatching {
                Json { ignoreUnknownKeys = true }.decodeFromString<ApiErrorEnvelope>(body)
            }.getOrNull()

            return if (envelope != null) {
                ImogenException(
                    status,
                    envelope.error.code,
                    envelope.error.message,
                    envelope.error.details,
                )
            } else {
                ImogenException(status, "http_error", "$status $reason".trim())
            }
        }
    }
}

/** Supplies a bearer token. Omit in a context that already holds a session cookie. */
typealias TokenProvider = suspend () -> String?

/** Called when the server rejects a token, so an app can refresh and retry once. */
typealias TokenRefresher = suspend () -> String?

data class ClientOptions(
    /** Where imogen lives, e.g. `https://photos.example.com`. */
    val baseUrl: String,
    val token: TokenProvider? = null,
    val onUnauthorized: TokenRefresher? = null,
    /** How many times to retry a request that failed for a transient reason. */
    val maxRetries: Int = 2,
    val engine: KtorClient? = null,
)

/** What a request carries beyond its method and path. */
class RequestOptions(
    val query: List<Pair<String, String>> = emptyList(),
    val body: Any? = null,
    val headers: Map<String, String> = emptyMap(),
    /** Set when the body is a multipart form, which cannot be replayed on a retry. */
    val isMultipart: Boolean = false,
)

/**
 * The transport every resource shares: URL building, auth, the error envelope, and one
 * retry policy. Resources above this layer contain no HTTP details at all.
 */
class HttpClient internal constructor(private val options: ClientOptions) : AutoCloseable {
    val baseUrl: String = options.baseUrl.trimEnd('/')
    private val ownsClient = options.engine == null
    // With no engine given, ktor finds one on the classpath.
    private val client: KtorClient = options.engine ?: KtorClient()

    fun url(path: String, query: List<Pair<String, String>> = emptyList()): String {
        val builder = URLBuilder(baseUrl + path)
        if (query.isNotEmpty()) {
            builder.parameters.appendAll(
                StringValues.build { query.forEach { (key, value) -> append(key, value) } }
            )
        }
        return builder.buildString()
    }

    /** Sends, decodes, and hands back the typed body. */
    suspend inline fun <reified T> request(
        method: String,
        path: String,
        options: RequestOptions = RequestOptions(),
    ): T {
        val text = requestText(method, path, options)
        if (text.isBlank()) return wireJson.decodeFromString<T>("null")
        return wireJson.decodeFromString<T>(text)
    }

    /** Sends and hands back the body as text, for callers that decode it themselves. */
    suspend fun requestText(
        method: String,
        path: String,
        options: RequestOptions = RequestOptions(),
    ): String = send(method, path, options).bodyAsText()

    /** Sends and hands back the raw response, for bytes rather than JSON. */
    suspend fun send(
        method: String,
        path: String,
        options: RequestOptions = RequestOptions(),
    ): HttpResponse {
        var last: Throwable? = null
        // A multipart body is not replayed: doing so would mean holding the whole file to
        // send it twice.
        val replayable = !options.isMultipart

        for (attempt in 0..this.options.maxRetries) {
            val response = try {
                perform(method, path, options)
            } catch (error: ImogenException) {
                throw error
            } catch (error: Throwable) {
                // A network failure is worth retrying; a rejection from the server is not.
                if (attempt == this.options.maxRetries || !replayable) throw error
                last = error
                backoff(attempt)
                continue
            }

            if (response.status == HttpStatusCode.Unauthorized && attempt == 0) {
                val refresh = this.options.onUnauthorized
                // Give the caller one chance to refresh, then try again.
                if (refresh != null && refresh() != null && replayable) continue
            }

            if (response.status.isSuccess()) return response

            val error = ImogenException.from(
                response.status.value,
                response.status.description,
                response.bodyAsText(),
            )
            if (error.isRetryable && attempt < this.options.maxRetries && replayable) {
                last = error
                backoff(attempt)
                continue
            }
            throw error
        }

        throw last ?: ImogenException(0, "http_error", "Request failed")
    }

    private suspend fun perform(
        method: String,
        path: String,
        options: RequestOptions,
    ): HttpResponse = client.request(url(path, options.query)) {
        this.method = HttpMethod.parse(method)
        applyBody(options)

        headers {
            options.headers.forEach { (key, value) -> append(key, value) }
        }
        this@HttpClient.options.token?.invoke()?.takeIf { it.isNotEmpty() }?.let {
            headers { append("Authorization", "Bearer $it") }
        }
    }

    private fun HttpRequestBuilder.applyBody(options: RequestOptions) {
        val body = options.body ?: return
        if (!options.isMultipart && body !is ByteArray && options.headers["Content-Type"] == null) {
            contentType(ContentType.Application.Json)
        }
        setBody(body)
    }

    override fun close() {
        if (ownsClient) client.close()
    }

    private suspend fun backoff(attempt: Int) = delay(backoffDelayMillis(attempt))
}

/**
 * Exponential backoff with full jitter, so a fleet of phones retrying after an outage does
 * not arrive in lockstep.
 */
fun backoffDelayMillis(attempt: Int): Long {
    val base = 250.0 * 2.0.pow(attempt)
    return (base + Random.nextDouble() * base).toLong()
}
