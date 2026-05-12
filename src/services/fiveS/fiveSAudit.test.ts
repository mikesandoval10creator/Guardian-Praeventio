import { describe, it, expect } from 'vitest';
import {
  getFiveSChecklist,
  buildFiveSAuditReport,
  rankZonesBy5S,
  type FiveSAuditResponse,
} from './fiveSAudit.js';

describe('getFiveSChecklist', () => {
  it('incluye items de las 5 dimensiones', () => {
    const items = getFiveSChecklist();
    const dims = new Set(items.map((i) => i.dimension));
    expect(dims).toEqual(new Set(['seiri', 'seiton', 'seiso', 'seiketsu', 'shitsuke']));
  });
});

describe('buildFiveSAuditReport', () => {
  it('todos en rating 2 → score 100, excellent', () => {
    const responses: FiveSAuditResponse[] = getFiveSChecklist().map((i) => ({
      itemId: i.id,
      rating: 2,
    }));
    const r = buildFiveSAuditReport('zone1', responses);
    expect(r.overallScore).toBe(100);
    expect(r.level).toBe('excellent');
  });

  it('todos en rating 0 → score 0, critical', () => {
    const responses: FiveSAuditResponse[] = getFiveSChecklist().map((i) => ({
      itemId: i.id,
      rating: 0,
    }));
    const r = buildFiveSAuditReport('zone1', responses);
    expect(r.overallScore).toBe(0);
    expect(r.level).toBe('critical');
  });

  it('detecta worstDimension', () => {
    const checklist = getFiveSChecklist();
    const responses: FiveSAuditResponse[] = checklist.map((i) => ({
      itemId: i.id,
      rating: i.dimension === 'shitsuke' ? 0 : 2,
    }));
    const r = buildFiveSAuditReport('zone1', responses);
    expect(r.worstDimension).toBe('shitsuke');
  });

  it('items sin respuesta cuentan como 0', () => {
    const r = buildFiveSAuditReport('zone1', []);
    expect(r.overallScore).toBe(0);
  });
});

describe('rankZonesBy5S', () => {
  it('ordena peor primero', () => {
    const reports = [
      buildFiveSAuditReport(
        'good',
        getFiveSChecklist().map((i) => ({ itemId: i.id, rating: 2 as const })),
      ),
      buildFiveSAuditReport(
        'bad',
        getFiveSChecklist().map((i) => ({ itemId: i.id, rating: 0 as const })),
      ),
    ];
    const ranked = rankZonesBy5S(reports);
    expect(ranked[0].zoneId).toBe('bad');
  });
});
