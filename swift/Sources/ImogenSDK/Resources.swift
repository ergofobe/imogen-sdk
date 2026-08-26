import Foundation

#if canImport(FoundationNetworking)
    import FoundationNetworking
#endif

// The resources. Each is a thin, typed layer over `HTTPClient`; none of them know
// anything about HTTP beyond the path they call.

public struct UploadProgress: Hashable, Sendable {
    /// Bytes transferred so far for this file.
    public let loaded: Int
    public let total: Int
}

public typealias ProgressHandler = @Sendable (UploadProgress) -> Void

public struct UploadOptions: Sendable {
    public var metadata: AssetUploadMetadata
    public var onProgress: ProgressHandler?

    public init(metadata: AssetUploadMetadata = AssetUploadMetadata(), onProgress: ProgressHandler? = nil) {
        self.metadata = metadata
        self.onProgress = onProgress
    }
}

/// The outcome of one file in a bulk upload. Each settles independently, so one bad photo
/// in a folder of three thousand does not abandon the rest.
public struct BulkUploadResult: Sendable {
    public let url: URL
    public let result: AssetUploadResult?
    public let error: Error?
}

// MARK: - Assets

public struct Assets: Sendable {
    let http: HTTPClient

    public func list(_ query: AssetQuery = AssetQuery()) async throws -> AssetPage {
        try await http.request("GET", "/api/v1/assets", RequestOptions(query: query.queryItems))
    }

