package com.imogen.sdk

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * A camera pointed at the world reads a great many things that are not a pairing
 * invitation, so the parser has to be as good at saying no as it is at saying yes.
 */
class PairingTest {

    @Test
    fun `reads the QR code the browser renders`() {
        val invitation =
            parsePairingUri("imogen://pair?server=https%3A%2F%2Fphotos.example.com&code=imog_pair_x")

        assertEquals("https://photos.example.com", invitation?.serverUrl)
        assertEquals("imog_pair_x", invitation?.code)
    }

    @Test
    fun `a tapped link carries the server implicitly, because it came from it`() {
        val invitation = parsePairingUri("https://photos.example.com/pair?code=abc")

        assertEquals("https://photos.example.com", invitation?.serverUrl)
        assertEquals("abc", invitation?.code)
    }

    @Test
    fun `keeps a non-default port, which a home library usually has`() {
        assertEquals(
            "http://192.168.1.9:3000",
            parsePairingUri("http://192.168.1.9:3000/pair?code=abc")?.serverUrl,
        )
    }

    @Test
    fun `refuses anything that is not an invitation`() {
        assertNull(parsePairingUri("https://example.com/holiday"))
        assertNull(parsePairingUri("not a url at all "))
        assertNull(parsePairingUri("mailto:someone@example.com?code=abc"))
        assertNull(parsePairingUri("imogen://pair?server=https://photos.example.com&code="))
    }
}
