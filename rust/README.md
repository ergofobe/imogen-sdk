# imogen-sdk (Rust)

Rust client for the [imogen](https://github.com/ergofobe/imogen-server) photo library API.

```toml
[dependencies]
imogen-sdk = "0.1"
tokio = { version = "1", features = ["macros", "rt-multi-thread"] }
```

## Getting started

```rust
use imogen_sdk::{AssetQuery, ClientOptions, ImogenClient};

#[tokio::main]
async fn main() -> imogen_sdk::Result<()> {
    let imogen = ImogenClient::new(
        ClientOptions::new("https://photos.example.com").token("…"),
    );

    let page = imogen
        .assets
        .list(&AssetQuery { q: Some("harbour".into()), limit: Some(50), ..Default::default() })
        .await?;

    for asset in page.items {
        println!("{} {}", asset.id, asset.original_filename);
    }
    Ok(())
}
```

Omit the token in a context that already holds a session cookie.

## Walking the library

`iterate` follows the cursor for you and yields a `Stream`, so a library of any size is one
loop:

```rust
use futures::StreamExt;

let mut assets = imogen.assets.iterate(&AssetQuery { favorite: Some(true), ..Default::default() });
while let Some(asset) = assets.next().await {
    let asset = asset?;
    println!("{} {}", asset.captured_at, asset.original_filename);
}
```

`list_all` collects the same thing into a `Vec` when the library is small enough to hold.

## Uploading

`upload` picks the protocol by size. Files at or above 64 MB use a resumable session, so a
dropped connection costs one 8 MB chunk rather than the whole video.

```rust
use std::sync::Arc;
use imogen_sdk::{UploadOptions, UploadProgress};

let options = UploadOptions::new().on_progress(Arc::new(|p: UploadProgress| {
    println!("{}%", p.loaded * 100 / p.total.max(1));
}));

let result = imogen.assets.upload(Path::new("holiday.mov"), &options).await?;
println!("{}", if result.duplicate { "already had it" } else { "stored" });
```

`upload_many` runs six at a time and lets each file settle on its own, so one bad photo in
a folder of three thousand does not abandon the rest:

```rust
let outcomes = imogen.assets.upload_many(&paths, &Default::default()).await;
let failed: Vec<_> = outcomes.iter().filter(|o| o.result.is_err()).collect();
```

## Errors

Every rejection arrives as `Error::Api`, so there is one thing to match on:

```rust
match imogen.assets.get(asset_id).await {
    Ok(asset) => { /* … */ }
    Err(error) if error.is_auth_error() => { /* sign in again */ }
    Err(error) => {
        eprintln!("{} ({:?})", error, error.code());
        if let Some(details) = error.details() {
            // field-level validation detail, path -> messages
        }
    }
}
```

Transient failures (429, 5xx, a dropped connection) are retried twice with exponential
backoff and full jitter. Rejections the server will keep making are not retried, and
neither is a request carrying a multipart body — replaying it would mean buffering the
whole file to send it twice.

## Supplying a token that changes

Implement `TokenSource` when the token lives behind a keychain or a refresh loop, and
`RefreshToken` to be given one chance to refresh when the server rejects the current one:

```rust
let options = ClientOptions::new(base)
    .token_source(Arc::new(MyKeychain))
    .on_unauthorized(Arc::new(MyRefresher));
```

## Signing in as an application

`OAuthClient` runs OAuth 2.1 with PKCE, including RFC 7591 dynamic registration, so an app
never ships a hard-coded client id and never holds a secret:

```rust
let oauth = imogen_sdk::OAuthClient::new("https://photos.example.com");
let registered = oauth.register("My Photo App", &["myapp://oauth".into()], None).await?;
let pending = oauth
    .begin_authorization(&registered.client_id, "myapp://oauth", None, None)
    .await?;
// open pending.authorization_url in the system browser, then on the callback:
let stored = oauth.complete_authorization(&pending, &callback_url).await?;
```

Hold `pending` until the redirect comes back — it carries the PKCE verifier and the state
that stops a code from another session being injected.

The last argument is the RFC 8707 `resource`. `None` asks for a token valid at every
surface; naming one binds the token to it and gets it refused everywhere else. Read the
identifier rather than building it — the server compares against the one spelling it
publishes:

```rust
let mcp = oauth
    .discover_protected_resource(imogen_sdk::ProtectedResourcePath::Mcp)
    .await?;
let pending = oauth
    .begin_authorization(&registered.client_id, "myapp://oauth", None, Some(&mcp.resource))
    .await?;
```

## A note on types

Timestamps are `String`, not a date type. The contract specifies ISO-8601 and nothing else,
and a client that reformats on the way through is a client that eventually sends back
something the server did not give it. Parse them at the edge of your own code if you need
to.

## Development

```bash
cargo test
cargo clippy --all-targets
cargo fmt
```

The tests run against the shared fixtures in `../conformance`, which are the same ones the
TypeScript, Python, Swift and Kotlin clients are checked against, and a stub server small
enough to live in `tests/`.

## Licence

AGPL-3.0-or-later.
