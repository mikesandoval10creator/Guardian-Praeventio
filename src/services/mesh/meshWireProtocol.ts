import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/** Four bytes: "PRM1" (Praeventio Relay Message, versioned stream). */
export const MESH_WIRE_MAGIC = Uint8Array.from([0x50, 0x52, 0x4d, 0x31]);
export const MESH_WIRE_PROTOCOL_VERSION = 1;
/** magic + version + flags + reserved + length + CRC32 + 128-bit message tag. */
export const MESH_WIRE_HEADER_BYTES = 32;
export const MESH_WIRE_MAX_MESSAGE_BYTES = 1024 * 1024;

const LENGTH_OFFSET = 8;
const CHECKSUM_OFFSET = 12;
const MESSAGE_TAG_OFFSET = 16;
const MESSAGE_TAG_BYTES = 16;

export class MeshWireProtocolError extends Error {
  override readonly name = "MeshWireProtocolError";

  constructor(message: string) {
    super(message);
  }
}

export interface MeshWireMessage {
  payload: Uint8Array;
  /** First 128 bits of SHA-256(payload), encoded as lowercase hex. */
  messageIdHex: string;
}

/**
 * Encodes one logical MeshPacket JSON payload into a length-delimited byte
 * stream. Native BLE writes may split this stream at arbitrary boundaries.
 * The receiver must not attempt to parse JSON until the entire stream is
 * present and its checksum/tag match.
 */
export function encodeMeshWireMessage(payload: Uint8Array): Uint8Array {
  if (payload.length > MESH_WIRE_MAX_MESSAGE_BYTES) {
    throw new MeshWireProtocolError(
      `mesh message exceeds ${MESH_WIRE_MAX_MESSAGE_BYTES} bytes`,
    );
  }

  const checksum = crc32(payload);
  const tag = sha256(payload).slice(0, MESSAGE_TAG_BYTES);
  const header = new Uint8Array(MESH_WIRE_HEADER_BYTES);
  header.set(MESH_WIRE_MAGIC, 0);
  header[4] = MESH_WIRE_PROTOCOL_VERSION;
  header[5] = 0; // flags reserved for a later protocol version.
  // bytes 6..7 are reserved and remain zero.
  const view = new DataView(header.buffer);
  view.setUint32(LENGTH_OFFSET, payload.length, false);
  view.setUint32(CHECKSUM_OFFSET, checksum, false);
  header.set(tag, MESSAGE_TAG_OFFSET);
  return concatBytes(header, payload);
}

/**
 * Incremental decoder for a stream of native writes. `push()` accepts any
 * write size, including partial headers, multiple messages, and a write that
 * ends in the middle of a message.
 */
export class MeshWireDecoder {
  private buffer = new Uint8Array(0);

  get pendingBytes(): number {
    return this.buffer.length;
  }

  reset(): void {
    this.buffer = new Uint8Array(0);
  }

  push(chunk: Uint8Array): MeshWireMessage[] {
    if (chunk.length > 0) {
      this.buffer = concatBytes(this.buffer, chunk);
    }

    const messages: MeshWireMessage[] = [];
    while (this.buffer.length >= MESH_WIRE_HEADER_BYTES) {
      this.alignToMagic();
      if (this.buffer.length < MESH_WIRE_HEADER_BYTES) break;

      const view = new DataView(
        this.buffer.buffer,
        this.buffer.byteOffset,
        this.buffer.byteLength,
      );
      const version = this.buffer[4];
      if (version !== MESH_WIRE_PROTOCOL_VERSION) {
        this.reset();
        throw new MeshWireProtocolError(
          `unsupported mesh wire version: ${version}`,
        );
      }

      const payloadLength = view.getUint32(LENGTH_OFFSET, false);
      if (payloadLength > MESH_WIRE_MAX_MESSAGE_BYTES) {
        this.reset();
        throw new MeshWireProtocolError(
          `mesh message exceeds ${MESH_WIRE_MAX_MESSAGE_BYTES} bytes`,
        );
      }

      const messageLength = MESH_WIRE_HEADER_BYTES + payloadLength;
      if (this.buffer.length < messageLength) break;

      const payload = this.buffer.slice(MESH_WIRE_HEADER_BYTES, messageLength);
      const expectedChecksum = view.getUint32(CHECKSUM_OFFSET, false);
      const actualChecksum = crc32(payload);
      const expectedTag = this.buffer.slice(
        MESSAGE_TAG_OFFSET,
        MESSAGE_TAG_OFFSET + MESSAGE_TAG_BYTES,
      );
      const actualTag = sha256(payload).slice(0, MESSAGE_TAG_BYTES);

      this.buffer = this.buffer.slice(messageLength);
      if (
        expectedChecksum !== actualChecksum ||
        !equalBytes(expectedTag, actualTag)
      ) {
        this.reset();
        throw new MeshWireProtocolError("mesh message integrity check failed");
      }

      messages.push({
        payload,
        messageIdHex: bytesToHex(actualTag),
      });
    }
    return messages;
  }

  private alignToMagic(): void {
    if (hasMagic(this.buffer, 0)) return;
    const next = indexOfMagic(this.buffer);
    if (next >= 0) {
      this.buffer = this.buffer.slice(next);
      return;
    }
    // Preserve a possible partial magic prefix across writes.
    const keep = Math.min(MESH_WIRE_MAGIC.length - 1, this.buffer.length);
    this.buffer = this.buffer.slice(this.buffer.length - keep);
  }
}

function hasMagic(input: Uint8Array, offset: number): boolean {
  if (offset + MESH_WIRE_MAGIC.length > input.length) return false;
  for (let i = 0; i < MESH_WIRE_MAGIC.length; i += 1) {
    if (input[offset + i] !== MESH_WIRE_MAGIC[i]) return false;
  }
  return true;
}

function indexOfMagic(input: Uint8Array): number {
  for (let i = 1; i <= input.length - MESH_WIRE_MAGIC.length; i += 1) {
    if (hasMagic(input, i)) return i;
  }
  return -1;
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

// Standard CRC-32/ISO-HDLC. It detects transport corruption; the SHA-256 tag
// also binds the complete logical message and is used as its stable wire ID.
function crc32(input: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of input) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
