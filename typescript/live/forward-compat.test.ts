import { beforeAll, describe, expect, test } from 'bun:test'
import { type FetchLike, ImogenClient, OAuthClient } from '@imogen/sdk'

/**
 * The newest client against the last *released* server.
 *
 * The fixtures under `conformance/` pin down what the five ports send to each other's
 * satisfaction, and `sdk-contract.test.ts` in imogen-server proves the *current* server
 * answers the *pinned* client. Neither asks the question users actually hit: apps update
 * before servers do, and a store release cannot be recalled. So this suite drives the
 * client on this branch over real HTTP against the server image of the newest release.
 *
 * A failure here means an SDK change needs a server change to function, which makes it a
 * breaking change — not a bug in this file.
 *
 * What it deliberately does not assert: that the server *honours* anything new. A released
 * server is allowed to ignore a field it has never heard of; that is what "additive" means.
 * Asserting that `resource` binds a token would be testing this particular server rather
 * than the compatibility rule, and would fail against every release older than the feature.
 * Enforcement is imogen-server's to test, and it does.
 */
function requireServerUrl(): string {
  const url = process.env.IMOGEN_SERVER_URL
  if (url) return url
  throw new Error(
    'IMOGEN_SERVER_URL is unset. This suite is only meaningful against a running released ' +
      'server, and skipping it quietly would report a forward compatibility that was never ' +
      'checked. Point it at one, or do not run this file.',
  )
}

const baseUrl = requireServerUrl()

// A released server hands back a session cookie at sign-up, and the authorization endpoint
// needs it to know who is approving. Node's fetch keeps no jar, so this is the jar.
const cookies = new Map<string, string>()
const withCookies: FetchLike = async (input, init) => {
  const request = new Request(input as RequestInfo, init)
  if (cookies.size > 0) {
    request.headers.set(
      'Cookie',
      [...cookies].map(([name, value]) => `${name}=${value}`).join('; '),
    )
  }
  const response = await fetch(request)
  for (const header of response.headers.getSetCookie()) {
    const [name, ...rest] = header.split(';')[0]!.split('=')
    if (name) cookies.set(name, rest.join('='))
  }
  return response
}

const client = new ImogenClient({ baseUrl, fetch: withCookies })
const oauth = new OAuthClient(baseUrl, withCookies)
const redirectUri = 'imogen-forward-compat://oauth'

/** Runs the browser's half of the authorization: approve, and read the code off the 302. */
async function authorize(resource?: string): Promise<string> {
  const registered = await oauth.register('Forward compatibility check', [redirectUri])
  const pending = await oauth.beginAuthorization(
    registered.client_id,
    redirectUri,
    ['library:read'],
    resource,
  )
  const approved = await withCookies(`${pending.authorizationUrl}&approved=yes`, {
    redirect: 'manual',
  })
  const callbackUrl = approved.headers.get('location')
  if (!callbackUrl) {
    throw new Error(
      `The authorization endpoint returned ${approved.status} with no Location header`,
    )
  }
  const tokens = await oauth.completeAuthorization(pending, callbackUrl)
  return tokens.access_token
}

/** A client holding only a bearer token — no cookie, the way a real app runs. */
function tokenClient(accessToken: string): ImogenClient {
  return new ImogenClient({ baseUrl, token: accessToken })
}

beforeAll(async () => {
  // Unique, so the suite can be run twice against one server without tripping over itself.
  await client.auth.signup({
    email: `forward-compat-${Date.now()}@example.com`,
    password: 'a-sufficiently-long-password',
    name: 'Forward compatibility',
  })
})

describe('the last released server', () => {
  test('is reachable, and says which version it is', async () => {
    const health = await client.health()

    expect(health.status).toBe('ok')
    // Not an assertion so much as the first thing anyone reading a red run wants to know.
    console.log(`  server version: ${health.version}`)
  })

  test('publishes authorization server metadata this client can read', async () => {
    const metadata = await oauth.discover()

    expect(metadata.issuer).toBeString()
    expect(metadata.authorization_endpoint).toBeString()
    expect(metadata.token_endpoint).toBeString()
    expect(metadata.registration_endpoint).toBeString()
    expect(metadata.code_challenge_methods_supported).toContain('S256')
  })

  test('publishes a protected resource document for the API and for MCP', async () => {
    const api = await oauth.discoverProtectedResource()
    const mcp = await oauth.discoverProtectedResource('/mcp')

    // `resource` and nothing else: RFC 9728 requires only that field, and the contract's
    // `protectedResourceMetadataMinimal` fixture holds all five ports to reading a document
    // that carries no more. Demanding the rest here would reject a legal answer.
    expect(api.resource).toBeString()
    expect(mcp.resource).toBeString()

    // Deliberately not asserted: that the two name *different* resources. Server 0.3.0
    // answers both paths with the site root, and per-surface identifiers landed after it.
    // Requiring them to differ would require a server newer than the one users are on,
    // which is the breaking change this suite exists to catch rather than commit.
  })
})

describe('an authorization this client can complete', () => {
  test('without a resource, as the pairing flow has to', async () => {
    const accessToken = await authorize()

    expect(accessToken).toBeString()
    expect(await tokenClient(accessToken).assets.list()).toMatchObject({ items: [] })
  })

  // Both documents, because the identifier is the thing most likely to strand a client on
  // an older server: `resource` has to be the value that server published, not one the
  // client assembled from its own base URL. Against 0.3.0 the MCP document answers with
  // the site root, so a client that built `${base}/mcp` for itself would be naming a
  // resource this server never heard of. Reading it back is what keeps that from happening.
  for (const [surface, path] of [
    ['the API', ''],
    ['MCP', '/mcp'],
  ] as const) {
    test(`naming the resource ${surface} published, which an older server may ignore`, async () => {
      const { resource } = await oauth.discoverProtectedResource(path)

      const accessToken = await authorize(resource)

      expect(accessToken).toBeString()
      expect(await tokenClient(accessToken).assets.list()).toMatchObject({ items: [] })
    })
  }
})
