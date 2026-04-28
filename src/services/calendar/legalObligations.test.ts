import { describe, it, expect } from 'vitest';
import { getNextDueDate, getLegalReference, type ObligationKind } from './legalObligations';

describe('legalObligations.getNextDueDate', () => {
  const base = new Date('2026-01-01T00:00:00.000Z');

  it('returns lastDate + 30 days for cphs-meeting (DS 54)', () => {
    const next = getNextDueDate('cphs-meeting', base).dueDate;
    const expected = new Date(base);
    expected.setUTCDate(expected.getUTCDate() + 30);
    expect(next.getTime()).toBe(expected.getTime());
  });

  it('returns lastDate + 180 days for odi-training (Ley 16.744)', () => {
    const next = getNextDueDate('odi-training', base).dueDate;
    const expected = new Date(base);
    expected.setUTCDate(expected.getUTCDate() + 180);
    expect(next.getTime()).toBe(expected.getTime());
  });

  it('returns lastDate + 365 days for management-review-iso45001 (cláusula 9.3)', () => {
    const next = getNextDueDate('management-review-iso45001', base).dueDate;
    const expected = new Date(base);
    expected.setUTCDate(expected.getUTCDate() + 365);
    expect(next.getTime()).toBe(expected.getTime());
  });

  it('audiometria-prexor: annual cadence at dose <= 100%', () => {
    const next = getNextDueDate('audiometria-prexor', base, { dosePercent: 80 }).dueDate;
    const expected = new Date(base);
    expected.setUTCDate(expected.getUTCDate() + 365);
    expect(next.getTime()).toBe(expected.getTime());
  });

  it('audiometria-prexor: accelerates to 6-month cadence when dose > 100%', () => {
    const next = getNextDueDate('audiometria-prexor', base, { dosePercent: 150 }).dueDate;
    const expected = new Date(base);
    expected.setUTCDate(expected.getUTCDate() + 180);
    expect(next.getTime()).toBe(expected.getTime());
  });

  it('every rule cites a legal reference', () => {
    const kinds: ObligationKind[] = [
      'cphs-meeting',
      'odi-training',
      'management-review-iso45001',
      'audiometria-prexor',
      'iper-review',
      'climate-risk-review',
    ];
    for (const k of kinds) {
      const meta = getNextDueDate(k, base);
      expect(meta.legalReference).toBeTruthy();
      expect(typeof meta.legalReference).toBe('string');
      expect(getLegalReference(k)).toBeTruthy();
    }
  });
});
