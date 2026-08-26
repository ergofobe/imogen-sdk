plugins {
    // Lets Gradle fetch the JDK the build asks for rather than requiring the right one to
    // already be installed and discoverable, which it often is not on macOS.
    id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}

rootProject.name = "imogen-sdk"
