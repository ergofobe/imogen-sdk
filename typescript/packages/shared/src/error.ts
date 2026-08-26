import { z } from 'zod'

/**
 * Every non-2xx response from the API has this shape. A single envelope means the SDK
 * has exactly one place to turn failures into typed errors.
 */
export const ApiError = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    /** Field-level detail for validation failures: path -> messages. */
    details: z.record(z.string(), z.array(z.string())).optional(),
  }),
})
export type ApiError = z.infer<typeof ApiError>

export const ERROR_CODES = {
  BAD_REQUEST: 'bad_request',
  VALIDATION_FAILED: 'validation_failed',
  UNAUTHORIZED: 'unauthorized',
  FORBIDDEN: 'forbidden',
  INSUFFICIENT_SCOPE: 'insufficient_scope',
  NOT_FOUND: 'not_found',
  CONFLICT: 'conflict',
  PAYLOAD_TOO_LARGE: 'payload_too_large',
  UNSUPPORTED_MEDIA_TYPE: 'unsupported_media_type',
  QUOTA_EXCEEDED: 'quota_exceeded',
  RATE_LIMITED: 'rate_limited',
  INTERNAL: 'internal_error',
} as const

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]
