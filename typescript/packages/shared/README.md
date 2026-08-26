# @imogen/shared

The [imogen](https://github.com/ergofobe/imogen-server) API contract: zod schemas and the
types inferred from them, shared by the server and every client.

```bash
bun add @imogen/shared
```

Most consumers do not want this package directly — [`@imogen/sdk`](../sdk) re-exports every
type from it, so a client needs one dependency rather than two.

Reach for it when you need the *schemas* rather than the types: the server uses them to
validate requests and generate its OpenAPI document, and a proxy or a fixture generator
would want the same.

```ts
import { Asset, AssetQuery, ERROR_CODES } from '@imogen/shared'

const parsed = Asset.parse(payload)          // throws on a shape that does not match
const query = AssetQuery.parse(searchParams) // coerces and applies defaults
```

The schemas are the single definition of the wire format. `conformance/models.json` in this
repository holds canonical payloads for them, and every port — TypeScript, Rust, Python,
Swift, Kotlin — is checked against those same fixtures.

## Licence

AGPL-3.0-or-later.
