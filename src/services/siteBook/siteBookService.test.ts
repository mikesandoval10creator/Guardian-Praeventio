import { describe, it, expect } from 'vitest';
import {
  buildFolio,
  createEntry,
  signEntry,
  createCorrection,
  filterEntries,
  summarizeSiteBook,
  SiteBookValidationError,
  type CreateEntryInput,
  type SiteBookEntry,
} from './siteBookService.js';

const NOW = new Date('2026-05-11T12:00:00Z');

function input(over: Partial<CreateEntryInput> = {}): CreateEntryInput {
  return {
    projectId: 'p1',
    year: 2026,
    sequenceNumber: 42,
    kind: 'inspection',
    occurredAt: '2026-05-11T10:00:00Z',
    recordedByUid: 'prev-1',
    recordedByRole: 'prevencionista',
    description: 'Inspección de andamios en sector norte sin observaciones críticas',
    now: NOW,
    ...over,
  };
}

describe('buildFolio', () => {
  it('formato SB-YYYY-NNNNNN', () => {
    expect(buildFolio(2026, 42)).toBe('SB-2026-000042');
  });

  it('seq con padding', () => {
    expect(buildFolio(2026, 1)).toBe('SB-2026-000001');
    expect(buildFolio(2026, 1234)).toBe('SB-2026-001234');
  });

  it('rechaza año fuera de rango', () => {
    expect(() => buildFolio(1999, 1)).toThrow(/INVALID_YEAR/);
    expect(() => buildFolio(2200, 1)).toThrow(/INVALID_YEAR/);
  });

  it('rechaza sequence fuera de rango', () => {
    expect(() => buildFolio(2026, 0)).toThrow(/INVALID_SEQUENCE/);
    expect(() => buildFolio(2026, 1_000_000)).toThrow(/INVALID_SEQUENCE/);
  });
});

describe('createEntry', () => {
  it('crea entry con folio + status=open', () => {
    const e = createEntry(input());
    expect(e.folio).toBe('SB-2026-000042');
    expect(e.status).toBe('open');
    expect(e.id).toHaveLength(32);
  });

  it('rechaza description < 20 chars', () => {
    expect(() => createEntry(input({ description: 'corto' }))).toThrow(
      /DESCRIPTION_TOO_SHORT/,
    );
  });

  it('preserva involvedWorkerUids + location + evidenceUrls', () => {
    const e = createEntry(
      input({
        involvedWorkerUids: ['w1', 'w2'],
        location: 'Sector A — nivel 3',
        evidenceUrls: ['gs://bucket/photo.jpg'],
      }),
    );
    expect(e.involvedWorkerUids).toEqual(['w1', 'w2']);
    expect(e.location).toBe('Sector A — nivel 3');
    expect(e.evidenceUrls).toEqual(['gs://bucket/photo.jpg']);
  });
});

describe('signEntry', () => {
  it('marca signed + adjunta firma', () => {
    const e = signEntry(createEntry(input()), {
      signerUid: 'prev-1',
      signedAt: NOW.toISOString(),
      algorithm: 'webauthn-ecdsa-p256',
      payloadHashHex: 'abc123',
    });
    expect(e.status).toBe('signed');
    expect(e.signature?.algorithm).toBe('webauthn-ecdsa-p256');
  });

  it('rechaza firmar dos veces', () => {
    const signed = signEntry(createEntry(input()), {
      signerUid: 'p',
      signedAt: NOW.toISOString(),
      algorithm: 'webauthn-ecdsa-p256',
      payloadHashHex: 'a',
    });
    expect(() =>
      signEntry(signed, {
        signerUid: 'p2',
        signedAt: NOW.toISOString(),
        algorithm: 'webauthn-ecdsa-p256',
        payloadHashHex: 'b',
      }),
    ).toThrow(/NOT_OPEN/);
  });
});

