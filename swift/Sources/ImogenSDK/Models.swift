import Foundation

// The API contract, as Swift types.
//
// JSON keys are camelCase and so are Swift properties, so almost nothing here needs
// CodingKeys. The exception is the OAuth payloads, which are snake_case on the wire.
//
// Timestamps stay `String` rather than becoming `Date`. The contract specifies ISO-8601
// and nothing else, and a client that reformats on the way through is a client that
// eventually sends back something the server did not give it.

// MARK: - Assets

public enum AssetType: String, Codable, Sendable, CaseIterable {
    case image, video
}

public enum AssetVariant: String, Codable, Sendable, CaseIterable {
    case original, preview, thumbnail
}

/// Processing lifecycle. Clients show a placeholder until an asset reaches `ready`.
public enum AssetStatus: String, Codable, Sendable, CaseIterable {
    case pending, processing, ready, failed
}

public struct ExifData: Codable, Hashable, Sendable {
    public var make: String?
    public var model: String?
    public var lens: String?
    public var fNumber: Double?
    public var exposureTime: Double?
    public var iso: Int?
    public var focalLength: Double?
    public var orientation: Int?
}

public struct GeoPoint: Codable, Hashable, Sendable {
    public var latitude: Double
    public var longitude: Double
    public var altitude: Double?
    /// Reverse-geocoded place name, when available.
    public var place: String?

    public init(latitude: Double, longitude: Double, altitude: Double? = nil, place: String? = nil) {
        self.latitude = latitude
        self.longitude = longitude
        self.altitude = altitude
        self.place = place
    }
}

public struct Asset: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var ownerId: String
    public var type: AssetType
    public var status: AssetStatus
    public var originalFilename: String
    public var mimeType: String
    /// SHA-256 of the original bytes. Stable identity across re-uploads.
    public var checksum: String
    public var sizeBytes: Int
    public var width: Int?
    public var height: Int?
    /// Seconds. `nil` for images.
    public var duration: Double?
    public var capturedAt: String
    /// True when `capturedAt` came from EXIF rather than a fallback.
    public var capturedAtIsExact: Bool
    /// The capture date before the owner corrected it, or `nil` if never corrected.
    public var capturedAtOriginal: String?
    public var capturedAtOriginalIsExact: Bool?
    public var createdAt: String
    public var updatedAt: String
    public var deletedAt: String?
    public var favorite: Bool
    public var archived: Bool
    public var description: String?
    public var exif: ExifData?
    public var location: GeoPoint?
    /// Dominant colour of the thumbnail, for grid placeholders.
    public var placeholderColor: String?
    /// The paired video of an iPhone Live Photo, if this asset has one.
    public var livePhotoVideoId: String?
    /// Client-supplied stable id, used by mobile apps to avoid re-uploading.
    public var deviceAssetId: String?
}

public struct AssetUpdate: Codable, Hashable, Sendable {
    public var favorite: Bool?
    public var archived: Bool?
    public var description: String?
    public var capturedAt: String?
    /// Puts back the date the file was imported with, discarding any correction.
    public var resetCapturedAt: Bool?
    public var location: GeoPoint?

    public init(
        favorite: Bool? = nil,
        archived: Bool? = nil,
        description: String? = nil,
        capturedAt: String? = nil,
        resetCapturedAt: Bool? = nil,
        location: GeoPoint? = nil
    ) {
        self.favorite = favorite
        self.archived = archived
        self.description = description
        self.capturedAt = capturedAt
        self.resetCapturedAt = resetCapturedAt
        self.location = location
    }
}

/// Metadata a client may attach at upload time. All fields are hints; EXIF wins.
public struct AssetUploadMetadata: Codable, Hashable, Sendable {
    public var deviceAssetId: String?
    public var capturedAt: String?
    public var favorite: Bool?
    public var filename: String?

