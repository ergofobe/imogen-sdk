import { z } from 'zod'

export const AssetType = z.enum(['image', 'video'])
export type AssetType = z.infer<typeof AssetType>

export const AssetVariant = z.enum(['original', 'preview', 'thumbnail'])
export type AssetVariant = z.infer<typeof AssetVariant>

/** Processing lifecycle. Clients show a placeholder until an asset reaches `ready`. */
export const AssetStatus = z.enum(['pending', 'processing', 'ready', 'failed'])
export type AssetStatus = z.infer<typeof AssetStatus>

export const ExifData = z.object({
  make: z.string().nullable(),
  model: z.string().nullable(),
  lens: z.string().nullable(),
  fNumber: z.number().nullable(),
  exposureTime: z.number().nullable(),
  iso: z.number().int().nullable(),
  focalLength: z.number().nullable(),
  orientation: z.number().int().nullable(),
})
export type ExifData = z.infer<typeof ExifData>

export const GeoPoint = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  altitude: z.number().nullable().default(null),
  /** Reverse-geocoded place name, when available. */
  place: z.string().nullable().default(null),
})
export type GeoPoint = z.infer<typeof GeoPoint>

export const Asset = z.object({
  id: z.uuid(),
  ownerId: z.uuid(),
  type: AssetType,
  status: AssetStatus,
  originalFilename: z.string(),
  mimeType: z.string(),
  /** SHA-256 of the original bytes. Stable identity across re-uploads. */
  checksum: z.string().length(64),
  sizeBytes: z.number().int().nonnegative(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  /** Seconds. Null for images. */
  duration: z.number().nonnegative().nullable(),
  /** Best available capture time — see resolution order in the design doc. */
  capturedAt: z.iso.datetime(),
  /** True when `capturedAt` came from EXIF rather than a fallback. */
  capturedAtIsExact: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable(),
  favorite: z.boolean(),
  archived: z.boolean(),
  description: z.string().nullable(),
  exif: ExifData.nullable(),
  location: GeoPoint.nullable(),
  /** Dominant colour of the thumbnail, for grid placeholders. */
  placeholderColor: z.string().nullable(),
  /** The paired video of an iPhone Live Photo, if this asset has one. */
  livePhotoVideoId: z.uuid().nullable(),
  /** Client-supplied stable id, used by mobile apps to avoid re-uploading. */
  deviceAssetId: z.string().nullable(),
})
export type Asset = z.infer<typeof Asset>

export const AssetUpdate = z.object({
  favorite: z.boolean().optional(),
  archived: z.boolean().optional(),
  description: z.string().max(4096).nullable().optional(),
  capturedAt: z.iso.datetime().optional(),
  location: GeoPoint.nullable().optional(),
})
export type AssetUpdate = z.infer<typeof AssetUpdate>

/** Metadata a client may attach at upload time. All fields are hints; EXIF wins. */
export const AssetUploadMetadata = z.object({
  deviceAssetId: z.string().max(512).optional(),
  capturedAt: z.iso.datetime().optional(),
  favorite: z.coerce.boolean().optional(),
  filename: z.string().max(1024).optional(),
})
export type AssetUploadMetadata = z.infer<typeof AssetUploadMetadata>

export const AssetUploadResult = z.object({
  asset: Asset,
  /** True when the checksum already existed and no new file was stored. */
  duplicate: z.boolean(),
})
export type AssetUploadResult = z.infer<typeof AssetUploadResult>
