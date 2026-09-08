# imogen-sdk (Kotlin)

Kotlin client for the [imogen](https://github.com/ergofobe/imogen-server) photo library
API. JVM, Java 21 or later.

```kotlin
dependencies {
    implementation("com.imogen:imogen-sdk:0.4.1")
    // Pick a ktor engine. CIO has no further dependencies; OkHttp is the usual choice
    // on Android.
    runtimeOnly("io.ktor:ktor-client-cio:3.0.3")
}
```

## Getting started

```kotlin
import com.imogen.sdk.AssetQuery
import com.imogen.sdk.ImogenClient

ImogenClient("https://photos.example.com", token = "…").use { imogen ->
    val page = imogen.assets.list(AssetQuery(q = "harbour", limit = 50))
    page.items.forEach { println("${it.id} ${it.originalFilename}") }
}
```

Every call is a `suspend` function. Omit the token in a context that already holds a
session cookie.

## Walking the library

`iterate` follows the cursor for you and returns a `Flow`, so a library of any size is one
`collect`:

```kotlin
imogen.assets.iterate(AssetQuery(favorite = true)).collect { asset ->
    println("${asset.capturedAt} ${asset.originalFilename}")
}
```

## Uploading

`upload` picks the protocol by size. Files at or above 64 MB use a resumable session, so a
dropped connection costs one 8 MB chunk rather than the whole video.

```kotlin
val result = imogen.assets.upload(
    File("holiday.mov"),
    UploadOptions(onProgress = { println("${it.loaded * 100 / it.total}%") }),
)
println(if (result.duplicate) "already had it" else "stored")
```

`uploadMany` runs six at a time and lets each file settle on its own, so one bad photo in a
folder of three thousand does not abandon the rest:

```kotlin
val outcomes = imogen.assets.uploadMany(files)
val failed = outcomes.filter { it.error != null }
```

## Errors

Every rejection arrives as `ImogenException`, so there is one thing to catch:

```kotlin
try {
    imogen.assets.get(assetId)
} catch (error: ImogenException) {
    when {
        error.isAuthError -> signInAgain()
        error.details != null -> showFieldErrors(error.details)
        else -> report(error)
    }
}
```

Transient failures (429, 5xx, a dropped connection) are retried twice with exponential
backoff and full jitter. Rejections the server will keep making are not retried, and
neither is a request carrying a multipart body — replaying it would mean holding the whole
file to send it twice.

## Supplying a token that changes

`ClientOptions` takes suspending lambdas when the token lives behind storage, and a second
one to be given a single chance to refresh when the server rejects the current one:

```kotlin
ImogenClient(
    ClientOptions(
        baseUrl = "https://photos.example.com",
        token = { store.accessToken() },
        onUnauthorized = { store.refresh() },
    )
).use { imogen -> /* … */ }
```

## Signing in as an application

`OAuthClient` runs OAuth 2.1 with PKCE, including RFC 7591 dynamic registration, so an app
never ships a hard-coded client id and never holds a secret:

```kotlin
OAuthClient("https://photos.example.com").use { oauth ->
    val registered = oauth.register("My Photo App", listOf("myapp://oauth"))
    val pending = oauth.beginAuthorization(registered.clientId, "myapp://oauth")
    // open pending.authorizationUrl in a Custom Tab, then on the callback:
    val stored = oauth.completeAuthorization(pending, callbackUrl)
}
```

Hold `pending` until the redirect comes back — it carries the PKCE verifier and the state
that stops a code from another session being injected.

By default the token is valid at every surface. Passing the RFC 8707 `resource` binds it
to one and gets it refused everywhere else. Read the identifier rather than building it —
the server compares against the one spelling it publishes:

```kotlin
val mcp = oauth.discoverProtectedResource(ProtectedResourcePath.MCP)
val pending = oauth.beginAuthorization(
    registered.clientId, "myapp://oauth", resource = mcp.resource
)
```

`resource` travels on the authorization request and the token exchange together, carried on
`pending` so the two cannot disagree — the server refuses a token request naming a resource
the authorization code did not record.

## A note on types

Timestamps are `String`, not `Instant`. The contract specifies ISO-8601 and nothing else,
and a client that reformats on the way through is a client that eventually sends back
something the server did not give it. Parse them at the edge of your own code if you need
to.

Requests are serialised with nulls dropped, so a patch carries only the fields it means to
change rather than blanking everything it did not mention.

## Development

```bash
./gradlew build
```

The tests run against the shared fixtures in `../conformance` — the same ones the
TypeScript, Rust, Python and Swift clients are checked against — and stub the network with
ktor's `MockEngine` rather than opening a socket.

Toolchain resolution goes through the foojay resolver, so asking for JDK 21 does not
require that exact JDK to already be installed and discoverable.

## Licence

AGPL-3.0-or-later.
