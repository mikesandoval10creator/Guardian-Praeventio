import { describe, it, expect } from 'vitest';
import { computeTrafficLight } from './trafficLightEngine.js';
import type { ExpirableItem } from '../expirations/expirationScanner.js';

const NOW = new Date('2026-05-11T12:00:00Z');

function inDays(days: number): string {
  return new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

describe('computeTrafficLight', () => {
  it('proyecto vacío sin nada → todo verde, score 100', () => {
    const result = computeTrafficLight({
      profile: { workersCount: 5 },
      expirableItems: [],
      attendedLegalRuleIds: [],
      openFindings: [],
      now: NOW,
    });
    expect(result.overall).toBe('green');
    expect(result.score).toBe(100);
    expect(result.byCategory.every((c) => c.light === 'green')).toBe(true);
  });

  it('≥25 trabajadores sin CPHS atendido → legal rojo', () => {
    const result = computeTrafficLight({
      profile: { workersCount: 30 },
      expirableItems: [],
      attendedLegalRuleIds: [],
      openFindings: [],
      now: NOW,
    });
    const legal = result.byCategory.find((c) => c.category === 'legal')!;
    expect(legal.light).toBe('red');
    expect(legal.criticalItemIds).toContain('cphs_25_workers');
    expect(result.overall).toBe('red');
  });

  it('≥25 trabajadores con CPHS atendido → legal verde', () => {
    const result = computeTrafficLight({
      profile: { workersCount: 30 },
      expirableItems: [],
      attendedLegalRuleIds: ['cphs_25_workers'],
      openFindings: [],
      now: NOW,
    });
    const legal = result.byCategory.find((c) => c.category === 'legal')!;
    expect(legal.light).toBe('green');
  });

  it('EPP vencido → epp rojo', () => {
    const items: ExpirableItem[] = [
      { id: 'casco-1', kind: 'epp', expiresAt: inDays(-5), status: 'active' },
    ];
    const result = computeTrafficLight({
      profile: { workersCount: 5 },
      expirableItems: items,
      attendedLegalRuleIds: [],
      openFindings: [],
      now: NOW,
    });
    const epp = result.byCategory.find((c) => c.category === 'epp')!;
    expect(epp.light).toBe('red');
    expect(epp.criticalItemIds).toContain('casco-1');
    expect(result.overall).toBe('red');
  });

  it('Document por vencer dentro 30d → documentation amarillo', () => {
    const items: ExpirableItem[] = [
      { id: 'contract-x', kind: 'document', expiresAt: inDays(20) },
    ];
    const result = computeTrafficLight({
      profile: { workersCount: 5 },
      expirableItems: items,
      attendedLegalRuleIds: [],
      openFindings: [],
      now: NOW,
    });
    const docs = result.byCategory.find((c) => c.category === 'documentation')!;
    expect(docs.light).toBe('yellow');
    expect(docs.warningCount).toBe(1);
  });

  it('Emergencia finding crítico abierto → emergencies rojo', () => {
    const result = computeTrafficLight({
      profile: { workersCount: 5 },
      expirableItems: [],
      attendedLegalRuleIds: [],
      openFindings: [
        { id: 'emerg-1', category: 'emergencies', severity: 'critical' },
      ],
      now: NOW,
    });
    const em = result.byCategory.find((c) => c.category === 'emergencies')!;
    expect(em.light).toBe('red');
  });

  it('Emergencia finding low → emergencies amarillo', () => {
    const result = computeTrafficLight({
      profile: { workersCount: 5 },
      expirableItems: [],
      attendedLegalRuleIds: [],
      openFindings: [
        { id: 'emerg-2', category: 'emergencies', severity: 'low' },
      ],
      now: NOW,
    });
    const em = result.byCategory.find((c) => c.category === 'emergencies')!;
    expect(em.light).toBe('yellow');
  });

  it('Mix: rojo en epp + amarillo en docs + verde otros → overall rojo', () => {
    const result = computeTrafficLight({
      profile: { workersCount: 5 },
      expirableItems: [
        { id: 'casco-1', kind: 'epp', expiresAt: inDays(-1), status: 'active' },
        { id: 'doc-1', kind: 'document', expiresAt: inDays(15) },
      ],
      attendedLegalRuleIds: [],
      openFindings: [],
      now: NOW,
    });
    expect(result.overall).toBe('red');
    expect(result.score).toBeLessThan(100);
    expect(result.score).toBeGreaterThan(0);
  });

  it('genera 8 categorías exactas', () => {
    const result = computeTrafficLight({
      profile: { workersCount: 5 },
      expirableItems: [],
      attendedLegalRuleIds: [],
      openFindings: [],
      now: NOW,
    });
    const cats = result.byCategory.map((c) => c.category);
    expect(cats).toEqual([
      'legal',
      'documentation',
      'training',
      'epp',
      'emergencies',
      'occupational_health',
      'maintenance',
      'audits',
    ]);
  });

  it('computedAt es ISO-8601 válido', () => {
    const result = computeTrafficLight({
      profile: { workersCount: 5 },
      expirableItems: [],
      attendedLegalRuleIds: [],
      openFindings: [],
      now: NOW,
    });
    expect(result.computedAt).toBe(NOW.toISOString());
  });
});
