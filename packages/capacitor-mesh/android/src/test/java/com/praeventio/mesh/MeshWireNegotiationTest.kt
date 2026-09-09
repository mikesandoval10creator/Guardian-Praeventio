package com.praeventio.mesh

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test
class MeshWireNegotiationTest {
    @Test
    fun exposesTheCapabilityPayloadForPrm1Peers() {
        assertArrayEquals(
            byteArrayOf(0x50, 0x52, 0x4d, 0x31, 0x01),
            MeshWireNegotiation.capabilityBytes(),
        )
    }

    @Test
    fun detectsPrm1WhenTheFirstWriteStartsWithWireMagic() {
        assertEquals(
            MeshWireMode.PRM1,
            MeshWireNegotiation.detectMode(byteArrayOf(0x50, 0x52, 0x4d, 0x31, 0x01)),
        )
    }

    @Test
    fun detectsLegacyJsonWhenTheFirstWriteStartsWithAnObject() {
        assertEquals(
            MeshWireMode.LEGACY,
            MeshWireNegotiation.detectMode("{\"id\":\"legacy\"}".toByteArray()),
        )
    }

    @Test
    fun keepsModeUnknownForAnIncompletePrm1Prefix() {
        assertEquals(
            MeshWireMode.UNKNOWN,
            MeshWireNegotiation.detectMode(byteArrayOf(0x50, 0x52, 0x4d)),
        )
    }

    @Test
    fun keepsModeUnknownForGarbageInsteadOfTreatingItAsLegacy() {
        assertEquals(
            MeshWireMode.UNKNOWN,
            MeshWireNegotiation.detectMode(byteArrayOf(0x00, 0x01, 0x02)),
        )
    }
}
