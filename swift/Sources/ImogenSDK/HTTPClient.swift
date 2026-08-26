import Foundation

#if canImport(FoundationNetworking)
    import FoundationNetworking
#endif

/// Every failure from the API arrives as one of these, so a caller writes one `catch`
/// rather than inspecting status codes at each call site.
public struct ImogenError: Error, Hashable, Sendable {
    public let status: Int
    public let code: String
    public let message: String
    public let details: [String: [String]]?

    public init(status: Int, code: String, message: String, details: [String: [String]]? = nil) {
        self.status = status
        self.code = code
        self.message = message
        self.details = details
    }

    /// True when re-sending the same request might succeed.
    public var isRetryable: Bool { status == 429 || status >= 500 }

    public var isAuthError: Bool { status == 401 || status == 403 }

    /// Builds the typed error from a rejection. A body that is not the envelope still
    /// yields an `ImogenError`, because callers should never have to handle two shapes.
    public static func from(status: Int, body: Data) -> ImogenError {
        if let envelope = try? JSONDecoder().decode(ApiErrorEnvelope.self, from: body) {
            return ImogenError(
                status: status,
                code: envelope.error.code,
                message: envelope.error.message,
                details: envelope.error.details
            )
        }
        let reason = HTTPURLResponse.localizedString(forStatusCode: status)
        return ImogenError(
            status: status,
            code: "http_error",
            message: "\(status) \(reason)".trimmingCharacters(in: .whitespaces)
        )
    }
}

extension ImogenError: LocalizedError {
    public var errorDescription: String? { message }
}

/// Supplies a bearer token. Omit in a context that already holds a session cookie.
public typealias TokenProvider = @Sendable () async -> String?

/// Called when the server rejects a token, so an app can refresh and retry once.
public typealias TokenRefresher = @Sendable () async -> String?

public struct ClientOptions: Sendable {
    /// Where imogen lives, e.g. `https://photos.example.com`.
    public var baseURL: String
    public var token: TokenProvider?
    public var onUnauthorized: TokenRefresher?
    /// How many times to retry a request that failed for a transient reason.
    public var maxRetries: Int
    public var session: URLSession

    public init(
        baseURL: String,
        token: TokenProvider? = nil,
        onUnauthorized: TokenRefresher? = nil,
        maxRetries: Int = 2,
        session: URLSession = .shared
    ) {
        self.baseURL = baseURL
        self.token = token
        self.onUnauthorized = onUnauthorized
        self.maxRetries = maxRetries
        self.session = session
    }

    /// Convenience for the common case: a token that does not change.
    public init(baseURL: String, token: String, maxRetries: Int = 2, session: URLSession = .shared) {
        self.init(
            baseURL: baseURL,
            token: { token },
            maxRetries: maxRetries,
            session: session
        )
    }
}

/// What a request carries beyond its method and path.
public struct RequestOptions: Sendable {
    public var query: [URLQueryItem]
    public var body: Data?
    public var headers: [String: String]
    /// Set when the body is a multipart form, which cannot be replayed on a retry.
    public var isMultipart: Bool

    public init(
        query: [URLQueryItem] = [],
        body: Data? = nil,
        headers: [String: String] = [:],
        isMultipart: Bool = false
    ) {
        self.query = query
        self.body = body
        self.headers = headers
        self.isMultipart = isMultipart
    }
}

/// The transport every resource shares: URL building, auth, the error envelope, and one
/// retry policy. Resources above this layer contain no HTTP details at all.
public final class HTTPClient: @unchecked Sendable {
    public let baseURL: String
    private let options: ClientOptions
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    init(options: ClientOptions) {
        var trimmed = options.baseURL
        while trimmed.hasSuffix("/") { trimmed.removeLast() }
        self.baseURL = trimmed
        self.options = options
    }

    public func url(_ path: String, query: [URLQueryItem] = []) -> String {
        guard var components = URLComponents(string: baseURL + path) else {
            return baseURL + path
        }
        if !query.isEmpty { components.queryItems = query }
        return components.url?.absoluteString ?? baseURL + path
    }

    func encode<T: Encodable>(_ value: T) throws -> Data {
        try encoder.encode(value)
    }

    /// Sends, decodes, and hands back the typed body.
    func request<T: Decodable>(
        _ method: String, _ path: String, _ options: RequestOptions = RequestOptions()
    ) async throws -> T {
        let (data, _) = try await send(method, path, options)
        if data.isEmpty {
            // A 204 decodes as `nil` for an optional T, and fails loudly otherwise.
            return try decoder.decode(T.self, from: Data("null".utf8))
        }
        return try decoder.decode(T.self, from: data)
    }

    /// Sends and discards the body, for endpoints that answer with no content.
    @discardableResult
    func requestVoid(
        _ method: String, _ path: String, _ options: RequestOptions = RequestOptions()
    ) async throws -> Data {
        let (data, _) = try await send(method, path, options)
        return data
    }

    /// Sends and hands back the raw bytes, for images rather than JSON.
    @discardableResult
    public func send(
        _ method: String, _ path: String, _ options: RequestOptions = RequestOptions()
    ) async throws -> (Data, HTTPURLResponse) {
        var lastError: Error?
        // A multipart body is not replayed: doing so would mean holding the whole file
        // to send it twice.
        let replayable = !options.isMultipart

        for attempt in 0...self.options.maxRetries {
            do {
                let (data, response) = try await perform(method: method, path: path, options: options)

                if response.statusCode == 401, attempt == 0, let refresh = self.options.onUnauthorized {
                    // Give the caller one chance to refresh, then try again.
                    if await refresh() != nil, replayable { continue }
                }

                if (200..<300).contains(response.statusCode) {
                    return (data, response)
                }

                let error = ImogenError.from(status: response.statusCode, body: data)
                if error.isRetryable, attempt < self.options.maxRetries, replayable {
                    lastError = error
                    try await backoff(attempt)
                    continue
                }
                throw error
            } catch let error as ImogenError {
                throw error
            } catch {
                // A network failure is worth retrying; a rejection from the server is not.
                if attempt == self.options.maxRetries || !replayable { throw error }
                lastError = error
                try await backoff(attempt)
            }
        }

        throw lastError ?? ImogenError(status: 0, code: "http_error", message: "Request failed")
    }

    private func perform(
        method: String, path: String, options: RequestOptions
    ) async throws -> (Data, HTTPURLResponse) {
        guard let url = URL(string: self.url(path, query: options.query)) else {
            throw ImogenError(status: 0, code: "bad_request", message: "Could not build the URL")
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = options.body
        for (key, value) in options.headers { request.setValue(value, forHTTPHeaderField: key) }

        if let provide = self.options.token, let token = await provide(), !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await self.options.session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw ImogenError(status: 0, code: "http_error", message: "Not an HTTP response")
        }
        return (data, http)
    }
}

/// Exponential backoff with full jitter, so a fleet of phones retrying after an outage
/// does not arrive in lockstep.
func backoffDelay(_ attempt: Int) -> Double {
    let base = 0.25 * pow(2.0, Double(attempt))
    return base + Double.random(in: 0..<base)
}

private func backoff(_ attempt: Int) async throws {
    try await Task.sleep(nanoseconds: UInt64(backoffDelay(attempt) * 1_000_000_000))
}
