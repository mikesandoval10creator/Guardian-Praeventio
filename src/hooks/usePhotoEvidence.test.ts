// @vitest-environment jsdom
//
// Regression: PhotoEvidence must actually upload bytes (not just metadata) to
// the project-scoped Storage path covered by storage.rules, keyed by the
// SHA-256 of the file content.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  uploadBytes: vi.fn(async () => undefined),
  getDownloadURL: vi.fn(async () => 'https://storage.example/evidence.jpg'),
  ref: vi.fn((_storage: unknown, path: string) => ({ path })),
  apiAuthHeader: vi.fn(async () => 'Bearer test-token'),
  fetch: vi.fn(),
}));

vi.mock('../services/firebase', () => ({
  storage: {},
  ref: h.ref,
  uploadBytes: h.uploadBytes,
  getDownloadURL: h.getDownloadURL,
  auth: { currentUser: null },
}));

vi.mock('../lib/apiAuth', () => ({
  apiAuthHeader: h.apiAuthHeader,
}));

import {
  sha256Hex,
  uploadPhotoEvidenceBytes,
} from './usePhotoEvidence';

beforeEach(() => {
  h.uploadBytes.mockClear();
  h.getDownloadURL.mockClear();
  h.ref.mockClear();
  h.fetch.mockReset();
  h.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({ artifact: { id: 'a'.repeat(64), mimeType: 'image/jpeg' } }),
  } as unknown as Response);
  vi.stubGlobal('fetch', h.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('uploadPhotoEvidenceBytes', () => {
  it('hashes bytes, uploads to projects/{pid}/evidence/{hash}.jpg, then records metadata', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const file = new File([bytes], 'hallazgo.jpg', { type: 'image/jpeg' });
    const expectedHash = await sha256Hex(await file.arrayBuffer());

    const result = await uploadPhotoEvidenceBytes('p1', file, {
      capturedByUid: 'uid-1',
      linkages: [{ nodeKind: 'incident', nodeId: 'i1' }],
    });

    expect(h.ref).toHaveBeenCalledTimes(1);
    const storagePath = h.ref.mock.calls[0][1] as string;
    expect(storagePath).toBe(`projects/p1/evidence/${expectedHash}.jpg`);
    expect(h.uploadBytes).toHaveBeenCalledTimes(1);
    expect(h.getDownloadURL).toHaveBeenCalledTimes(1);

    // Metadata POST carries the SAME hash used for the path.
    const body = JSON.parse((h.fetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.contentHash).toBe(expectedHash);
    expect(body.payload.byteSize).toBe(bytes.length);
    expect(body.linkages).toEqual([{ nodeKind: 'incident', nodeId: 'i1' }]);

    expect(result.storagePath).toBe(storagePath);
    expect(result.downloadUrl).toBe('https://storage.example/evidence.jpg');
  });

  it('rejects an unsupported mime type BEFORE uploading', async () => {
    const file = new File([new Uint8Array([1])], 'foto.heic', { type: 'image/heic' });

    await expect(
      uploadPhotoEvidenceBytes('p1', file, {
        capturedByUid: 'uid-1',
        linkages: [{ nodeKind: 'incident', nodeId: 'i1' }],
      }),
    ).rejects.toThrow();

    expect(h.uploadBytes).not.toHaveBeenCalled();
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it('rejects an empty linkage list BEFORE uploading (server requires 1..10)', async () => {
    const file = new File([new Uint8Array([1, 2])], 'hallazgo.jpg', { type: 'image/jpeg' });

    await expect(
      uploadPhotoEvidenceBytes('p1', file, {
        capturedByUid: 'uid-1',
        linkages: [],
      }),
    ).rejects.toThrow(/linkage_required/);

    expect(h.uploadBytes).not.toHaveBeenCalled();
    expect(h.fetch).not.toHaveBeenCalled();
  });
});
