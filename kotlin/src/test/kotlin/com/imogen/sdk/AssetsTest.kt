package com.imogen.sdk

import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/**
 * The id-list overload of the bulk asset mutations is the original, shorter way of
 * saying "these assets" -- it must keep producing a bare `{"assetIds":[...]}` body, not
 * grow the `query`/`except` fields a selection carries. All six call sites (trash,
 * restore, addAssets, removeAssets, moveIn, moveOut) delegate through the same
 * `AssetSelection(assetIds = ...)` path, so one covers the shape for all of them.
 */
class AssetsTest {

    @Test
    fun `trash accepts a bare id list, as it always has`() = runTest {
        val stub = Stub { _, _ -> Reply.json("""{"count":1}""") }

        ImogenClient(
            ClientOptions(baseUrl = "https://photos.example.test", engine = stub.engine)
        ).use { imogen ->
            imogen.assets.trash(listOf("6a5f1e2c-90b4-4d1a-8f3e-2b7c9d0a1e45"))
        }

        assertEquals(
            """{"assetIds":["6a5f1e2c-90b4-4d1a-8f3e-2b7c9d0a1e45"]}""",
            String(stub.calls.single().body),
        )
    }

    /**
     * `except` narrows a filter. Beside an explicit id list it is a contradiction the
     * server's id branch never reads, so honouring it would trash the very photographs the
     * caller excluded -- refused before the request leaves rather than learned from a 400.
     */
    @Test
    fun `trash refuses an id list with exclusions rather than sending it`() = runTest {
        val stub = Stub { _, _ -> Reply.json("""{"count":0}""") }

        val error = assertFailsWith<IllegalArgumentException> {
            ImogenClient(
                ClientOptions(baseUrl = "https://photos.example.test", engine = stub.engine)
            ).use { imogen ->
                imogen.assets.trash(
                    AssetSelection(assetIds = listOf("a", "b"), except = listOf("a")),
                )
            }
        }

        assertTrue(error.message!!.contains("except"), error.message)
        assertTrue(stub.calls.isEmpty())
    }
}
