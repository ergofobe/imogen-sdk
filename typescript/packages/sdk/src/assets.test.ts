import { expect, test } from 'bun:test'
import { Assets } from './assets.ts'
import type { HttpClient, RequestOptions } from './http.ts'

type RecordedCall = {
  method: string
  path: string
  query?: Record<string, unknown>
  body?: unknown
}

function recordingHttp(payload: unknown): HttpClient & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  const http = {
    calls,
    baseUrl: 'https://example.test',
    url: (path: string) => path,
    request: async (method: string, path: string, options: RequestOptions = {}) => {
      calls.push({ method, path, query: options.query, body: options.body })
      return payload
    },
    send: async () => {
      throw new Error('recordingHttp: send() not implemented')
    },
  }
  return http as unknown as HttpClient & { calls: RecordedCall[] }
}

test('timelineBucket asks for one period', async () => {
  const http = recordingHttp({ items: [], nextCursor: null, total: 0 })
  await new Assets(http).timelineBucket({ period: '2011-08', limit: 5000 })
  expect(http.calls[0]).toMatchObject({
    method: 'GET',
    path: '/api/v1/assets/timeline/bucket',
    query: { period: '2011-08', limit: 5000 },
  })
})

test('trash accepts a bare id list, as it always has', async () => {
  const http = recordingHttp({ count: 1 })
  await new Assets(http).trash(['6a5f1e2c-90b4-4d1a-8f3e-2b7c9d0a1e45'])
  expect(http.calls[0]?.body).toEqual({ assetIds: ['6a5f1e2c-90b4-4d1a-8f3e-2b7c9d0a1e45'] })
})

test('trash accepts a selection by query', async () => {
  const http = recordingHttp({ count: 12431 })
  await new Assets(http).trash({ query: { favorite: true }, except: [] })
  expect(http.calls[0]?.body).toEqual({ query: { favorite: true }, except: [] })
})