    public init(
        deviceAssetId: String? = nil,
        capturedAt: String? = nil,
        favorite: Bool? = nil,
        filename: String? = nil
    ) {
        self.deviceAssetId = deviceAssetId
        self.capturedAt = capturedAt
        self.favorite = favorite
        self.filename = filename
    }
}

public struct AssetUploadResult: Codable, Hashable, Sendable {
    public var asset: Asset
    /// True when the checksum already existed and no new file was stored.
    public var duplicate: Bool
}

public struct AssetPage: Codable, Hashable, Sendable {
    public var items: [Asset]
    public var nextCursor: String?
    /// Total matching rows, when cheap to compute. `nil` means "not counted".
    public var total: Int?
}

// MARK: - Queries

public enum AssetSort: String, Codable, Sendable {
    case capturedAt, createdAt, filename
}

public enum SortOrder: String, Codable, Sendable {
    case asc, desc
}

/// Cursor pagination.
///
/// Offsets are wrong for a timeline that grows while you scroll: an upload shifts every
/// later page by one. The cursor encodes the last seen `(capturedAt, id)` pair.
public struct AssetQuery: Hashable, Sendable {
    public var cursor: String?
    public var limit: Int?
    /// Free-text over filename, description, camera, and place.
    public var q: String?
    public var type: AssetType?
    public var albumId: String?
    public var favorite: Bool?
    public var archived: Bool?
    /// When true, returns only trashed assets. Trashed assets are hidden otherwise.
    public var trashed: Bool?
    public var takenAfter: String?
    public var takenBefore: String?
    /// Bounding box filter: `minLat,minLon,maxLat,maxLon`.
    public var bbox: String?
    public var sort: AssetSort?
    public var order: SortOrder?

    public init(
        cursor: String? = nil,
        limit: Int? = nil,
        q: String? = nil,
        type: AssetType? = nil,
        albumId: String? = nil,
        favorite: Bool? = nil,
        archived: Bool? = nil,
        trashed: Bool? = nil,
        takenAfter: String? = nil,
        takenBefore: String? = nil,
        bbox: String? = nil,
        sort: AssetSort? = nil,
        order: SortOrder? = nil
    ) {
        self.cursor = cursor
        self.limit = limit
        self.q = q
        self.type = type
        self.albumId = albumId
        self.favorite = favorite
        self.archived = archived
        self.trashed = trashed
        self.takenAfter = takenAfter
        self.takenBefore = takenBefore
        self.bbox = bbox
        self.sort = sort
        self.order = order
    }

    /// Flattened to the query string the API expects. Absent fields stay absent, so the
    /// server applies its own defaults rather than ours.
    public var queryItems: [URLQueryItem] {
        var items: [URLQueryItem] = []
        func add(_ name: String, _ value: String?) {
            if let value { items.append(URLQueryItem(name: name, value: value)) }
        }

        add("cursor", cursor)
        add("limit", limit.map(String.init))
        add("q", q)
        add("type", type?.rawValue)
        add("albumId", albumId)
        add("favorite", favorite.map(String.init))
        add("archived", archived.map(String.init))
        add("trashed", trashed.map(String.init))
        add("takenAfter", takenAfter)
        add("takenBefore", takenBefore)
        add("bbox", bbox)
        add("sort", sort?.rawValue)
        add("order", order?.rawValue)
        return items
    }
}

/// A day bucket in the timeline, used to size the scroller before assets load.
public struct TimelineBucket: Codable, Hashable, Sendable {
    public var date: String
    public var count: Int
}

public struct Timeline: Codable, Hashable, Sendable {
    public var buckets: [TimelineBucket]
}

public struct LibraryStats: Codable, Hashable, Sendable {
    public var assetCount: Int
    public var imageCount: Int
    public var videoCount: Int
    public var albumCount: Int
    public var favoriteCount: Int
    public var trashedCount: Int
    public var storageBytes: Int
    public var earliestCapturedAt: String?
    public var latestCapturedAt: String?
}

// MARK: - Albums