    /// Walks every page, so a caller can `for await` the whole library.
    public func iterate(_ query: AssetQuery = AssetQuery()) -> AsyncThrowingStream<Asset, Error> {
        AsyncThrowingStream { continuation in
            Task {
                var current = query
                do {
                    while true {
                        let page = try await list(current)
                        for asset in page.items { continuation.yield(asset) }
                        guard let cursor = page.nextCursor else { break }
                        current.cursor = cursor
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
        }
    }

    public func get(_ assetId: String) async throws -> Asset {
        try await http.request("GET", "/api/v1/assets/\(assetId)")
    }

    public func update(_ assetId: String, _ patch: AssetUpdate) async throws -> Asset {
        try await http.request(
            "PATCH", "/api/v1/assets/\(assetId)",
            RequestOptions(body: try http.encode(patch), headers: jsonHeaders)
        )
    }

    /// The live public link for one photo, or `nil`.
    public func shareLink(_ assetId: String) async throws -> ShareLink? {
        try await http.request("GET", "/api/v1/assets/\(assetId)/share")
    }

    /// Publishes one photo. Replaces any existing link for it.
    @discardableResult
    public func share(_ assetId: String, _ input: ShareLinkCreate = ShareLinkCreate()) async throws
        -> ShareLink
    {
        try await http.request(
            "POST", "/api/v1/assets/\(assetId)/share",
            RequestOptions(body: try http.encode(input), headers: jsonHeaders)
        )
    }

    public func unshare(_ assetId: String) async throws {
        try await http.requestVoid("DELETE", "/api/v1/assets/\(assetId)/share")
    }

    @discardableResult
    public func trash(_ assetIds: [String]) async throws -> Int {
        let result: AffectedCount = try await http.request(
            "POST", "/api/v1/assets/trash",
            RequestOptions(body: try http.encode(["assetIds": assetIds]), headers: jsonHeaders)
        )
        return result.count
    }

    @discardableResult
    public func restore(_ assetIds: [String]) async throws -> Int {
        let result: AffectedCount = try await http.request(
            "POST", "/api/v1/assets/restore",
            RequestOptions(body: try http.encode(["assetIds": assetIds]), headers: jsonHeaders)
        )
        return result.count
    }

    public func timeline() async throws -> Timeline {
        try await http.request("GET", "/api/v1/assets/timeline")
    }

    public func stats() async throws -> LibraryStats {
        try await http.request("GET", "/api/v1/assets/stats")
    }

    /// A URL suitable for an image view. Browsers send the session cookie themselves.
    public func url(for assetId: String, variant: AssetVariant = .thumbnail) -> String {
        http.url("/api/v1/assets/\(assetId)/\(variant.rawValue)")
    }

    public func downloadURL(for assetId: String) -> String {
        http.url("/api/v1/assets/\(assetId)/download")
    }

    /// Fetches image bytes with an Authorization header, for non-browser clients.
    public func data(_ assetId: String, variant: AssetVariant = .preview) async throws -> Data {
        let (data, _) = try await http.send("GET", "/api/v1/assets/\(assetId)/\(variant.rawValue)")
        return data
    }

    /// Uploads one file, choosing the protocol by size: small files go in a single
    /// request, large ones use a resumable session so a dropped connection costs one chunk
    /// rather than the whole video.
    @discardableResult
    public func upload(_ fileURL: URL, options: UploadOptions = UploadOptions()) async throws
        -> AssetUploadResult
    {
        let size = try fileSize(of: fileURL)
        if size >= UploadLimits.resumableThresholdBytes {
            return try await uploadResumable(fileURL, size: size, options: options)
        }

        let boundary = "imogen.\(UUID().uuidString)"
        var body = Data()

        func field(_ name: String, _ value: String) {
            body.append("--\(boundary)\r\n")
            body.append("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n")
            body.append("\(value)\r\n")
        }

        body.append("--\(boundary)\r\n")
        body.append(
            "Content-Disposition: form-data; name=\"file\"; filename=\"\(fileURL.lastPathComponent)\"\r\n"
        )
        body.append("Content-Type: \(mimeType(for: fileURL))\r\n\r\n")
        body.append(try Data(contentsOf: fileURL))
        body.append("\r\n")

        if let value = options.metadata.deviceAssetId { field("deviceAssetId", value) }
        if let value = options.metadata.capturedAt { field("capturedAt", value) }
        if let value = options.metadata.favorite { field("favorite", String(value)) }
        body.append("--\(boundary)--\r\n")

        let result: AssetUploadResult = try await http.request(
            "POST", "/api/v1/assets",
            RequestOptions(
                body: body,
                headers: ["Content-Type": "multipart/form-data; boundary=\(boundary)"],
                isMultipart: true
            )
        )
        options.onProgress?(UploadProgress(loaded: size, total: size))
        return result
    }

    private func uploadResumable(
        _ fileURL: URL, size: Int, options: UploadOptions
    ) async throws -> AssetUploadResult {
        let create = UploadSessionCreate(
            filename: fileURL.lastPathComponent,
            sizeBytes: size,
            mimeType: mimeType(for: fileURL),
            checksum: nil,
            deviceAssetId: options.metadata.deviceAssetId,
            capturedAt: options.metadata.capturedAt,
            favorite: options.metadata.favorite
        )

        let session: UploadSession = try await http.request(
            "POST", "/api/v1/uploads",
            RequestOptions(body: try http.encode(create), headers: jsonHeaders)
        )

        // The server already had these bytes; nothing to transfer.
        if let existing = session.existing {
            options.onProgress?(UploadProgress(loaded: size, total: size))
            return existing
        }

        let handle = try FileHandle(forReadingFrom: fileURL)
        defer { try? handle.close() }

        var offset = session.offset
        while offset < size {
            try handle.seek(toOffset: UInt64(offset))
            let chunk = try handle.read(upToCount: UploadLimits.chunkBytes) ?? Data()

            let progress: UploadOffset = try await http.request(
                "PATCH", "/api/v1/uploads/\(session.id)",
                RequestOptions(
                    body: chunk,
                    headers: [
                        "Upload-Offset": String(offset),
                        "Content-Type": "application/octet-stream",
                    ]
                )
            )
            offset = progress.offset
            options.onProgress?(UploadProgress(loaded: offset, total: size))
        }

        return try await http.request("POST", "/api/v1/uploads/\(session.id)/complete")
    }

    /// Uploads many files with bounded concurrency.
    public func uploadMany(
        _ fileURLs: [URL],
        concurrency: Int = UploadLimits.bulkConcurrency,
        metadataFor: (@Sendable (URL) -> AssetUploadMetadata)? = nil
    ) async -> [BulkUploadResult] {
        let limit = max(1, concurrency)
        var outcomes: [Int: BulkUploadResult] = [:]

        await withTaskGroup(of: (Int, BulkUploadResult).self) { group in
            var next = 0

            func submit(_ index: Int) {
                let url = fileURLs[index]
                group.addTask {
                    do {
                        let options = UploadOptions(metadata: metadataFor?(url) ?? AssetUploadMetadata())
                        let result = try await upload(url, options: options)
                        return (index, BulkUploadResult(url: url, result: result, error: nil))
                    } catch {
                        return (index, BulkUploadResult(url: url, result: nil, error: error))
                    }
                }
            }

            while next < min(limit, fileURLs.count) {
                submit(next)
                next += 1
            }
            for await (index, outcome) in group {
                outcomes[index] = outcome
                if next < fileURLs.count {
                    submit(next)
                    next += 1
                }
            }
        }

        return fileURLs.indices.compactMap { outcomes[$0] }
    }
}

// MARK: - Albums

public struct Albums: Sendable {
    let http: HTTPClient

    public func list() async throws -> [Album] {
        let page: Items<Album> = try await http.request("GET", "/api/v1/albums")
        return page.items
    }

    public func get(_ albumId: String) async throws -> AlbumWithAssets {
        try await http.request("GET", "/api/v1/albums/\(albumId)")
    }

    public func create(_ input: AlbumCreate) async throws -> Album {
        try await http.request(
            "POST", "/api/v1/albums",
            RequestOptions(body: try http.encode(input), headers: jsonHeaders)
        )
    }

    public func update(_ albumId: String, _ patch: AlbumUpdate) async throws -> Album {
        try await http.request(
            "PATCH", "/api/v1/albums/\(albumId)",
            RequestOptions(body: try http.encode(patch), headers: jsonHeaders)
        )
    }

    public func remove(_ albumId: String) async throws {
        try await http.requestVoid("DELETE", "/api/v1/albums/\(albumId)")
    }

    @discardableResult
    public func addAssets(_ albumId: String, _ assetIds: [String]) async throws -> AlbumAssetsResult {
        try await http.request(
            "POST", "/api/v1/albums/\(albumId)/assets",
            RequestOptions(body: try http.encode(["assetIds": assetIds]), headers: jsonHeaders)
        )
    }

    @discardableResult
    public func removeAssets(_ albumId: String, _ assetIds: [String]) async throws -> Int {
        let result: RemovedCount = try await http.request(
            "DELETE", "/api/v1/albums/\(albumId)/assets",
            RequestOptions(body: try http.encode(["assetIds": assetIds]), headers: jsonHeaders)
        )
        return result.removed
    }

    /// The live public link for this album, or `nil`.
    public func shareLink(_ albumId: String) async throws -> ShareLink? {
        try await http.request("GET", "/api/v1/albums/\(albumId)/share")
    }

    @discardableResult
    public func share(_ albumId: String, _ input: ShareLinkCreate = ShareLinkCreate()) async throws
        -> ShareLink
    {
        try await http.request(
            "POST", "/api/v1/albums/\(albumId)/share",
            RequestOptions(body: try http.encode(input), headers: jsonHeaders)
        )
    }

    public func unshare(_ albumId: String) async throws {
        try await http.requestVoid("DELETE", "/api/v1/albums/\(albumId)/share")
    }
}

// MARK: - People

/// People, as grouped by face recognition.
///
/// The feature is off until a server administrator enables it, so every method here can
/// legitimately return nothing — check `status()` before showing a person interface.
public struct People: Sendable {
    let http: HTTPClient

    public func status() async throws -> FaceStatus {
        try await http.request("GET", "/api/v1/people/status")
    }

    /// Administrator only. Enabling downloads the models and scans the library.
    public func setEnabled(_ enabled: Bool) async throws {
        try await http.requestVoid(
            "POST", "/api/v1/people/enable",
            RequestOptions(body: try http.encode(["enabled": enabled]), headers: jsonHeaders)
        )
    }

    public func list(includeHidden: Bool = false) async throws -> [Person] {
        let page: Items<Person> = try await http.request(
            "GET", "/api/v1/people",
            RequestOptions(query: [URLQueryItem(name: "includeHidden", value: String(includeHidden))])
        )
        return page.items
    }

    public func get(_ personId: String) async throws -> PersonWithPhotos {
        try await http.request("GET", "/api/v1/people/\(personId)")
    }

    public func update(_ personId: String, _ patch: PersonUpdate) async throws {
        try await http.requestVoid(
            "PATCH", "/api/v1/people/\(personId)",
            RequestOptions(body: try http.encode(patch), headers: jsonHeaders)
        )
    }

    /// Folds several clusters into one. Use when grouping split a person in two.
    @discardableResult
    public func merge(keeping keepId: String, merging mergeIds: [String]) async throws -> Int {
        let body = try http.encode(["keepId": AnyJSON.string(keepId), "mergeIds": .array(mergeIds.map(AnyJSON.string))])
        let result: MovedCount = try await http.request(
            "POST", "/api/v1/people/merge", RequestOptions(body: body, headers: jsonHeaders)
        )
        return result.moved
    }

    /// Moves specific faces to another person, or detaches them with `nil`.
    public func reassign(_ faceIds: [String], to personId: String?) async throws {
        let body = try http.encode([
            "faceIds": AnyJSON.array(faceIds.map(AnyJSON.string)),
            "personId": personId.map(AnyJSON.string) ?? .null,
        ])
        try await http.requestVoid(
            "POST", "/api/v1/people/reassign", RequestOptions(body: body, headers: jsonHeaders)
        )
    }

    public func faces(in assetId: String) async throws -> [DetectedFace] {
        let page: Items<DetectedFace> = try await http.request(
            "GET", "/api/v1/people/faces/\(assetId)")
        return page.items
    }

    /// A person's thumbnail, cropped from the photo their best face was found in.
    public func thumbnailURL(faceId: String) -> String {
        http.url("/api/v1/people/thumbnail/\(faceId)")
    }
}

// MARK: - Vault

/// Photographs kept out of the ordinary library entirely — absent from the timeline,
/// search, albums, shared links, and anything an AI assistant can reach.
///
/// It opens only for a signed-in browser session that re-enters the vault passphrase. A
/// bearer token cannot open it, so these methods are unavailable to API clients by design
/// rather than by omission.
public struct Vault: Sendable {
    let http: HTTPClient

    public func status() async throws -> VaultStatus {
        try await http.request("GET", "/api/v1/vault/status")
    }

    /// Sets the passphrase. Changing an existing one requires the vault to be open.
    public func setPassphrase(_ passphrase: String) async throws {
        try await http.requestVoid(
            "POST", "/api/v1/vault/setup",
            RequestOptions(body: try http.encode(["passphrase": passphrase]), headers: jsonHeaders)
        )
    }

    public func unlock(_ passphrase: String) async throws {
        try await http.requestVoid(
            "POST", "/api/v1/vault/unlock",
            RequestOptions(body: try http.encode(["passphrase": passphrase]), headers: jsonHeaders)
        )
    }

    public func lock() async throws {
        try await http.requestVoid("POST", "/api/v1/vault/lock")
    }

    public func list(limit: Int = 200) async throws -> [Asset] {
        let page: Items<Asset> = try await http.request(
            "GET", "/api/v1/vault/assets",
            RequestOptions(query: [URLQueryItem(name: "limit", value: String(limit))])
        )
        return page.items
    }

    @discardableResult
    public func moveIn(_ assetIds: [String]) async throws -> Int {
        let result: MovedCount = try await http.request(
            "POST", "/api/v1/vault/assets",
            RequestOptions(body: try http.encode(["assetIds": assetIds]), headers: jsonHeaders)
        )
        return result.moved
    }

    @discardableResult
    public func moveOut(_ assetIds: [String]) async throws -> Int {
        let result: MovedCount = try await http.request(
            "DELETE", "/api/v1/vault/assets",
            RequestOptions(body: try http.encode(["assetIds": assetIds]), headers: jsonHeaders)
        )
        return result.moved
    }
}

// MARK: - Auth

public struct Auth: Sendable {
    let http: HTTPClient

    /// What the sign-in screen needs before anyone has authenticated.
    public func config() async throws -> AuthConfig {
        try await http.request("GET", "/api/v1/auth/config")
    }

    @discardableResult
    public func login(_ request: LoginRequest) async throws -> User {
        try await http.request(
            "POST", "/api/v1/auth/login",
            RequestOptions(body: try http.encode(request), headers: jsonHeaders)
        )
    }

    @discardableResult
    public func signup(_ request: SignupRequest) async throws -> User {
        try await http.request(
            "POST", "/api/v1/auth/signup",
            RequestOptions(body: try http.encode(request), headers: jsonHeaders)
        )
    }

    public func logout() async throws {
        try await http.requestVoid("POST", "/api/v1/auth/logout")
    }

    public func logoutEverywhere() async throws {
        try await http.requestVoid("POST", "/api/v1/auth/logout-everywhere")
    }

    public func me() async throws -> User {
        try await http.request("GET", "/api/v1/auth/me")
    }

    /// Edits your own name or email. Not available to provider-managed accounts.
    @discardableResult
    public func updateProfile(_ patch: ProfileUpdate) async throws -> User {
        try await http.request(
            "PATCH", "/api/v1/auth/me",
            RequestOptions(body: try http.encode(patch), headers: jsonHeaders)
        )
    }

    public func changePassword(_ request: PasswordChangeRequest) async throws {
        try await http.requestVoid(
            "POST", "/api/v1/auth/password",
            RequestOptions(body: try http.encode(request), headers: jsonHeaders)
        )
    }

    /// Where to send a browser to begin single sign-on.
    public func oidcStartURL(returnTo: String = "/") -> String {
        http.url("/api/v1/auth/oidc/start", query: [URLQueryItem(name: "returnTo", value: returnTo)])
    }
}

// MARK: - Administration

/// Server administration.
///
/// Every endpoint here answers 404 rather than 403 to anyone who is not an administrator,
/// so a refusal is indistinguishable from a route that does not exist. Treat a not-found
/// from these methods as "you may not", not as a bug.
public struct Admin: Sendable {
    let http: HTTPClient

    /// Every account on the server, oldest first. Deleted accounts are not included.
    public func users() async throws -> [AdminUser] {
        let page: Items<AdminUser> = try await http.request("GET", "/api/v1/admin/users")
        return page.items
    }

    /// Changes a role, or suspends and restores access.
    @discardableResult
    public func updateUser(_ userId: String, _ patch: AdminUserUpdate) async throws -> AdminUser {
        try await http.request(
            "PATCH", "/api/v1/admin/users/\(userId)",
            RequestOptions(body: try http.encode(patch), headers: jsonHeaders)
        )
    }

    /// Removes the account. Its photographs go to the trash, not the incinerator.
    public func deleteUser(_ userId: String) async throws {
        try await http.requestVoid("DELETE", "/api/v1/admin/users/\(userId)")
    }

    /// Sets someone's password and ends every session they had.
    public func resetPassword(_ userId: String, to password: String) async throws {
        try await http.requestVoid(
            "POST", "/api/v1/admin/users/\(userId)/password",
            RequestOptions(body: try http.encode(["password": password]), headers: jsonHeaders)
        )
    }

    public func invites() async throws -> [Invite] {
        let page: Items<Invite> = try await http.request("GET", "/api/v1/admin/invites")
        return page.items
    }

    /// The returned token is the only legible copy. It is stored hashed.
    @discardableResult
    public func createInvite(_ input: InviteCreate = InviteCreate()) async throws -> InviteCreated {
        try await http.request(
            "POST", "/api/v1/admin/invites",
            RequestOptions(body: try http.encode(input), headers: jsonHeaders)
        )
    }

    public func revokeInvite(_ inviteId: String) async throws {
        try await http.requestVoid("DELETE", "/api/v1/admin/invites/\(inviteId)")
    }

    /// Queue depth, what is running, and what the pipeline gave up on.
    public func queue() async throws -> QueueHealth {
        try await http.request("GET", "/api/v1/admin/queue")
    }

    /// Puts one failed job back in the queue with its attempts cleared.
    public func retryJob(_ jobId: String) async throws {
        try await http.requestVoid("POST", "/api/v1/admin/queue/\(jobId)/retry")
    }

    @discardableResult
    public func retryAllJobs() async throws -> Int {
        let result: AffectedCount = try await http.request("POST", "/api/v1/admin/queue/retry")
        return result.count
    }

    public func discardJob(_ jobId: String) async throws {
        try await http.requestVoid("DELETE", "/api/v1/admin/queue/\(jobId)")
    }

    /// Applications allowed to act on someone's behalf.
    public func clients() async throws -> [AdminClient] {
        let page: Items<AdminClient> = try await http.request("GET", "/api/v1/admin/clients")
        return page.items
    }

    /// Removes an application. Its tokens go with it.
    public func revokeClient(_ clientId: String) async throws {
        try await http.requestVoid("DELETE", "/api/v1/admin/clients/\(clientId)")
    }

    public func sessions() async throws -> [AdminSession] {
        let page: Items<AdminSession> = try await http.request("GET", "/api/v1/admin/sessions")
        return page.items
    }

    /// Ends a session. Refuses the one making the request.
    public func revokeSession(_ sessionId: String) async throws {
        try await http.requestVoid("DELETE", "/api/v1/admin/sessions/\(sessionId)")
    }

    /// Where the bytes are, per variant and per account.
    public func storage() async throws -> StorageReport {
        try await http.request("GET", "/api/v1/admin/storage")
    }

    public func settings() async throws -> ServerSettings {
        try await http.request("GET", "/api/v1/admin/settings")
    }

    /// Takes effect at once. The stored value wins over the environment.
    @discardableResult
    public func updateSettings(_ patch: ServerSettingsUpdate) async throws -> ServerSettings {
        try await http.request(
            "PATCH", "/api/v1/admin/settings",
            RequestOptions(body: try http.encode(patch), headers: jsonHeaders)
        )
    }

    /// Every link that is public right now, across all accounts.
    public func shares() async throws -> [AdminShareLink] {
        let page: Items<AdminShareLink> = try await http.request("GET", "/api/v1/admin/shares")
        return page.items
    }

    /// Closes a link, whoever made it.
    public func revokeShare(_ shareId: String) async throws {
        try await http.requestVoid("DELETE", "/api/v1/admin/shares/\(shareId)")
    }
}

// MARK: - Odds and ends

let jsonHeaders = ["Content-Type": "application/json"]

/// Just enough of a JSON value to build the handful of mixed-type request bodies the API
/// takes. Everything else in the contract is a typed struct.
enum AnyJSON: Encodable {
    case string(String)
    case array([AnyJSON])
    case null

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value): try container.encode(value)
        case .array(let values): try container.encode(values)
        case .null: try container.encodeNil()
        }
    }
}

func fileSize(of url: URL) throws -> Int {
    let values = try url.resourceValues(forKeys: [.fileSizeKey])
    return values.fileSize ?? 0
}

/// Enough of a guess for the server to accept the part. The server re-sniffs the bytes
/// anyway, so this never becomes the last word on what a file is.
func mimeType(for url: URL) -> String {
    switch url.pathExtension.lowercased() {
    case "jpg", "jpeg": return "image/jpeg"
    case "png": return "image/png"
    case "gif": return "image/gif"
    case "webp": return "image/webp"
    case "heic": return "image/heic"
    case "heif": return "image/heif"
    case "avif": return "image/avif"
    case "tif", "tiff": return "image/tiff"
    case "mp4", "m4v": return "video/mp4"
    case "mov": return "video/quicktime"
    case "webm": return "video/webm"
    case "avi": return "video/x-msvideo"
    default: return "application/octet-stream"
    }
}

extension Data {
    mutating func append(_ string: String) {
        append(Data(string.utf8))
    }
}
