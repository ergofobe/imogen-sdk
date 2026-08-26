import { Admin } from './admin.ts'
import { Albums } from './albums.ts'
import { Assets } from './assets.ts'
import { Auth } from './auth.ts'
import { type ClientOptions, HttpClient } from './http.ts'
import { People } from './people.ts'
import { Vault } from './vault.ts'

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

  constructor(options: ClientOptions) {
    this.http = new HttpClient(options)
    this.assets = new Assets(this.http)
    this.albums = new Albums(this.http)
    this.admin = new Admin(this.http)
    this.auth = new Auth(this.http)
    this.vault = new Vault(this.http)
    this.people = new People(this.http)
  }

  get baseUrl(): string {
    return this.http.baseUrl
  }

  /** Confirms the server is reachable and reports its version. */
  health(): Promise<{ status: string; version: string }> {
    return this.http.request('GET', '/api/v1/health')
  }
}
