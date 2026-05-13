import { describe, it, expect } from 'vitest';
import {
  validatePayload,
  buildArtifact,
  addLinkage,
  removeLinkage,
  buildStoragePath,
  validateBatch,
  PhotoEvidenceValidationError,
  type PhotoEvidencePayload,
} from './photoEvidenceEngine.js';

const NOW = new Date('2026-05-12T22:00:00Z');
const VALID_HASH = 'a'.repeat(64);

function payload(over: Partial<PhotoEvidencePayload> = {}): PhotoEvidencePayload {
  return {
    originalFilename: 'foto.jpg',
    mimeType: 'image/jpeg',
    byteSize: 500_000,
    capturedAt: '2026-05-12T10:00:00Z',
    capturedByUid: 'w1',
    ...over,
  };
}

describe('validatePayload', () => {
  it('rechaza mime no permitido', () => {
    expect(() =>
      validatePayload(payload({ mimeType: 'application/pdf' }), { now: NOW }),
    ).toThrowError(PhotoEvidenceValidationError);
  });

  it('rechaza byteSize 0 o negativo', () => {
    expect(() => validatePayload(payload({ byteSize: 0 }), { now: NOW })).toThrowError(
      /too_large/,
    );
  });

  it('rechaza imagen >25MB', () => {
    expect(() =>
      validatePayload(payload({ byteSize: 26 * 1024 * 1024 }), { now: NOW }),
    ).toThrowError(/too_large/);
  });

  it('acepta video hasta 50MB', () => {
    expect(() =>
      validatePayload(
        payload({ mimeType: 'video/mp4', byteSize: 49 * 1024 * 1024 }),
        { now: NOW },
      ),
    ).not.toThrow();
  });

  it('rechaza filename vacío', () => {
    expect(() =>
      validatePayload(payload({ originalFilename: '' }), { now: NOW }),
    ).toThrowError(/invalid_filename/);
  });

  it('rechaza capturedByUid vacío', () => {
    expect(() =>
      validatePayload(payload({ capturedByUid: '' }), { now: NOW }),
    ).toThrowError(/missing_uid/);
  });

  it('rechaza capturedAt malformado', () => {
    expect(() =>
      validatePayload(payload({ capturedAt: 'not-a-date' }), { now: NOW }),
    ).toThrowError(/invalid_capture_date/);
  });

  it('rechaza capturedAt futuro >5min', () => {
    const future = new Date(NOW.getTime() + 30 * 60_000).toISOString();
    expect(() =>
      validatePayload(payload({ capturedAt: future }), { now: NOW }),
    ).toThrowError(/future_capture/);
  });

  it('acepta capturedAt en ventana de slack 5min', () => {
    const slack = new Date(NOW.getTime() + 2 * 60_000).toISOString();
    expect(() =>
      validatePayload(payload({ capturedAt: slack }), { now: NOW }),
    ).not.toThrow();
  });

  it('rechaza capturedAt >30 días atrás', () => {
    const old = new Date(NOW.getTime() - 60 * 86_400_000).toISOString();
    expect(() =>
      validatePayload(payload({ capturedAt: old }), { now: NOW }),
    ).toThrowError(/invalid_capture_date/);
  });
});

describe('buildArtifact', () => {
  it('hash inválido (no SHA-256 hex 64 chars) → tira', () => {
    expect(() =>
      buildArtifact({
        payload: payload(),
        contentHash: 'short',
        linkages: [],
        now: NOW,
      }),
    ).toThrowError(PhotoEvidenceValidationError);
  });

  it('artifact tiene id = contentHash lowercase', () => {
    const a = buildArtifact({
      payload: payload(),
      contentHash: 'A'.repeat(64),
      linkages: [{ nodeKind: 'incident', nodeId: 'inc-1' }],
      now: NOW,
    });
    expect(a.id).toBe('a'.repeat(64));
    expect(a.linkages).toHaveLength(1);
  });

  it('preserva capturedLocation y notes', () => {
    const a = buildArtifact({
      payload: payload({
        capturedLocation: { lat: -33.4, lng: -70.6 },
        notes: 'Daño en escalera norte',
      }),
      contentHash: VALID_HASH,
      linkages: [],
      now: NOW,
    });
    expect(a.capturedLocation).toEqual({ lat: -33.4, lng: -70.6 });
    expect(a.notes).toBe('Daño en escalera norte');
  });
});

describe('addLinkage / removeLinkage', () => {
  const base = buildArtifact({
    payload: payload(),
    contentHash: VALID_HASH,
    linkages: [{ nodeKind: 'incident', nodeId: 'i1' }],
    now: NOW,
  });

  it('agrega linkage nuevo', () => {
    const updated = addLinkage(base, { nodeKind: 'inspection', nodeId: 'insp-1' });
    expect(updated.linkages).toHaveLength(2);
  });

  it('idempotente: agregar mismo linkage no duplica', () => {
    const a = addLinkage(base, { nodeKind: 'incident', nodeId: 'i1' });
    expect(a.linkages).toHaveLength(1);
  });

  it('remove linkage', () => {
    const updated = removeLinkage(base, { nodeKind: 'incident', nodeId: 'i1' });
    expect(updated.linkages).toEqual([]);
  });

  it('NO muta el artifact original', () => {
    const ref = base.linkages;
    addLinkage(base, { nodeKind: 'audit', nodeId: 'a1' });
    expect(base.linkages).toBe(ref);
  });
});

describe('buildStoragePath', () => {
  const artifact = buildArtifact({
    payload: payload(),
    contentHash: VALID_HASH,
    linkages: [],
    now: NOW,
  });

  it('path canónico tenants/{tid}/evidence/{hash}.{ext}', () => {
    expect(buildStoragePath(artifact, 'tA')).toBe(`tenants/tA/evidence/${VALID_HASH}.jpg`);
  });

  it('ext correcto para mp4', () => {
    const video = buildArtifact({
      payload: payload({ mimeType: 'video/mp4', byteSize: 1000 }),
      contentHash: VALID_HASH,
      linkages: [],
      now: NOW,
    });
    expect(buildStoragePath(video, 'tA')).toMatch(/\.mp4$/);
  });
});

describe('validateBatch', () => {
  it('separa valid vs invalid', () => {
    const r = validateBatch(
      [
        payload({ originalFilename: 'a.jpg' }),
        payload({ mimeType: 'application/pdf', originalFilename: 'b.pdf' }),
        payload({ originalFilename: 'c.png', mimeType: 'image/png' }),
      ],
      { now: NOW },
    );
    expect(r.valid).toHaveLength(2);
    expect(r.invalid).toHaveLength(1);
    expect(r.invalid[0].reason).toMatch(/invalid_mime/);
  });
});
