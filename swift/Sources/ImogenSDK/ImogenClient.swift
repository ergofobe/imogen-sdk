import Foundation

#if canImport(FoundationNetworking)
    import FoundationNetworking
#endif

/// The imogen client.
///
/// ```swift
/// let imogen = ImogenClient(baseURL: "https://photos.example.com", token: "…")
/// let page = try await imogen.assets.list(AssetQuery(q: "harbour", limit: 50))
/// ```
///
/// In a context served by imogen itself, omit the token: the session cookie is enough.
public struct ImogenClient: Sendable {
    public let http: HTTPClient
    public let assets: Assets
    public let albums: Albums
    public let admin: Admin
    public let auth: Auth
    public let vault: Vault
    public let people: People

    public init(options: ClientOptions) {
        let http = HTTPClient(options: options)
        self.http = http
        self.assets = Assets(http: http)
        self.albums = Albums(http: http)
        self.admin = Admin(http: http)
        self.auth = Auth(http: http)
        self.vault = Vault(http: http)
        self.people = People(http: http)
    }

    public init(baseURL: String, token: String? = nil, session: URLSession = .shared) {
        self.init(
            options: ClientOptions(
                baseURL: baseURL,
                token: token.map { value in { @Sendable in value } },
                session: session
            )
        )
    }

    public var baseURL: String { http.baseURL }

    /// Confirms the server is reachable and reports its version.
    public func health() async throws -> Health {
        try await http.request("GET", "/api/v1/health")
    }
}
