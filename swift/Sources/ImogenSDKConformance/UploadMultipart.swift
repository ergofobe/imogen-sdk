import Foundation

import ImogenSDK

/// What the upload actually puts on the wire.
///
/// Nothing in the conformance suite can catch an encoding defect here: it compares
/// fixtures between the five ports, and a `Content-Disposition` no fixture describes is
/// invisible to it. Only a test that reads the rendered bytes sees this class of bug, so
/// each port that builds a multipart body carries one. Kotlin's is `UploadMultipartTest`.
///
/// This port assembles the body by hand, which makes it the one where a filename carrying
/// a CRLF does not merely truncate the parameter — it writes headers of the caller's
/// choosing into the request. On a phone the name comes straight out of the photograph
/// library, so it is user data.
enum UploadMultipart {

    /// The parts' headers, read the way a parser reads them: each part up to its blank
    /// line, and no further. Searching the whole body instead would let a part *body* that
    /// happens to contain a CRLF and a header-shaped line — which is exactly what a
    /// hostile filename puts there — pass for a header.
    static func dispositions(_ body: Data) -> [String] {
        // Byte-for-character rather than UTF-8: the file's own bytes are in here too, and
        // a lossy decode would replace them and shift everything after.
        let text = String(body.map { Character(UnicodeScalar($0)) })
        let boundary = text.components(separatedBy: "\r\n")[0]

        return text.components(separatedBy: "\(boundary)\r\n")
            .dropFirst()
            .flatMap { part in
                part.components(separatedBy: "\r\n\r\n")[0].components(separatedBy: "\r\n")
            }
            .filter { $0.hasPrefix("Content-Disposition:") }
    }

    static func uploadAndCapture(filename: String) async throws -> Data {
        let file = FileManager.default.temporaryDirectory
            .appendingPathComponent("imogen-upload-multipart.jpg")
        try Data("not really a jpeg".utf8).write(to: file)

        let session = stubbedSession { _, _ in .json("{}") }
        let client = ImogenClient(
            options: ClientOptions(baseURL: Conformance.base, maxRetries: 0, session: session)
        )
        // What comes back does not matter: the stub records the request before it answers,
        // and building a whole valid asset would tie this to a model it is not about.
        _ = try? await client.assets.upload(
            file, options: UploadOptions(metadata: AssetUploadMetadata(filename: filename))
        )

        guard let call = StubState.shared.calls.first else {
            fail("the upload made no request at all")
            return Data()
        }
        return call.body
    }

    static func testTheFilePartCarriesAnOrdinaryFilenameUnchanged() async throws {
        let lines = dispositions(try await uploadAndCapture(filename: "PXL_1.jpg"))

        expectTrue(
            lines.contains {
                $0.contains("name=\"file\"") && $0.contains("filename=\"PXL_1.jpg\"")
            },
            "the file part must carry its filename: \(lines)"
        )
    }

    static func testAQuoteOrANewlineInTheFilenameIsEscaped() async throws {
        let hostile = "he said \"hi\"\r\nContent-Disposition: form-data; name=\"evil\", ok.jpg"
        let lines = dispositions(try await uploadAndCapture(filename: hostile))

        expectEqual(
            lines.filter { $0.contains("; name=\"file\"") },
            [
                "Content-Disposition: form-data; name=\"file\"; filename=\"he said %22hi%22%0D%0A"
                    + "Content-Disposition: form-data; name=%22evil%22, ok.jpg\""
            ],
            "the filename must be escaped into the header, not laid into it: \(lines)"
        )
        // The escaping is the only thing standing between a display name and an extra
        // part. Two is the whole body here: the file, and the `filename` part beside it.
        expectEqual(lines.count, 2, "the filename smuggled a part past the encoding: \(lines)")
    }
}