public struct Album: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var ownerId: String
    public var name: String
    public var description: String?
    public var coverAssetId: String?
    public var assetCount: Int
    public var createdAt: String
    public var updatedAt: String
    /// Set when the album has an active public share link.
    public var shareSlug: String?
}

public struct AlbumWithAssets: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var ownerId: String
    public var name: String
    public var description: String?
    public var coverAssetId: String?
    public var assetCount: Int
    public var createdAt: String
    public var updatedAt: String
    public var shareSlug: String?
    public var assets: [Asset]
}

public struct AlbumCreate: Codable, Hashable, Sendable {
    public var name: String
    public var description: String?
    public var assetIds: [String]?

    public init(name: String, description: String? = nil, assetIds: [String]? = nil) {
        self.name = name
        self.description = description
        self.assetIds = assetIds
    }
}

public struct AlbumUpdate: Codable, Hashable, Sendable {
    public var name: String?
    public var description: String?
    public var coverAssetId: String?

    public init(name: String? = nil, description: String? = nil, coverAssetId: String? = nil) {
        self.name = name
        self.description = description
        self.coverAssetId = coverAssetId
    }
}

/// Adding assets is idempotent, so the result reports what actually changed.
public struct AlbumAssetsResult: Codable, Hashable, Sendable {
    public var added: Int
    public var skipped: Int
    public var assetCount: Int
}

// MARK: - Sharing

public struct ShareLink: Codable, Hashable, Sendable {
    public var slug: String
    public var url: String
    /// Exactly one of these is set: a link points at an album or at one photograph.
    public var albumId: String?
    public var assetId: String?
    public var expiresAt: String?
    public var allowDownload: Bool
    public var createdAt: String
}

public struct ShareLinkCreate: Codable, Hashable, Sendable {
    public var expiresAt: String?
    public var allowDownload: Bool
    public var password: String?

    public init(expiresAt: String? = nil, allowDownload: Bool = true, password: String? = nil) {
        self.expiresAt = expiresAt
        self.allowDownload = allowDownload
        self.password = password
    }
}

// MARK: - Uploads

public struct UploadSessionCreate: Codable, Hashable, Sendable {
    public var filename: String
    public var sizeBytes: Int
    public var mimeType: String
    /// Optional SHA-256 known in advance; lets the server short-circuit a duplicate.
    public var checksum: String?
    public var deviceAssetId: String?
    public var capturedAt: String?
    public var favorite: Bool?
}

public struct UploadSession: Codable, Hashable, Sendable {
    public var id: String
    /// Bytes already stored. A resuming client PATCHes from this offset.
    public var offset: Int
    public var sizeBytes: Int
    public var expiresAt: String
    /// Set when the server recognised the checksum and no upload is needed.
    public var existing: AssetUploadResult?
}

struct UploadOffset: Codable { var offset: Int }

public enum UploadLimits {
    public static let bulkConcurrency = 6
    /// Files at or above this size use the resumable protocol.
    public static let resumableThresholdBytes = 64 * 1024 * 1024
    public static let chunkBytes = 8 * 1024 * 1024
}

// MARK: - Auth

public enum UserRole: String, Codable, Sendable {
    case admin, user
}

public struct User: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var email: String
    public var name: String
    public var role: UserRole
    public var avatarUrl: String?
    /// Present when the account is linked to an external identity provider.
    public var oidcSubject: String?
    /// False for OIDC-only accounts, which have no local password.
    public var hasPassword: Bool
    public var createdAt: String
    public var quotaBytes: Int?
    public var usedBytes: Int
}

public struct LoginRequest: Codable, Hashable, Sendable {
    public var email: String
    public var password: String

    public init(email: String, password: String) {
        self.email = email
        self.password = password
    }
}

public struct SignupRequest: Codable, Hashable, Sendable {
    public var email: String
    public var password: String
    public var name: String
    /// An invitation token. Admits one account to a server with sign-up closed.
    public var invite: String?

