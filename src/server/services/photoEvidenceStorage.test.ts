// Server-side proof that the bytes at the content-addressed path are the bytes
// the client claims. Without this, the "verified hash" label on the uploader
// would be a client-side assertion, not an audit guarantee.

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  PhotoEvidenceStorageError,
  verifyUploadedEvidenceBytes,
} from './photoEvidenceStorage';
import { buildArtifact } from '../../services/photoEvidence/photoEvidenceEngine';

function artifactFor(bytes: Buffer) {
  return buildArtifact({
    payload: {
      originalFilename: 'evidencia.jpg',
      mimeType: 'image/jpeg',
      byteSize: bytes.length,
      capturedAt: new Date().toISOString(),
      capturedByUid: 'u1',
    },
    contentHash: createHash('sha256').update(bytes).digest('hex'),
    linkages: [{ nodeKind: 'incident', nodeId: 'inc-1' }],
  });
}

describe('verifyUploadedEvidenceBytes', () => {
  it('accepts bytes whose size and SHA-256 match the artifact', async () => {
    const bytes = Buffer.from('arnes roto en sector 3');
    const artifact = artifactFor(bytes);
    const seen: string[] = [];

    await expect(
      verifyUploadedEvidenceBytes(artifact, 'p1', async (path) => {
        seen.push(path);
        return bytes;
      }),
    ).resolves.toBeUndefined();

    expect(seen).toEqual([`projects/p1/evidence/${artifact.id}.jpg`]);
  });

  it('rejects same-size bytes with a different hash', async () => {
    const artifact = artifactFor(Buffer.from('AAAA'));

    await expect(
      verifyUploadedEvidenceBytes(artifact, 'p1', async () =>
        Buffer.from('BBBB'),
      ),
    ).rejects.toMatchObject({
      code: 'evidence_hash_mismatch',
      httpStatus: 422,
    });
  });

  it('rejects a different byte size even before hashing', async () => {
    const artifact = artifactFor(Buffer.from('AAAA'));

    await expect(
      verifyUploadedEvidenceBytes(artifact, 'p1', async () =>
        Buffer.from('AAAAA'),
      ),
    ).rejects.toBeInstanceOf(PhotoEvidenceStorageError);
    await expect(
      verifyUploadedEvidenceBytes(artifact, 'p1', async () =>
        Buffer.from('AAAAA'),
      ),
    ).rejects.toMatchObject({ code: 'evidence_hash_mismatch' });
  });

  it('reports a missing object as evidence_bytes_missing (422)', async () => {
    const artifact = artifactFor(Buffer.from('AAAA'));
    const notFound = Object.assign(new Error('No such object'), { code: 404 });

    await expect(
      verifyUploadedEvidenceBytes(artifact, 'p1', async () => {
        throw notFound;
      }),
    ).rejects.toMatchObject({
      code: 'evidence_bytes_missing',
      httpStatus: 422,
    });
  });

  it('reports a Storage outage as retryable evidence_storage_unavailable (503)', async () => {
    const artifact = artifactFor(Buffer.from('AAAA'));

    await expect(
      verifyUploadedEvidenceBytes(artifact, 'p1', async () => {
        throw new Error('socket hang up');
      }),
    ).rejects.toMatchObject({
      code: 'evidence_storage_unavailable',
      httpStatus: 503,
    });
  });
});
