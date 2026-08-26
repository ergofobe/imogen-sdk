import Foundation

#if canImport(FoundationNetworking)
    import FoundationNetworking
#endif

#if canImport(CryptoKit)
    import CryptoKit
#else
    import Crypto
#endif

/// Hold these until the redirect comes back; they complete the exchange.
public struct PendingAuthorization: Hashable, Sendable {
    public let authorizationURL: String
    public let codeVerifier: String
    public let state: String
    public let redirectURI: String
    public let clientId: String
}

public struct StoredTokens: Hashable, Sendable {
    public let tokens: TokenResponse
    /// Unix seconds, so expiry is computable without keeping the clock that read it.
    public let obtainedAt: Double

    /// True when the access token is expired or close enough that it should be refreshed.
    public func isExpired(skewSeconds: Int = 60) -> Bool {
        Date().timeIntervalSince1970 >= obtainedAt + Double(max(0, tokens.expiresIn - skewSeconds))
    }
}

public struct OAuthError: Error, LocalizedError, Sendable {
    public let message: String
    public var errorDescription: String? { message }
}

/// The OAuth 2.1 client a native application needs: discover the server, register itself,
/// run authorization code with PKCE, and refresh. No client secret is involved, because a
/// secret shipped inside a mobile app is not a secret.
///
/// ```swift
/// let oauth = OAuthClient(baseURL: "https://photos.example.com")
/// let registered = try await oauth.register(name: "My App", redirectURIs: ["myapp://oauth"])
/// let pending = try await oauth.beginAuthorization(
///     clientId: registered.clientId, redirectURI: "myapp://oauth"
/// )
/// // open pending.authorizationURL in the system browser, then on the callback:
/// let stored = try await oauth.completeAuthorization(pending, callbackURL: url)
/// ```
public actor OAuthClient {
    private let baseURL: String
    private let session: URLSession
    private var metadata: AuthorizationServerMetadata?

    public init(baseURL: String, session: URLSession = .shared) {
        var trimmed = baseURL
        while trimmed.hasSuffix("/") { trimmed.removeLast() }
        self.baseURL = trimmed
        self.session = session
    }

    public func discover() async throws -> AuthorizationServerMetadata {
        if let metadata { return metadata }

        guard let url = URL(string: "\(baseURL)/.well-known/oauth-authorization-server") else {
            throw OAuthError(message: "Could not build the discovery URL")
        }
        let (data, response) = try await session.data(from: url)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw OAuthError(message: "Could not read the authorization server metadata")
        }

        let decoded = try JSONDecoder().decode(AuthorizationServerMetadata.self, from: data)
        metadata = decoded
        return decoded
    }

    /// RFC 7591 dynamic registration, so an app never ships a hard-coded client id.
    public func register(
        name: String,
        redirectURIs: [String],
        scopes: [String] = defaultScopes
    ) async throws -> ClientRegistrationResponse {
        let metadata = try await discover()
        guard let endpoint = metadata.registrationEndpoint, let url = URL(string: endpoint) else {
            throw OAuthError(message: "The server does not offer dynamic registration")
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "client_name": name,
            "redirect_uris": redirectURIs,
            "token_endpoint_auth_method": "none",
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "scope": scopes.joined(separator: " "),
        ])

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw OAuthError(
                message: "Registration failed: \(String(decoding: data, as: UTF8.self))")
        }
        return try JSONDecoder().decode(ClientRegistrationResponse.self, from: data)
    }

    public func beginAuthorization(
        clientId: String,
        redirectURI: String,
        scopes: [String] = defaultScopes
    ) async throws -> PendingAuthorization {
        let metadata = try await discover()
        let codeVerifier = randomString(byteLength: 32)
        let state = randomString(byteLength: 16)

        guard var components = URLComponents(string: metadata.authorizationEndpoint) else {
            throw OAuthError(message: "The authorization endpoint is not a URL")
        }
        components.queryItems = (components.queryItems ?? []) + [
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "client_id", value: clientId),
            URLQueryItem(name: "redirect_uri", value: redirectURI),
            URLQueryItem(name: "scope", value: scopes.joined(separator: " ")),
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "code_challenge", value: s256(codeVerifier)),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
        ]

        guard let url = components.url else {
            throw OAuthError(message: "Could not build the authorization URL")
        }

        return PendingAuthorization(
            authorizationURL: url.absoluteString,
            codeVerifier: codeVerifier,
            state: state,
            redirectURI: redirectURI,
            clientId: clientId
        )
    }

    public func completeAuthorization(
        _ pending: PendingAuthorization, callbackURL: String
    ) async throws -> StoredTokens {
        guard let components = URLComponents(string: callbackURL) else {
            throw OAuthError(message: "The callback is not a URL")
        }
        let params = Dictionary(
            (components.queryItems ?? []).map { ($0.name, $0.value ?? "") },
            uniquingKeysWith: { first, _ in first }
        )

        if let error = params["error"] {
            throw OAuthError(
                message: params["error_description"] ?? "Authorization failed: \(error)")
        }
        // Checking state is what stops a code from another session being injected here.
        guard params["state"] == pending.state else {
            throw OAuthError(
                message:
                    "Authorization state did not match; the response may have been tampered with")
        }
        guard let code = params["code"] else {
            throw OAuthError(message: "The callback carried no authorization code")
        }

        return try await exchange([
            "grant_type": "authorization_code",
            "client_id": pending.clientId,
            "code": code,
            "code_verifier": pending.codeVerifier,
            "redirect_uri": pending.redirectURI,
        ])
    }

    public func refresh(clientId: String, refreshToken: String) async throws -> StoredTokens {
        try await exchange([
            "grant_type": "refresh_token",
            "client_id": clientId,
            "refresh_token": refreshToken,
        ])
    }

    public func revoke(_ token: String) async throws {
        let metadata = try await discover()
        guard let endpoint = metadata.revocationEndpoint, let url = URL(string: endpoint) else {
            return
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data(formEncode(["token": token]).utf8)
        _ = try? await session.data(for: request)
    }

    private func exchange(_ params: [String: String]) async throws -> StoredTokens {
        let metadata = try await discover()
        guard let url = URL(string: metadata.tokenEndpoint) else {
            throw OAuthError(message: "The token endpoint is not a URL")
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data(formEncode(params).utf8)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let described =
                (try? JSONSerialization.jsonObject(with: data) as? [String: Any])
                .flatMap { $0?["error_description"] as? String ?? $0?["error"] as? String }
                ?? "Token request failed"
            throw OAuthError(message: described)
        }

        return StoredTokens(
            tokens: try JSONDecoder().decode(TokenResponse.self, from: data),
            obtainedAt: Date().timeIntervalSince1970
        )
    }
}

private func base64URL(_ bytes: Data) -> String {
    bytes.base64EncodedString()
        .replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
}

private func randomString(byteLength: Int) -> String {
    var bytes = [UInt8](repeating: 0, count: byteLength)
    for index in bytes.indices { bytes[index] = UInt8.random(in: 0...255) }
    return base64URL(Data(bytes))
}

private func s256(_ verifier: String) -> String {
    base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
}

private func formEncode(_ params: [String: String]) -> String {
    var allowed = CharacterSet.alphanumerics
    allowed.insert(charactersIn: "-._~")

    return params.map { key, value in
        let k = key.addingPercentEncoding(withAllowedCharacters: allowed) ?? key
        let v = value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
        return "\(k)=\(v)"
    }.joined(separator: "&")
}
