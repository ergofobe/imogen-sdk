package com.imogen.sdk

import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class VaultTest {

    /**
     * The listing is capped, and the cap has to be visible. A return type carrying only the
     * rows cannot say "there are four thousand of these and you have two hundred", which is
     * the difference between a sample and the whole vault.
     */
    @Test
    fun `the vault listing says how big the vault is, not just what fits in one answer`() =
        runTest {
            val stub = Stub { _, _ -> Reply.json("""{"items":[],"nextCursor":null,"total":4096}""") }

            val page = ImogenClient(
                ClientOptions(baseUrl = "https://photos.example.test", engine = stub.engine)
            ).use { imogen -> imogen.vault.list() }

            assertTrue(page.items.isEmpty())
            assertEquals(4096L, page.total)
        }

    /**
     * `period`, `cursor` and `limit` and nothing else: the vault spine takes no filter, so
     * there is nothing a caller can send that widens what comes back.
     */
    @Test
    fun `the vault spine asks for one period and carries no filter`() = runTest {
        val stub = Stub { _, _ -> Reply.json("""{"items":[],"nextCursor":null,"total":0}""") }

        ImogenClient(
            ClientOptions(baseUrl = "https://photos.example.test", engine = stub.engine)
        ).use { imogen -> imogen.vault.timelineBucket("2011-08") }

        assertEquals("/api/v1/vault/timeline/bucket", stub.calls.single().path)
        assertEquals("period=2011-08", stub.calls.single().query)
    }
}
