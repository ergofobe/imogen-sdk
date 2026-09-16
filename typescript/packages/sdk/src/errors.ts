import type { ApiError, ErrorCode } from '@imogen/shared'

/**
 * Every failure from the API arrives as one of these, so a caller writes one catch
 * rather than inspecting status codes at each call site.
 */
export class ImogenError extends Error {
  readonly status: number
  readonly code: ErrorCode | string
  readonly details: Record<string, string[]> | undefined

  constructor(status: number, code: string, message: string, details?: Record<string, string[]>) {
    super(message)
    this.name = 'ImogenError'
    this.status = status
    this.code = code
    this.details = details
  }

  /** True when re-sending the same request might succeed. */
  get isRetryable(): boolean {
    return this.status === 429 || this.status >= 500
  }

  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403
  }

  static async fromResponse(response: Response): Promise<ImogenError> {
    const body = (await response.json().catch(() => null)) as ApiError | null
    if (body?.error) {
      return new ImogenError(
        response.status,
        body.error.code,
        body.error.message,
        body.error.details,
      )
    }
    return new ImogenError(
      response.status,
      'http_error',
      `${response.status} ${response.statusText}`.trim(),
    )
  }
}

/**
 * The answer was not the shape the contract promised.
 *
 * A subclass rather than a code on `ImogenError`, so the one catch a caller already
 * writes still sees it while code that cares can tell a server that said no from a
 * server that said something unreadable — the same split Rust draws between `Error::Api`
 * and `Error::Decode`.
 *
 * `status` is 0 because no HTTP status describes this: the response was a perfectly good
 * 200 whose body the contract does not admit. That also makes it unretryable, which is
 * right — a server that answered this once will answer it again.
 */
export class ImogenDecodeError extends ImogenError {
  /** The schema failure underneath, for a caller that wants to see which field it was. */
  override readonly cause: unknown

  constructor(method: string, path: string, cause: unknown) {
    super(0, 'invalid_response', `${method} ${path} answered with a body the contract cannot read`)
    this.name = 'ImogenDecodeError'
    this.cause = cause
  }
}
