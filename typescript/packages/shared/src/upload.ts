import { z } from 'zod'
import { AssetUploadMetadata, AssetUploadResult } from './asset.ts'

/**
 * Resumable uploads for large files. A phone on a train should resume a 2 GB video,
 * not restart it. The SDK chooses this path automatically above a size threshold.
 */
export const UploadSessionCreate = AssetUploadMetadata.extend({
  filename: z.string().min(1).max(1024),
  sizeBytes: z.number().int().positive(),
  mimeType: z.string().min(1).max(256),
  /** Optional SHA-256 known in advance; lets the server short-circuit a duplicate. */
  checksum: z.string().length(64).optional(),
})
export type UploadSessionCreate = z.infer<typeof UploadSessionCreate>

export const UploadSession = z.object({
  id: z.uuid(),
  /** Bytes already stored. A resuming client PATCHes from this offset. */
  offset: z.number().int().nonnegative(),
  sizeBytes: z.number().int().positive(),
  expiresAt: z.iso.datetime(),
  /** Set when the server recognised the checksum and no upload is needed. */
  existing: AssetUploadResult.nullable(),
})
export type UploadSession = z.infer<typeof UploadSession>

export const BULK_UPLOAD_CONCURRENCY = 6
/** Files at or above this size use the resumable protocol. */
export const RESUMABLE_THRESHOLD_BYTES = 64 * 1024 * 1024
export const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024
