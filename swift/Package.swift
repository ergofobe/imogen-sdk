// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "ImogenSDK",
    platforms: [
        .macOS(.v13),
        .iOS(.v16),
        .tvOS(.v16),
        .watchOS(.v9),
    ],
    products: [
        .library(name: "ImogenSDK", targets: ["ImogenSDK"]),
        // The conformance suite is an executable rather than a test target: XCTest is
        // absent wherever Xcode is not installed, and the contract should be checkable
        // with nothing but a Swift toolchain. `swift run ImogenSDKConformance`.
        .executable(name: "ImogenSDKConformance", targets: ["ImogenSDKConformance"]),
    ],
    targets: [
        .target(name: "ImogenSDK"),
        .executableTarget(name: "ImogenSDKConformance", dependencies: ["ImogenSDK"]),
    ]
)
