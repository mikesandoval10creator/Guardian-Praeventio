import { describe, it, expect } from 'vitest';
import { PreventiveObjectivesAdapter } from './annualReviewFirestoreAdapter.js';
import { createFakeFirestore } from '../../test/fakeFirestore.js';
import type { PreventiveObjective } from './annualSgiReview.js';

function obj(over: Partial<PreventiveObjective> & { id: string }): PreventiveObjective {
  return {
    id: over.id,
    fiscalYear: over.fiscalYear ?? 2026,
    title: 't',
    description: 'd',
    metric: 'percent_reduction',
    baseline: 100,
    target: 70,
    currentValue: 85,
    deadline: '2026-12-31T23:59:59Z',
    ownerUid: over.ownerUid ?? 'o1',
    status: 'in_progress',
    linkedActionIds: over.linkedActionIds ?? [],
    evidenceUrls: over.evidenceUrls ?? [],
  };
}

describe('PreventiveObjectivesAdapter', () => {
  it('save + getById', async () => {
    const db = createFakeFirestore();
    const a = new PreventiveObjectivesAdapter(db, 't1');
    await a.save(obj({ id: 'o1' }));
    expect((await a.getById('o1'))?.id).toBe('o1');
  });

  it('updateProgress sin status', async () => {
    const db = createFakeFirestore();
    const a = new PreventiveObjectivesAdapter(db, 't1');
    await a.save(obj({ id: 'o1' }));
    await a.updateProgress('o1', 75);
    expect((await a.getById('o1'))?.currentValue).toBe(75);
  });

  it('updateProgress con status', async () => {
    const db = createFakeFirestore();
    const a = new PreventiveObjectivesAdapter(db, 't1');
    await a.save(obj({ id: 'o1' }));
    await a.updateProgress('o1', 70, 'achieved');
    const got = await a.getById('o1');
    expect(got?.currentValue).toBe(70);
    expect(got?.status).toBe('achieved');
  });

  it('listByFiscalYear filtra', async () => {
    const db = createFakeFirestore();
    const a = new PreventiveObjectivesAdapter(db, 't1');
    await a.save(obj({ id: '2026', fiscalYear: 2026 }));
    await a.save(obj({ id: '2027', fiscalYear: 2027 }));
    expect((await a.listByFiscalYear(2026))[0].id).toBe('2026');
  });

  it('listForOwner con filtro de year', async () => {
    const db = createFakeFirestore();
    const a = new PreventiveObjectivesAdapter(db, 't1');
    await a.save(obj({ id: 'a', ownerUid: 'o1', fiscalYear: 2026 }));
    await a.save(obj({ id: 'b', ownerUid: 'o1', fiscalYear: 2027 }));
    await a.save(obj({ id: 'c', ownerUid: 'o2', fiscalYear: 2026 }));
    expect((await a.listForOwner('o1', 2026)).map((o) => o.id)).toEqual(['a']);
  });

  it('addLinkedAction es idempotente', async () => {
    const db = createFakeFirestore();
    const a = new PreventiveObjectivesAdapter(db, 't1');
    await a.save(obj({ id: 'o1' }));
    await a.addLinkedAction('o1', 'ca1');
    await a.addLinkedAction('o1', 'ca1');
    expect((await a.getById('o1'))?.linkedActionIds).toEqual(['ca1']);
  });

  it('addEvidence idempotente', async () => {
    const db = createFakeFirestore();
    const a = new PreventiveObjectivesAdapter(db, 't1');
    await a.save(obj({ id: 'o1' }));
    await a.addEvidence('o1', 'https://x/y.pdf');
    await a.addEvidence('o1', 'https://x/y.pdf');
    expect((await a.getById('o1'))?.evidenceUrls).toEqual(['https://x/y.pdf']);
  });
});
