import { describe, expect, test } from 'bun:test'
import {
  AdminUser,
  Album,
  AlbumAssetsResult,
  Asset,
  AuthConfig,
  BULK_UPLOAD_CONCURRENCY,
  DetectedFace,
  FaceStatus,
  LibraryStats,
  Person,
  QueueHealth,
  RESUMABLE_THRESHOLD_BYTES,
  ServerSettings,
  ShareLink,
  StorageReport,
  TimelineBucket,
  TokenResponse,
  UPLOAD_CHUNK_BYTES,
  UploadSession,
  User,
} from '@imogen/shared'
import endpoints from '../../../../conformance/endpoints.json' with { type: 'json' }
import errors from '../../../../conformance/errors.json' with { type: 'json' }
import models from '../../../../conformance/models.json' with { type: 'json' }
import { ImogenClient } from './client.ts'
import { ImogenError } from './errors.ts'
import type { FetchLike } from './http.ts'

const BASE = 'https://photos.example.test'

/**
 * The conformance suite. It is deliberately transport-level rather than a mock of the
 * SDK's own methods: what these fixtures pin down is the wire contract every port shares,
 * so the same three files drive the Rust, Python, Swift and Kotlin suites unchanged.
 */

type Recorded = { method: string; path: string; query: URLSearchParams; body: string | null }

/**
 * Enough of a server for the SDK to get through a call. The resumable handshake is the
 * only part that needs real answers: it opens a session, then chunks until the reported
 * offset reaches the end, so a stub that always says nought loops for ever.
 */
function stubBody(pathname: string): unknown {
  if (pathname === '/api/v1/uploads') {
    return { id: 'SESSION', offset: 0, sizeBytes: RESUMABLE_THRESHOLD_BYTES, existing: null }
  }
  if (pathname.startsWith('/api/v1/uploads/')) return { offset: RESUMABLE_THRESHOLD_BYTES }
  // Shaped so both `{ items }` destructuring and plain object returns survive.
  return { items: [] }
}

function recorder(): { calls: Recorded[]; fetch: FetchLike } {
  const calls: Recorded[] = []
  const fetch: FetchLike = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.toString())
    calls.push({
      method: init?.method ?? 'GET',
      path: url.pathname,
      query: url.searchParams,
      body: typeof init?.body === 'string' ? init.body : null,
    })
    return new Response(JSON.stringify(stubBody(url.pathname)), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return { calls, fetch }
}

/** A File-alike, so the resumable path is exercised without allocating 64 MB. */
function hugeFile(size: number): File {
  return {
    name: 'holiday.mov',
    type: 'video/quicktime',
    size,
    slice: () => ({ arrayBuffer: async () => new ArrayBuffer(0) }),
  } as unknown as File
}

