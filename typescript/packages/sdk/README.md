# @imogen/sdk

TypeScript client for the [imogen](https://github.com/ergofobe/imogen-server) photo library
API.

```bash
bun add @imogen/sdk
```

## Getting started

```ts
import { ImogenClient } from '@imogen/sdk'

const imogen = new ImogenClient({ baseUrl: 'https://photos.example.com', token })

const page = await imogen.assets.list({ q: 'harbour', limit: 50 })
for (const asset of page.items) {
  console.log(asset.id, asset.originalFilename)
}
```

In a browser served by imogen itself, omit `token`: the session cookie is enough.

The package re-exports the contract types from `@imogen/shared`, so consumers need only
one dependency for both the client and the shapes it returns.

## Walking the library

`iterate` follows the cursor for you, so a library of any size is one `for await`:

```ts
for await (const asset of imogen.assets.iterate({ favorite: true })) {
  console.log(asset.capturedAt, asset.originalFilename)
}
```

Cursors rather than offsets, because a timeline that grows while you scroll shifts every
later page by one on every upload.

## Showing photographs

`urlFor` builds a URL without making a request, which is what an `<img src>` wants. In a
browser the session cookie goes with it; elsewhere use `blob`, which attaches the
Authorization header.

```tsx
<img src={imogen.assets.urlFor(asset.id, 'thumbnail')} alt={asset.description ?? ''} />
```

## Uploading

`upload` picks the protocol by size. Files at or above 64 MB use a resumable session, so a
dropped connection costs one 8 MB chunk rather than the whole video.

```ts
const result = await imogen.assets.upload(file, {
  onProgress: ({ loaded, total }) => setProgress(loaded / total),
})
console.log(result.duplicate ? 'already had it' : 'stored')
```

`uploadMany` runs six at a time and reports each file as it settles, so a UI can update a
list rather than a single bar — and one bad photo in a folder of three thousand does not
abandon the rest:

```ts
const outcomes = await imogen.assets.uploadMany(files, {
  onFileComplete: (outcome, done, total) => setStatus(`${done} of ${total}`),
})
const failed = outcomes.filter((o) => o.error)
```

## Errors

Every rejection arrives as `ImogenError`, so there is one thing to catch:

```ts
import { ImogenError } from '@imogen/sdk'

try {
  await imogen.assets.get(assetId)
} catch (error) {
  if (error instanceof ImogenError) {
    if (error.isAuthError) signInAgain()
    else if (error.details) showFieldErrors(error.details)
  }
}
```

Transient failures (429, 5xx, a dropped connection) are retried twice with exponential
backoff and full jitter — so a fleet of phones coming back after an outage does not arrive
in lockstep. Rejections the server will keep making are not retried.

## Tokens that change

`token` may be a function, sync or async, for a token that lives behind storage.
`onUnauthorized` is given a single chance to refresh when the server rejects the current
one:

```ts
const imogen = new ImogenClient({
  baseUrl,
  token: () => store.accessToken,
  onUnauthorized: async () => store.refresh(),
})
```

`fetch` can be replaced outright, which is how React Native, test harnesses and proxies get
in.

## Signing in as an application

`OAuthClient` runs OAuth 2.1 with PKCE, including RFC 7591 dynamic registration, so an app
never ships a hard-coded client id and never holds a secret:

```ts
import { OAuthClient } from '@imogen/sdk'

const oauth = new OAuthClient('https://photos.example.com')
const registered = await oauth.register('My Photo App', ['myapp://oauth'])
const pending = await oauth.beginAuthorization(registered.client_id, 'myapp://oauth')
// open pending.authorizationUrl in the system browser, then on the callback:
const tokens = await oauth.completeAuthorization(pending, callbackUrl)
```

Hold `pending` until the redirect comes back — it carries the PKCE verifier and the state
that stops a code from another session being injected.

## Development

From `typescript/`:

```bash
bun install
bun run verify   # lint, typecheck, test
```

The suite runs against the shared fixtures in `../../conformance`, which are the same ones
the Rust, Python, Swift and Kotlin clients are checked against.

## Licence

AGPL-3.0-or-later.
