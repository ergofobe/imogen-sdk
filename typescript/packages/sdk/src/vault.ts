import type { AssetSelection, TimelineBucketQuery } from '@imogen/shared'
import { AssetPage, TilePage, Timeline, VaultMoveResult, VaultStatus } from '@imogen/shared'
import { selectionBody } from './assets.js'
import type { HttpClient } from './http.js'

// Re-exported rather than restated: the status is a model in the contract like any other.
export type { VaultStatus } from '@imogen/shared'

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
    return this.http.request('GET', '/api/v1/vault/status', { decode: VaultStatus })
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

  /**
   * A sample of the vault, newest first, and how big the vault actually is.
   *
   * `total` rather than just the rows, because this endpoint is capped and the cap used to
   * be invisible: it answered two hundred photographs with no cursor and no count, which
   * reads as "that is all of them" and for a larger vault simply was not true. A caller
   * that wants the whole thing wants `timeline` and `timelineBucket`; this is for anything
   * that wants a handful of recent rows without laying out a grid, and `total` is what lets
   * it know that is what it got.
   *
   * The ordinary `AssetPage` rather than a shape of its own, because the server answers
   * `pageOf(Asset)` here like everywhere else. `nextCursor` is always null: this endpoint
   * does not page, which is exactly what `total` beside a null cursor is there to say.
   */
  list(limit = 200): Promise<AssetPage> {
    return this.http.request('GET', '/api/v1/vault/assets', {
      query: { limit },
      decode: AssetPage,
    })
  }

  /**
   * One row per day in the vault, for sizing the grid before any tile arrives.
   *
   * The vault has a spine of its own because it cannot have a filter: `AssetFilter`
   * deliberately cannot express "inside the vault", so the scoping is done server-side
   * behind the unlock rather than by anything the caller sends.
   */
  timeline(query: { covers?: boolean } = {}): Promise<Timeline> {
    return this.http.request('GET', '/api/v1/vault/timeline', { query, decode: Timeline })
  }

  /**
   * Every tile in one period of the vault. `period`, `cursor` and `limit` only — the
   * route parses nothing else, and a filter it accepted would be a filter that could
   * widen what the vault hands back.
   */
  timelineBucket(
    query: Pick<TimelineBucketQuery, 'period'> & { cursor?: string; limit?: number },
  ): Promise<TilePage> {
    return this.http.request('GET', '/api/v1/vault/timeline/bucket', {
      query,
      decode: TilePage,
    })
  }

  moveIn(selection: string[] | AssetSelection): Promise<{ moved: number }> {
    return this.http.request('POST', '/api/v1/vault/assets', {
      body: selectionBody(selection),
      decode: VaultMoveResult,
    })
  }

  moveOut(selection: string[] | AssetSelection): Promise<{ moved: number }> {
    return this.http.request('DELETE', '/api/v1/vault/assets', {
      body: selectionBody(selection),
      decode: VaultMoveResult,
    })
  }
}
