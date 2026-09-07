import Foundation

import ImogenSDK

/// The Swift half of the shared conformance suite.
///
/// Everything asserted here comes out of `../../conformance`, so this file and its
/// TypeScript, Rust, Python and Kotlin counterparts are checking the same contract rather
/// than five independent opinions about it.
enum Conformance {
    static let base = "https://photos.example.test"

    // MARK: Fixtures

    nonisolated(unsafe) static var conformanceDirectory: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()  // ImogenSDKConformance
            .deletingLastPathComponent()  // Sources
            .deletingLastPathComponent()  // swift
            .deletingLastPathComponent()  // the repository root
            .appendingPathComponent("conformance")
    }

    static func fixture(_ name: String) throws -> [String: Any] {
        let data = try Data(contentsOf: conformanceDirectory.appendingPathComponent(name))
        return try JSONSerialization.jsonObject(with: data) as! [String: Any]
    }

    /// Walks a dotted path, so a failure names the field rather than dumping the model.
    static func at(_ value: Any?, _ path: String) -> Any? {
        var current = value
        for key in path.split(separator: ".") {
            if let array = current as? [Any], let index = Int(key) {
                current = index < array.count ? array[index] : nil
            } else if let object = current as? [String: Any] {
                current = object[String(key)]
            } else {
                return nil
            }
            if current is NSNull { return nil }
        }
        return current
    }

    /// The stub's default answers. The resumable handshake is the only part that needs
    /// real ones: it opens a session, then chunks until the reported offset reaches the
    /// end, so a stub that always says nought loops for ever.
    static let defaultReply: @Sendable (Recorded, Int) -> Reply = { request, _ in
        if request.path == "/api/v1/uploads" && request.method == "POST" {
            let size = UploadLimits.resumableThresholdBytes
            return .json(
                """
                {"id":"SESSION","offset":0,"sizeBytes":\(size),\
                "expiresAt":"2030-01-01T00:00:00.000Z","existing":null}
                """
            )
        }
        if request.path.hasPrefix("/api/v1/uploads/") {
            return .json("{\"offset\":\(UploadLimits.resumableThresholdBytes)}")
        }
        return .json("{\"items\":[],\"nextCursor\":null,\"total\":0}")
    }

    // MARK: The endpoint table

    /// Performs one operation from the contract. Returns false when the client has no way
    /// to perform it, which is itself a conformance failure.
    static func invoke(_ client: ImogenClient, _ key: String, big: URL, small: URL) async -> Bool {
        let ids = ["ASSET"]

        do {
            switch key {
            case "client.health": _ = try await client.health()

            case "assets.list": _ = try await client.assets.list()
            case "assets.get": _ = try await client.assets.get("ASSET")
            case "assets.update":
                _ = try await client.assets.update("ASSET", AssetUpdate(favorite: true))
            case "assets.shareLink": _ = try await client.assets.shareLink("ASSET")
            case "assets.share": _ = try await client.assets.share("ASSET")
            case "assets.unshare": try await client.assets.unshare("ASSET")
            case "assets.trash": _ = try await client.assets.trash(ids)
            case "assets.restore": _ = try await client.assets.restore(ids)
            case "assets.timeline": _ = try await client.assets.timeline()
            case "assets.timelineBucket":
                _ = try await client.assets.timelineBucket(TimelineBucketQuery(period: "2024-06"))
            case "assets.stats": _ = try await client.assets.stats()
            case "assets.variant": _ = try await client.assets.data("ASSET", variant: .thumbnail)
            case "assets.download":
                _ = try await client.http.send("GET", "/api/v1/assets/ASSET/download")
            case "assets.upload": _ = try await client.assets.upload(small)
            case "assets.createUploadSession", "assets.uploadChunk", "assets.completeUpload":
                _ = try await client.assets.upload(big)

            case "albums.list": _ = try await client.albums.list()
            case "albums.get": _ = try await client.albums.get("ALBUM")
            case "albums.create": _ = try await client.albums.create(AlbumCreate(name: "A"))
            case "albums.update":
                _ = try await client.albums.update("ALBUM", AlbumUpdate(name: "B"))
            case "albums.remove": try await client.albums.remove("ALBUM")
            case "albums.addAssets": _ = try await client.albums.addAssets("ALBUM", ids)
            case "albums.removeAssets": _ = try await client.albums.removeAssets("ALBUM", ids)
            case "albums.shareLink": _ = try await client.albums.shareLink("ALBUM")
            case "albums.share": _ = try await client.albums.share("ALBUM")
            case "albums.unshare": try await client.albums.unshare("ALBUM")

            case "people.status": _ = try await client.people.status()
            case "people.setEnabled": try await client.people.setEnabled(true)
            case "people.list": _ = try await client.people.list()
            case "people.get": _ = try await client.people.get("PERSON")
            case "people.update":
                try await client.people.update("PERSON", PersonUpdate(name: "Ada"))
            case "people.merge":
                _ = try await client.people.merge(keeping: "PERSON", merging: ["OTHER"])
            case "people.reassign": try await client.people.reassign(["FACE"], to: nil)
            case "people.facesIn": _ = try await client.people.faces(in: "ASSET")
            case "people.thumbnail":
                _ = try await client.http.send("GET", "/api/v1/people/thumbnail/FACE")

            case "vault.status": _ = try await client.vault.status()
            case "vault.setPassphrase": try await client.vault.setPassphrase("open sesame")
            case "vault.unlock": try await client.vault.unlock("open sesame")
            case "vault.lock": try await client.vault.lock()
            case "vault.list": _ = try await client.vault.list()
            case "vault.timeline": _ = try await client.vault.timeline()
            case "vault.timelineBucket":
                _ = try await client.vault.timelineBucket(period: "2024-06")
            case "vault.moveIn": _ = try await client.vault.moveIn(ids)
            case "vault.moveOut": _ = try await client.vault.moveOut(ids)

            case "auth.config": _ = try await client.auth.config()
            case "auth.login":
                _ = try await client.auth.login(LoginRequest(email: "a@b.c", password: "x"))
            case "auth.signup":
                _ = try await client.auth.signup(
                    SignupRequest(email: "a@b.c", password: "x", name: "A"))
            case "auth.logout": try await client.auth.logout()
            case "auth.logoutEverywhere": try await client.auth.logoutEverywhere()
            case "auth.me": _ = try await client.auth.me()
            case "auth.updateProfile":
                _ = try await client.auth.updateProfile(ProfileUpdate(name: "A"))
            case "auth.changePassword":
                try await client.auth.changePassword(
                    PasswordChangeRequest(newPassword: String(repeating: "x", count: 10)))
            case "auth.oidcStart":
                _ = try await client.http.send("GET", "/api/v1/auth/oidc/start")

            case "admin.users": _ = try await client.admin.users()
            case "admin.updateUser":
                _ = try await client.admin.updateUser("USER", AdminUserUpdate(role: .user))
            case "admin.deleteUser": try await client.admin.deleteUser("USER")
            case "admin.resetPassword":
                try await client.admin.resetPassword("USER", to: String(repeating: "x", count: 10))
            case "admin.invites": _ = try await client.admin.invites()
            case "admin.createInvite": _ = try await client.admin.createInvite()
            case "admin.revokeInvite": try await client.admin.revokeInvite("INVITE")
            case "admin.queue": _ = try await client.admin.queue()
            case "admin.retryJob": try await client.admin.retryJob("JOB")
            case "admin.retryAllJobs": _ = try await client.admin.retryAllJobs()
            case "admin.discardJob": try await client.admin.discardJob("JOB")
            case "admin.clients": _ = try await client.admin.clients()
            case "admin.revokeClient": try await client.admin.revokeClient("CLIENT")
            case "admin.sessions": _ = try await client.admin.sessions()
            case "admin.revokeSession": try await client.admin.revokeSession("SESSION")
            case "admin.storage": _ = try await client.admin.storage()
            case "admin.settings": _ = try await client.admin.settings()
            case "admin.updateSettings":
                _ = try await client.admin.updateSettings(ServerSettingsUpdate(allowSignup: true))
            case "admin.shares": _ = try await client.admin.shares()
            case "admin.revokeShare": try await client.admin.revokeShare("SHARE")

            case "pairing.create": _ = try await client.pairing.create()
            case "pairing.status": _ = try await client.pairing.status("TICKET")
            case "pairing.claim":
                _ = try await client.pairing.claim(
                    PairingClaimRequest(
                        code: "imog_pair_x",
                        clientId: "CLIENT",
                        redirectUri: "imogen://oauth",
                        codeChallenge: String(repeating: "x", count: 43)
                    )
                )

            case "oauth.discover":
                _ = try await client.http.send("GET", "/.well-known/oauth-authorization-server")

            case "oauth.protectedResource":
                _ = try await client.http.send("GET", "/.well-known/oauth-protected-resource")

            case "oauth.protectedResourceMcp":
                _ = try await client.http.send("GET", "/.well-known/oauth-protected-resource/mcp")

            default: return false
            }
        } catch {
            // The stub's body is nonsense; the path is the point.
        }
        return true
    }

    static let placeholders = [
        "{assetId}": "ASSET", "{albumId}": "ALBUM", "{personId}": "PERSON",
        "{faceId}": "FACE", "{userId}": "USER", "{inviteId}": "INVITE",
        "{jobId}": "JOB", "{clientId}": "CLIENT", "{sessionId}": "SESSION",
        "{shareId}": "SHARE", "{ticketId}": "TICKET", "{variant}": "thumbnail",
    ]

    static func concrete(_ path: String) -> String {
        placeholders.reduce(path) { $0.replacingOccurrences(of: $1.key, with: $1.value) }
    }

    static func testEveryOperationInTheContractReachesTheRightEndpoint() async throws {
        let directory = FileManager.default.temporaryDirectory
        let small = directory.appendingPathComponent("imogen-conformance-small.jpg")
        try Data("not really a jpeg".utf8).write(to: small)

        // The resumable path needs a file over the threshold. A sparse one costs no disk.
        let big = directory.appendingPathComponent("imogen-conformance-big.mov")
        FileManager.default.createFile(atPath: big.path, contents: nil)
        let handle = try FileHandle(forWritingTo: big)
        try handle.truncate(atOffset: UInt64(UploadLimits.resumableThresholdBytes))
        try handle.close()

        let session = stubbedSession(Conformance.defaultReply)
        let table = try Conformance.fixture("endpoints.json")["resources"] as! [String: [[String: String]]]

        var missing: [String] = []
        var wrong: [String] = []

        for (resource, operations) in table {
            for endpoint in operations {
                let key = "\(resource).\(endpoint["operation"]!)"
                let want = (endpoint["method"]!, Conformance.concrete(endpoint["path"]!))
                let before = StubState.shared.callCount

                let client = ImogenClient(
                    options: ClientOptions(baseURL: Conformance.base, maxRetries: 0, session: session)
                )
                guard await invoke(client, key, big: big, small: small) else {
                    missing.append(key)
                    continue
                }

                let made = StubState.shared.calls.dropFirst(before).map { ($0.method, $0.path) }
                if !made.contains(where: { $0 == want.0 && $1 == want.1 }) {
                    wrong.append("\(key): wanted \(want), saw \(made)")
                }
            }
        }

        expectEqual(missing, [], "the contract names operations the client cannot perform")
        expectEqual(wrong, [])
    }

    // MARK: Models

    /// Decodes a fixture into `T`, re-encodes it, and checks the asserted fields survived.
    /// The round trip is the point: a field the type forgot would decode fine and then
    /// vanish on the way back out. Swift omits nil rather than writing null, so an absent
    /// key and an explicit null are treated alike.
    static func check<T: Codable>(_ type: T.Type, _ name: String) throws {
        let models = try Conformance.fixture("models.json")
        let entry = models[name] as! [String: Any]

        let payload = try JSONSerialization.data(withJSONObject: entry["payload"]!)
        let decoded = try JSONDecoder().decode(T.self, from: payload)
        let encoded = try JSONSerialization.jsonObject(with: JSONEncoder().encode(decoded))

        for (path, expected) in entry["assert"] as! [String: Any] {
            let actual = Conformance.at(encoded, path)

            if expected is NSNull {
                expectNil(actual, "\(name).\(path) should be absent or null")
                continue
            }
            expectEqual(String(describing: actual ?? "nil"),
                String(describing: expected),
                "\(name).\(path)"
            )
        }
    }

    static func testModelsDecodeAsTheContractSays() throws {
        try check(Asset.self, "asset")
        try check(Asset.self, "assetMinimal")
        try check(AssetPage.self, "assetPage")
        try check(Album.self, "album")
        try check(AlbumAssetsResult.self, "albumAssetsResult")
        try check(ShareLink.self, "shareLink")
        try check(User.self, "user")
        try check(AuthConfig.self, "authConfigOidcOff")
        try check(AuthConfig.self, "authConfigOidcOn")
        try check(Person.self, "person")
        try check(Person.self, "personUnnamed")
        try check(DetectedFace.self, "detectedFace")
        try check(FaceStatus.self, "faceStatus")
        try check(VaultStatus.self, "vaultStatusLocked")
        try check(VaultStatus.self, "vaultStatusUnlocked")
        try check(Timeline.self, "timeline")
        try check(TimelineBucket.self, "timelineBucket")
        try check(TimelineTile.self, "timelineTile")
        try check(LibraryStats.self, "libraryStats")
        try check(UploadSession.self, "uploadSession")
        try check(AdminUser.self, "adminUser")
        try check(QueueHealth.self, "queueHealth")
        try check(StorageReport.self, "storageReport")
        try check(ServerSettings.self, "serverSettings")
        try check(TokenResponse.self, "tokenResponse")
        try check(ProtectedResourceMetadata.self, "protectedResourceMetadata")
        try check(ProtectedResourceMetadata.self, "protectedResourceMetadataMinimal")
        try check(PairingTicket.self, "pairingTicket")
        try check(PairingStatus.self, "pairingStatusUnclaimed")
        try check(PairingStatus.self, "pairingStatusClaimed")
        try check(PairingClaim.self, "pairingClaim")
    }

    // MARK: Errors

    static func testErrorsAreClassifiedAsTheContractSays() throws {
        let errors = try Conformance.fixture("errors.json")

        for case let item as [String: Any] in errors["cases"] as! [Any] {
            let name = item["name"] as! String
            let status = item["status"] as! Int
            let want = item["expect"] as! [String: Any]

            let body: Data
            if let raw = item["bodyRaw"] as? String {
                body = Data(raw.utf8)
            } else {
                body = try JSONSerialization.data(withJSONObject: item["body"]!)
            }

            let error = ImogenError.from(status: status, body: body)

            expectEqual(error.status, status, name)
            expectEqual(error.code, want["code"] as? String, name)
            expectEqual(error.isRetryable, want["retryable"] as? Bool, name)
            expectEqual(error.isAuthError, want["authError"] as? Bool, name)

            if let message = want["message"] as? String {
                expectEqual(error.message, message, name)
            }

            if let expected = want["details"] as? [String: [String]] {
                expectEqual(error.details, expected, name)
            } else {
                expectNil(error.details, "\(name): expected no detail")
            }
        }
    }

    static func testTuningConstantsMatchTheContract() throws {
        // The fixture object carries a `$comment` alongside the numbers, so read the
        // keys that matter rather than casting the whole thing.
        let upload = try Conformance.fixture("errors.json")["upload"] as! [String: Any]
        func number(_ key: String) -> Int { (upload[key] as? NSNumber)?.intValue ?? -1 }

        expectEqual(UploadLimits.bulkConcurrency, number("bulkConcurrency"), "bulkConcurrency")
        expectEqual(
            UploadLimits.resumableThresholdBytes, number("resumableThresholdBytes"),
            "resumableThresholdBytes")
        expectEqual(UploadLimits.chunkBytes, number("chunkBytes"), "chunkBytes")
    }

    // MARK: Transport

    static func testRetriesARetryableRejectionAndThenSucceeds() async throws {
        let session = stubbedSession { _, index in
            index < 2
                ? .status(429, #"{"error":{"code":"rate_limited","message":"slow"}}"#)
                : .json(#"{"status":"ok","version":"0.1.0"}"#)
        }

        let client = ImogenClient(options: ClientOptions(baseURL: Conformance.base, session: session))
        let health = try await client.health()

        expectEqual(health.status, "ok")
        expectEqual(StubState.shared.callCount, 3)
    }

    static func testDoesNotRetryARejectionTheServerWillKeepRejecting() async throws {
        let session = stubbedSession { _, _ in
            .status(404, #"{"error":{"code":"not_found","message":"no"}}"#)
        }

        let client = ImogenClient(options: ClientOptions(baseURL: Conformance.base, session: session))

        do {
            _ = try await client.assets.get("nope")
            fail("should have thrown")
        } catch let error as ImogenError {
            expectEqual(error.status, 404)
        }
        expectEqual(StubState.shared.callCount, 1)
    }

    /// `except` narrows a filter. Beside an explicit id list it is a contradiction the
    /// server's id branch never reads, so honouring it would trash the very photographs
    /// the caller excluded — refused before the request leaves rather than from a 400.
    static func testRefusesAnIdListWithExclusionsRatherThanSendingIt() async throws {
        let session = stubbedSession { _, _ in .json(#"{"count":0}"#) }
        let client = ImogenClient(options: ClientOptions(baseURL: Conformance.base, session: session))

        do {
            _ = try await client.assets.trash(
                AssetSelection(assetIds: ["a", "b"], except: ["a"]))
            fail("should have refused a selection excluding ids it also names")
        } catch let error as ImogenError {
            expectTrue(error.message.contains("except"), error.message)
        }
        expectEqual(StubState.shared.callCount, 0)
    }

    /// The listing is capped, and the cap has to be visible. A return type carrying only
    /// the rows cannot say "there are four thousand of these and you have two hundred",
    /// which is the difference between a sample and the whole vault.
    static func testTheVaultListingSaysHowBigTheVaultIs() async throws {
        let session = stubbedSession { _, _ in
            .json(#"{"items":[],"nextCursor":null,"total":4096}"#)
        }

        let client = ImogenClient(options: ClientOptions(baseURL: Conformance.base, session: session))
        let page = try await client.vault.list()

        expectEqual(page.items.count, 0)
        expectEqual(page.total, 4096)
    }

    /// `period`, `cursor` and `limit` and nothing else: the vault spine takes no filter,
    /// so there is nothing a caller can send that widens what comes back.
    static func testTheVaultSpineAsksForOnePeriodAndCarriesNoFilter() async throws {
        let session = stubbedSession { _, _ in
            .json(#"{"items":[],"nextCursor":null,"total":0}"#)
        }

        let client = ImogenClient(options: ClientOptions(baseURL: Conformance.base, session: session))
        _ = try await client.vault.timelineBucket(period: "2011-08")

        expectEqual(StubState.shared.calls.last?.path, "/api/v1/vault/timeline/bucket")
        expectEqual(StubState.shared.calls.last?.query, "period=2011-08")
    }

    static func testSendsTheBearerToken() async throws {
        let session = stubbedSession(Conformance.defaultReply)
        let client = ImogenClient(
            options: ClientOptions(baseURL: Conformance.base, token: "abc123", session: session)
        )

        _ = try await client.assets.list()

        expectEqual(StubState.shared.calls.first?.headers["authorization"], "Bearer abc123")
    }

    static func testAsksForAFreshTokenOnceWhenTheServerRejectsTheOldOne() async throws {
        let session = stubbedSession { request, index in
            index == 0
                ? .status(401, #"{"error":{"code":"unauthorized","message":"x"}}"#)
                : Conformance.defaultReply(request, index)
        }

        let refreshed = Refreshed()
        let client = ImogenClient(
            options: ClientOptions(
                baseURL: Conformance.base,
                token: { "stale" },
                onUnauthorized: {
                    refreshed.mark()
                    return "fresh"
                },
                session: session
            )
        )

        _ = try await client.assets.list()

        expectTrue(refreshed.value)
        expectEqual(StubState.shared.callCount, 2)
    }

    /// A camera pointed at the world reads a great many things that are not a pairing
    /// invitation, so the parser has to be as good at saying no as at saying yes.
    static func testReadsAPairingInvitation() {
        let fromQR = PairingInvitation(
            scanned: "imogen://pair?server=https%3A%2F%2Fphotos.example.com&code=imog_pair_x")
        expectEqual(fromQR?.serverURL, "https://photos.example.com", "QR server")
        expectEqual(fromQR?.code, "imog_pair_x", "QR code")

        // A link tapped in the browser carries the server implicitly: it came from it.
        let fromLink = PairingInvitation(scanned: "https://photos.example.com/pair?code=abc")
        expectEqual(fromLink?.serverURL, "https://photos.example.com", "link server")
        expectEqual(fromLink?.code, "abc", "link code")

        let withPort = PairingInvitation(scanned: "http://192.168.1.9:3000/pair?code=abc")
        expectEqual(withPort?.serverURL, "http://192.168.1.9:3000", "port kept")

        expectNil(PairingInvitation(scanned: "https://example.com/holiday"), "no code")
        expectNil(PairingInvitation(scanned: "not a url at all "), "not a URL")
        expectNil(PairingInvitation(scanned: "mailto:someone@example.com?code=abc"), "wrong scheme")
    }

    static func testBuildsImageURLsWithoutARequest() {
        let client = ImogenClient(baseURL: "\(Conformance.base)/")

        expectEqual(client.assets.url(for: "A1"), "\(Conformance.base)/api/v1/assets/A1/thumbnail")
        expectEqual(client.assets.url(for: "A1", variant: .preview),
            "\(Conformance.base)/api/v1/assets/A1/preview")
        expectEqual(client.assets.downloadURL(for: "A1"), "\(Conformance.base)/api/v1/assets/A1/download")
    }

    // MARK: The RFC 8707 resource indicator

    /// Reads one field out of an `application/x-www-form-urlencoded` body.
    ///
    /// `URLComponents` is no help here: assigning a form body to `query` leaves the
    /// percent-encoding in place rather than resolving it, so `resource` comes back as
    /// `https%3A%2F%2F…` and never matches the fixture.
    /// `omittingEmptySubsequences: false`, because `resource=` is not the same as no
    /// resource: the server reads an empty one as `invalid_target`, and the default would
    /// collapse `"resource="` to a single part and report it as absent — discarding
    /// exactly the mistake the null case exists to catch.
    static func formValue(_ body: String, _ name: String) -> String? {
        for pair in body.split(separator: "&") {
            let parts = pair.split(
                separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            guard parts.count == 2, parts[0] == name else { continue }
            return String(parts[1]).removingPercentEncoding
        }
        return nil
    }

    /// Answers discovery, then hands back a token for whatever is exchanged.
    static let oauthReply: @Sendable (Recorded, Int) -> Reply = { request, _ in
        if request.path == "/.well-known/oauth-authorization-server" {
            let fields = [
                "\"issuer\":\"\(base)\"",
                "\"authorization_endpoint\":\"\(base)/oauth/authorize\"",
                "\"token_endpoint\":\"\(base)/oauth/token\"",
                "\"registration_endpoint\":\"\(base)/oauth/register\"",
            ]
            return .json("{\(fields.joined(separator: ","))}")
        }
        return .json(
            #"{"access_token":"at","token_type":"Bearer","expires_in":3600,"scope":"library:read"}"#
        )
    }

    static func testTheResourceIndicatorTravelsOnBothLegsOrNeither() async throws {
        let endpoints = try Conformance.fixture("endpoints.json")
        let indicator = endpoints["oauthResourceIndicator"] as! [String: Any]

        for case let item as [String: Any] in indicator["cases"] as! [Any] {
            let name = item["name"] as! String
            let resource = item["resource"] as? String
            let session = stubbedSession(Conformance.oauthReply)
            let oauth = OAuthClient(baseURL: base, session: session)

            let pending = try await oauth.beginAuthorization(
                clientId: "CLIENT", redirectURI: "app://callback", resource: resource
            )

            let query = URLComponents(string: pending.authorizationURL)?.queryItems ?? []
            let sent = query.first { $0.name == "resource" }?.value
            expectEqual(sent, item["expectAuthorizationParam"] as? String, "\(name): authorization")

            let before = StubState.shared.callCount
            _ = try await oauth.completeAuthorization(
                pending, callbackURL: "app://callback?code=CODE&state=\(pending.state)"
            )

            let body = String(decoding: StubState.shared.calls[before].body, as: UTF8.self)
            expectEqual(formValue(body, "resource"), item["expectTokenParam"] as? String,
                "\(name): token request")
        }
    }

    /// The path the contract gives for one `oauth` operation.
    static func oauthPath(_ endpoints: [String: Any], _ operation: String) -> String {
        let rows = (endpoints["resources"] as! [String: Any])["oauth"] as! [Any]
        for case let row as [String: Any] in rows where row["operation"] as? String == operation {
            return row["path"] as! String
        }
        fail("the contract names no oauth.\(operation)")
        return ""
    }

    static func testEachResourceIdentifierIsReadFromItsDocument() async throws {
        let endpoints = try Conformance.fixture("endpoints.json")
        let indicator = endpoints["oauthResourceIndicator"] as! [String: Any]
        let identifiers = indicator["identifiers"] as! [String: Any]
        let root = identifiers["root"] as! String
        let mcp = identifiers["mcp"] as! String

        let session = stubbedSession { request, _ in
            // Answers with the identifier for whichever document was asked for, so a
            // client that read the wrong one is caught by the value and not just by the
            // path.
            .json(#"{"resource":"\#(request.path.hasSuffix("/mcp") ? mcp : root)"}"#)
        }
        let oauth = OAuthClient(baseURL: base, session: session)

        expectEqual(try await oauth.discoverProtectedResource().resource, root)
        expectEqual(try await oauth.discoverProtectedResource(.mcp).resource, mcp)

        expectEqual(
            StubState.shared.calls.map(\.path),
            [
                oauthPath(endpoints, "protectedResource"),
                oauthPath(endpoints, "protectedResourceMcp"),
            ]
        )
    }

    /// Pairing must stay unbound, and the reason is not visible from the call site.
    ///
    /// `/api/v1/pairing/claim` mints its authorization code server-side and cannot record
    /// a resource, so a token request naming one is refused — every paired device breaks
    /// at once. Nothing in ``OAuthClient/pair(pairingCode:clientName:redirectURI:deviceName:scopes:)``
    /// itself says so, which is why this is pinned here: pushing `resource` down into the
    /// shared exchange helper would do it silently.
    /// A paired device binds its token by naming the resource on the claim.
    ///
    /// The reason is not visible from the call site: the claim is where the code is
    /// minted, so it is the only leg that can record a resource, and the exchange has to
    /// echo what was recorded or the server answers invalid_target. Pinned here because
    /// pushing `resource` down into the shared `exchange` helper would get one leg and
    /// not the other.
    static func testThePairingResourceIndicatorTravelsOnBothLegsOrNeither() async throws {
        let endpoints = try Conformance.fixture("endpoints.json")
        let indicator = endpoints["pairingResourceIndicator"] as! [String: Any]

        for case let item as [String: Any] in indicator["cases"] as! [Any] {
            let name = item["name"] as! String
            let resource = item["resource"] as? String

            let session = stubbedSession { request, index in
                switch request.path {
                case "/oauth/register": return .json(#"{"client_id":"CLIENT"}"#)
                case "/api/v1/pairing/claim":
                    return .json(
                        #"{"code":"ac_x","redirectUri":"imogen://oauth","scope":"library:read"}"#)
                default: return Conformance.oauthReply(request, index)
                }
            }
            let oauth = OAuthClient(baseURL: base, session: session)

            _ = try await oauth.pair(
                pairingCode: "imog_pair_x", clientName: "A Device",
                redirectURI: "imogen://oauth", resource: resource
            )

            let claims = StubState.shared.calls.filter { $0.path == "/api/v1/pairing/claim" }
            expectTrue(!claims.isEmpty, "\(name): pairing did not reach the claim endpoint")
            // A null is not the same as an absent key: the request schema refuses one, so
            // the unbound case asserts the field is gone rather than merely falsy.
            let claimed =
                (try? JSONSerialization.jsonObject(with: claims[0].body)) as? [String: Any]
            expectEqual(
                claimed?["resource"] as? String, item["expectClaimField"] as? String,
                "\(name): the claim")

            let exchanges = StubState.shared.calls.filter { $0.path == "/oauth/token" }
            expectTrue(!exchanges.isEmpty, "\(name): pairing did not reach the token endpoint")
            for call in exchanges {
                expectEqual(
                    formValue(String(decoding: call.body, as: UTF8.self), "resource"),
                    item["expectTokenParam"] as? String,
                    "\(name): the token request"
                )
            }
        }
    }

    static func testIteratesEveryPageExactlyOnce() async throws {
        @Sendable func page(_ id: String, cursor: String?) -> String {
            let next = cursor.map { "\"\($0)\"" } ?? "null"
            return """
                {"items":[{"id":"\(id)","ownerId":"o","type":"image","status":"ready",\
                "originalFilename":"\(id).jpg","mimeType":"image/jpeg","checksum":"c",\
                "sizeBytes":1,"width":null,"height":null,"duration":null,\
                "capturedAt":"2024-01-01T00:00:00.000Z","capturedAtIsExact":true,\
                "capturedAtOriginal":null,"capturedAtOriginalIsExact":null,\
                "createdAt":"2024-01-01T00:00:00.000Z","updatedAt":"2024-01-01T00:00:00.000Z",\
                "deletedAt":null,"favorite":false,"archived":false,"description":null,\
                "exif":null,"location":null,"placeholderColor":null,"livePhotoVideoId":null,\
                "deviceAssetId":null}],"nextCursor":\(next),"total":2}
                """
        }

        let session = stubbedSession { _, index in
            index == 0 ? .json(page("a", cursor: "c1")) : .json(page("b", cursor: nil))
        }

        let client = ImogenClient(options: ClientOptions(baseURL: Conformance.base, session: session))

        var seen: [String] = []
        for try await asset in client.assets.iterate() { seen.append(asset.id) }

        expectEqual(seen, ["a", "b"])
    }
}

/// A box, so the refresh callback can report back without capturing a `var`.
final class Refreshed: @unchecked Sendable {
    private let lock = NSLock()
    private var flag = false

    func mark() {
        lock.lock()
        flag = true
        lock.unlock()
    }

    var value: Bool {
        lock.lock()
        defer { lock.unlock() }
        return flag
    }
}
