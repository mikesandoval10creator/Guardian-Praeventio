// Praeventio Guard — Bucket D: classifyIncidents() unit tests.

import { describe, it, expect } from 'vitest';
import { classifyIncidents, type RawIncidentDoc } from './classifyIncidents';

describe('classifyIncidents', () => {
  it('returns all-zero counts for an empty list', () => {
    expect(classifyIncidents([])).toEqual({
      totalRecordable: 0,
      lostTime: 0,
      restrictedOrTransferred: 0,
      seriousInjuriesAndFatalities: 0,
      fatalities: 0,
      totalLostDays: 0,
    });
  });

  it('near-miss is NOT recordable (no injury) — contributes nothing', () => {
    const docs: RawIncidentDoc[] = [
      { incidentType: 'near_miss', severity: 'high', lostDays: 5 },
    ];
    const c = classifyIncidents(docs);
    expect(c.totalRecordable).toBe(0);
    expect(c.lostTime).toBe(0);
    expect(c.totalLostDays).toBe(0);
  });

  it('incident + post_mortem are recordable', () => {
    const docs: RawIncidentDoc[] = [
      { incidentType: 'incident', severity: 'low' },
      { incidentType: 'post_mortem', severity: 'high' },
    ];
    expect(classifyIncidents(docs).totalRecordable).toBe(2);
  });

  it('lostTime counts recordable incidents with numeric lostDays > 0 and sums totalLostDays', () => {
    const docs: RawIncidentDoc[] = [
      { incidentType: 'incident', severity: 'med', lostDays: 3 },
      { incidentType: 'incident', severity: 'med', lostDays: 0 },
      { incidentType: 'incident', severity: 'med' }, // no lostDays field
      { incidentType: 'incident', severity: 'med', lostDays: 7.4 }, // rounds to 7
    ];
    const c = classifyIncidents(docs);
    expect(c.totalRecordable).toBe(4);
    expect(c.lostTime).toBe(2);
    expect(c.totalLostDays).toBe(10); // 3 + round(7.4)
  });

  it('restrictedOrTransferred counts only explicit restricted === true', () => {
    const docs: RawIncidentDoc[] = [
      { incidentType: 'incident', severity: 'low', restricted: true },
      { incidentType: 'incident', severity: 'low', restricted: false },
      { incidentType: 'incident', severity: 'low' },
    ];
    expect(classifyIncidents(docs).restrictedOrTransferred).toBe(1);
  });

  it('SIF includes severity critical recordable incidents', () => {
    const docs: RawIncidentDoc[] = [
      { incidentType: 'incident', severity: 'critical' },
      { incidentType: 'incident', severity: 'high' },
    ];
    expect(classifyIncidents(docs).seriousInjuriesAndFatalities).toBe(1);
  });

  it('fatalities require explicit fatal === true — NEVER inferred from severity', () => {
    const docs: RawIncidentDoc[] = [
      { incidentType: 'incident', severity: 'critical' }, // critical but no fatal flag
      { incidentType: 'incident', severity: 'high', fatal: true },
    ];
    const c = classifyIncidents(docs);
    expect(c.fatalities).toBe(1);
    // both are SIF (one critical, one fatal)
    expect(c.seriousInjuriesAndFatalities).toBe(2);
  });

  it('ignores docs with missing/unknown incidentType (no fabricated default)', () => {
    const docs: RawIncidentDoc[] = [
      {},
      { incidentType: 'garbage', severity: 'critical', lostDays: 99 },
    ];
    expect(classifyIncidents(docs)).toMatchObject({
      totalRecordable: 0,
      totalLostDays: 0,
    });
  });
});