    public init(email: String, password: String, name: String, invite: String? = nil) {
        self.email = email
        self.password = password
        self.name = name
        self.invite = invite
    }
}

public struct PasswordChangeRequest: Codable, Hashable, Sendable {
    public var currentPassword: String?
    public var newPassword: String

    public init(currentPassword: String? = nil, newPassword: String) {
        self.currentPassword = currentPassword
        self.newPassword = newPassword
    }
}

/// Editing your own profile. Accounts linked to an identity provider cannot change these
/// here — the provider owns them, and imogen re-reads them at every sign-in.
public struct ProfileUpdate: Codable, Hashable, Sendable {
    public var name: String?
    public var email: String?
    /// Required to change the email address on an account that has a password.
    public var currentPassword: String?

    public init(name: String? = nil, email: String? = nil, currentPassword: String? = nil) {
        self.name = name
        self.email = email
        self.currentPassword = currentPassword
    }
}

public struct OidcConfig: Codable, Hashable, Sendable {
    public var enabled: Bool
    public var label: String?
    public var startUrl: String?
    /// Where to send someone to edit the details the provider owns, if known.
    public var accountUrl: String?
}

/// What the login page needs in order to render before anyone has authenticated.
public struct AuthConfig: Codable, Hashable, Sendable {
    public var allowSignup: Bool
    /// True until the first account exists; the first signup becomes the admin.
    public var needsSetup: Bool
    public var oidc: OidcConfig
}

public struct Health: Codable, Hashable, Sendable {
    public var status: String
    public var version: String
}

// MARK: - OAuth 2.1

public enum OAuthScope: String, Codable, Sendable, CaseIterable {
    case libraryRead = "library:read"
    case libraryWrite = "library:write"
    case albumsRead = "albums:read"
    case albumsWrite = "albums:write"
    case profile
}

public let defaultScopes: [String] = [
    "library:read", "library:write", "albums:read", "albums:write",
]

public struct ClientRegistrationResponse: Codable, Hashable, Sendable {
    public var clientId: String
    public var clientSecret: String?
    public var clientIdIssuedAt: Int?
    public var clientSecretExpiresAt: Int?
    public var clientName: String?
    public var redirectUris: [String]?
    public var grantTypes: [String]?
    public var responseTypes: [String]?
    public var tokenEndpointAuthMethod: String?
    public var scope: String?

    enum CodingKeys: String, CodingKey {
        case clientId = "client_id"
        case clientSecret = "client_secret"
        case clientIdIssuedAt = "client_id_issued_at"
        case clientSecretExpiresAt = "client_secret_expires_at"
        case clientName = "client_name"
        case redirectUris = "redirect_uris"
        case grantTypes = "grant_types"
        case responseTypes = "response_types"
        case tokenEndpointAuthMethod = "token_endpoint_auth_method"
        case scope
    }
}

public struct TokenResponse: Codable, Hashable, Sendable {
    public var accessToken: String
    public var tokenType: String
    public var expiresIn: Int
    public var refreshToken: String?
    public var scope: String?

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case tokenType = "token_type"
        case expiresIn = "expires_in"
        case refreshToken = "refresh_token"
        case scope
    }
}

public struct AuthorizationServerMetadata: Codable, Hashable, Sendable {
    public var issuer: String
    public var authorizationEndpoint: String
    public var tokenEndpoint: String
    public var registrationEndpoint: String?
    public var revocationEndpoint: String?
    public var scopesSupported: [String]?
    public var codeChallengeMethodsSupported: [String]?

    enum CodingKeys: String, CodingKey {
        case issuer
        case authorizationEndpoint = "authorization_endpoint"
        case tokenEndpoint = "token_endpoint"
        case registrationEndpoint = "registration_endpoint"
        case revocationEndpoint = "revocation_endpoint"
        case scopesSupported = "scopes_supported"
        case codeChallengeMethodsSupported = "code_challenge_methods_supported"
    }
}

