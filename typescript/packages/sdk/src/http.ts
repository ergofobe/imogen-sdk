import { ImogenError } from './errors.ts'

export type TokenProvider = string | (() => string | null | Promise<string | null>)

/**
 * Deliberately looser than `typeof fetch`: React Native, test harnesses, and proxies
 * supply a plain function, and requiring the runtime's exact signature would reject them.
 */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export type ClientOptions = {
  /** Where imogen lives, e.g. `https://photos.example.com`. */
  baseUrl: string
  /**
   * A bearer token, or a function returning one. Omit in a browser that already holds
   * a session cookie.
   */
  token?: TokenProvider
  /** Called when the server rejects a token, so an app can refresh and retry once. */
  onUnauthorized?: () => Promise<string | null>
  fetch?: FetchLike
  /** How many times to retry a request that failed for a transient reason. */
  maxRetries?: number
}

export type RequestOptions = {
  query?: Record<string, unknown>
  body?: unknown
  formData?: FormData
  headers?: Record<string, string>
  signal?: AbortSignal
  /** Raw bytes, for chunked uploads. */
  raw?: BodyInit
}

/**
 * The transport every resource shares: URL building, auth, the error envelope, and
 * one retry policy. Resources above this layer contain no HTTP details at all.
 */
export class HttpClient {
  readonly baseUrl: string
  private readonly options: ClientOptions
  private readonly doFetch: FetchLike

  constructor(options: ClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.options = options
    this.doFetch = options.fetch ?? globalThis.fetch.bind(globalThis)
  }

  url(path: string, query?: Record<string, unknown>): string {
    const url = new URL(`${this.baseUrl}${path}`)
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null) continue
      url.searchParams.set(key, String(value))
    }
    return url.toString()
  }

  private async authorization(): Promise<string | null> {
    const token = this.options.token
    if (!token) return null
    const value = typeof token === 'function' ? await token() : token
    return value ? `Bearer ${value}` : null
  }

  async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.send(method, path, options)
    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  }

  async send(method: string, path: string, options: RequestOptions = {}): Promise<Response> {
    const maxRetries = this.options.maxRetries ?? 2
    let lastError: unknown

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.attempt(method, path, options)

        if (response.status === 401 && this.options.onUnauthorized && attempt === 0) {
          // Give the caller one chance to refresh, then try again with the new token.
          const refreshed = await this.options.onUnauthorized()
          if (refreshed) continue
        }

        if (!response.ok) {
          const error = await ImogenError.fromResponse(response)
          if (error.isRetryable && attempt < maxRetries) {
            lastError = error
            await backoff(attempt)
            continue
          }
          throw error
        }

        return response
      } catch (error) {
        // A network failure is worth retrying; a rejection from the server is not.
        if (error instanceof ImogenError && !error.isRetryable) throw error
        if (options.signal?.aborted) throw error
        if (attempt === maxRetries) throw error
        lastError = error
        await backoff(attempt)
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Request failed')
  }

  private async attempt(method: string, path: string, options: RequestOptions): Promise<Response> {
    const headers: Record<string, string> = { ...options.headers }

    const authorization = await this.authorization()
    if (authorization) headers.Authorization = authorization

    let body: BodyInit | undefined
    if (options.formData) {
      body = options.formData
    } else if (options.raw !== undefined) {
      body = options.raw
    } else if (options.body !== undefined) {
      headers['Content-Type'] ??= 'application/json'
      body = JSON.stringify(options.body)
    }

    return this.doFetch(this.url(path, options.query), {
      method,
      headers,
      ...(body !== undefined ? { body } : {}),
      // Carries the session cookie in a browser; harmless everywhere else.
      credentials: 'include',
      ...(options.signal ? { signal: options.signal } : {}),
    })
  }
}

function backoff(attempt: number): Promise<void> {
  const base = 2 ** attempt * 250
  // Jitter, so a fleet of phones retrying after an outage does not arrive in lockstep.
  const delay = base + Math.random() * base
  return new Promise((resolve) => setTimeout(resolve, delay))
}
