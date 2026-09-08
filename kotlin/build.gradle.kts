plugins {
    kotlin("jvm") version "2.2.20"
    kotlin("plugin.serialization") version "2.2.20"
}

group = "com.imogen"
version = "0.4.1"

repositories {
    mavenCentral()
}

val ktorVersion = "3.0.3"

dependencies {
    api("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")
    api("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    api("io.ktor:ktor-client-core:$ktorVersion")
    implementation("io.ktor:ktor-client-content-negotiation:$ktorVersion")
    implementation("io.ktor:ktor-serialization-kotlinx-json:$ktorVersion")
    runtimeOnly("io.ktor:ktor-client-cio:$ktorVersion")

    testImplementation(kotlin("test"))
    testImplementation("io.ktor:ktor-client-mock:$ktorVersion")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
}

kotlin {
    // 17, not the newest available: the Android build tools accept Java 17 class files
    // without ceremony, and this library is meant to be the one an Android application
    // depends on. Nothing here needs a language feature newer than that.
    jvmToolchain(17)
}

tasks.test {
    useJUnitPlatform()
    testLogging {
        events("passed", "failed", "skipped")
    }

    // The conformance suite reads the shared contract JSON (endpoints.json, models.json,
    // errors.json) at runtime; those files live outside this project's source set, so
    // Gradle's up-to-date check can't see them on its own. Without this, editing any of
    // them leaves `test` UP-TO-DATE and the gate reports success without running anything.
    // The whole directory is declared, not individual files, so a future contract file
    // is covered automatically instead of silently falling into the same blind spot.
    inputs.dir(rootProject.layout.projectDirectory.dir("../conformance"))
        .withPropertyName("conformanceContract")
}
