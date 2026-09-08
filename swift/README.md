# ImogenSDK (Swift)

Swift client for the [imogen](https://github.com/ergofobe/imogen-server) photo library API.

```swift
.package(url: "https://github.com/ergofobe/imogen-sdk.git", from: "0.4.1")
```

The package lives in the `swift/` directory of that repository. Requires macOS 13, iOS 16,
tvOS 16 or watchOS 9.

## Getting started

```swift
import ImogenSDK

let imogen = ImogenClient(baseURL: "https://photos.example.com", token: "…")

let page = try await imogen.assets.list(AssetQuery(q: "harbour", limit: 50))
for asset in page.items {
    print(asset.id, asset.originalFilename)
}
```

Omit the token in a context that already holds a session cookie.

## Walking the library

`iterate` follows the cursor for you, so a library of any size is one `for try await`:

```swift
for try await asset in imogen.assets.iterate(AssetQuery(favorite: true)) {
    print(asset.capturedAt, asset.originalFilename)
}
```

## Showing photographs

`url(for:variant:)` builds a URL without making a request, which is what an `AsyncImage`
wants. In a context holding a session cookie the system sends it for you; elsewhere use
`data(_:variant:)`, which attaches the Authorization header.

```swift
AsyncImage(url: URL(string: imogen.assets.url(for: asset.id, variant: .thumbnail))!)
```

## Uploading

`upload` picks the protocol by size. Files at or above 64 MB use a resumable session, so a
dropped connection costs one 8 MB chunk rather than the whole video.

```swift
let options = UploadOptions(onProgress: { progress in
    print(Double(progress.loaded) / Double(progress.total))
})

let result = try await imogen.assets.upload(fileURL, options: options)
print(result.duplicate ? "already had it" : "stored")
```

`uploadMany` runs six at a time and lets each file settle on its own, so one bad photo in a
folder of three thousand does not abandon the rest:

```swift
let outcomes = await imogen.assets.uploadMany(urls)
let failed = outcomes.filter { $0.error != nil }
```

## Errors

Every rejection arrives as `ImogenError`, so there is one thing to catch:

```swift
do {
    let asset = try await imogen.assets.get(assetId)
} catch let error as ImogenError {
    if error.isAuthError {
        // sign in again
    } else if let details = error.details {
        // field-level validation detail, path -> messages
    }
}
```

Transient failures (429, 5xx, a dropped connection) are retried twice with exponential
backoff and full jitter. Rejections the server will keep making are not retried, and
neither is a request carrying a multipart body — replaying it would mean holding the whole
file to send it twice.

## Supplying a token that changes

`ClientOptions` takes an async closure rather than a string when the token lives in the
keychain, and a second one to be given a single chance to refresh when the server rejects
the current one:

```swift
let imogen = ImogenClient(options: ClientOptions(
    baseURL: "https://photos.example.com",
    token: { await keychain.accessToken() },
    onUnauthorized: { await keychain.refresh() }
))
```

## Signing in as an application

`OAuthClient` runs OAuth 2.1 with PKCE, including RFC 7591 dynamic registration, so an app
never ships a hard-coded client id and never holds a secret:

```swift
let oauth = OAuthClient(baseURL: "https://photos.example.com")
let registered = try await oauth.register(name: "My Photo App", redirectURIs: ["myapp://oauth"])
let pending = try await oauth.beginAuthorization(
    clientId: registered.clientId, redirectURI: "myapp://oauth"
)
// open pending.authorizationURL with ASWebAuthenticationSession, then on the callback:
let stored = try await oauth.completeAuthorization(pending, callbackURL: callback)
```

Hold `pending` until the redirect comes back — it carries the PKCE verifier and the state
that stops a code from another session being injected.

By default the token is valid at every surface. Passing the RFC 8707 `resource` binds it
to one and gets it refused everywhere else. Read the identifier rather than building it —
the server compares against the one spelling it publishes:

```swift
let mcp = try await oauth.discoverProtectedResource(.mcp)
let pending = try await oauth.beginAuthorization(
    clientId: registered.clientId, redirectURI: "myapp://oauth", resource: mcp.resource
)
```

`resource` travels on the authorization request and the token exchange together, carried on
`pending` so the two cannot disagree — the server refuses a token request naming a resource
the authorization code did not record.

## A note on types

Timestamps are `String`, not `Date`. The contract specifies ISO-8601 and nothing else, and
a client that reformats on the way through is a client that eventually sends back something
the server did not give it. Parse them at the edge of your own code with
`ISO8601DateFormatter` if you need to.

## Development

```bash
swift build
swift run ImogenSDKConformance
```

The conformance suite is an executable rather than an XCTest bundle. XCTest is absent on a
machine with only the Command Line Tools installed, and a contract worth checking should be
checkable with nothing but a toolchain. It prints its cases and exits non-zero on failure,
which is all a test framework was providing.

It runs against the shared fixtures in `../conformance` — the same ones the TypeScript,
Rust, Python and Kotlin clients are checked against — and stubs the network with a
`URLProtocol` rather than opening a socket.

## Licence

AGPL-3.0-or-later.
