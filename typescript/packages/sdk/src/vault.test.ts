import { expect, test } from 'bun:test'
import type { HttpClient, RequestOptions } from './http.ts'
import { Vault } from './vault.ts'

type RecordedCall = { method: string; path: string; query?: Record<string, unknown> }

function recordingHttp(payload: unknown): HttpClient & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  const http = {
    calls,
    baseUrl: 'https://example.test',
    url: (path: string) => path,
    request: async (method: string, path: string, options: RequestOptions = {}) => {
      calls.push({ method, path, query: options.query })
      return payload
    },
    send: async () => {
      throw new Error('recordingHttp: send() not implemented')
    },
  }
  return http as unknown as HttpClient & { calls: RecordedCall[] }
}

/**
 * The listing is capped, and the cap has to be visible. A return type that carries only
 * the rows cannot say "there are four thousand of these and you have two hundred", which
 * is the difference between a sample and the whole vault.
 */
test('the vault listing says how big the vault is, not just what fits in one answer', async () => {
  const http = recordingHttp({ items: [], nextCursor: null, total: 4096 })
  const page = await new Vault(http).list()

  expect(page.items).toEqual([])
  expect(page.total).toBe(4096)
  expect(http.calls[0]).toMatchObject({ method: 'GET', path: '/api/v1/vault/assets' })
})

test('the vault spine asks for one period and carries no filter', async () => {
  const http = recordingHttp({ items: [], nextCursor: null, total: 0 })
  await new Vault(http).timelineBucket({ period: '2011-08' })

  expect(http.calls[0]).toEqual({
    method: 'GET',
    path: '/api/v1/vault/timeline/bucket',
    query: { period: '2011-08' },
  })
})
