// SPDX-License-Identifier: MIT
//
// Sprint 26 — fileChunker tests.

import { describe, expect, it } from 'vitest';
import {
  chunkBlob,
  computeContentHash,
  reconstructBlob,
} from './fileChunker';

// Vitest's Node async-leak detector reports Node's native BlobReader as a
// leak even after arrayBuffer() resolves. Hashing only needs this Blob
// contract, so keep these assertions independent of that runtime resource.
function hashBlob(bytes: number[]): Blob {
  const data = new Uint8Array(bytes);
  return {
    arrayBuffer: async () => data.slice().buffer,
  } as Blob;
}

describe('fileChunker', () => {
  it('chunkBlob splits into uniform chunks of chunkSize bytes', async () => {
    const data = new Uint8Array(1500).map((_, i) => i % 256);
    const blob = new Blob([data]);
    const chunks = await chunkBlob(blob, 512);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(512);
    expect(chunks[1]).toHaveLength(512);
    expect(chunks[2]).toHaveLength(1500 - 1024);
  });

  it('chunkBlob returns empty for empty Blob', async () => {
    const chunks = await chunkBlob(new Blob([]), 512);
    expect(chunks).toEqual([]);
  });

  it('chunkBlob throws when chunkSize <= 0', async () => {
    await expect(chunkBlob(new Blob([new Uint8Array(8)]), 0)).rejects.toThrow();
  });

  it('reconstructBlob round-trips through chunkBlob', async () => {
    const original = new Uint8Array(2048).map((_, i) => (i * 7) % 256);
    const blob = new Blob([original], { type: 'application/octet-stream' });

    const chunks = await chunkBlob(blob, 300);
    const reconstructed = reconstructBlob(chunks, 'application/octet-stream');

    expect(reconstructed.size).toBe(original.length);
    const back = new Uint8Array(await reconstructed.arrayBuffer());
    expect(Array.from(back)).toEqual(Array.from(original));
  });

  it('computeContentHash is deterministic + matches known SHA-256 for empty', async () => {
    // SHA-256 of empty string.
    const empty = await computeContentHash(hashBlob([]));
    expect(empty).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );

    const a = await computeContentHash(hashBlob([1, 2, 3]));
    const b = await computeContentHash(hashBlob([1, 2, 3]));
    expect(a).toBe(b);

    const c = await computeContentHash(hashBlob([1, 2, 4]));
    expect(a).not.toBe(c);
  });
});
