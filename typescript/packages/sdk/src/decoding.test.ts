import { describe, expect, test } from 'bun:test'
import { Asset } from '@imogen/shared'
import models from '../../../../conformance/models.json' with { type: 'json' }
import { ImogenClient } from './client.js'
import { ImogenDecodeError, ImogenError } from './errors.js'
import type { FetchLike } from './http.js'

const BASE = 'https://photos.example.test'

/** Answers every request with one body, and counts how many times it was asked. */
function answering(body: unknown): { fetch: FetchLike; calls: () => number } {
  let calls = 0
  const fetch: FetchLike = async () => {
    calls++
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return { fetch, calls: () => calls }
}

function clientAnswering(body: unknown): ImogenClient {
  return new ImogenClient({ baseUrl: BASE, fetch: answering(body).fetch, maxRetries: 0 })
}

const fixtures = models as unknown as Record<string, { payload: Record<string, unknown> }>
const outOfRange = fixtures.assetLocationLatitudeOutOfRange!.payload
const minimal = fixtures.assetMinimal!.payload

describe('a caller reads the contract, not the wire', () => {
  /**
   * The case imogen-sdk#42 was filed on. `Asset.parse` has always answered null here —
   * what the issue pinned down is that no caller of this port ever reached that parse,
   * so the web client would render a pin the CLI, iOS and Android clients all discard.
   */
  test('a location no map can place is dropped on the way in', async () => {
    const asset = await clientAnswering(outOfRange).assets.get('ASSET')

    expect(asset.location).toBeNull()
    expect(asset).toEqual(Asset.parse(outOfRange))
  })

  test('and is dropped inside a page as well as on its own', async () => {
    const page = await clientAnswering({
      items: [outOfRange],
      nextCursor: null,
      total: 1,
    }).assets.list()

    expect(page.items[0]?.location).toBeNull()
  })

  /**
   * Absorb, not reject: the asset itself survives. A decoder that threw here would turn
   * a wrongly rendered pin into a failed request, which is a worse bug than the one
   * being fixed.
   */
  test('the rest of the asset survives the location being dropped', async () => {
    const asset = await clientAnswering(outOfRange).assets.get('ASSET')

    expect(asset.id).toBe(outOfRange.id as string)
    expect(asset.originalFilename).toBe('bad-latitude.jpg')
  })
})

/**
 * Forward compatibility is the rule this change could most easily break: a client built
 * from this branch has to keep working against the server release that is already out
 * there, and the other direction — a client older than the server it is talking to — is
 * how every deployment looks between a server update and an app-store release. Both end
 * in the same place, a response carrying fields this port has never heard of, and
 * nothing in CI tests it. So it is tested here.
 */
describe('a response from a server this client has never heard of', () => {
  const fromTheFuture = {
    ...outOfRange,
    sentiment: 'wistful',
    location: { ...(outOfRange.location as object), what3words: 'index.home.raft' },
    exif: null,
  }

  test('decodes rather than being refused', async () => {
    const asset = await clientAnswering(fromTheFuture).assets.get('ASSET')

    expect(asset.id).toBe(outOfRange.id as string)
    // Unknown keys are dropped, exactly as serde, pydantic, kotlinx and Codable drop
    // them. Dropping is what makes an added field additive; refusing would not be.
    expect('sentiment' in asset).toBe(false)
  })

  test('decodes even when the unknown field is nested inside a known one', async () => {
    const withinBounds = {
      ...minimal,
      location: { latitude: 50.1, longitude: -5.5, altitude: null, place: null, plusCode: '9C2P' },
    }
    const asset = await clientAnswering(withinBounds).assets.get('ASSET')

    expect(asset.location).toEqual({
      latitude: 50.1,
      longitude: -5.5,
      altitude: null,
      place: null,
    })
  })
})

describe('a body the contract cannot read', () => {
  test('arrives as an ImogenError rather than a raw schema failure', async () => {
    const client = clientAnswering({ id: 'not-a-uuid' })

    await expect(client.assets.get('ASSET')).rejects.toBeInstanceOf(ImogenDecodeError)
    await expect(client.assets.get('ASSET')).rejects.toBeInstanceOf(ImogenError)
  })

  test('is not retried, because the server will keep sending it', async () => {
    const { fetch, calls } = answering({ id: 'not-a-uuid' })
    const client = new ImogenClient({ baseUrl: BASE, fetch })

    await expect(client.assets.get('ASSET')).rejects.toThrow(ImogenDecodeError)
    expect(calls()).toBe(1)
  })

  test('says which call it was and carries the failure it came from', async () => {
    try {
      await clientAnswering({ id: 'not-a-uuid' }).assets.get('ASSET')
      throw new Error('expected a decode failure')
    } catch (error) {
      expect(error).toBeInstanceOf(ImogenDecodeError)
      const decode = error as ImogenDecodeError
      expect(decode.code).toBe('invalid_response')
      expect(decode.isRetryable).toBe(false)
      expect(decode.message).toContain('/api/v1/assets/ASSET')
      expect(decode.cause).toBeDefined()
    }
  })
})
