package com.imogen.sdk

import kotlinx.coroutines.test.runTest
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * What the upload actually puts on the wire.
 *
 * Not a detail: the WHATWG multipart parser — which Bun, undici and therefore the server's
 * `parseBody` all implement — cannot tell where an *unquoted* name ends when `filename`
 * follows it. `name=file; filename="x.jpg"` is read as a field called `file; filename=`,
 * so the server sees no `file` at all and rejects every upload. Nothing in the conformance
 * suite can catch that: it compares fixtures between ports, and this is an encoding defect
 * no fixture describes.
 *
 * ktor rendered names unquoted through 3.4.x, which is why the client used to quote them
 * by hand; 3.5.2 quotes them itself (ktorio/ktor#5157) and the hand-quoting is gone. This
 * test does not care which side supplies the quotes — it asserts only the bytes — so it
 * guards a ktor downgrade and a regression on either side alike.
 */
class UploadMultipartTest {

    private val metadata = AssetUploadMetadata(
        deviceAssetId = "android:external_primary:125",
        capturedAt = "2025-07-27T15:04:03.413Z",
        favorite = true,
        filename = "PXL_1.jpg",
        // Quotes and a comma, in a value that travels in a part body rather than a header:
        // the escaping a header needs must not leak into one.
        description = "Sunrise, and \"the good one\"",
        location = GeoPoint(47.6205, -122.3493, 158.0, "Space Needle, Seattle"),
    )

    /**
     * The parts' headers, read the way a parser reads them: each part up to its blank
     * line, and no further. Grepping the whole body instead would let a part *body* that
     * happens to contain a CRLF and a header-shaped line — which is exactly what a
     * hostile filename puts there — pass for a header.
     */
    private fun dispositions(body: ByteArray): List<String> {
        val text = String(body, Charsets.ISO_8859_1)
        val boundary = text.substringBefore("\r\n")
        return text.split("$boundary\r\n")
            .drop(1)
            .map { it.substringBefore("\r\n\r\n") }
            .flatMap { it.split("\r\n") }
            .filter { it.startsWith("Content-Disposition:") }
    }

    private fun uploadAndCapture(metadata: AssetUploadMetadata = this.metadata): ByteArray = run {
        val file = File.createTempFile("imogen", ".jpg").apply {
            writeBytes(byteArrayOf(1, 2, 3))
            deleteOnExit()
        }
        val stub = Stub { _, _ -> Reply.json("{}") }
        // What comes back does not matter here — this is about what goes out, and the
        // stub records the request before it answers. Building a whole valid asset just
        // to get past deserialization would tie this test to a model it is not about.
        kotlinx.coroutines.runBlocking {
            runCatching {
                ImogenClient(
                    ClientOptions(baseUrl = "https://photos.example.test", engine = stub.engine)
                ).use { imogen ->
                    imogen.assets.upload(file, UploadOptions(metadata = metadata))
                }
            }
        }
        stub.calls.single().body
    }

    @Test
    fun `every part names itself with a quoted name`() = runTest {
        val lines = dispositions(uploadAndCapture())

        assertTrue(lines.isNotEmpty(), "no parts were written at all")
        for (line in lines) {
            // The separator matters: a bare `name="` is also satisfied by the file part's
            // own `filename="…"`, which would let the one part the bug is about go
            // unquoted without this test noticing.
            assertTrue(
                line.contains("; name=\""),
                "unquoted name, which the server will misread: $line",
            )
        }
    }

    @Test
    fun `the file part is called file, and carries the filename beside it`() = runTest {
        val lines = dispositions(uploadAndCapture())

        assertEquals(
            1,
            lines.count { it.contains("name=\"file\"") },
            "exactly one part must be the file itself: $lines",
        )
        assertTrue(
            lines.any { it.contains("name=\"file\"") && it.contains("filename=\"PXL_1.jpg\"") },
            "the file part must carry its filename: $lines",
        )
    }

    @Test
    fun `every metadata field travels as its own part, and nothing else does`() = runTest {
        val lines = dispositions(uploadAndCapture())

        for (name in METADATA_PART_NAMES) {
            assertTrue(lines.any { it.contains("; name=\"$name\"") }, "no $name part: $lines")
        }
        // Counted, not just spot-checked: a part that quietly stops being written is the
        // failure mode a set of `any` assertions cannot see.
        assertEquals(
            METADATA_PART_NAMES.size + 1,
            lines.size,
            "one part per metadata field, plus the file: $lines",
        )
    }

    @Test
    fun `the location rides as JSON in its own part`() = runTest {
        val body = String(uploadAndCapture(), Charsets.ISO_8859_1)

        // The value most likely to expose an encoding bug: quotes and commas, in the one
        // metadata field that is a document rather than a scalar.
        assertTrue(
            body.contains(
                """{"latitude":47.6205,"longitude":-122.3493,"altitude":158.0,""" +
                    """"place":"Space Needle, Seattle"}""",
            ),
            "the location part did not carry its JSON intact: $body",
        )
        assertTrue(
            body.contains("Sunrise, and \"the good one\""),
            "the description part did not carry its quotes intact: $body",
        )
    }

    @Test
    fun `a quote or a newline in the filename is escaped, not left in the header`() = runTest {
        // Android reads this straight off MediaStore's DISPLAY_NAME, so it is user data.
        // Raw, the quote ends the parameter early and the CRLF starts a header of the
        // caller's choosing; undici answers both by rejecting the whole body.
        val hostile = "he said \"hi\"\r\nContent-Disposition: form-data; name=\"evil\", ok.jpg"
        val lines = dispositions(uploadAndCapture(metadata.copy(filename = hostile)))

        assertEquals(
            "Content-Disposition: form-data; name=\"file\"; filename=\"he said %22hi%22%0D%0A" +
                "Content-Disposition: form-data; name=%22evil%22, ok.jpg\"",
            lines.single { it.contains("; name=\"file\"") },
            "the filename must be escaped into the header, not laid into it: $lines",
        )
        // The escaping is the only thing standing between a DISPLAY_NAME and an extra part.
        assertEquals(
            METADATA_PART_NAMES.size + 1,
            lines.size,
            "the filename smuggled a part past the encoding: $lines",
        )
    }

    private companion object {
        val METADATA_PART_NAMES = listOf(
            "deviceAssetId",
            "capturedAt",
            "favorite",
            "description",
            "filename",
            "location",
        )
    }
}
