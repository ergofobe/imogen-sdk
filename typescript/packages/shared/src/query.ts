import { z } from 'zod'
import { AssetType } from './asset.ts'

/**
 * Cursor pagination. Offsets are wrong for a timeline that grows while you scroll:
 * an upload shifts every later page by one. The cursor encodes the last seen
 * (capturedAt, id) pair, so results stay stable.
 */
export const PageQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
})
export type PageQuery = z.infer<typeof PageQuery>

export function pageOf<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
    /** Total matching rows, when cheap to compute. Null means "not counted". */
    total: z.number().int().nonnegative().nullable(),
  })
}

export const AssetSort = z.enum(['capturedAt', 'createdAt', 'filename'])
export type AssetSort = z.infer<typeof AssetSort>

export const AssetQuery = PageQuery.extend({
  /** Free-text over filename, description, camera, and place. */
  q: z.string().max(512).optional(),
  type: AssetType.optional(),
  albumId: z.uuid().optional(),
  favorite: z.coerce.boolean().optional(),
  archived: z.coerce.boolean().optional(),
  /** When true, returns only trashed assets. Trashed assets are hidden otherwise. */
  trashed: z.coerce.boolean().optional(),
  takenAfter: z.iso.datetime().optional(),
  takenBefore: z.iso.datetime().optional(),
  /** Bounding box filter: minLat,minLon,maxLat,maxLon */
  bbox: z
    .string()
    .regex(/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/, 'expected minLat,minLon,maxLat,maxLon')
    .optional(),
  sort: AssetSort.default('capturedAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
})
export type AssetQuery = z.infer<typeof AssetQuery>

/** A day bucket in the timeline, used to size the scroller before assets load. */
export const TimelineBucket = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  count: z.number().int().positive(),
})
export type TimelineBucket = z.infer<typeof TimelineBucket>

export const LibraryStats = z.object({
  assetCount: z.number().int().nonnegative(),
  imageCount: z.number().int().nonnegative(),
  videoCount: z.number().int().nonnegative(),
  albumCount: z.number().int().nonnegative(),
  favoriteCount: z.number().int().nonnegative(),
  trashedCount: z.number().int().nonnegative(),
  storageBytes: z.number().int().nonnegative(),
  earliestCapturedAt: z.iso.datetime().nullable(),
  latestCapturedAt: z.iso.datetime().nullable(),
})
export type LibraryStats = z.infer<typeof LibraryStats>
