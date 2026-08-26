// The API contract itself, so consumers need only one dependency.
export type {
  Album,
  AlbumCreate,
  AlbumUpdate,
  AlbumWithAssets,
  Asset,
  AssetQuery,
  AssetType,
  AssetUpdate,
  AssetUploadResult,
  AssetVariant,
  AuthConfig,
  DetectedFace,
  FaceStatus,
  LibraryStats,
  OAuthScope,
  Person,
  PersonUpdate,
  PersonWithPhotos,
  ProfileUpdate,
  ShareLink,
  TimelineBucket,
  User,
} from '@imogen/shared'
export * from './admin.ts'
export { Albums } from './albums.ts'
export {
  type AssetPage,
  Assets,
  type BulkUploadOptions,
  type BulkUploadResult,
  type UploadOptions,
  type UploadProgress,
} from './assets.ts'
export { Auth } from './auth.ts'
export { ImogenClient } from './client.ts'
export { ImogenError } from './errors.ts'
export { type ClientOptions, HttpClient, type TokenProvider } from './http.ts'
export {
  type AuthorizationServerMetadata,
  OAuthClient,
  type PendingAuthorization,
  type StoredTokens,
} from './oauth.ts'
export { People } from './people.ts'
export { Vault, type VaultStatus } from './vault.ts'
