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

## Mixed-version negotiation

The legacy release used the same service and data characteristic but sent raw JSON
without a wire version. PRM1 peers therefore expose an additional readable
capability characteristic:

- Capability UUID: `0000ABCE-12AE-3E45-7123-456789ABCDEF`.
- Capability value: `50 52 4d 31 01` (`PRM1`, version `1`).
- A central that discovers this characteristic selects PRM1.
- If the characteristic is absent, the peer is classified as legacy and the
  sender uses raw JSON rather than sending PRM1 bytes into a legacy parser.
- Until discovery/classification completes, `send()` returns the peer in
  `queued`; it must not report a protocol-unknown peer as delivered.
- New peripherals retain a legacy JSON receive accumulator so an older central
  can still send its old stream to the new process. The first bytes are only
  used to classify `PRM1` versus legacy; ambiguous bytes are discarded.

This is a compatibility guard, not a delivery acknowledgement. Legacy iOS did
not define a multi-write JSON stream, so large packets to an unknown legacy peer
still require the native lab before they can be treated as interoperable. No
mixed-version path is considered production-ready until Android↔Android and
Android↔iOS physical tests cover that case.

## Application delivery ACK — Slice 2

The Capacitor plugin's `deliveredTo` result means only that the local native
layer accepted the write attempt. The TypeScript transport therefore keeps a
packet pending until the receiving facade accepts the complete logical packet:

- A receiver emits a `MeshPacket` of type `ack` with `ackedPacketId` and
  `confirmedBy` after `MeshRelayQueue.receive()` accepts the packet.
- When a project signing key is provisioned, generated ACKs are HMAC-signed
  with that same key; an ACK from an unexpected peer cannot clear delivery.
- The sender removes the packet only after a matching ACK from a peer that was
  actually reported in `deliveredTo`.
- If the ACK timeout expires (10 seconds by default), a packet removed by
  `drainForPeer` is requeued for a later peer opportunity. Stop/restart also
  preserves such in-flight packets.
- This slice does not yet implement native GATT callback backpressure,
  retransmission at frame level, or physical BLE loss/reorder validation.

## Current boundary

Slice 1 proves zero-truncation framing/reassembly and checksum/tag validation.
Slice 2 proves the TypeScript application-ACK state machine, signed ACKs and
bounded timeout requeue in unit tests. It does **not** yet prove native GATT
backpressure, frame-level retransmission, reconnection or physical
Android↔Android/Android↔iOS behavior. `WRITE_NO_RESPONSE` acceptance remains
local write evidence only.

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