// MARK: - People

/// One cluster of faces the library believes belong to the same person.
public struct Person: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    /// `nil` until somebody names them. An unnamed person is still browsable.
    public var name: String?
    /// The face used as their thumbnail.
    public var coverFaceId: String?
    public var photoCount: Int
    public var hidden: Bool
}

public struct PersonWithPhotos: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var name: String?
    public var coverFaceId: String?
    public var photoCount: Int
    public var hidden: Bool
    public var photos: [Asset]
}

/// Where a face sits in its photo, in the original image's pixels.
public struct DetectedFace: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var assetId: String
    public var personId: String?
    /// `nil` when this person has not been named yet.
    public var personName: String?
    public var x: Int
    public var y: Int
    public var width: Int
    public var height: Int
    public var score: Double
}

public struct PersonUpdate: Codable, Hashable, Sendable {
    public var name: String?
    public var hidden: Bool?

    public init(name: String? = nil, hidden: Bool? = nil) {
        self.name = name
        self.hidden = hidden
    }
}

public struct FaceModel: Codable, Hashable, Sendable {
    public var name: String
    public var present: Bool
    public var bytes: Int
    public var expectedBytes: Int
}

/// What the settings screen needs to describe the feature's state.
public struct FaceStatus: Codable, Hashable, Sendable {
    public var enabled: Bool
    /// False until the models have been downloaded onto the server.
    public var modelsReady: Bool
    public var models: [FaceModel]
    public var peopleCount: Int
    /// Photos still waiting to be scanned.
    public var pending: Int
}

// MARK: - Vault

public struct VaultStatus: Codable, Hashable, Sendable {
    public var configured: Bool
    public var unlocked: Bool
    /// Only present while unlocked: a locked vault does not reveal its size.
    public var count: Int?
}

// MARK: - Administration

public enum SignsInWith: String, Codable, Sendable {
    case password, sso, both
}

/// An account as an administrator sees it.
///
/// Deliberately not the same shape as `User`: this carries what is needed to decide what
/// to do about someone, and carries no secret of any kind.
public struct AdminUser: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var email: String
    public var name: String
    public var role: UserRole
    /// How this account signs in. An SSO account has no password to reset.
    public var signsInWith: SignsInWith
    /// Suspended: the rows are all still here, but nobody can sign in as them.
    public var disabled: Bool
    public var photoCount: Int
    public var usedBytes: Int
    /// `nil` when the account draws on whatever the server has.
    public var quotaBytes: Int?
    public var createdAt: String
    public var updatedAt: String
}

public struct AdminUserUpdate: Codable, Hashable, Sendable {
    public var role: UserRole?
    public var disabled: Bool?

    public init(role: UserRole? = nil, disabled: Bool? = nil) {
        self.role = role
        self.disabled = disabled
    }
}

public enum InviteState: String, Codable, Sendable {
    case pending, accepted, expired
}

/// An outstanding invitation. The token is absent on purpose: it is shown once, when the
/// invitation is made, and is stored only as a hash.
public struct Invite: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var email: String?
    public var role: UserRole
    public var createdAt: String
    public var expiresAt: String
    public var acceptedAt: String?
    public var state: InviteState
}

public struct InviteCreate: Codable, Hashable, Sendable {
    /// When set, only this address may use the link.
    public var email: String?
    public var role: UserRole
    public var expiresInDays: Int

    public init(email: String? = nil, role: UserRole = .user, expiresInDays: Int = 7) {
        self.email = email
        self.role = role
        self.expiresInDays = expiresInDays
    }
}

/// The one and only time the token is legible.
public struct InviteCreated: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var email: String?
    public var role: UserRole
    public var createdAt: String
    public var expiresAt: String
    public var acceptedAt: String?
    public var state: InviteState
    public var token: String
}

public enum JobStatus: String, Codable, Sendable {
    case queued, running, done, failed
}

