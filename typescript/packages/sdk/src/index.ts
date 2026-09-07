// The API contract itself, so consumers need only one dependency.
export type {
  Album,
  AlbumCreate,
  AlbumUpdate,
  AlbumWithAssets,
  Asset,
  AssetQuery,
  AssetSelection,
  AssetType,
  AssetUpdate,
  AssetUploadResult,
  AssetVariant,
  AuthConfig,
  DetectedFace,
  FaceStatus,
  LibraryStats,
  OAuthScope,
  PairingClaim,
  PairingClaimRequest,
  PairingStatus,
  PairingTicket,
  Person,
  PersonUpdate,
  PersonWithPhotos,
  ProfileUpdate,
  ShareLink,
  TimelineBucket,
  TimelineBucketQuery,
  TimelineQuery,
  TimelineTile,
  User,
} from '@imogen/shared'
export * from './admin.js'
export { Albums } from './albums.js'
export {
  type AssetPage,
  Assets,
  type BulkUploadOptions,
  type BulkUploadResult,
  selectionBody,
  type TilePage,
  type UploadOptions,
  type UploadProgress,
} from './assets.js'
export { Auth } from './auth.js'
export { ImogenClient } from './client.js'
export { ImogenError } from './errors.js'
export {
  type ClientOptions,
  type FetchLike,
  HttpClient,
  type RequestOptions,
  type TokenProvider,
} from './http.js'
export {
  type AuthorizationServerMetadata,
  OAuthClient,
  type PendingAuthorization,
  type StoredTokens,
} from './oauth.js'
export { Pairing } from './pairing.js'
export { People } from './people.js'
export { Vault, type VaultStatus } from './vault.js'
