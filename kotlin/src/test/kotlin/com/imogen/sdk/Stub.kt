package com.imogen.sdk

import io.ktor.client.HttpClient as KtorClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.utils.io.ByteChannel
import io.ktor.utils.io.readRemaining
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.io.readByteArray

/**
 * A stub imogen, built on ktor's MockEngine.
 *
 * The conformance suite needs a server that records what it was asked and answers
 * predictably. Intercepting the client's engine gets that without opening a socket, which
 * keeps the tests free of anything the library itself does not already depend on.
 */

data class Recorded(
    val method: String,
    val path: String,
    val query: String,
    val headers: Map<String, String>,
    val body: ByteArray,
) {
    // Data classes with an array member need these written out to compare sensibly.
    override fun equals(other: Any?): Boolean = this === other

    override fun hashCode(): Int = System.identityHashCode(this)
}

data class Reply(val status: Int = 200, val body: String = "{}") {
    companion object {
        fun json(body: String) = Reply(200, body)
        fun status(status: Int, body: String) = Reply(status, body)
    }
}

class Stub(private val responder: (Recorded, Int) -> Reply) {
    val calls: MutableList<Recorded> = mutableListOf()

    val callCount: Int get() = calls.size

    val engine: KtorClient = KtorClient(
        MockEngine { request ->
            val recorded = record(request)
            val index = synchronized(calls) {
                calls.add(recorded)
                calls.size - 1
            }
            val reply = responder(recorded, index)

            respond(
                content = reply.body,
                status = HttpStatusCode.fromValue(reply.status),
                headers = headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString()),
            )
        }
    )

    private suspend fun record(request: HttpRequestData): Recorded {
        val body = runCatching {
            request.body.toByteArrayOrEmpty()
        }.getOrDefault(ByteArray(0))

        return Recorded(
            method = request.method.value,
            path = request.url.encodedPath,
            query = request.url.encodedQuery,
            headers = request.headers.entries().associate { it.key.lowercase() to it.value.first() },
            body = body,
        )
    }
}

private suspend fun io.ktor.http.content.OutgoingContent.toByteArrayOrEmpty(): ByteArray =
    when (this) {
        is io.ktor.http.content.OutgoingContent.ByteArrayContent -> bytes()
        is io.ktor.http.content.OutgoingContent.ReadChannelContent ->
            readFrom().readRemaining().readByteArray()
        // A multipart form is written rather than read, so it needs somewhere to be
        // written to before there is anything to record. Concurrently, because a body
        // larger than the channel's buffer would otherwise deadlock against itself.
        is io.ktor.http.content.OutgoingContent.WriteChannelContent -> coroutineScope {
            val channel = ByteChannel()
            launch {
                writeTo(channel)
                channel.flushAndClose()
            }
            channel.readRemaining().readByteArray()
        }
        else -> ByteArray(0)
    }
