import { describe, expect, test } from 'bun:test'
import {
  AssetFilter,
  AssetQuery,
  AssetSelection,
  TimelineBucket,
  TimelineBucketQuery,
  TimelineTile,
} from './query.js'

describe('AssetFilter', () => {
  test('carries every filter the timeline endpoints share', () => {
    const parsed = AssetFilter.parse({
      q: 'harbour',
      personId: '6a5f1e2c-90b4-4d1a-8f3e-2b7c9d0a1e45',
    })
    expect(parsed.q).toBe('harbour')
    expect(parsed.personId).toBe('6a5f1e2c-90b4-4d1a-8f3e-2b7c9d0a1e45')
  })

  test('rejects a bbox that is not four numbers', () => {
    expect(() => AssetFilter.parse({ bbox: '1,2,3' })).toThrow()
  })
})

describe('AssetQuery', () => {
  // Enumerated rather than spot-checked: AssetQuery is PageQuery + AssetFilter + sort/order,
  // and nothing else in the suite parses it (it's a request shape, so the conformance
  // fixture loop never touches it). A field dropped from AssetFilter.shape, or an
  // .extend() reordered so one silently overwrites another, must fail here or it fails
  // nowhere until a client's query string breaks in the field.
  test('is exactly PageQuery + AssetFilter + sort/order, field for field', () => {
    const expectedKeys = [
      'cursor',
      'limit',
      'q',
      'type',
      'albumId',
      'personId',
      'favorite',
      'archived',
      'trashed',
      'takenAfter',
      'takenBefore',
      'bbox',
      'sort',
      'order',
    ].sort()
    expect(Object.keys(AssetQuery.shape).sort()).toEqual(expectedKeys)
  })

  test('keeps the wire defaults every client depends on', () => {
    const parsed = AssetQuery.parse({})
    expect(parsed.limit).toBe(100)
    expect(parsed.sort).toBe('capturedAt')
    expect(parsed.order).toBe('desc')
  })

  test('still coerces a query-string boolean', () => {
    expect(AssetQuery.parse({ favorite: 'true' }).favorite).toBe(true)
  })
})

describe('TimelineBucket', () => {
  test('defaults coverAssetId to null, so a caller that did not ask still parses', () => {
    expect(TimelineBucket.parse({ date: '2011-08-14', count: 12 }).coverAssetId).toBeNull()
  })
})

describe('TimelineTile', () => {
  test('accepts a still-processing asset with no dimensions', () => {
    const tile = TimelineTile.parse({
      id: '6a5f1e2c-90b4-4d1a-8f3e-2b7c9d0a1e45',
      capturedAt: '2011-08-14T09:30:00.000Z',
      width: null,
      height: null,
      type: 'image',
      status: 'processing',
      favorite: false,
      duration: null,
      placeholderColor: null,
      livePhotoVideoId: null,
    })
    expect(tile.status).toBe('processing')
  })
})

describe('TimelineBucketQuery', () => {
  test('accepts a month and a day', () => {
    expect(TimelineBucketQuery.parse({ period: '2011-08' }).period).toBe('2011-08')
    expect(TimelineBucketQuery.parse({ period: '2011-08-14' }).period).toBe('2011-08-14')
  })

  test('rejects a bare year, which would be a whole-library scan by accident', () => {
    expect(() => TimelineBucketQuery.parse({ period: '2011' })).toThrow()
  })

  test('defaults the limit to 5000', () => {
    expect(TimelineBucketQuery.parse({ period: '2011-08' }).limit).toBe(5000)
  })
})

describe('AssetSelection', () => {
  test('takes an explicit id list', () => {
    const parsed = AssetSelection.parse({ assetIds: ['6a5f1e2c-90b4-4d1a-8f3e-2b7c9d0a1e45'] })
    expect(parsed.assetIds).toHaveLength(1)
  })

  test('takes a query with exclusions', () => {
    const parsed = AssetSelection.parse({
      query: { favorite: true },
      except: ['6a5f1e2c-90b4-4d1a-8f3e-2b7c9d0a1e45'],
    })
    expect(parsed.query?.favorite).toBe(true)
    expect(parsed.except).toHaveLength(1)
  })

  test('refuses both forms at once', () => {
    expect(() =>
      AssetSelection.parse({ assetIds: ['6a5f1e2c-90b4-4d1a-8f3e-2b7c9d0a1e45'], query: {} }),
    ).toThrow()
  })

  /*
   * The id branch of a bulk mutation never looks at `except`, so a request carrying both
   * trashes the photograph the caller explicitly excluded. Truncating the list quietly
   * would be a destructive action silently narrowed — undetectable until somebody goes
   * looking for a picture — so the shape is refused instead.
   */
  test('refuses exclusions beside an explicit id list', () => {
    expect(() =>
      AssetSelection.parse({
        assetIds: ['6a5f1e2c-90b4-4d1a-8f3e-2b7c9d0a1e45', '2b7c9d0a-1e45-4d1a-8f3e-6a5f1e2c90b4'],
        except: ['6a5f1e2c-90b4-4d1a-8f3e-2b7c9d0a1e45'],
      }),
    ).toThrow(/except/)
  })

  test('refuses neither form', () => {
    expect(() => AssetSelection.parse({})).toThrow()
  })
})
