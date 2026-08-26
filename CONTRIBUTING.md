# Contributing

## The shape of the repository

Five clients for one API, plus the contract they share:

```
conformance/   the contract, as data — every port's tests read these files
typescript/    @imogen/sdk and @imogen/shared, a bun workspace
rust/          the imogen-sdk crate
python/        the imogen_sdk package
swift/         the ImogenSDK package
kotlin/        com.imogen:imogen-sdk
```

Each port is independent. Nothing imports anything from another language, and CI checks
each on its own, because each can break on its own.

## Running the suites

```bash
cd typescript && bun install && bun run verify
cd rust       && cargo test && cargo clippy --all-targets && cargo fmt --check
cd python     && uv sync && uv run pytest && uv run ruff check
cd swift      && swift run ImogenSDKConformance
cd kotlin     && ./gradlew build
```

## Changing the contract

Change `conformance/` first. Every port will then fail until it is brought into line, which
is the point — the fixtures exist so that drift shows up as a test failure in whichever
language drifted rather than as a bug report months later.

Adding an endpoint means adding a row to `endpoints.json` and then five implementations.
The endpoint test asserts that the contract names no operation the client cannot perform,
so a half-finished port fails loudly rather than quietly.

Adding or changing a model means updating `models.json`, including the `assert` block: the
fields listed there must survive a decode-and-re-encode round trip. That round trip is what
catches a field the type forgot, which would otherwise decode fine and vanish on the way
back out.

## What the fixtures do not cover

They pin down what the client *sends* and what it can *read*. Nothing here can prove the
server answers correctly — for that, see `api/sdk-contract.test.ts` in
[imogen-server](https://github.com/ergofobe/imogen-server), which stands up a real app and
drives it through the published TypeScript client.

If you change the wire format, both repositories need the change.

## Style

Match the surrounding code. Each port is written in its own language's idiom rather than
transliterated from the TypeScript: snake_case in Rust and Python, `Flow` in Kotlin,
`AsyncThrowingStream` in Swift. What stays identical across all five is the endpoint table,
the error classification, the retry policy, and the upload thresholds — the things a server
notices when a client disagrees.

Comments should say why, not what. If a decision looks odd, the comment explaining it is
worth more than the line it sits above.