describe('endpoint table', () => {
  const table = endpoints.resources as Record<
    string,
    Array<{ operation: string; method: string; path: string }>
  >

  /** Every operation in the contract, and the call that must produce it. */
  const invocations: Record<string, (c: ImogenClient) => unknown> = {
    'client.health': (c) => c.health(),

    'assets.list': (c) => c.assets.list(),
    'assets.get': (c) => c.assets.get('ASSET'),
    'assets.update': (c) => c.assets.update('ASSET', { favorite: true }),
    'assets.shareLink': (c) => c.assets.shareLink('ASSET'),
    'assets.share': (c) => c.assets.share('ASSET'),
    'assets.unshare': (c) => c.assets.unshare('ASSET'),
    'assets.trash': (c) => c.assets.trash(['ASSET']),
    'assets.restore': (c) => c.assets.restore(['ASSET']),
    'assets.timeline': (c) => c.assets.timeline(),
    'assets.timelineBucket': (c) => c.assets.timelineBucket({ period: '2024-06' }),
    'assets.stats': (c) => c.assets.stats(),
    'assets.variant': (c) => c.assets.blob('ASSET', 'thumbnail'),
    'assets.download': (c) => c.http.send('GET', '/api/v1/assets/ASSET/download'),
    'assets.upload': (c) => c.assets.upload(new File(['x'], 'a.jpg', { type: 'image/jpeg' })),
    'assets.createUploadSession': (c) => c.assets.upload(hugeFile(RESUMABLE_THRESHOLD_BYTES)),
    'assets.uploadChunk': (c) => c.assets.upload(hugeFile(RESUMABLE_THRESHOLD_BYTES)),
    'assets.completeUpload': (c) => c.assets.upload(hugeFile(RESUMABLE_THRESHOLD_BYTES)),

    'albums.list': (c) => c.albums.list(),
    'albums.get': (c) => c.albums.get('ALBUM'),
    'albums.create': (c) => c.albums.create({ name: 'A' }),
    'albums.update': (c) => c.albums.update('ALBUM', { name: 'B' }),
    'albums.remove': (c) => c.albums.remove('ALBUM'),
    'albums.addAssets': (c) => c.albums.addAssets('ALBUM', ['ASSET']),
    'albums.removeAssets': (c) => c.albums.removeAssets('ALBUM', ['ASSET']),
    'albums.shareLink': (c) => c.albums.shareLink('ALBUM'),
    'albums.share': (c) => c.albums.share('ALBUM'),
    'albums.unshare': (c) => c.albums.unshare('ALBUM'),

    'people.status': (c) => c.people.status(),
    'people.setEnabled': (c) => c.people.setEnabled(true),
    'people.list': (c) => c.people.list(),
    'people.get': (c) => c.people.get('PERSON'),
    'people.update': (c) => c.people.update('PERSON', { name: 'Ada' }),
    'people.merge': (c) => c.people.merge('PERSON', ['OTHER']),
    'people.reassign': (c) => c.people.reassign(['FACE'], null),
    'people.facesIn': (c) => c.people.facesIn('ASSET'),
    'people.thumbnail': (c) => c.http.send('GET', '/api/v1/people/thumbnail/FACE'),

    'vault.status': (c) => c.vault.status(),
    'vault.setPassphrase': (c) => c.vault.setPassphrase('open sesame'),
    'vault.unlock': (c) => c.vault.unlock('open sesame'),
    'vault.lock': (c) => c.vault.lock(),
    'vault.list': (c) => c.vault.list(),
    'vault.timeline': (c) => c.vault.timeline(),
    'vault.timelineBucket': (c) => c.vault.timelineBucket({ period: '2024-06' }),
    'vault.moveIn': (c) => c.vault.moveIn(['ASSET']),
    'vault.moveOut': (c) => c.vault.moveOut(['ASSET']),

    'auth.config': (c) => c.auth.config(),
    'auth.login': (c) => c.auth.login({ email: 'a@b.c', password: 'x' }),
    'auth.signup': (c) => c.auth.signup({ email: 'a@b.c', password: 'x', name: 'A' }),
    'auth.logout': (c) => c.auth.logout(),
    'auth.logoutEverywhere': (c) => c.auth.logoutEverywhere(),
    'auth.me': (c) => c.auth.me(),
    'auth.updateProfile': (c) => c.auth.updateProfile({ name: 'A' }),
    'auth.changePassword': (c) => c.auth.changePassword({ newPassword: 'x'.repeat(10) }),
    'auth.oidcStart': (c) => c.http.send('GET', '/api/v1/auth/oidc/start'),

    'admin.users': (c) => c.admin.users(),
    'admin.updateUser': (c) => c.admin.updateUser('USER', { role: 'user' }),
    'admin.deleteUser': (c) => c.admin.deleteUser('USER'),
    'admin.resetPassword': (c) => c.admin.resetPassword('USER', 'x'.repeat(10)),
    'admin.invites': (c) => c.admin.invites(),
    'admin.createInvite': (c) => c.admin.createInvite(),
    'admin.revokeInvite': (c) => c.admin.revokeInvite('INVITE'),
    'admin.queue': (c) => c.admin.queue(),
    'admin.retryJob': (c) => c.admin.retryJob('JOB'),
    'admin.retryAllJobs': (c) => c.admin.retryAllJobs(),
    'admin.discardJob': (c) => c.admin.discardJob('JOB'),
    'admin.clients': (c) => c.admin.clients(),
    'admin.revokeClient': (c) => c.admin.revokeClient('CLIENT'),
    'admin.sessions': (c) => c.admin.sessions(),
    'admin.revokeSession': (c) => c.admin.revokeSession('SESSION'),
    'admin.storage': (c) => c.admin.storage(),
    'admin.settings': (c) => c.admin.settings(),
    'admin.updateSettings': (c) => c.admin.updateSettings({ allowSignup: true }),
    'admin.shares': (c) => c.admin.shares(),
    'admin.revokeShare': (c) => c.admin.revokeShare('SHARE'),

    'pairing.create': (c) => c.pairing.create(),
    'pairing.status': (c) => c.pairing.status('TICKET'),
    'pairing.claim': (c) =>
      c.pairing.claim({
        code: 'imog_pair_x',
        clientId: 'CLIENT',
        redirectUri: 'imogen://oauth',
        codeChallenge: 'x'.repeat(43),
        codeChallengeMethod: 'S256',
      }),

    'oauth.discover': (c) => c.http.send('GET', '/.well-known/oauth-authorization-server'),
  }

  const placeholders: Record<string, string> = {
    assetId: 'ASSET',
    albumId: 'ALBUM',
    personId: 'PERSON',
    faceId: 'FACE',
    userId: 'USER',
    inviteId: 'INVITE',
    jobId: 'JOB',
    clientId: 'CLIENT',
    sessionId: 'SESSION',
    shareId: 'SHARE',
    ticketId: 'TICKET',
    variant: 'thumbnail',
  }

  function concrete(path: string): string {
    return path.replace(/\{(\w+)\}/g, (_, key: string) => placeholders[key] ?? key)
  }

  test('the contract names no operation the client cannot perform', () => {
    const missing: string[] = []
    for (const [resource, operations] of Object.entries(table)) {
      for (const { operation } of operations) {
        if (!invocations[`${resource}.${operation}`]) missing.push(`${resource}.${operation}`)
      }
    }
    expect(missing).toEqual([])
  })

  for (const [resource, operations] of Object.entries(table)) {
    for (const endpoint of operations) {
      const key = `${resource}.${endpoint.operation}`
      test(`${key} calls ${endpoint.method} ${endpoint.path}`, async () => {
        const { calls, fetch } = recorder()
        const client = new ImogenClient({ baseUrl: BASE, fetch, maxRetries: 0 })
        await invocations[key]?.(client)

        const want = { method: endpoint.method, path: concrete(endpoint.path) }
        expect(calls.map((c) => ({ method: c.method, path: c.path }))).toContainEqual(want)
      })
    }
  }
})

