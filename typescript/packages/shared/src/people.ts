import { z } from 'zod'
import { Asset } from './asset.ts'

/** One cluster of faces the library believes belong to the same person. */
export const Person = z.object({
  id: z.uuid(),
  /** Null until somebody names them. An unnamed person is still browsable. */
  name: z.string().nullable(),
  /** The face used as their thumbnail. */
  coverFaceId: z.uuid().nullable(),
  photoCount: z.number().int().nonnegative(),
  hidden: z.boolean(),
})
export type Person = z.infer<typeof Person>

export const PersonWithPhotos = Person.extend({ photos: z.array(Asset) })
export type PersonWithPhotos = z.infer<typeof PersonWithPhotos>

/** Where a face sits in its photo, in the original image's pixels. */
export const DetectedFace = z.object({
  id: z.uuid(),
  assetId: z.uuid(),
  personId: z.uuid().nullable(),
  /** Null when this person has not been named yet. */
  personName: z.string().nullable(),
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  score: z.number(),
})
export type DetectedFace = z.infer<typeof DetectedFace>

export const PersonUpdate = z.object({
  name: z.string().min(1).max(128).nullable().optional(),
  hidden: z.boolean().optional(),
})
export type PersonUpdate = z.infer<typeof PersonUpdate>

export const MergePeople = z.object({
  /** The person who survives, keeping their name. */
  keepId: z.uuid(),
  mergeIds: z.array(z.uuid()).min(1).max(50),
})
export type MergePeople = z.infer<typeof MergePeople>

export const ReassignFaces = z.object({
  faceIds: z.array(z.uuid()).min(1).max(500),
  /** Null detaches the faces from any person. */
  personId: z.uuid().nullable(),
})
export type ReassignFaces = z.infer<typeof ReassignFaces>

/** What the settings screen needs to describe the feature's state. */
export const FaceStatus = z.object({
  enabled: z.boolean(),
  /** False until the models have been downloaded onto the server. */
  modelsReady: z.boolean(),
  /** Bytes downloaded so far, when a download is in progress. */
  models: z.array(
    z.object({
      name: z.string(),
      present: z.boolean(),
      bytes: z.number().int().nonnegative(),
      expectedBytes: z.number().int().nonnegative(),
    }),
  ),
  peopleCount: z.number().int().nonnegative(),
  /** Photos still waiting to be scanned. */
  pending: z.number().int().nonnegative(),
})
export type FaceStatus = z.infer<typeof FaceStatus>
