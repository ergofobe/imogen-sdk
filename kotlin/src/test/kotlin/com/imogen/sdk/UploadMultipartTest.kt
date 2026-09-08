package com.imogen.sdk

import kotlinx.coroutines.test.runTest
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * What the upload actually puts on the wire.
 *
 * Not a detail: ktor writes the `name` parameter of a part's Content-Disposition
 * unquoted, and the WHATWG multipart parser — which Bun, undici and therefore the server's
 * `parseBody` all implement — cannot tell where an unquoted name ends when `filename`
 * follows it. `name=file; filename="x.jpg"` is read as a field called `file; filename=`,
 * so the server sees no `file` at all and rejects every upload. Nothing in the conformance
 * suite can catch that: it compares fixtures between ports, and this is an encoding defect
 * no fixture describes.
 */
class UploadMultipartTest {

    private fun dispositions(body: ByteArray): List<String> =
        String(body, Charsets.ISO_8859_1)
            .split("\r\n")
            .filter { it.startsWith("Content-Disposition:") }

    private fun uploadAndCapture(): ByteArray = run {
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
                    imogen.assets.upload(
                        file,
                        UploadOptions(
                            metadata = AssetUploadMetadata(
                                deviceAssetId = "android:external_primary:125",
                                capturedAt = "2025-07-27T15:04:03.413Z",
                                filename = "PXL_1.jpg",
                            ),
                        ),
                    )
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
            assertTrue(
                line.contains("name=\""),
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
    fun `the metadata travels as its own parts`() = runTest {
        val lines = dispositions(uploadAndCapture())

        assertTrue(lines.any { it.contains("name=\"deviceAssetId\"") }, "$lines")
        assertTrue(lines.any { it.contains("name=\"capturedAt\"") }, "$lines")
    }
}