describe('models decode as the contract says', () => {
  const schemas: Record<string, { parse: (input: unknown) => unknown }> = {
    asset: Asset,
    assetMinimal: Asset,
    album: Album,
    albumAssetsResult: AlbumAssetsResult,
    shareLink: ShareLink,
    user: User,
    authConfigOidcOff: AuthConfig,
    authConfigOidcOn: AuthConfig,
    person: Person,
    personUnnamed: Person,
    detectedFace: DetectedFace,
    faceStatus: FaceStatus,
    libraryStats: LibraryStats,
    uploadSession: UploadSession,
    adminUser: AdminUser,
    queueHealth: QueueHealth,
    storageReport: StorageReport,
    serverSettings: ServerSettings,
    tokenResponse: TokenResponse,
  }

  function at(value: unknown, path: string): unknown {
    return path.split('.').reduce<unknown>((acc, key) => {
      if (acc === null || acc === undefined) return undefined
      return (acc as Record<string, unknown>)[key]
    }, value)
  }

  type Fixture = { payload: unknown; assert: Record<string, Json> }
  type Json = string | number | boolean | null | Json[] | { [key: string]: Json }
  const fixtures = models as unknown as Record<string, Fixture | string>

  for (const [name, schema] of Object.entries(schemas)) {
    const fixture = fixtures[name]
    if (!fixture || typeof fixture === 'string') continue

    test(`${name}`, () => {
      const parsed = schema.parse(fixture.payload)
      // Keyed by path so a failure names the field rather than dumping the whole model.
      for (const [path, expected] of Object.entries(fixture.assert)) {
        const actual = (at(parsed, path) ?? null) as Json
        expect({ [path]: actual }).toEqual({ [path]: expected })
      }
    })
  }

  test('the timeline bucket fixture decodes', () => {
    for (const bucket of models.timeline.payload.buckets) {
      expect(TimelineBucket.parse(bucket)).toEqual({ ...bucket, coverAssetId: null })
    }
  })
})

