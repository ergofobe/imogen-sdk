import { Admin } from './admin.js'
import { Albums } from './albums.js'
import { Assets } from './assets.js'
import { Auth } from './auth.js'
import { type ClientOptions, HttpClient } from './http.js'
import { Pairing } from './pairing.js'
import { People } from './people.js'
import { Vault } from './vault.js'

/**
 * The imogen client.
 *
 * ```ts
 * const imogen = new ImogenClient({ baseUrl: 'https://photos.example.com', token })
 * const page = await imogen.assets.list({ q: 'harbour', limit: 50 })
 * ```
 *
 * In a browser served by imogen itself, omit `token`: the session cookie is enough.
 */
export class ImogenClient {
  readonly http: HttpClient
  readonly assets: Assets
  readonly albums: Albums
  readonly admin: Admin
  readonly auth: Auth
  readonly vault: Vault
  readonly people: People
  readonly pairing: Pairing

  constructor(options: ClientOptions) {
    this.http = new HttpClient(options)
    this.assets = new Assets(this.http)
    this.albums = new Albums(this.http)
    this.admin = new Admin(this.http)
    this.auth = new Auth(this.http)
    this.vault = new Vault(this.http)
    this.people = new People(this.http)
    this.pairing = new Pairing(this.http)
  }

  get baseUrl(): string {
    return this.http.baseUrl
  }

  /** Confirms the server is reachable and reports its version. */
  health(): Promise<{ status: string; version: string }> {
    return this.http.request('GET', '/api/v1/health')
  }
}
