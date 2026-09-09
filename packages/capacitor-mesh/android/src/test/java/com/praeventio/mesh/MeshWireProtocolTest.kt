package com.praeventio.mesh

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Test

class MeshWireProtocolTest {
    @Test
    fun matchesCrossPlatformGoldenVector() {
        val payload = "{\"id\":\"mesh-vector\",\"text\":\"café ⚠️\"}".toByteArray(Charsets.UTF_8)
        val encoded = MeshWireProtocol.encode(payload)
        val expectedHeader = hexToBytes(
            "50524d31010000000000002a1e6b716c59006e3b210376add52ffac6f394da0b",
        )
        assertArrayEquals(expectedHeader, encoded.copyOfRange(0, MeshWireProtocol.HEADER_BYTES))
    }

    @Test
    fun reassemblesPayloadAcrossArbitraryGattWriteBoundaries() {
        val payload = ByteArray(513) { (it % 251).toByte() }
        val encoded = MeshWireProtocol.encode(payload)
        val decoder = MeshWireProtocol.Decoder()
        val messages = ArrayList<ByteArray>()
        var offset = 0
        val writeSizes = intArrayOf(1, 7, 20, 31, 3, 64)
        var cursor = 0
        while (offset < encoded.size) {
            val end = minOf(offset + writeSizes[cursor % writeSizes.size], encoded.size)
            messages.addAll(decoder.append(encoded.copyOfRange(offset, end)))
            offset = end
            cursor += 1
        }
        assertEquals(1, messages.size)
        assertArrayEquals(payload, messages.single())
    }

    @Test
    fun handlesTwoMessagesBackToBack() {
        val first = byteArrayOf(1, 2, 3)
        val second = ByteArray(4096) { (it % 127).toByte() }
        val decoder = MeshWireProtocol.Decoder()
        val combined = MeshWireProtocol.encode(first) + MeshWireProtocol.encode(second)
        val messages = decoder.append(combined)
        assertEquals(2, messages.size)
        assertArrayEquals(first, messages[0])
        assertArrayEquals(second, messages[1])
    }

    @Test
    fun rejectsCorruptionAndClearsPendingState() {
        val encoded = MeshWireProtocol.encode(byteArrayOf(10, 20, 30, 40))
        encoded[encoded.lastIndex] = (encoded[encoded.lastIndex].toInt() xor 0xff).toByte()
        val decoder = MeshWireProtocol.Decoder()
        try {
            decoder.append(encoded)
            fail("corrupted message must be rejected")
        } catch (_: MeshWireProtocol.ProtocolException) {
            // expected
        }
        assertEquals(0, decoder.append(ByteArray(0)).size)
    }

    @Test
    fun neverUsesJsonBraceHeuristicsForUtf8Payload() {
        val payload = "{\"body\":\"brace } inside UTF-8 ⚠️\"}".toByteArray(Charsets.UTF_8)
        val encoded = MeshWireProtocol.encode(payload)
        val decoder = MeshWireProtocol.Decoder()
        val messages = encoded.asList().chunked(5).flatMap { decoder.append(it.toByteArray()) }
        assertEquals(1, messages.size)
        assertArrayEquals(payload, messages.single())
    }

    private fun hexToBytes(value: String): ByteArray {
        require(value.length % 2 == 0)
        return ByteArray(value.length / 2) { index ->
            value.substring(index * 2, index * 2 + 2).toInt(16).toByte()
        }
    }
}
