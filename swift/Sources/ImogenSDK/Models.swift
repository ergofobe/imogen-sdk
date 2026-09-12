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

/// How a location is read off a response. A point on a map needs both coordinates, so an
/// object missing either decodes as no location at all -- place name included, since a
/// name with nothing to pin it to is not something a client can show. The shape has to be
/// absorbed rather than rejected: a server that read a GPS block and found nothing usable
/// in it answers with the object and nulls inside, and clients outlive the servers they
/// talk to. `GeoPoint` itself stays strict for requests, where half a pair is the
/// caller's own mistake and worth an error.
@propertyWrapper
public struct DecodedLocation: Codable, Hashable, Sendable {
    public var wrappedValue: GeoPoint?

    public init(wrappedValue: GeoPoint?) {
        self.wrappedValue = wrappedValue
    }

    public init(from decoder: any Decoder) throws {
        if let single = try? decoder.singleValueContainer(), single.decodeNil() {
            self.wrappedValue = nil
            return
        }
        let wire = try Wire(from: decoder)
        guard let latitude = wire.latitude, let longitude = wire.longitude else {
            self.wrappedValue = nil
            return
        }
        self.wrappedValue = GeoPoint(
            latitude: latitude,
            longitude: longitude,
            altitude: wire.altitude,
            place: wire.place
        )
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(wrappedValue)
    }

    private struct Wire: Decodable {
        var latitude: Double?
        var longitude: Double?
        var altitude: Double?
        var place: String?
    }
}

