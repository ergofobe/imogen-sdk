import Foundation

/// A conformance runner, in place of XCTest.
///
/// XCTest is unavailable wherever Xcode is not installed, and the contract ought to be
/// checkable with nothing but a Swift toolchain. This is the whole of what the suite
/// needed from a test framework: named cases, equality, and an exit code.

nonisolated(unsafe) var failures: [String] = []
nonisolated(unsafe) var checks = 0

func fail(_ message: String) {
    failures.append(message)
}

func expect(_ condition: Bool, _ message: @autoclosure () -> String = "") {
    checks += 1
    if !condition { fail(message()) }
}

func expectEqual<T: Equatable>(_ actual: T, _ expected: T, _ context: @autoclosure () -> String = "") {
    checks += 1
    if actual != expected {
        fail("\(context()): expected \(expected), got \(actual)")
    }
}

func expectTrue(_ condition: Bool, _ context: @autoclosure () -> String = "") {
    checks += 1
    if !condition { fail("\(context()): expected true") }
}

func expectNil(_ value: Any?, _ context: @autoclosure () -> String = "") {
    checks += 1
    if let value, !(value is NSNull) {
        fail("\(context()): expected nothing, got \(value)")
    }
}

/// Runs one case, keeping a thrown error from ending the whole suite.
func scenario(_ name: String, _ body: () async throws -> Void) async {
    let before = failures.count
    do {
        try await body()
    } catch {
        fail("\(name): threw \(error)")
    }
    let added = failures.count - before
    print(added == 0 ? "  ok   \(name)" : "  FAIL \(name) (\(added))")
}

print("imogen SDK — Swift conformance")

await scenario("every operation in the contract reaches the right endpoint") {
    try await Conformance.testEveryOperationInTheContractReachesTheRightEndpoint()
}
await scenario("models decode as the contract says") {
    try Conformance.testModelsDecodeAsTheContractSays()
}
await scenario("errors are classified as the contract says") {
    try Conformance.testErrorsAreClassifiedAsTheContractSays()
}
await scenario("tuning constants match the contract") {
    try Conformance.testTuningConstantsMatchTheContract()
}
await scenario("retries a retryable rejection and then succeeds") {
    try await Conformance.testRetriesARetryableRejectionAndThenSucceeds()
}
await scenario("does not retry a rejection the server will keep rejecting") {
    try await Conformance.testDoesNotRetryARejectionTheServerWillKeepRejecting()
}
await scenario("refuses an id list with exclusions rather than sending it") {
    try await Conformance.testRefusesAnIdListWithExclusionsRatherThanSendingIt()
}
await scenario("the vault listing says how big the vault is") {
    try await Conformance.testTheVaultListingSaysHowBigTheVaultIs()
}
await scenario("the vault spine asks for one period and carries no filter") {
    try await Conformance.testTheVaultSpineAsksForOnePeriodAndCarriesNoFilter()
}
await scenario("sends the bearer token") {
    try await Conformance.testSendsTheBearerToken()
}
await scenario("asks for a fresh token once when the server rejects the old one") {
    try await Conformance.testAsksForAFreshTokenOnceWhenTheServerRejectsTheOldOne()
}
await scenario("reads a pairing invitation, and refuses everything else") {
    Conformance.testReadsAPairingInvitation()
}
await scenario("builds image URLs without a request") {
    Conformance.testBuildsImageURLsWithoutARequest()
}
await scenario("the resource indicator travels on both legs or neither") {
    try await Conformance.testTheResourceIndicatorTravelsOnBothLegsOrNeither()
}
await scenario("each resource identifier is read from its document") {
    try await Conformance.testEachResourceIdentifierIsReadFromItsDocument()
}
await scenario("pairing names no resource") {
    try await Conformance.testPairingNamesNoResource()
}
await scenario("iterates every page exactly once") {
    try await Conformance.testIteratesEveryPageExactlyOnce()
}

print("")
if failures.isEmpty {
    print("\(checks) checks passed")
    exit(0)
}

print("\(failures.count) of \(checks) checks failed:")
for failure in failures { print("  - \(failure)") }
exit(1)
