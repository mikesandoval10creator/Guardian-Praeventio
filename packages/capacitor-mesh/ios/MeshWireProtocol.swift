import Foundation
import CryptoKit

enum MeshWireMode: Equatable {
    case unknown
    case legacy
    case prm1
}

enum MeshWireNegotiation {
    static let magic = Data([0x50, 0x52, 0x4d, 0x31])
    static let capabilityData = Data([0x50, 0x52, 0x4d, 0x31, 0x01])

    static func detectMode(_ data: Data) -> MeshWireMode {
        if data.count >= magic.count && data.prefix(magic.count) == magic {
            return .prm1
        }
        guard let first = data.first else { return .unknown }
        if first == 0x7b || first == 0x5b { // `{` or `[`: legacy JSON
            return .legacy
        }
        return .unknown
    }
}

/// Versioned stream framing shared with the Android mesh plugin.
/// CoreBluetooth writes may split this stream at arbitrary boundaries; only a
/// complete, checksum-verified logical JSON message is emitted to JavaScript.
enum MeshWireProtocol {
    static let magic = Data([0x50, 0x52, 0x4d, 0x31]) // "PRM1"
    static let version: UInt8 = 1
    static let headerBytes = 32
    static let maxMessageBytes = 1024 * 1024
    private static let tagBytes = 16

    enum ProtocolError: Error {
        case messageTooLarge
        case unsupportedVersion
        case integrityFailure
    }

    static func encode(_ payload: Data) throws -> Data {
        guard payload.count <= maxMessageBytes else { throw ProtocolError.messageTooLarge }
        var header = Data()
        header.append(magic)
        header.append(version)
        header.append(0) // flags
        header.append(contentsOf: [0, 0]) // reserved
        appendUInt32(&header, UInt32(payload.count))
        appendUInt32(&header, crc32(payload))
        header.append(Data(SHA256.hash(data: payload).prefix(tagBytes)))
        return header + payload
    }

    final class Decoder {
        private var buffer = Data()

        func reset() {
            buffer.removeAll(keepingCapacity: false)
        }

        func append(_ chunk: Data) throws -> [Data] {
            buffer.append(chunk)
            var messages: [Data] = []
            while buffer.count >= headerBytes {
                alignToMagic()
                if buffer.count < headerBytes { break }
                guard buffer[4] == version else {
                    reset()
                    throw ProtocolError.unsupportedVersion
                }
                let payloadLength = Int(readUInt32(buffer, offset: 8))
                guard payloadLength <= maxMessageBytes else {
                    reset()
                    throw ProtocolError.messageTooLarge
                }
                let total = headerBytes + payloadLength
                if buffer.count < total { break }
                let payload = buffer.subdata(in: headerBytes..<total)
                let expectedChecksum = readUInt32(buffer, offset: 12)
                let expectedTag = buffer.subdata(in: 16..<(16 + tagBytes))
                buffer.removeSubrange(0..<total)
                let actualTag = Data(SHA256.hash(data: payload).prefix(tagBytes))
                guard expectedChecksum == crc32(payload), expectedTag == actualTag else {
                    reset()
                    throw ProtocolError.integrityFailure
                }
                messages.append(payload)
            }
            return messages
        }

        private func alignToMagic() {
            if buffer.starts(with: MeshWireProtocol.magic) { return }
            if let range = buffer.range(of: MeshWireProtocol.magic, options: [], in: buffer.startIndex..<buffer.endIndex), range.lowerBound > 0 {
                buffer.removeSubrange(0..<range.lowerBound)
            } else if buffer.range(of: MeshWireProtocol.magic) == nil {
                buffer = Data(buffer.suffix(MeshWireProtocol.magic.count - 1))
            }
        }
    }

    private static func appendUInt32(_ data: inout Data, _ value: UInt32) {
        data.append(UInt8((value >> 24) & 0xff))
        data.append(UInt8((value >> 16) & 0xff))
        data.append(UInt8((value >> 8) & 0xff))
        data.append(UInt8(value & 0xff))
    }

    private static func readUInt32(_ data: Data, offset: Int) -> UInt32 {
        (UInt32(data[offset]) << 24)
            | (UInt32(data[offset + 1]) << 16)
            | (UInt32(data[offset + 2]) << 8)
            | UInt32(data[offset + 3])
    }

    private static func crc32(_ data: Data) -> UInt32 {
        var crc: UInt32 = 0xffffffff
        for byte in data {
            crc ^= UInt32(byte)
            for _ in 0..<8 {
                crc = (crc >> 1) ^ ((crc & 1) == 1 ? 0xedb88320 : 0)
            }
        }
        return crc ^ 0xffffffff
    }
}