extension KeyedDecodingContainer {
    /// The synthesised decoder reaches for a wrapped property by `decode` rather than
    /// `decodeIfPresent`, which would make an absent -- or null -- `location` an error
    /// where a bare `GeoPoint?` tolerated both. This puts that back.
    func decode(_ type: DecodedLocation.Type, forKey key: Key) throws -> DecodedLocation {
        try decodeIfPresent(type, forKey: key) ?? DecodedLocation(wrappedValue: nil)
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
    @DecodedLocation public var location: GeoPoint?
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

/// Metadata a client may attach at upload time. All fields are hints; EXIF wins where it
/// has an opinion.
///
/// `description` and `location` are here so an importer carrying metadata from somewhere
/// else — a Google Takeout sidecar, say — can land a photograph complete in one request
/// rather than an upload followed by a patch for every file it moves.
public struct AssetUploadMetadata: Codable, Hashable, Sendable {
    public var deviceAssetId: String?
    public var capturedAt: String?
    public var favorite: Bool?
    public var filename: String?
    public var description: String?
    public var location: GeoPoint?

    public init(
        deviceAssetId: String? = nil,
        capturedAt: String? = nil,
        favorite: Bool? = nil,
        filename: String? = nil,
        description: String? = nil,
        location: GeoPoint? = nil
    ) {
        self.deviceAssetId = deviceAssetId
        self.capturedAt = capturedAt
        self.favorite = favorite
        self.filename = filename
        self.description = description
        self.location = location
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
    /// Photographs a given person appears in.
    public var personId: String?
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
        personId: String? = nil,
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
        self.personId = personId
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
        add("personId", personId)
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
    /// The newest ready asset in the bucket, for an overview's period card. `nil` unless
    /// `covers` was asked for, and `nil` for a period whose photographs are all still
    /// being processed — such a period shows a count without a picture rather than
    /// vanishing.
    public var coverAssetId: String?

    /// Public, unlike most of the models here, because a client builds these rather than
    /// only decoding them: a timeline grid works out its own shape by adding to and taking
    /// from the day counts as photographs arrive and are deleted.
    public init(date: String, count: Int, coverAssetId: String? = nil) {
        self.date = date
        self.count = count
        self.coverAssetId = coverAssetId
    }
}

public struct Timeline: Codable, Hashable, Sendable {
    public var buckets: [TimelineBucket]
}

/// The filters every listing shares. Extracted so the timeline aggregate, the bucket
/// endpoint, and a by-query selection cannot drift from what `GET /assets` accepts —
/// three definitions of "which photographs" is three chances to disagree.
public struct AssetFilter: Codable, Hashable, Sendable {
    /// Free-text over filename, description, camera, and place.
    public var q: String?
    public var type: AssetType?
    public var albumId: String?
    /// Photographs a given person appears in.
    public var personId: String?
    public var favorite: Bool?
    public var archived: Bool?
    /// When true, returns only trashed assets. Trashed assets are hidden otherwise.
    public var trashed: Bool?
    public var takenAfter: String?
    public var takenBefore: String?
    /// Bounding box filter: `minLat,minLon,maxLat,maxLon`.
    public var bbox: String?

    public init(
        q: String? = nil,
        type: AssetType? = nil,
        albumId: String? = nil,
        personId: String? = nil,
        favorite: Bool? = nil,
        archived: Bool? = nil,
        trashed: Bool? = nil,
        takenAfter: String? = nil,
        takenBefore: String? = nil,
        bbox: String? = nil
    ) {
        self.q = q
        self.type = type
        self.albumId = albumId
        self.personId = personId
        self.favorite = favorite
        self.archived = archived
        self.trashed = trashed
        self.takenAfter = takenAfter
        self.takenBefore = takenBefore
        self.bbox = bbox
    }

    /// Flattened to the query string the API expects. Absent fields stay absent, so the
    /// server applies its own defaults rather than ours.
    public var queryItems: [URLQueryItem] {
        var items: [URLQueryItem] = []
        func add(_ name: String, _ value: String?) {
            if let value { items.append(URLQueryItem(name: name, value: value)) }
        }

        add("q", q)
        add("type", type?.rawValue)
        add("albumId", albumId)
        add("personId", personId)
        add("favorite", favorite.map(String.init))
        add("archived", archived.map(String.init))
        add("trashed", trashed.map(String.init))
        add("takenAfter", takenAfter)
        add("takenBefore", takenBefore)
        add("bbox", bbox)
        return items
    }
}

public struct TimelineQuery: Hashable, Sendable {
    public var filter: AssetFilter
    public var covers: Bool?

    public init(filter: AssetFilter = AssetFilter(), covers: Bool? = nil) {
        self.filter = filter
        self.covers = covers
    }

    public var queryItems: [URLQueryItem] {
        var items = filter.queryItems
        if let covers { items.append(URLQueryItem(name: "covers", value: String(covers))) }
        return items
    }
}

/// Everything a grid tile draws, and nothing else. An `Asset` carries checksum, exif,
/// filenames, and both captured-at corrections — around 800 bytes against this one's
/// 200 — none of which a tile reads. Over a heavy month that is the difference between
/// one round trip and several.
public struct TimelineTile: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var capturedAt: String
    public var width: Int?
    public var height: Int?
    public var type: AssetType
    public var status: AssetStatus
    public var favorite: Bool
    /// Seconds. `nil` for images.
    public var duration: Double?
    public var placeholderColor: String?
    public var livePhotoVideoId: String?
}

public struct TilePage: Codable, Hashable, Sendable {
    public var items: [TimelineTile]
    public var nextCursor: String?
    /// Total matching rows, when cheap to compute. `nil` means "not counted".
    public var total: Int?
}

public struct TimelineBucketQuery: Hashable, Sendable {
    public var filter: AssetFilter
    /// `YYYY-MM` or `YYYY-MM-DD`. A bare year is refused: it would be a whole-library
    /// scan asked for by accident.
    public var period: String
    public var cursor: String?
    /// Defaults server-side to 5000 when omitted, so a caller need not know the
    /// server's default just to ask for one page.
    public var limit: Int?

    public init(
        period: String, filter: AssetFilter = AssetFilter(), cursor: String? = nil, limit: Int? = nil
    ) {
        self.period = period
        self.filter = filter
        self.cursor = cursor
        self.limit = limit
    }

    public var queryItems: [URLQueryItem] {
        var items = filter.queryItems
        items.append(URLQueryItem(name: "period", value: period))
        if let cursor { items.append(URLQueryItem(name: "cursor", value: cursor)) }
        if let limit { items.append(URLQueryItem(name: "limit", value: String(limit))) }
        return items
    }
}

/// What a bulk mutation acts on. Either an explicit list, or the filter the user was
/// looking at minus whatever they unticked — so "select all" in a hundred-thousand-photo
/// library is a filter, not a hundred thousand ids in a request body.
public struct AssetSelection: Codable, Hashable, Sendable {
    public var assetIds: [String]?
    public var query: AssetFilter?
    /// Capped deliberately: past this, an interface should not be offering a selection.
    public var except: [String]?

    public init(assetIds: [String]? = nil, query: AssetFilter? = nil, except: [String]? = nil) {
        self.assetIds = assetIds
        self.query = query
        self.except = except
    }

    /// Throws when this selection cannot be sent. Every method that sends one checks
    /// first, so a client learns of a contradictory selection here rather than from a 400
    /// after the request has gone.
    public func validate() throws {
        if (assetIds == nil) == (query == nil) {
            throw ImogenError(
                status: 0, code: "bad_request",
                message: "Provide exactly one of assetIds or query")
        }
        // `except` narrows a filter; beside an explicit list it is a contradiction, and
        // the server's id branch never reads it — so honouring the request would act on
        // the very photographs the caller excluded. Rejecting matches the cap rule: a
        // destructive action silently narrowed is undetectable until somebody goes
        // looking for a picture that is no longer there.
        if assetIds != nil && except != nil {
            throw ImogenError(
                status: 0, code: "bad_request",
                message:
                    "except narrows a query selection only; with assetIds, leave the "
                    + "unwanted ids out of the list")
        }
    }
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
    public var description: String?
    public var location: GeoPoint?
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

/// RFC 9728 protected resource metadata.
///
/// ``resource`` is the identifier to echo back as the RFC 8707 `resource` parameter. The
/// server compares it against the single spelling it publishes here, so a client that
/// rebuilds the string from its own base URL can produce a near-miss — a stray port, a
/// trailing slash — that comes back as `invalid_target`.
public struct ProtectedResourceMetadata: Codable, Hashable, Sendable {
    public var resource: String
    public var authorizationServers: [String]?
    public var scopesSupported: [String]?
    public var bearerMethodsSupported: [String]?
    public var resourceDocumentation: String?

    enum CodingKeys: String, CodingKey {
        case resource
        case authorizationServers = "authorization_servers"
        case scopesSupported = "scopes_supported"
        case bearerMethodsSupported = "bearer_methods_supported"
        case resourceDocumentation = "resource_documentation"
    }
}

// MARK: - Pairing

/// A ticket a signed-in browser makes so a device does not have to be told where the
/// server is. See ``Pairing``.
public struct PairingTicket: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    /// The one-time secret. Legible only in the response that created the ticket.
    public var code: String
    public var serverUrl: String
    /// Server and secret in one string — this is what goes into the QR code.
    public var uri: String
    public var expiresAt: String
}

public struct PairingStatus: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var expiresAt: String
    /// `nil` until a device takes the ticket.
    public var claimedAt: String?
    public var deviceName: String?
}

public struct PairingClaimRequest: Codable, Hashable, Sendable {
    public var code: String
    /// The client the device registered for itself through RFC 7591.
    public var clientId: String
    public var redirectUri: String
    public var codeChallenge: String
    public var codeChallengeMethod: String
    /// Space-separated. Omit to take everything a paired device is allowed.
    public var scope: String?
    /// Shown to whoever made the ticket, and in the connected-applications list.
    public var deviceName: String?
    /// RFC 8707. The resource this device's token is for, recorded on the code the claim
    /// mints so the exchange is bound to it just as a browser-flow code would be. Nil for
    /// a token good at every surface, which is what every device paired before this
    /// existed already holds.
    public var resource: String?

