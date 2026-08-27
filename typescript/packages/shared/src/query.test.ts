import { describe, expect, test } from 'bun:test'
import {
  AssetFilter,
  AssetSelection,
  TimelineBucket,
  TimelineBucketQuery,
  TimelineTile,
} from './query.ts'

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

  test('refuses neither form', () => {
    expect(() => AssetSelection.parse({})).toThrow()
  })
})
