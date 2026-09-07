import { z } from 'zod'
import { Asset } from './asset.js'

export const Album = z.object({
  id: z.uuid(),
  ownerId: z.uuid(),
  name: z.string().min(1).max(256),
  description: z.string().max(4096).nullable(),
  coverAssetId: z.uuid().nullable(),
  assetCount: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  /** Set when the album has an active public share link. */
  shareSlug: z.string().nullable(),
})
export type Album = z.infer<typeof Album>

export const AlbumWithAssets = Album.extend({
  assets: z
    .array(Asset)
    .describe(
      'A cover sample, not the whole album: at most 60 photographs, newest ' +
        '(capturedAt desc, id desc) first. For every photo in the album, page ' +
        "GET /assets or GET /assets/timeline/bucket with albumId set to this album's id.",
    ),
})
export type AlbumWithAssets = z.infer<typeof AlbumWithAssets>

export const AlbumCreate = z.object({
  name: z.string().min(1).max(256),
  description: z.string().max(4096).optional(),
  assetIds: z.array(z.uuid()).max(1000).optional(),
})
export type AlbumCreate = z.infer<typeof AlbumCreate>

export const AlbumUpdate = z.object({
  name: z.string().min(1).max(256).optional(),
  description: z.string().max(4096).nullable().optional(),
  coverAssetId: z.uuid().nullable().optional(),
})
export type AlbumUpdate = z.infer<typeof AlbumUpdate>

export const AlbumAssetsMutation = z.object({
  assetIds: z.array(z.uuid()).min(1).max(1000),
})
export type AlbumAssetsMutation = z.infer<typeof AlbumAssetsMutation>

/** Result of adding assets: additions are idempotent, so report what actually changed. */
export const AlbumAssetsResult = z.object({
  added: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  assetCount: z.number().int().nonnegative(),
})
export type AlbumAssetsResult = z.infer<typeof AlbumAssetsResult>

export const ShareLink = z.object({
  slug: z.string(),
  url: z.url(),
  /** Exactly one of these is set: a link points at an album or at one photograph. */
  albumId: z.uuid().nullable(),
  assetId: z.uuid().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  allowDownload: z.boolean(),
  createdAt: z.iso.datetime(),
})
export type ShareLink = z.infer<typeof ShareLink>

export const ShareLinkCreate = z.object({
  expiresAt: z.iso.datetime().nullable().optional(),
  allowDownload: z.boolean().default(true),
  password: z.string().min(4).max(256).nullable().optional(),
})
export type ShareLinkCreate = z.infer<typeof ShareLinkCreate>