describe('error classification', () => {
  for (const item of errors.cases) {
    test(item.name, async () => {
      const body = 'bodyRaw' in item ? item.bodyRaw : JSON.stringify(item.body)
      const response = new Response(body as string, {
        status: item.status,
        headers: { 'Content-Type': 'application/json' },
      })
      const error = await ImogenError.fromResponse(response)

      expect(error.status).toBe(item.expect.status)
      expect(error.code).toBe(item.expect.code)
      expect(error.isRetryable).toBe(item.expect.retryable)
      expect(error.isAuthError).toBe(item.expect.authError)
      expect(error.details ?? null).toEqual(item.expect.details ?? null)
      if ('message' in item.expect) expect(error.message).toBe(item.expect.message as string)
    })
  }
})

describe('shared tuning constants', () => {
  test('match the contract', () => {
    expect(BULK_UPLOAD_CONCURRENCY).toBe(errors.upload.bulkConcurrency)
    expect(RESUMABLE_THRESHOLD_BYTES).toBe(errors.upload.resumableThresholdBytes)
    expect(UPLOAD_CHUNK_BYTES).toBe(errors.upload.chunkBytes)
  })
})

describe('transport behaviour', () => {
  test('retries a retryable rejection and then succeeds', async () => {
    let attempts = 0
    const fetch: FetchLike = async () => {
      attempts++
      if (attempts < 3) {
        return new Response(JSON.stringify({ error: { code: 'rate_limited', message: 'slow' } }), {
          status: 429,
        })
      }
      return new Response(JSON.stringify({ status: 'ok', version: '0.1.0' }), { status: 200 })
    }

    const client = new ImogenClient({ baseUrl: BASE, fetch })
    expect(await client.health()).toEqual({ status: 'ok', version: '0.1.0' })
    expect(attempts).toBe(3)
  })

  test('does not retry a rejection the server will keep rejecting', async () => {
    let attempts = 0
    const fetch: FetchLike = async () => {
      attempts++
      return new Response(JSON.stringify({ error: { code: 'not_found', message: 'no' } }), {
        status: 404,
      })
    }

    const client = new ImogenClient({ baseUrl: BASE, fetch })
    await expect(client.assets.get('nope')).rejects.toThrow(ImogenError)
    expect(attempts).toBe(1)
  })

  test('asks for a fresh token once when the server rejects the old one', async () => {
    let attempts = 0
    let refreshed = false
    const fetch: FetchLike = async () => {
      attempts++
      if (attempts === 1) {
        return new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'x' } }), {
          status: 401,
        })
      }
      return new Response(JSON.stringify({ items: [] }), { status: 200 })
    }

    const client = new ImogenClient({
      baseUrl: BASE,
      token: 'stale',
      fetch,
      onUnauthorized: async () => {
        refreshed = true
        return 'fresh'
      },
    })

    await client.assets.list()
    expect(refreshed).toBe(true)
    expect(attempts).toBe(2)
  })

  test('sends the bearer token', async () => {
    const seen: { authorization: string | null } = { authorization: null }
    const fetch: FetchLike = async (_input, init) => {
      seen.authorization = new Headers(init?.headers).get('Authorization')
      return new Response(JSON.stringify({ items: [] }), { status: 200 })
    }

    await new ImogenClient({ baseUrl: BASE, token: 'abc123', fetch }).assets.list()
    expect(seen.authorization).toBe('Bearer abc123')
  })

  test('builds image URLs without a request', () => {
    const client = new ImogenClient({ baseUrl: `${BASE}/` })
    expect(client.assets.urlFor('A1')).toBe(`${BASE}/api/v1/assets/A1/thumbnail`)
    expect(client.assets.urlFor('A1', 'preview')).toBe(`${BASE}/api/v1/assets/A1/preview`)
    expect(client.assets.downloadUrl('A1')).toBe(`${BASE}/api/v1/assets/A1/download`)
  })

  test('iterates every page exactly once', async () => {
    const pages = [
      { items: [{ id: 'a' }, { id: 'b' }], nextCursor: 'c1', total: 3 },
      { items: [{ id: 'c' }], nextCursor: null, total: 3 },
    ]
    let index = 0
    const fetch: FetchLike = async () =>
      new Response(JSON.stringify(pages[index++]), { status: 200 })

    const client = new ImogenClient({ baseUrl: BASE, fetch })
    const seen: string[] = []
    for await (const asset of client.assets.iterate()) seen.push(asset.id)
    expect(seen).toEqual(['a', 'b', 'c'])
  })
})