    public init(
        code: String,
        clientId: String,
        redirectUri: String,
        codeChallenge: String,
        codeChallengeMethod: String = "S256",
        scope: String? = nil,
        deviceName: String? = nil,
        resource: String? = nil
    ) {
        self.code = code
        self.clientId = clientId
        self.redirectUri = redirectUri
        self.codeChallenge = codeChallenge
        self.codeChallengeMethod = codeChallengeMethod
        self.scope = scope
        self.deviceName = deviceName
        self.resource = resource
    }
}

/// An ordinary authorization code. Exchange it at the token endpoint with the verifier
/// that produced the challenge; on its own it grants nothing.
public struct PairingClaim: Codable, Hashable, Sendable {
    public var code: String
    public var redirectUri: String
    public var scope: String
}

/// The scheme an application registers so `imogen://pair?…` opens it.
public let pairingURIScheme = "imogen"

/// What a device reads out of a QR code: where to go, and the code to spend there.
public struct PairingInvitation: Hashable, Sendable {
    public var serverURL: String
    public var code: String

    /// Reads a scanned string, whether it arrived as `imogen://pair?…` or as an ordinary
    /// `https://…/pair?…` link somebody tapped in a browser. `nil` for anything else,
    /// because a camera pointed at the world reads a great many things that are not this.
    public init?(scanned: String) {
        guard let components = URLComponents(string: scanned.trimmingCharacters(in: .whitespacesAndNewlines))
        else { return nil }
        let params = Dictionary(
            (components.queryItems ?? []).map { ($0.name, $0.value ?? "") },
            uniquingKeysWith: { first, _ in first }
        )
        guard let code = params["code"], !code.isEmpty else { return nil }

        if let server = params["server"], !server.isEmpty {
            self.serverURL = String(server.reversed().drop(while: { $0 == "/" }).reversed())
            self.code = code
            return
        }

        // An https link carries the server in the link itself: it came from that server.
        guard let scheme = components.scheme, scheme == "http" || scheme == "https",
            let host = components.host
        else { return nil }
        let port = components.port.map { ":\($0)" } ?? ""
        self.serverURL = "\(scheme)://\(host)\(port)"
        self.code = code
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
