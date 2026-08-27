@file:Suppress("unused")

package com.imogen.sdk

/**
 * The imogen client.
 *
 * ```kotlin
 * val imogen = ImogenClient("https://photos.example.com", token = "…")
 * val page = imogen.assets.list(AssetQuery(q = "harbour", limit = 50))
 * ```
 *
 * In a context served by imogen itself, omit the token: the session cookie is enough.
 */
class ImogenClient(options: ClientOptions) : AutoCloseable {
    val http: HttpClient = HttpClient(options)
    val assets: Assets = Assets(http)
    val albums: Albums = Albums(http)
    val admin: Admin = Admin(http)
    val auth: Auth = Auth(http)
    val vault: Vault = Vault(http)
    val people: People = People(http)
    val pairing: Pairing = Pairing(http)

    constructor(baseUrl: String, token: String? = null) : this(
        ClientOptions(baseUrl = baseUrl, token = token?.let { { it } })
    )

    val baseUrl: String get() = http.baseUrl

    /** Confirms the server is reachable and reports its version. */
    suspend fun health(): Health = http.request("GET", "/api/v1/health")

    override fun close() = http.close()
}
