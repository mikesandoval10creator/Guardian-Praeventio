package com.praeventio.mesh

/** Wire mode selected per peer after capability discovery or first-write probing. */
internal enum class MeshWireMode {
    UNKNOWN,
    LEGACY,
    PRM1,
}

/**
 * Compatibility negotiation for the PRM1 rollout.
 *
 * A legacy peer has no capability characteristic and still sends raw JSON.
 * The first bytes are only used to classify an inbound stream; malformed or
 * ambiguous bytes remain UNKNOWN and are never treated as a valid packet.
 */
internal object MeshWireNegotiation {
    private val MAGIC = byteArrayOf(0x50, 0x52, 0x4d, 0x31)
    private val CAPABILITY = byteArrayOf(0x50, 0x52, 0x4d, 0x31, 0x01)

    fun capabilityBytes(): ByteArray = CAPABILITY.copyOf()

    fun detectMode(bytes: ByteArray): MeshWireMode {
        if (bytes.size >= MAGIC.size && bytes.copyOfRange(0, MAGIC.size).contentEquals(MAGIC)) {
            return MeshWireMode.PRM1
        }
        val first = bytes.firstOrNull()?.toInt()?.and(0xff) ?: return MeshWireMode.UNKNOWN
        return if (first == '{'.code || first == '['.code) {
            MeshWireMode.LEGACY
        } else {
            MeshWireMode.UNKNOWN
        }
    }
}