public struct AdminJob: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var status: JobStatus
    public var attempts: Int
    public var maxAttempts: Int
    public var lastError: String?
    public var runAt: String
    public var createdAt: String
    public var finishedAt: String?
}

/// The state of the work queue.
///
/// `stuck` counts photographs the pipeline never finished with. Without it a failed
/// transcode leaves a photo saying "processing" for ever and nothing says why.
public struct QueueHealth: Codable, Hashable, Sendable {
    public var queued: Int
    public var running: Int
    public var failed: Int
    public var stuck: Int
    /// The oldest thing still waiting, so a jammed queue is obvious.
    public var oldestQueuedAt: String?
    public var failures: [AdminJob]
}

public struct AdminClient: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var redirectUris: [String]
    public var scopes: [String]
    /// With RFC 7591 open, anything that asks gets a client. This separates what an
    /// administrator set up deliberately from what simply turned up.
    public var dynamicallyRegistered: Bool
    /// Public clients hold no secret and rely on PKCE. Native apps and MCP are these.
    public var isPublic: Bool
    public var createdAt: String
    public var activeTokens: Int
}

public struct AdminSession: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var userId: String
    public var userEmail: String
    public var userAgent: String?
    public var ipAddress: String?
    public var createdAt: String
    public var lastUsedAt: String
    public var expiresAt: String
    /// True for the session making this request, so it is not revoked by accident.
    public var current: Bool
}

public struct StoragePerUser: Codable, Hashable, Sendable {
    public var userId: String
    public var email: String
    public var usedBytes: Int
    public var photoCount: Int
}

public struct StorageReport: Codable, Hashable, Sendable {
    public var dataDir: String
    public var originalBytes: Int
    public var derivativeBytes: Int
    public var trashedCount: Int
    public var trashedBytes: Int
    public var trashRetentionDays: Int
    /// The next thing due to be destroyed, so the sweep is not a black box.
    public var nextSweepAt: String?
    /// Rows whose file is missing. Counted rather than listed.
    public var missingFiles: Int
    public var perUser: [StoragePerUser]
}

/// Settings that can be changed without restarting the server. What is stored wins over
/// the environment, so a deployment that sets nothing keeps behaving as it did.
public struct ServerSettings: Codable, Hashable, Sendable {
    public var allowSignup: Bool
    public var trashRetentionDays: Int
    public var facesEnabled: Bool
}

public struct ServerSettingsUpdate: Codable, Hashable, Sendable {
    public var allowSignup: Bool?
    public var trashRetentionDays: Int?
    public var facesEnabled: Bool?

    public init(
        allowSignup: Bool? = nil, trashRetentionDays: Int? = nil, facesEnabled: Bool? = nil
    ) {
        self.allowSignup = allowSignup
        self.trashRetentionDays = trashRetentionDays
        self.facesEnabled = facesEnabled
    }
}

public enum ShareKind: String, Codable, Sendable {
    case album, photo
}

/// A public link, named by what it points at rather than by its slug: an administrator
/// deciding whether something should still be public is asking what it is.
public struct AdminShareLink: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var slug: String
    public var url: String
    public var kind: ShareKind
    /// The album's name, or the photograph's filename.
    public var target: String
    public var createdByEmail: String
    public var createdAt: String
    public var expiresAt: String?
    public var hasPassword: Bool
    public var allowDownload: Bool
}

// MARK: - Envelopes

struct ApiErrorBody: Codable {
    var code: String
    var message: String
    /// Field-level detail for validation failures: path -> messages.
    var details: [String: [String]]?
}

struct ApiErrorEnvelope: Codable {
    var error: ApiErrorBody
}

/// A page of anything the API returns as `{ items }`.
struct Items<T: Codable>: Codable {
    var items: [T]
}

struct AffectedCount: Codable { var count: Int }
struct RemovedCount: Codable { var removed: Int }
struct MovedCount: Codable { var moved: Int }
