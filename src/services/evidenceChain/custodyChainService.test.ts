import { describe, it, expect } from 'vitest';
import {
  hashArtifact,
  registerArtifact,
  replaceArtifact,
  recordAccess,
  recordExport,
  verifyIntegrity,
  summarizeChain,
  CustodyValidationError,
} from './custodyChainService.js';

const NOW = new Date('2026-05-11T12:00:00Z');

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe('hashArtifact', () => {
  it('determinístico para mismos bytes', () => {
    const a = hashArtifact(bytes('photo-content-1'));
    const b = hashArtifact(bytes('photo-content-1'));
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it('cambia con diferentes bytes', () => {
    const a = hashArtifact(bytes('A'));
    const b = hashArtifact(bytes('B'));
    expect(a).not.toBe(b);
  });
});

describe('registerArtifact', () => {
  it('crea artifact con hash + evento upload', () => {
    const { artifact, event } = registerArtifact({
      kind: 'photo',
      mimeType: 'image/jpeg',
      bytes: bytes('photo-bytes'),
      uploadedByUid: 'w1',
      now: NOW,
    });
    expect(artifact.id).toHaveLength(64);
    expect(artifact.kind).toBe('photo');
    expect(artifact.byteSize).toBeGreaterThan(0);
    expect(event.eventKind).toBe('upload');
  });

  it('rechaza payload vacío', () => {
    expect(() =>
      registerArtifact({
        kind: 'photo',
        mimeType: 'image/jpeg',
        bytes: new Uint8Array(),
        uploadedByUid: 'w1',
        now: NOW,
      }),
    ).toThrow(/EMPTY_PAYLOAD/);
  });

  it('captura coords si presente', () => {
    const { artifact } = registerArtifact({
      kind: 'photo',
      mimeType: 'image/jpeg',
      bytes: bytes('x'),
      uploadedByUid: 'w1',
      capturedAt: { lat: -33.45, lng: -70.66, timestamp: NOW.toISOString() },
      now: NOW,
    });
    expect(artifact.capturedAt?.lat).toBe(-33.45);
  });
});

describe('replaceArtifact', () => {
  it('marca replacedByHash', () => {
    const { artifact } = registerArtifact({
      kind: 'photo',
      mimeType: 'image/jpeg',
      bytes: bytes('v1'),
      uploadedByUid: 'w1',
      now: NOW,
    });
    const newHash = hashArtifact(bytes('v2'));
    const { artifact: updated, event } = replaceArtifact(
      artifact,
      newHash,
      'w1',
      'foto fuera de foco, sube versión clara',
      NOW,
    );
    expect(updated.replacedByHash).toBe(newHash);
    expect(event.eventKind).toBe('replacement');
  });

  it('rechaza doble replace', () => {
    const { artifact } = registerArtifact({
      kind: 'photo',
      mimeType: 'image/jpeg',
      bytes: bytes('v1'),
      uploadedByUid: 'w1',
      now: NOW,
    });
    const { artifact: replaced } = replaceArtifact(
      artifact,
      'h1',
      'w1',
      'razón válida primer cambio',
      NOW,
    );
    expect(() =>
      replaceArtifact(replaced, 'h2', 'w1', 'razón válida segundo cambio', NOW),
    ).toThrow(/ALREADY_REPLACED/);
  });

  it('rechaza reason corto', () => {
    const { artifact } = registerArtifact({
      kind: 'photo',
      mimeType: 'image/jpeg',
      bytes: bytes('v1'),
      uploadedByUid: 'w1',
      now: NOW,
    });
    expect(() => replaceArtifact(artifact, 'h2', 'w1', 'corto', NOW)).toThrow(
      /REASON_TOO_SHORT/,
    );
  });
});

describe('verifyIntegrity', () => {
  it('valid=true si bytes coinciden', () => {
    const data = bytes('verify-me');
    const { artifact } = registerArtifact({
      kind: 'photo',
      mimeType: 'image/jpeg',
      bytes: data,
      uploadedByUid: 'w1',
      now: NOW,
    });
    const r = verifyIntegrity(artifact, data);
    expect(r.valid).toBe(true);
    expect(r.computedHash).toBe(artifact.id);
  });

  it('valid=false si bytes modificados', () => {
    const original = bytes('verify-me');
    const { artifact } = registerArtifact({
      kind: 'photo',
      mimeType: 'image/jpeg',
      bytes: original,
      uploadedByUid: 'w1',
      now: NOW,
    });
    const tampered = bytes('verify-me-MODIFIED');
    const r = verifyIntegrity(artifact, tampered);
    expect(r.valid).toBe(false);
  });
});

describe('summarizeChain', () => {
  it('cuenta accesos + exports', () => {
    const { artifact } = registerArtifact({
      kind: 'photo',
      mimeType: 'image/jpeg',
      bytes: bytes('x'),
      uploadedByUid: 'w1',
      now: NOW,
    });
    const e1 = recordAccess(artifact, 'p1', 'prevencionista');
    const e2 = recordAccess(artifact, 'auditor', 'auditor');
    const e3 = recordExport(artifact, 'auditor', 'auditor', 'SUSESO portal');
    const summary = summarizeChain(artifact, [e1, e2, e3]);
    expect(summary.accessCount).toBe(2);
    expect(summary.exportCount).toBe(1);
    expect(summary.totalEvents).toBe(3);
  });

  it('lastAccessByUid devuelve el más reciente', () => {
    const { artifact } = registerArtifact({
      kind: 'photo',
      mimeType: 'image/jpeg',
      bytes: bytes('x'),
      uploadedByUid: 'w1',
      now: NOW,
    });
    const e1 = recordAccess(artifact, 'a1', 'role1', undefined, new Date(NOW.getTime() - 1000));
    const e2 = recordAccess(artifact, 'a2', 'role2', undefined, new Date(NOW.getTime() + 1000));
    const summary = summarizeChain(artifact, [e1, e2]);
    expect(summary.lastAccessByUid).toBe('a2');
  });
});
