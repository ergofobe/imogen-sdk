import type { ClientRegistrationResponse, TokenResponse } from '@imogen/shared'
import type { FetchLike } from './http.ts'

export type AuthorizationServerMetadata = {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  registration_endpoint: string
  revocation_endpoint: string
  scopes_supported: string[]
  code_challenge_methods_supported: string[]
}

export type PendingAuthorization = {
  authorizationUrl: string
  /** Hold these until the redirect comes back; they complete the exchange. */
  codeVerifier: string
  state: string
  redirectUri: string
  clientId: string
}

export type StoredTokens = TokenResponse & { obtainedAt: number }

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomString(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return base64url(bytes)
}

async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64url(new Uint8Array(digest))
}

/**
 * The OAuth 2.1 client a native application needs: discover the server, register itself,
 * run authorization code with PKCE, and refresh. No client secret is involved, because a
 * secret shipped inside a mobile app is not a secret.
 *
 * ```ts
 * const oauth = new OAuthClient('https://photos.example.com')
 * const client = await oauth.register('My Photo App', ['myapp://oauth'])
 * const pending = await oauth.beginAuthorization(client.client_id, 'myapp://oauth')
 * // open pending.authorizationUrl in the system browser, then on the callback:
 * const tokens = await oauth.completeAuthorization(pending, callbackUrl)
 * ```
 */
export class OAuthClient {
  private metadata: AuthorizationServerMetadata | null = null

  constructor(
    private readonly baseUrl: string,
    private readonly doFetch: FetchLike = globalThis.fetch.bind(globalThis),
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
  }

  async discover(): Promise<AuthorizationServerMetadata> {
    if (this.metadata) return this.metadata
    const response = await this.doFetch(`${this.baseUrl}/.well-known/oauth-authorization-server`)
    if (!response.ok) throw new Error(`Could not read the authorization server metadata`)
    this.metadata = (await response.json()) as AuthorizationServerMetadata
    return this.metadata
  }

  /** RFC 7591 dynamic registration, so an app never ships a hard-coded client id. */
  async register(
    name: string,
    redirectUris: string[],
    scopes: string[] = ['library:read', 'library:write', 'albums:read', 'albums:write'],
  ): Promise<ClientRegistrationResponse> {
    const metadata = await this.discover()
    const response = await this.doFetch(metadata.registration_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: name,
        redirect_uris: redirectUris,
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        scope: scopes.join(' '),
      }),
    })
    if (!response.ok) throw new Error(`Registration failed: ${await response.text()}`)
    return (await response.json()) as ClientRegistrationResponse
  }

  async beginAuthorization(
    clientId: string,
    redirectUri: string,
    scopes: string[] = ['library:read', 'library:write', 'albums:read', 'albums:write'],
  ): Promise<PendingAuthorization> {
    const metadata = await this.discover()
    const codeVerifier = randomString()
    const state = randomString(16)

    const url = new URL(metadata.authorization_endpoint)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('scope', scopes.join(' '))
    url.searchParams.set('state', state)
    url.searchParams.set('code_challenge', await s256(codeVerifier))
    url.searchParams.set('code_challenge_method', 'S256')

    return { authorizationUrl: url.toString(), codeVerifier, state, redirectUri, clientId }
  }

  async completeAuthorization(
    pending: PendingAuthorization,
    callbackUrl: string,
  ): Promise<StoredTokens> {
    const url = new URL(callbackUrl)

    const error = url.searchParams.get('error')
    if (error) {
      throw new Error(url.searchParams.get('error_description') ?? `Authorization failed: ${error}`)
    }
    // Checking state is what stops a code from another session being injected here.
    if (url.searchParams.get('state') !== pending.state) {
      throw new Error('Authorization state did not match; the response may have been tampered with')
    }
    const code = url.searchParams.get('code')
    if (!code) throw new Error('The callback carried no authorization code')

    return this.exchange({
      grant_type: 'authorization_code',
      client_id: pending.clientId,
      code,
      code_verifier: pending.codeVerifier,
      redirect_uri: pending.redirectUri,
    })
  }

  async refresh(clientId: string, refreshToken: string): Promise<StoredTokens> {
    return this.exchange({
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: refreshToken,
    })
  }

  async revoke(token: string): Promise<void> {
    const metadata = await this.discover()
    await this.doFetch(metadata.revocation_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    })
  }

  /** True when the access token is expired or close enough that it should be refreshed. */
  static isExpired(tokens: StoredTokens, skewSeconds = 60): boolean {
    return Date.now() >= tokens.obtainedAt + (tokens.expires_in - skewSeconds) * 1000
  }

  private async exchange(params: Record<string, string>): Promise<StoredTokens> {
    const metadata = await this.discover()
    const response = await this.doFetch(metadata.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    })
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: string
        error_description?: string
      } | null
      throw new Error(body?.error_description ?? body?.error ?? 'Token request failed')
    }
    const tokens = (await response.json()) as TokenResponse
    return { ...tokens, obtainedAt: Date.now() }
  }
}
