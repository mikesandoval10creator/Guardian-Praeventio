import { describe, it, expect } from 'vitest';
import { SIFAdapter, type StoredSIFPrecursor } from './sifFirestoreAdapter.js';
import { createFakeFirestore } from '../../test/fakeFirestore.js';

function precursor(over: Partial<StoredSIFPrecursor> & { id: string }): StoredSIFPrecursor {
  return {
    id: over.id,
    projectId: 'p1',
    kind: over.kind ?? 'altura_sin_lesion',
    potential: over.potential ?? 'serious',
    rationale: ['x'],
    executiveReviewRequired: over.executiveReviewRequired ?? true,
    mandanteNotificationRequired: over.mandanteNotificationRequired ?? false,
    reportedByUid: over.reportedByUid ?? 'w1',
    occurredAt: over.occurredAt ?? '2026-05-11T10:00:00Z',
    reviewedAt: over.reviewedAt,
    notifiedMandanteAt: over.notifiedMandanteAt,
  };
}

describe('SIFAdapter', () => {
  it('save + getById', async () => {
    const db = createFakeFirestore();
    const a = new SIFAdapter(db, 't1', 'p1');
    await a.save(precursor({ id: 's1' }));
    const got = await a.getById('s1');
    expect(got?.kind).toBe('altura_sin_lesion');
  });

  it('recordExecutiveReview setea reviewedAt + reviewedBy', async () => {
    const db = createFakeFirestore();
    const a = new SIFAdapter(db, 't1', 'p1');
    await a.save(precursor({ id: 's1' }));
    await a.recordExecutiveReview('s1', 'exec1', '2026-05-11T16:00:00Z', 'OK');
    const got = await a.getById('s1');
    expect(got?.reviewedByUid).toBe('exec1');
    expect(got?.reviewNotes).toBe('OK');
  });

  it('listByPotential filtra y ordena desc', async () => {
    const db = createFakeFirestore();
    const a = new SIFAdapter(db, 't1', 'p1');
    await a.save(precursor({ id: 'old', potential: 'fatal', occurredAt: '2026-05-10T10:00:00Z' }));
    await a.save(precursor({ id: 'new', potential: 'fatal', occurredAt: '2026-05-11T10:00:00Z' }));
    await a.save(precursor({ id: 'other', potential: 'serious' }));
    const list = await a.listByPotential('fatal');
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe('new');
  });

  it('listPendingExecutiveReview excluye los ya revisados', async () => {
    const db = createFakeFirestore();
    const a = new SIFAdapter(db, 't1', 'p1');
    await a.save(precursor({ id: 'pending', executiveReviewRequired: true }));
    await a.save(
      precursor({
        id: 'reviewed',
        executiveReviewRequired: true,
        reviewedAt: '2026-05-11T15:00:00Z',
      }),
    );
    const list = await a.listPendingExecutiveReview();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('pending');
  });

  it('recordMandanteNotification persiste', async () => {
    const db = createFakeFirestore();
    const a = new SIFAdapter(db, 't1', 'p1');
    await a.save(precursor({ id: 's1' }));
    await a.recordMandanteNotification('s1', 'admin1', '2026-05-11T17:00:00Z');
    const got = await a.getById('s1');
    expect(got?.notifiedMandanteAt).toBe('2026-05-11T17:00:00Z');
  });
});
