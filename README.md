# imogen SDK

Client libraries for the [imogen](https://github.com/ergofobe/imogen-server) photo library
API, in TypeScript, Rust, Python, Swift and Kotlin.

| Language | Package | Path |
| --- | --- | --- |
| TypeScript | `@imogen/sdk` | [`typescript/`](typescript/) |
| Rust | `imogen-sdk` | [`rust/`](rust/) |
| Python | `imogen-sdk` | [`python/`](python/) |
| Swift | `ImogenSDK` | [`swift/`](swift/) |
| Kotlin | `com.imogen:imogen-sdk` | [`kotlin/`](kotlin/) |

Each has its own README with installation and worked examples.

## The same client, five times

Every port has the same shape, because the API has one shape:

```
imogen.assets    photos and videos, search, upload, the trash
imogen.albums    collections, and the links that publish them
imogen.people    face grouping, when the server has it switched on
imogen.vault     photographs kept out of the library entirely
imogen.auth      signing in, and who you are
imogen.admin     accounts, invitations, the work queue, storage, settings
```

Underneath each of them is one transport that owns URL building, authentication, the error
envelope and the retry policy. The resources above it contain no HTTP at all. That is why
five ports can stay in step: there is only one place per language where the wire is
touched.

Naming follows each language rather than the JSON. `originalFilename` in TypeScript is
`original_filename` in Rust and Python, and `originalFilename` again in Swift and Kotlin.
Nothing in calling code has to know which side of that line it is on.

## What is shared

[`conformance/`](conformance/) holds the contract as data, and every port's test suite
reads it:

- **`endpoints.json`** — the operation table. Each port asserts its client produces exactly
  these method and path pairs, and fails if the contract names an operation the client
  cannot perform.
- **`models.json`** — a canonical payload for every model, with the fields that must
  survive a decode-and-re-encode round trip. A field renamed, retyped, or wrongly made
  non-nullable fails here.
- **`errors.json`** — the error envelope, the status-to-classification map that drives
  retries and token refresh, and the upload tuning every client must agree on.

This is the answer to the obvious problem with five clients: they drift. A mocked test
proves a client agrees with itself. These fixtures prove the five agree with each other.

They do not prove the *server* agrees. That is
[`api/sdk-contract.test.ts`](https://github.com/ergofobe/imogen-server) in the server
repository, which stands up a real app and drives it through the published TypeScript
client. The two halves are deliberately in different places, because each needs something
the other cannot supply.

## Design decisions the ports share

**Timestamps stay strings.** The contract specifies ISO-8601 and nothing else. A client
that parses into a date type and formats on the way back out eventually sends the server
something the server did not give it.

**Cursors, not offsets.** A timeline that grows while you scroll shifts every later page by
one on every upload. Each port exposes the paging as a stream — `AsyncGenerator`,
`Stream`, `AsyncIterator`, `AsyncThrowingStream`, `Flow` — so walking the whole library is
one loop.

**Uploads pick their protocol by size.** Files at or above 64 MB use a resumable session in
8 MB chunks, so a dropped connection costs one chunk rather than the whole video. Bulk
uploads run six at a time and let each file settle on its own: one bad photo in a folder of
three thousand does not abandon the rest.

**One error type.** Every rejection arrives as `ImogenError` (or `ImogenException`), with
the status, a stable code, and field-level detail for validation failures. Callers write
one catch rather than inspecting status codes at each call site.

**Retries are for transient failures only.** 429, 5xx and dropped connections are retried
twice with exponential backoff and full jitter — so a fleet of phones coming back after an
outage does not arrive in lockstep. A rejection the server will keep making is not retried.
Neither is a request carrying a multipart body, which would mean holding the whole file to
send it twice.

**OAuth without a secret.** Each port ships an OAuth 2.1 client doing authorization code
with PKCE and RFC 7591 dynamic registration, because a client secret shipped inside a
mobile app is not a secret.

## Working on it

Each port builds and tests on its own:

```bash
cd typescript && bun install && bun run verify
cd rust       && cargo test && cargo clippy --all-targets
cd python     && uv sync && uv run pytest
cd swift      && swift run ImogenSDKConformance
cd kotlin     && ./gradlew build
```

The Swift suite is an executable rather than an XCTest bundle: XCTest is absent on a
machine with only the Command Line Tools installed, and a contract worth checking should be
checkable with nothing but a toolchain.

**Changing the contract** means changing `conformance/` first. Every port will then fail
until it is brought into line, which is the intended order of events.

## Licence

AGPL-3.0-or-later.
