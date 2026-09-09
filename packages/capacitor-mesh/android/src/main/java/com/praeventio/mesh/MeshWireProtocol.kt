package com.praeventio.mesh

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import java.util.zip.CRC32

/**
 * Versioned stream framing shared by the Android/iOS mesh plugins.
 *
 * A logical JSON packet is encoded once, then the resulting bytes may be split
 * at arbitrary GATT write boundaries. The receiver emits only after it has the
 * complete declared message and the CRC/SHA tag both match. GATT writes are
 * deliberately not treated as packet boundaries.
 */
internal object MeshWireProtocol {
    private val MAGIC = byteArrayOf(0x50, 0x52, 0x4d, 0x31) // "PRM1"
    const val VERSION = 1
    const val HEADER_BYTES = 32
    const val MAX_MESSAGE_BYTES = 1024 * 1024
    private const val TAG_BYTES = 16

    class ProtocolException(message: String) : IllegalArgumentException(message)

    fun encode(payload: ByteArray): ByteArray {
        requireSize(payload.size)
        val header = ByteArray(HEADER_BYTES)
        MAGIC.copyInto(header, 0)
        header[4] = VERSION.toByte()
        // header[5..7] flags/reserved remain zero.
        putUInt32(header, 8, payload.size.toLong())
        putUInt32(header, 12, crc32(payload))
        sha256(payload).copyInto(header, 16, 0, TAG_BYTES)
        return concat(header, payload)
    }

    class Decoder {
        private var buffer = ByteArray(0)

        fun reset() {
            buffer = ByteArray(0)
        }

        fun append(chunk: ByteArray): List<ByteArray> {
            if (chunk.isNotEmpty()) buffer = concat(buffer, chunk)
            val messages = ArrayList<ByteArray>()
            while (buffer.size >= HEADER_BYTES) {
                alignToMagic()
                if (buffer.size < HEADER_BYTES) break
                if (buffer[4].toInt() and 0xff != VERSION) {
                    reset()
                    throw ProtocolException("unsupported mesh wire version")
                }
                val payloadLength = readUInt32(buffer, 8)
                if (payloadLength > MAX_MESSAGE_BYTES) {
                    reset()
                    throw ProtocolException("mesh message exceeds maximum")
                }
                val total = HEADER_BYTES + payloadLength.toInt()
                if (buffer.size < total) break
                val payload = buffer.copyOfRange(HEADER_BYTES, total)
                val expectedChecksum = readUInt32(buffer, 12)
                val expectedTag = buffer.copyOfRange(16, 16 + TAG_BYTES)
                buffer = buffer.copyOfRange(total, buffer.size)
                if (expectedChecksum != crc32(payload)
                    || !expectedTag.contentEquals(sha256(payload).copyOf(TAG_BYTES))) {
                    reset()
                    throw ProtocolException("mesh message integrity check failed")
                }
                messages.add(payload)
            }
            return messages
        }

        private fun alignToMagic() {
            if (hasMagic(buffer, 0)) return
            val index = findMagic(buffer)
            buffer = if (index >= 0) {
                buffer.copyOfRange(index, buffer.size)
            } else {
                buffer.copyOfRange(
                    maxOf(0, buffer.size - (MAGIC.size - 1)),
                    buffer.size,
                )
            }
        }
    }

    private fun requireSize(size: Int) {
        if (size > MAX_MESSAGE_BYTES) {
            throw ProtocolException("mesh message exceeds maximum")
        }
    }

    private fun hasMagic(input: ByteArray, offset: Int): Boolean {
        if (offset < 0 || offset + MAGIC.size > input.size) return false
        for (i in MAGIC.indices) if (input[offset + i] != MAGIC[i]) return false
        return true
    }

    private fun findMagic(input: ByteArray): Int {
        for (i in 1..(input.size - MAGIC.size)) if (hasMagic(input, i)) return i
        return -1
    }

    private fun readUInt32(input: ByteArray, offset: Int): Long {
        return ((input[offset].toLong() and 0xff) shl 24) or
            ((input[offset + 1].toLong() and 0xff) shl 16) or
            ((input[offset + 2].toLong() and 0xff) shl 8) or
            (input[offset + 3].toLong() and 0xff)
    }

    private fun putUInt32(output: ByteArray, offset: Int, value: Long) {
        ByteBuffer.wrap(output, offset, 4)
            .order(ByteOrder.BIG_ENDIAN)
            .putInt(value.toInt())
    }

    private fun sha256(input: ByteArray): ByteArray =
        MessageDigest.getInstance("SHA-256").digest(input)

    private fun crc32(input: ByteArray): Long {
        val crc = CRC32()
        crc.update(input)
        return crc.value
    }

    private fun concat(first: ByteArray, second: ByteArray): ByteArray {
        val output = ByteArray(first.size + second.size)
        first.copyInto(output, 0)
        second.copyInto(output, first.size)
        return output
    }
}
