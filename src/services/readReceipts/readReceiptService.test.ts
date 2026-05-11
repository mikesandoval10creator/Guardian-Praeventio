import { describe, it, expect } from 'vitest';
import {
  resolveAudience,
  buildInitialReceipts,
  deriveStatus,
  acknowledgeReceipt,
  summarizeReceipts,
  type DocumentForRead,
  type WorkerForRead,
} from './readReceiptService.js';

const NOW = new Date('2026-05-11T12:00:00Z');
const PUBLISHED = '2026-05-01T00:00:00Z'; // 10 días atrás

const baseDoc: DocumentForRead = {
  id: 'doc-altura-v3',
  version: 3,
  title: 'Procedimiento Trabajo en Altura v3',
  audience: { allWorkers: false, roles: ['operador'] },
  publishedAt: PUBLISHED,
  readDeadlineDays: 7,
};

const workers: WorkerForRead[] = [
  { uid: 'w1', role: 'operador', projectIds: ['p1'], activeTrainings: ['t1'], isActive: true },
  { uid: 'w2', role: 'operador', projectIds: ['p2'], activeTrainings: [], isActive: true },
  { uid: 'w3', role: 'supervisor', projectIds: ['p1'], activeTrainings: ['t1'], isActive: true },
  { uid: 'w4', role: 'operador', projectIds: ['p1'], activeTrainings: ['t1'], isActive: false },
];

describe('resolveAudience', () => {
  it('allWorkers=true → todos activos', () => {
    expect(resolveAudience({ allWorkers: true }, workers)).toHaveLength(3); // w4 inactivo excluido
  });

  it('filtra por roles', () => {
    const out = resolveAudience({ roles: ['operador'] }, workers);
    expect(out.map((w) => w.uid).sort()).toEqual(['w1', 'w2']);
  });

  it('intersecta roles + projectIds', () => {
    const out = resolveAudience({ roles: ['operador'], projectIds: ['p1'] }, workers);
    expect(out.map((w) => w.uid)).toEqual(['w1']);
  });

  it('filtra por trainingCodes', () => {
    const out = resolveAudience({ trainingCodes: ['t1'] }, workers);
    expect(out.map((w) => w.uid).sort()).toEqual(['w1', 'w3']); // w4 inactivo, w2 sin t1
  });

  it('workerUids whitelist explícita', () => {
    const out = resolveAudience({ workerUids: ['w1', 'w3'] }, workers);
    expect(out).toHaveLength(2);
  });

  it('inactivos siempre excluidos', () => {
    const out = resolveAudience({ workerUids: ['w4'] }, workers);
    expect(out).toHaveLength(0);
  });
});

describe('buildInitialReceipts', () => {
  it('crea un receipt por audience member, status=pending, deadline computado', () => {
    const audience = resolveAudience(baseDoc.audience, workers);
    const receipts = buildInitialReceipts(baseDoc, audience);
    expect(receipts).toHaveLength(2);
    receipts.forEach((r) => {
      expect(r.status).toBe('pending');
      expect(r.acknowledgedAt).toBeNull();
      expect(r.documentVersion).toBe(3);
      expect(new Date(r.deadlineAt).getTime()).toBe(
        new Date(PUBLISHED).getTime() + 7 * 86_400_000,
      );
    });
  });
});

describe('deriveStatus', () => {
  it('acknowledged si tiene ack timestamp', () => {
    expect(
      deriveStatus({ acknowledgedAt: '2026-05-05T00:00:00Z', deadlineAt: '2026-05-08T00:00:00Z' }, NOW),
    ).toBe('acknowledged');
  });

  it('overdue si deadline pasó sin ack', () => {
    // doc publicado 2026-05-01 + 7d → deadline 2026-05-08, NOW=2026-05-11 → overdue
    expect(
      deriveStatus({ acknowledgedAt: null, deadlineAt: '2026-05-08T00:00:00Z' }, NOW),
    ).toBe('overdue');
  });

  it('pending si deadline futuro sin ack', () => {
    expect(
      deriveStatus({ acknowledgedAt: null, deadlineAt: '2026-05-20T00:00:00Z' }, NOW),
    ).toBe('pending');
  });
});

describe('acknowledgeReceipt', () => {
  it('marca acknowledged + setea timestamp', () => {
    const r = buildInitialReceipts(baseDoc, [workers[0]])[0];
    const acked = acknowledgeReceipt(r, '2026-05-05T10:00:00Z');
    expect(acked.acknowledgedAt).toBe('2026-05-05T10:00:00Z');
    expect(acked.status).toBe('acknowledged');
  });

  it('es idempotente: si ya ack, mantiene timestamp original', () => {
    const r = buildInitialReceipts(baseDoc, [workers[0]])[0];
    const acked1 = acknowledgeReceipt(r, '2026-05-05T10:00:00Z');
    const acked2 = acknowledgeReceipt(acked1, '2026-05-10T22:00:00Z');
    expect(acked2.acknowledgedAt).toBe('2026-05-05T10:00:00Z');
  });
});

describe('summarizeReceipts', () => {
  it('genera summary con buckets correctos', () => {
    const audience = resolveAudience(baseDoc.audience, workers);
    let receipts = buildInitialReceipts(baseDoc, audience);
    receipts = receipts.map((r, i) =>
      i === 0 ? acknowledgeReceipt(r, '2026-05-02T00:00:00Z') : r,
    );
    const summary = summarizeReceipts(baseDoc, receipts, NOW);
    expect(summary.totalAudience).toBe(2);
    expect(summary.acknowledged).toBe(1);
    expect(summary.overdue).toBe(1); // el que no ack y deadline pasó
    expect(summary.pending).toBe(0);
    expect(summary.coveragePercent).toBe(50);
  });

  it('100% coverage cuando todos acknowledged', () => {
    const audience = resolveAudience(baseDoc.audience, workers);
    const receipts = buildInitialReceipts(baseDoc, audience).map((r) =>
      acknowledgeReceipt(r, '2026-05-03T00:00:00Z'),
    );
    const summary = summarizeReceipts(baseDoc, receipts, NOW);
    expect(summary.coveragePercent).toBe(100);
    expect(summary.overdue).toBe(0);
  });

  it('coverage 100% cuando audience vacía (no rompe)', () => {
    const summary = summarizeReceipts(baseDoc, [], NOW);
    expect(summary.coveragePercent).toBe(100);
    expect(summary.totalAudience).toBe(0);
  });
});
