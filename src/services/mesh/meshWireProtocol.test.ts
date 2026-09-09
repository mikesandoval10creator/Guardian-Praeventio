import { describe, expect, it } from "vitest";
import {
  MESH_WIRE_HEADER_BYTES,
  MESH_WIRE_MAX_MESSAGE_BYTES,
  MeshWireDecoder,
  MeshWireProtocolError,
  encodeMeshWireMessage,
} from "./meshWireProtocol";

function bytes(values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function splitAt(input: Uint8Array, cut: number): [Uint8Array, Uint8Array] {
  return [input.slice(0, cut), input.slice(cut)];
}

describe("meshWireProtocol — framed UTF-8 message stream", () => {
  it("matches the cross-platform golden vector for Kotlin/Swift parity", () => {
    const payload = new TextEncoder().encode(
      '{"id":"mesh-vector","text":"café ⚠️"}',
    );
    const encoded = encodeMeshWireMessage(payload);

    expect(Array.from(encoded.slice(0, MESH_WIRE_HEADER_BYTES))).toEqual(
      Array.from(
        Uint8Array.from(
          "50524d31010000000000002a1e6b716c59006e3b210376add52ffac6f394da0b"
            .match(/../g)!
            .map((hex) => parseInt(hex, 16)),
        ),
      ),
    );
  });

  it("uses a versioned fixed header and never truncates a 512+ byte payload", () => {
    const payload = new Uint8Array(513).map((_, index) => index % 251);
    const encoded = encodeMeshWireMessage(payload);

    expect(MESH_WIRE_HEADER_BYTES).toBeGreaterThan(0);
    expect(encoded.length).toBe(MESH_WIRE_HEADER_BYTES + payload.length);
    expect(encoded.slice(MESH_WIRE_HEADER_BYTES)).toEqual(payload);
  });

  it("reassembles a message when writes split at every byte boundary", () => {
    const payload = new TextEncoder().encode(
      "mensaje UTF-8: caída ⚠️ — trabajador",
    );
    const encoded = encodeMeshWireMessage(payload);

    for (let cut = 1; cut < encoded.length; cut += 1) {
      const decoder = new MeshWireDecoder();
      const [first, second] = splitAt(encoded, cut);
      expect(decoder.push(first)).toEqual([]);
      const messages = decoder.push(second);
      expect(messages).toHaveLength(1);
      expect(messages[0].payload).toEqual(payload);
      expect(messages[0].messageIdHex).toMatch(/^[0-9a-f]{32}$/);
    }
  });

  it("reassembles multiple back-to-back messages from one write", () => {
    const first = bytes([1, 2, 3]);
    const second = new Uint8Array(4096).map((_, index) => index % 256);
    const decoder = new MeshWireDecoder();

    const messages = decoder.push(
      concat(encodeMeshWireMessage(first), encodeMeshWireMessage(second)),
    );

    expect(messages).toHaveLength(2);
    expect(messages[0].payload).toEqual(first);
    expect(messages[1].payload).toEqual(second);
  });

  it("rejects corruption instead of emitting a partial message", () => {
    const encoded = encodeMeshWireMessage(bytes([10, 20, 30, 40]));
    encoded[encoded.length - 1] ^= 0xff;
    const decoder = new MeshWireDecoder();

    expect(() => decoder.push(encoded)).toThrow(MeshWireProtocolError);
    expect(decoder.pendingBytes).toBe(0);
  });

  it("rejects a declared message larger than the protocol maximum", () => {
    const encoded = encodeMeshWireMessage(bytes([1, 2, 3]));
    const tooLarge = MESH_WIRE_MAX_MESSAGE_BYTES + 1;
    new DataView(encoded.buffer).setUint32(8, tooLarge, false);

    expect(() => new MeshWireDecoder().push(encoded)).toThrow(
      MeshWireProtocolError,
    );
  });

  it("does not emit until a complete message has arrived", () => {
    const payload = new Uint8Array(1500).fill(7);
    const encoded = encodeMeshWireMessage(payload);
    const decoder = new MeshWireDecoder();

    for (let offset = 0; offset < encoded.length - 1; offset += 17) {
      expect(
        decoder.push(
          encoded.slice(offset, Math.min(offset + 17, encoded.length - 1)),
        ),
      ).toEqual([]);
    }
    expect(decoder.push(encoded.slice(encoded.length - 1))).toHaveLength(1);
  });

  it("survives adversarial size boundaries and prefix noise", () => {
    for (const size of [0, 1, 19, 20, 512, 513, 4096]) {
      const payload = new Uint8Array(size).map(
        (_, index) => (index * 31) % 256,
      );
      const encoded = encodeMeshWireMessage(payload);
      const decoder = new MeshWireDecoder();
      expect(decoder.push(Uint8Array.from([0xde, 0xad, 0xbe, 0xef]))).toEqual(
        [],
      );

      let offset = 0;
      const recovered = [];
      while (offset < encoded.length) {
        const step = 1 + ((offset * 17) % 23);
        recovered.push(...decoder.push(encoded.slice(offset, offset + step)));
        offset += step;
      }
      expect(recovered).toHaveLength(1);
      expect(recovered[0].payload).toEqual(payload);
    }
  });
});
