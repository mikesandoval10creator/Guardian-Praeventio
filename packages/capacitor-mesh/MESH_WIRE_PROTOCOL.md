# Mesh wire protocol — PRM1

This document is the cross-platform contract for `packages/capacitor-mesh`.
It applies to Android Kotlin and iOS Swift. A CoreBluetooth/GATT write is a
**stream segment**, not a logical `MeshPacket`.

## Logical message

The Capacitor bridge serializes one packet as UTF-8 JSON. The native plugin wraps
that complete byte sequence in one PRM1 stream message.

| Offset | Bytes | Meaning |
|---:|---:|---|
| 0 | 4 | ASCII magic `PRM1` (`50 52 4d 31`) |
| 4 | 1 | Protocol version `1` |
| 5 | 1 | Flags (reserved; `0` for now) |
| 6 | 2 | Reserved (`0`) |
| 8 | 4 | Payload length, unsigned big-endian |
| 12 | 4 | CRC32/ISO-HDLC of the complete payload, unsigned big-endian |
| 16 | 16 | First 128 bits of SHA-256(payload) |
| 32 | N | UTF-8 JSON payload |

The maximum logical message is 1 MiB. A decoder must not emit JSON until the
complete declared payload is present and both integrity values match. Invalid,
oversized or incomplete data is rejected; it is never truncated or parsed by
brace counting.

## Native segmentation

- Android requests an ATT MTU of 247 and uses `mtu - 3` as the write payload
  when negotiation succeeds; it falls back to the legacy ATT payload when it
  does not.
- iOS uses `maximumWriteValueLength(for: .withoutResponse)`.
- Both platforms split the exact same PRM1 bytes at arbitrary offsets.
- The receiver keeps a decoder per peer and can accept multiple messages in one
  callback or one message across many callbacks.

## Current boundary

Slice 1 proves zero-truncation framing/reassembly and checksum/tag validation.
It does **not** yet prove message delivery. `WRITE_NO_RESPONSE` acceptance is
only local enqueue evidence. Application ACK, write backpressure,
retransmission, reconnection and physical Android↔Android/Android↔iOS drills
remain Slice 2 / external validation.

## Golden vector

Payload UTF-8:

```text
{"id":"mesh-vector","text":"café ⚠️"}
```

Header bytes:

```text
50524d31010000000000002a1e6b716c59006e3b210376add52ffac6f394da0b
```

The TypeScript and Android unit tests assert this vector. Swift uses the same
constants and byte order; iOS compilation requires macOS/Xcode and remains an
external gate on this Windows host.
