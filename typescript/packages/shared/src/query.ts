import { z } from 'zod'
import { AssetStatus, AssetType } from './asset.js'

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

/**
 * The filters every listing shares. Extracted so the timeline aggregate, the bucket
 * endpoint, and a by-query selection cannot drift from what `GET /assets` accepts —
 * three definitions of "which photographs" is three chances to disagree.
 */
export const AssetFilter = z.object({
  /** Free-text over filename, description, camera, and place. */
  q: z.string().max(512).optional(),
  type: AssetType.optional(),
  albumId: z.uuid().optional(),
  /** Photographs a given person appears in. */
  personId: z.uuid().optional(),
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
})
export type AssetFilter = z.infer<typeof AssetFilter>

export const AssetQuery = PageQuery.extend(AssetFilter.shape).extend({
  sort: AssetSort.default('capturedAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
})
export type AssetQuery = z.infer<typeof AssetQuery>

/** A day bucket in the timeline, used to size the scroller before assets load. */
export const TimelineBucket = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  count: z.number().int().positive(),
  /**
   * The newest ready asset in the bucket, for an overview's period card. Null unless
   * `covers` was asked for, and null for a period whose photographs are all still being
   * processed — such a period shows a count without a picture rather than vanishing.
   */
  coverAssetId: z.uuid().nullable().default(null),
})
export type TimelineBucket = z.infer<typeof TimelineBucket>

export const TimelineQuery = AssetFilter.extend({
  covers: z.coerce.boolean().optional(),
})
export type TimelineQuery = z.infer<typeof TimelineQuery>

/**
 * Everything a grid tile draws, and nothing else. An `Asset` carries checksum, exif,
 * filenames, and both captured-at corrections — around 800 bytes against this one's
 * 200 — none of which a tile reads. Over a heavy month that is the difference between
 * one round trip and several.
 */
export const TimelineTile = z.object({
  id: z.uuid(),
  capturedAt: z.iso.datetime(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  type: AssetType,
  status: AssetStatus,
  favorite: z.boolean(),
  duration: z.number().nonnegative().nullable(),
  placeholderColor: z.string().nullable(),
  livePhotoVideoId: z.uuid().nullable(),
})
export type TimelineTile = z.infer<typeof TimelineTile>

export const TimelineBucketQuery = AssetFilter.extend({
  /**
   * `YYYY-MM` or `YYYY-MM-DD`. A bare year is refused: it would be a whole-library scan
   * asked for by accident.
   */
  period: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/, 'expected YYYY-MM or YYYY-MM-DD'),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(10_000).default(5000),
})
export type TimelineBucketQuery = z.infer<typeof TimelineBucketQuery>

/**
 * What a bulk mutation acts on. Either an explicit list, or the filter the user was
 * looking at minus whatever they unticked — so "select all" in a hundred-thousand-photo
 * library is a filter, not a hundred thousand uuids in a request body.
 *
 * Two optional fields and a refinement rather than a discriminated union: a union costs
 * a Rust enum, a Swift enum with associated values, and a Kotlin sealed class, and buys
 * nothing.
 */
export const AssetSelection = z
  .object({
    assetIds: z.array(z.uuid()).min(1).max(1000).optional(),
    query: AssetFilter.optional(),
    /** Capped deliberately: past this, an interface should not be offering a selection. */
    except: z.array(z.uuid()).max(10_000).optional(),
  })
  .superRefine((value, ctx) => {
    const problem = assetSelectionProblem(value)
    if (problem) ctx.addIssue({ code: 'custom', message: problem })
  })
export type AssetSelection = z.infer<typeof AssetSelection>

/**
 * Why a selection cannot be sent, or null when it can.
 *
 * Written out rather than left inside the refinement because a client should learn this
 * before the request leaves, not from a 400: every port checks the same two rules, and
 * the SDK's own selection helper checks them with this.
 */
export function assetSelectionProblem(selection: {
  assetIds?: unknown
  query?: unknown
  except?: unknown
}): string | null {
  if ((selection.assetIds === undefined) === (selection.query === undefined)) {
    return 'Provide exactly one of assetIds or query'
  }
  /*
   * `except` narrows a filter; beside an explicit list it is a contradiction, and the
   * server's id branch never reads it — so honouring the request would trash the very
   * photographs the caller excluded. Rejecting matches the cap rule above: a destructive
   * action that has been silently narrowed is undetectable until somebody goes looking
   * for a picture that is no longer there.
   */
  if (selection.assetIds !== undefined && selection.except !== undefined) {
    return 'except narrows a query selection only; with assetIds, leave the unwanted ids out of the list'
  }
  return null
}

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
