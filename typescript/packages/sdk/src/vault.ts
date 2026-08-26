import type { Asset } from '@imogen/shared'
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

  moveIn(assetIds: string[]): Promise<{ moved: number }> {
    return this.http.request('POST', '/api/v1/vault/assets', { body: { assetIds } })
  }

  moveOut(assetIds: string[]): Promise<{ moved: number }> {
    return this.http.request('DELETE', '/api/v1/vault/assets', { body: { assetIds } })
  }
}
