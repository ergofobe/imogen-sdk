import type {
  Asset,
  AssetSelection,
  TimelineBucket,
  TimelineBucketQuery,
} from '@imogen/shared'
import { selectionBody, type TilePage } from './assets.ts'
import type { HttpClient } from './http.ts'

export type VaultStatus = {
  configured: boolean
  unlocked: boolean
  /** Only present while unlocked: a locked vault does not reveal its size. */
  count?: number
}

/**
 * The vault holds photographs kept out of the ordinary library entirely — absent from
 * the timeline, search, albums, shared links, and anything an AI assistant can reach.
 *
 * It opens only for a signed-in browser session that re-enters the vault passphrase.
 * A bearer token cannot open it, so these methods are unavailable to API clients by
 * design rather than by omission.
 */
export class Vault {
  constructor(private readonly http: HttpClient) {}

  status(): Promise<VaultStatus> {
    return this.http.request<VaultStatus>('GET', '/api/v1/vault/status')
  }

  /** Sets the passphrase. Changing an existing one requires the vault to be open. */
  setPassphrase(passphrase: string): Promise<void> {
    return this.http.request<void>('POST', '/api/v1/vault/setup', { body: { passphrase } })
  }

  unlock(passphrase: string): Promise<void> {
    return this.http.request<void>('POST', '/api/v1/vault/unlock', { body: { passphrase } })
  }

  lock(): Promise<void> {
    return this.http.request<void>('POST', '/api/v1/vault/lock')
  }

  async list(limit = 200): Promise<Asset[]> {
    const page = await this.http.request<{ items: Asset[] }>('GET', '/api/v1/vault/assets', {
      query: { limit },
    })
    return page.items
  }

  /**
   * One row per day in the vault, for sizing the grid before any tile arrives.
   *
   * The vault has a spine of its own because it cannot have a filter: `AssetFilter`
   * deliberately cannot express "inside the vault", so the scoping is done server-side
   * behind the unlock rather than by anything the caller sends.
   */
  timeline(query: { covers?: boolean } = {}): Promise<{ buckets: TimelineBucket[] }> {
    return this.http.request('GET', '/api/v1/vault/timeline', { query })
  }

  timelineBucket(
    query: Pick<TimelineBucketQuery, 'period'> & { cursor?: string; limit?: number },
  ): Promise<TilePage> {
    return this.http.request<TilePage>('GET', '/api/v1/vault/timeline/bucket', { query })
  }

  moveIn(selection: string[] | AssetSelection): Promise<{ moved: number }> {
    return this.http.request('POST', '/api/v1/vault/assets', { body: selectionBody(selection) })
  }

  moveOut(selection: string[] | AssetSelection): Promise<{ moved: number }> {
    return this.http.request('DELETE', '/api/v1/vault/assets', { body: selectionBody(selection) })
  }
}
