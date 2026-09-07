import { beforeAll, describe, expect, test } from 'bun:test'
import { createHash, randomBytes } from 'node:crypto'
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
  // Without a session the server bounces to its own login page, and the relative path that
  // comes back would surface three frames later as a bare `TypeError: Invalid URL`. This
  // job is only worth having if a red run reads clearly.
  if (callbackUrl.startsWith('/')) {
    throw new Error(
      `The authorization endpoint redirected to ${callbackUrl} instead of ${redirectUri}: ` +
        'the sign-up session was not carried, so there was nobody to approve as.',
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

    // Deliberately not asserted: that the two name *different* resources. Per-surface
    // identifiers arrived partway through the server's history, and a release old enough
    // to answer both paths with the site root is still one users are on. Requiring them to
    // differ would require a newer server — the breaking change this suite exists to catch
    // rather than commit.
  })
})

describe('an authorization this client can complete', () => {
  test('naming no resource at all', async () => {
    const accessToken = await authorize()

    expect(accessToken).toBeString()
    expect(await tokenClient(accessToken).assets.list()).toMatchObject({ items: [] })
  })

  test('naming the resource the API published', async () => {
    const { resource } = await oauth.discoverProtectedResource()

    const accessToken = await authorize(resource)

    expect(accessToken).toBeString()
    expect(await tokenClient(accessToken).assets.list()).toMatchObject({ items: [] })
  })

  // The MCP identifier matters here even though this repository has no MCP client: it is
  // the value most likely to strand a client on an older server. `resource` has to be what
  // that server published, not something the client assembled out of its own base URL —
  // a server old enough to answer both paths with the site root would reject `${base}/mcp`
  // as a resource it never heard of. Reading it back is what keeps that from happening.
  test('naming the resource MCP published', async () => {
    const { resource } = await oauth.discoverProtectedResource('/mcp')

    const accessToken = await authorize(resource)

    // Where this stops: the token is issued, and that is the whole forward-compatibility
    // claim. Not asserted — that it then works at the REST API. A server that enforces
    // binding is *right* to refuse an MCP-bound token there; imogen-server's
    // sdk-contract.test.ts asserts the mirror of it, that an API-bound token gets 401 at
    // /mcp, and the enforcement is symmetric. Reaching for a read here would assert the
    // negation of the server's own contract, and go red on the release that implements it.
    expect(accessToken).toBeString()
  })
})

describe('a device this client can pair', () => {
  // `PairingClaimRequest` grew an optional `resource`, which a released server has never
  // heard of. Naming none is the only case forward compatibility covers: this asserts the
  // released server still pairs, not that a newer one binds. Naming one *does* need the
  // server half — the old server ignores the field, mints an unbound code, and refuses the
  // exchange that echoes it — which is the breaking change the SDK PR has to declare, and
  // asserting it here would go red on every release older than the feature.
  test('without a resource, which is all a released server can honour', async () => {
    const ticket = await client.pairing.create()
    const registered = await oauth.register('Forward compatibility device', [redirectUri])
    const verifier = randomBytes(32).toString('base64url')

    const claim = await client.pairing.claim({
      code: ticket.code,
      clientId: registered.client_id,
      redirectUri,
      codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
      codeChallengeMethod: 'S256',
      deviceName: 'Forward compatibility device',
    })

    expect(claim.code).toBeString()
    expect(claim.scope).toBeString()
  })
})
