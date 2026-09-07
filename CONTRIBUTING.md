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

The TypeScript suite shells out to `npm pack` to check what the published tarball contains,
so it needs node and npm on the path alongside bun.

```bash
cd typescript && bun install && bun run verify
cd rust       && cargo test && cargo clippy --all-targets && cargo fmt --check
cd python     && uv sync && uv run pytest && uv run ruff check && uv run ruff format --check .
cd swift      && swift run ImogenSDKConformance
cd kotlin     && ./gradlew build
```

## Consuming the TypeScript packages from a checkout

`main`, `types` and the default export condition all point into `typescript/packages/*/dist`,
which is generated and gitignored. A consumer that resolves this repository from a
checkout rather than the registry — `imogen-server` does, with `file:` overrides pointing
at the `imogen-sdk/` git submodule inside its own tree — therefore has to build it first:

```bash
cd typescript && bun install && bun run build          # in imogen-sdk
bun install --force                                    # in the consumer
```

The second line is not optional: bun *copies* a `file:` dependency rather than symlinking
it, so a consumer that installed before the build keeps its dist-less copy and nothing you
do in this repository reaches it.

Skipping either fails in an unhelpfully asymmetric way: the `bun` export condition still
resolves to TypeScript source, so the consumer's tests pass while its `tsc` reports
`Cannot find module '@imogen/sdk'`.

## Bumping a version

The five ports move in lockstep, and inside `typescript/` the version is written in four
places: `package.json`, `packages/shared/package.json`, `packages/sdk/package.json`, and the
exact range `@imogen/sdk` pins shared at. They have to move in the same commit.

Two different things go wrong if they drift. `bun install` resolves the sibling from the
workspace only while shared's version and sdk's range agree, and looks for the range on npm
when they do not — which fails the install, before any test can run. And publishing a
half-bumped pair puts shared's new version on the registry while sdk is rejected as a
duplicate of the old one, leaving the two split across versions. `packaging.test.ts` covers
both.

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
