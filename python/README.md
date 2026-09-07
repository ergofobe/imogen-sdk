# imogen-sdk (Python)

Python client for the [imogen](https://github.com/ergofobe/imogen-server) photo library
API.

```bash
pip install imogen-sdk
```

## Getting started

The client is async, and closes its connection pool when the context exits.

```python
import asyncio
from imogen_sdk import AssetQuery, ImogenClient


async def main() -> None:
    async with ImogenClient("https://photos.example.com", token="…") as imogen:
        page = await imogen.assets.list(AssetQuery(q="harbour", limit=50))
        for asset in page.items:
            print(asset.id, asset.original_filename)


asyncio.run(main())
```

Every response is a pydantic model, so field names are snake_case in Python and camelCase
on the wire, and a payload that does not match the contract fails where it arrives rather
than three frames later.

## Walking the library

`iterate` follows the cursor for you, so a library of any size is one `async for`:

```python
async for asset in imogen.assets.iterate(AssetQuery(favorite=True)):
    print(asset.captured_at, asset.original_filename)
```

## Uploading

`upload` picks the protocol by size. Files at or above 64 MB use a resumable session, so a
dropped connection costs one 8 MB chunk rather than the whole video.

```python
result = await imogen.assets.upload(
    "holiday.mov",
    on_progress=lambda p: print(f"{p.loaded / p.total:.0%}"),
)
print(result.asset.id, "already had it" if result.duplicate else "stored")
```

`upload_many` runs six at a time and lets each file settle on its own, so one bad photo in
a folder of three thousand does not abandon the rest:

```python
outcomes = await imogen.assets.upload_many(Path("holiday").glob("*.jpg"))
failed = [o for o in outcomes if o.error]
```

## Errors

Every rejection arrives as `ImogenError`, so there is one thing to catch:

```python
from imogen_sdk import ImogenError

try:
    await imogen.assets.get(asset_id)
except ImogenError as error:
    if error.is_auth_error:
        ...  # sign in again
    elif error.details:
        ...  # field-level validation detail, path -> messages
```

Requests that failed for a transient reason (429, 5xx, a dropped connection) are retried
twice with exponential backoff and full jitter. Rejections the server will keep making are
not retried.

## Signing in as an application

`OAuthClient` runs OAuth 2.1 with PKCE, including RFC 7591 dynamic registration, so an app
never ships a hard-coded client id and never holds a secret:

```python
from imogen_sdk import OAuthClient

oauth = OAuthClient("https://photos.example.com")
registered = await oauth.register("My Photo App", ["myapp://oauth"])
pending = await oauth.begin_authorization(registered.client_id, "myapp://oauth")
# open pending.authorization_url in the system browser, then on the callback:
stored = await oauth.complete_authorization(pending, callback_url)
```

Hold `pending` until the redirect comes back — it carries the PKCE verifier and the state
that stops a code from another session being injected.

By default the token is valid at every surface. Passing the RFC 8707 `resource` binds it
to one and gets it refused everywhere else. Read the identifier rather than building it —
the server compares against the one spelling it publishes:

```python
mcp = await oauth.discover_protected_resource("/mcp")
pending = await oauth.begin_authorization(
    registered.client_id, "myapp://oauth", resource=mcp.resource
)
```

`resource` travels on the authorization request and the token exchange together, carried on
`pending` so the two cannot disagree — the server refuses a token request naming a resource
the authorization code did not record.

## Development

```bash
uv sync
uv run pytest
uv run ruff check
```

The tests run against the shared fixtures in `../conformance`, which are the same ones the
TypeScript, Rust, Swift and Kotlin clients are checked against.

## Licence

AGPL-3.0-or-later.
