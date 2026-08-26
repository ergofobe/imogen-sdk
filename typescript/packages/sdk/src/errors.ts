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