describe('createCorrection', () => {
  it('crea correction con correctsEntryFolio referenciando original', () => {
    const original = signEntry(createEntry(input()), {
      signerUid: 'p',
      signedAt: NOW.toISOString(),
      algorithm: 'webauthn-ecdsa-p256',
      payloadHashHex: 'h',
    });
    const correction = createCorrection(original, {
      projectId: 'p1',
      year: 2026,
      sequenceNumber: 43,
      occurredAt: NOW.toISOString(),
      recordedByUid: 'prev-1',
      recordedByRole: 'prevencionista',
      description: 'Corrige información del folio anterior — error de tipeo en sector',
      correctionReason: 'Sector correcto era B y no A; corrijo para auditoría',
      now: NOW,
    });
    expect(correction.correctsEntryFolio).toBe('SB-2026-000042');
    expect(correction.correctionReason).toContain('Sector correcto');
  });

  it('solo permite corregir signed', () => {
    const open = createEntry(input());
    expect(() =>
      createCorrection(open, {
        projectId: 'p1',
        year: 2026,
        sequenceNumber: 43,
        occurredAt: NOW.toISOString(),
        recordedByUid: 'p',
        recordedByRole: 'prevencionista',
        description: 'Corrección de un open',
        correctionReason: 'razón suficiente para corregir esto',
        now: NOW,
      }),
    ).toThrow(/CAN_ONLY_CORRECT_SIGNED/);
  });
});

describe('filterEntries', () => {
  const entries: SiteBookEntry[] = [
    createEntry(input({ year: 2026, sequenceNumber: 1, kind: 'inspection', occurredAt: '2026-01-15' })),
    createEntry(input({ year: 2026, sequenceNumber: 2, kind: 'incident', occurredAt: '2026-02-20' })),
    createEntry(input({ year: 2025, sequenceNumber: 1, kind: 'visit', occurredAt: '2025-12-10' })),
    createEntry(input({ projectId: 'p2', year: 2026, sequenceNumber: 1, kind: 'inspection', occurredAt: '2026-03-01' })),
  ];

  it('filtra por projectId', () => {
    expect(filterEntries(entries, { projectId: 'p1' })).toHaveLength(3);
    expect(filterEntries(entries, { projectId: 'p2' })).toHaveLength(1);
  });

  it('filtra por year', () => {
    expect(filterEntries(entries, { projectId: 'p1', year: 2025 })).toHaveLength(1);
  });

  it('filtra por kind', () => {
    expect(
      filterEntries(entries, { projectId: 'p1', kind: 'inspection' }),
    ).toHaveLength(1);
  });

  it('filtra por rango fechas', () => {
    expect(
      filterEntries(entries, {
        projectId: 'p1',
        fromDate: '2026-02-01',
        toDate: '2026-02-28',
      }),
    ).toHaveLength(1);
  });

  it('filtra por workerUid', () => {
    const e = createEntry(input({ involvedWorkerUids: ['w-juan'] }));
    expect(
      filterEntries([e], { projectId: 'p1', workerUid: 'w-juan' }),
    ).toHaveLength(1);
    expect(filterEntries([e], { projectId: 'p1', workerUid: 'w-x' })).toHaveLength(0);
  });
});

describe('summarizeSiteBook', () => {
  it('cuenta por kind + status', () => {
    const entries = [
      createEntry(input({ sequenceNumber: 1, kind: 'inspection' })),
      createEntry(input({ sequenceNumber: 2, kind: 'inspection' })),
      signEntry(createEntry(input({ sequenceNumber: 3, kind: 'incident' })), {
        signerUid: 'p',
        signedAt: NOW.toISOString(),
        algorithm: 'webauthn-ecdsa-p256',
        payloadHashHex: 'a',
      }),
    ];
    const s = summarizeSiteBook(entries);
    expect(s.totalEntries).toBe(3);
    expect(s.byKind.inspection).toBe(2);
    expect(s.byKind.incident).toBe(1);
    expect(s.signedCount).toBe(1);
    expect(s.pendingSignatureCount).toBe(2);
  });
});
