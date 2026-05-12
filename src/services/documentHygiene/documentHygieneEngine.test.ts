import { describe, it, expect } from 'vitest';
import {
  detectUnusedDocuments,
  detectGhostDocuments,
  suggestPurges,
  computeDocumentConfidence,
  type DocumentRecord,
} from './documentHygieneEngine.js';

function doc(over: Partial<DocumentRecord> & { id: string }): DocumentRecord {
  return {
    id: over.id,
    title: over.title ?? 'Procedimiento X',
    kind: over.kind ?? 'procedure',
    version: over.version ?? 'v1',
    updatedAt: over.updatedAt ?? '2026-05-01T00:00:00Z',
    hasValidSignature: over.hasValidSignature ?? true,
    accessCount90d: over.accessCount90d ?? 10,
    readReceiptCount: over.readReceiptCount ?? 5,
    referencesNorm: over.referencesNorm ?? true,
    isLinkedToOperations: over.isLinkedToOperations ?? true,
    approvedByUid: over.approvedByUid ?? 'a1',
    approvedAt: over.approvedAt ?? '2026-04-01T00:00:00Z',
  };
}

describe('detectUnusedDocuments', () => {
  it('documento con uso normal → no aparece', () => {
    expect(detectUnusedDocuments([doc({ id: 'a' })])).toEqual([]);
  });

  it('sin accesos + sin firmas → reasons múltiples', () => {
    const r = detectUnusedDocuments([
      doc({ id: 'a', accessCount90d: 0, readReceiptCount: 0, isLinkedToOperations: false }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].reasons).toContain('no_access');
    expect(r[0].reasons).toContain('no_signatures');
    expect(r[0].reasons).toContain('no_links');
  });

  it('viejo + sin uso → suggestedAction archive', () => {
    const r = detectUnusedDocuments(
      [
        doc({
          id: 'a',
          accessCount90d: 0,
          readReceiptCount: 0,
          isLinkedToOperations: false,
          updatedAt: '2024-01-01T00:00:00Z',
        }),
      ],
      '2026-05-11T00:00:00Z',
    );
    expect(r[0].suggestedAction).toBe('archive');
  });
});

describe('detectGhostDocuments', () => {
  it('detecta documento sin links + sin firmas + sin accesos', () => {
    const ghosts = detectGhostDocuments([
      doc({ id: 'g', isLinkedToOperations: false, readReceiptCount: 0, accessCount90d: 0 }),
      doc({ id: 'good' }),
    ]);
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0].documentId).toBe('g');
  });
});

describe('suggestPurges', () => {
  it('marca duplicados por título normalizado', () => {
    const r = suggestPurges([
      doc({ id: 'a', title: 'Procedimiento Soldadura', updatedAt: '2026-05-01T00:00:00Z' }),
      doc({ id: 'b', title: 'PROCEDIMIENTO SOLDADURA', updatedAt: '2026-04-01T00:00:00Z' }),
    ]);
    const dup = r.find((s) => s.reason === 'duplicate');
    expect(dup).toBeDefined();
    expect(dup?.documentId).toBe('b'); // perdedor
    expect(dup?.supersededBy).toEqual(['a']);
  });

  it('marca obsoleto si >2 años sin actualizar Y referencia norma', () => {
    const r = suggestPurges(
      [doc({ id: 'a', updatedAt: '2023-01-01T00:00:00Z', referencesNorm: true })],
      '2026-05-11T00:00:00Z',
    );
    expect(r.find((s) => s.reason === 'obsolete')).toBeDefined();
  });

  it('marca orphaned si sin links + sin firmas', () => {
    const r = suggestPurges([
      doc({ id: 'a', isLinkedToOperations: false, readReceiptCount: 0 }),
    ]);
    expect(r[0].reason).toBe('orphaned');
  });

  it('un mismo doc en varias categorías → prioridad duplicate > obsolete > orphaned', () => {
    const r = suggestPurges([
      doc({ id: 'a', title: 'X', updatedAt: '2026-05-01T00:00:00Z' }),
      doc({
        id: 'b',
        title: 'X',
        updatedAt: '2022-01-01T00:00:00Z',
        isLinkedToOperations: false,
        readReceiptCount: 0,
        referencesNorm: true,
      }),
    ]);
    const losing = r.find((s) => s.documentId === 'b');
    expect(losing?.reason).toBe('duplicate'); // prioridad máxima
  });
});

describe('computeDocumentConfidence', () => {
  it('documento perfecto reciente → high', () => {
    const c = computeDocumentConfidence(doc({ id: 'a', accessCount90d: 100, readReceiptCount: 50 }), '2026-05-11');
    expect(c.level).toBe('high');
    expect(c.score).toBeGreaterThanOrEqual(70);
  });

  it('documento sin firma + sin accesos + viejo → low', () => {
    const c = computeDocumentConfidence(
      doc({
        id: 'a',
        hasValidSignature: false,
        approvedByUid: undefined,
        accessCount90d: 0,
        readReceiptCount: 0,
        referencesNorm: false,
        isLinkedToOperations: false,
        updatedAt: '2023-01-01T00:00:00Z',
      }),
      '2026-05-11T00:00:00Z',
    );
    expect(c.level).toBe('low');
  });

  it('factors lista los componentes del score', () => {
    const c = computeDocumentConfidence(doc({ id: 'a' }), '2026-05-11');
    expect(c.factors.length).toBeGreaterThan(0);
    expect(c.factors.every((f) => typeof f.delta === 'number')).toBe(true);
  });
});
