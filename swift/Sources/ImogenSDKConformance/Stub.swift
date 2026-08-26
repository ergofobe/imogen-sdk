import Foundation

#if canImport(FoundationNetworking)
    import FoundationNetworking
#endif

/// A stub imogen, as a `URLProtocol`.
///
/// The conformance suite needs a server that records what it was asked and answers
/// predictably. Intercepting `URLSession` gets that without opening a socket, which keeps
/// the tests free of anything the library itself does not already depend on.

struct Recorded: Sendable {
    let method: String
    let path: String
    let query: String
    let headers: [String: String]
    let body: Data
}

struct Reply: Sendable {
    var status: Int = 200
    var body: String = "{}"

    static func json(_ body: String) -> Reply { Reply(status: 200, body: body) }
    static func status(_ status: Int, _ body: String) -> Reply { Reply(status: status, body: body) }
}

/// Shared because `URLProtocol` instances are made by the loading system, not by us.
final class StubState: @unchecked Sendable {
    private let lock = NSLock()
    private var recorded: [Recorded] = []
    private var responder: (@Sendable (Recorded, Int) -> Reply)?

    static let shared = StubState()

    func install(_ responder: @escaping @Sendable (Recorded, Int) -> Reply) {
        lock.lock()
        defer { lock.unlock() }
        self.responder = responder
        self.recorded = []
    }

    func answer(_ request: Recorded) -> Reply {
        lock.lock()
        let index = recorded.count
        recorded.append(request)
        let responder = self.responder
        lock.unlock()
        return responder?(request, index) ?? Reply()
    }

    var calls: [Recorded] {
        lock.lock()
        defer { lock.unlock() }
        return recorded
    }

    var callCount: Int { calls.count }
}

final class StubProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let url = request.url!
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)

        // `httpBody` is nil when URLSession turned the body into a stream, which it does
        // for anything of any size, so read it back rather than trusting the property.
        var body = request.httpBody ?? Data()
        if body.isEmpty, let stream = request.httpBodyStream {
            stream.open()
            defer { stream.close() }
            var buffer = [UInt8](repeating: 0, count: 64 * 1024)
            while stream.hasBytesAvailable {
                let read = stream.read(&buffer, maxLength: buffer.count)
                if read <= 0 { break }
                body.append(contentsOf: buffer[0..<read])
            }
        }

        let recorded = Recorded(
            method: request.httpMethod ?? "GET",
            path: components?.path ?? url.path,
            query: components?.query ?? "",
            headers: Dictionary(
                (request.allHTTPHeaderFields ?? [:]).map { ($0.key.lowercased(), $0.value) },
                uniquingKeysWith: { first, _ in first }
            ),
            body: body
        )

        let reply = StubState.shared.answer(recorded)
        let response = HTTPURLResponse(
            url: url,
            statusCode: reply.status,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!

        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(reply.body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

/// A session wired to the stub, plus a fresh recording.
func stubbedSession(_ responder: @escaping @Sendable (Recorded, Int) -> Reply) -> URLSession {
    StubState.shared.install(responder)
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [StubProtocol.self]
    return URLSession(configuration: configuration)
}
