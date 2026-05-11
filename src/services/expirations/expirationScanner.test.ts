import { describe, it, expect } from 'vitest';
import {
  scanForExpirations,
  buildExpirationFindingPayload,
  type ExpirableItem,
} from './expirationScanner.js';

const NOW = new Date('2026-05-11T12:00:00Z');

function inDays(days: number): string {
  const ms = NOW.getTime() + days * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString();
}

function item(over: Partial<ExpirableItem>): ExpirableItem {
  return {
    id: 'auto',
    kind: 'document',
    expiresAt: undefined,
    ...over,
  };
}

describe('scanForExpirations', () => {
  it('buckets items por severity correctamente', () => {
    const items: ExpirableItem[] = [
      item({ id: 'e1', expiresAt: inDays(-5) }), // expired (5d atrás)
      item({ id: 'c1', expiresAt: inDays(3) }), // critical (3d futuro)
      item({ id: 'w1', expiresAt: inDays(20) }), // warning (20d, dentro de 30)
      item({ id: 'ok1', expiresAt: inDays(90) }), // ok (90d)
    ];
    const r = scanForExpirations(items, { now: NOW });
    expect(r.expired.map((o) => o.item.id)).toEqual(['e1']);
    expect(r.critical.map((o) => o.item.id)).toEqual(['c1']);
    expect(r.warning.map((o) => o.item.id)).toEqual(['w1']);
    expect(r.ok.map((o) => o.item.id)).toEqual(['ok1']);
    expect(r.totalScanned).toBe(4);
    expect(r.skipped).toBe(0);
  });

  it('omite items sin expiresAt', () => {
    const items: ExpirableItem[] = [
      item({ id: 'no-date' }),
      item({ id: 'good', expiresAt: inDays(10) }),
    ];
    const r = scanForExpirations(items, { now: NOW });
    expect(r.totalScanned).toBe(1);
    expect(r.skipped).toBe(1);
  });

  it('omite items con status=expired o archived (idempotencia)', () => {
    const items: ExpirableItem[] = [
      item({ id: 'already-exp', expiresAt: inDays(-50), status: 'expired' }),
      item({ id: 'archived', expiresAt: inDays(-50), status: 'archived' }),
      item({ id: 'active-expired', expiresAt: inDays(-50), status: 'active' }),
    ];
    const r = scanForExpirations(items, { now: NOW });
    expect(r.skipped).toBe(2);
    expect(r.expired.map((o) => o.item.id)).toEqual(['active-expired']);
  });

  it('omite expiresAt malformados', () => {
    const items: ExpirableItem[] = [
      item({ id: 'bad', expiresAt: 'not-a-date' }),
      item({ id: 'good', expiresAt: inDays(15) }),
    ];
    const r = scanForExpirations(items, { now: NOW });
    expect(r.skipped).toBe(1);
    expect(r.warning).toHaveLength(1);
  });

  it('respeta ventanas custom: warningWindowDays=60, criticalWindowDays=14', () => {
    const items: ExpirableItem[] = [
      item({ id: 'c14', expiresAt: inDays(10) }), // critical (≤ 14)
      item({ id: 'w50', expiresAt: inDays(50) }), // warning (≤ 60)
      item({ id: 'ok90', expiresAt: inDays(90) }), // ok
    ];
    const r = scanForExpirations(items, {
      now: NOW,
      warningWindowDays: 60,
      criticalWindowDays: 14,
    });
    expect(r.critical.map((o) => o.item.id)).toEqual(['c14']);
    expect(r.warning.map((o) => o.item.id)).toEqual(['w50']);
    expect(r.ok.map((o) => o.item.id)).toEqual(['ok90']);
  });

  it('rejects criticalWindowDays >= warningWindowDays (config error)', () => {
    expect(() =>
      scanForExpirations([], {
        warningWindowDays: 5,
        criticalWindowDays: 10,
      }),
    ).toThrow(RangeError);
  });

  it('daysUntilExpiry es exacto (flooring sane)', () => {
    const items: ExpirableItem[] = [
      item({ id: 'today-noon', expiresAt: NOW.toISOString() }),
      item({ id: 'in-3d', expiresAt: inDays(3) }),
      item({ id: '3d-atras', expiresAt: inDays(-3) }),
    ];
    const r = scanForExpirations(items, { now: NOW });
    expect(r.expired.map((o) => o.daysUntilExpiry).sort()).toEqual([-3]);
    expect(r.critical.find((o) => o.item.id === 'in-3d')?.daysUntilExpiry).toBe(3);
    // El item con expiresAt EXACTAMENTE = now tiene daysUntilExpiry=0 → critical
    expect(r.critical.find((o) => o.item.id === 'today-noon')?.daysUntilExpiry).toBe(0);
  });

  it('cubre los 9 ExpirationKind sin error', () => {
    const items: ExpirableItem[] = [
      item({ id: '1', kind: 'epp', expiresAt: inDays(5) }),
      item({ id: '2', kind: 'document', expiresAt: inDays(5) }),
      item({ id: '3', kind: 'training', expiresAt: inDays(5) }),
      item({ id: '4', kind: 'occupational_exam', expiresAt: inDays(5) }),
      item({ id: '5', kind: 'work_permit', expiresAt: inDays(5) }),
      item({ id: '6', kind: 'license', expiresAt: inDays(5) }),
      item({ id: '7', kind: 'medical_fitness', expiresAt: inDays(5) }),
      item({ id: '8', kind: 'contract', expiresAt: inDays(5) }),
      item({ id: '9', kind: 'audit_action', expiresAt: inDays(5) }),
    ];
    const r = scanForExpirations(items, { now: NOW });
    expect(r.critical).toHaveLength(9);
  });
});

describe('buildExpirationFindingPayload', () => {
  it('construye payload listo para crear NodeType.FINDING', () => {
    const outcome = scanForExpirations(
      [
        item({
          id: 'doc-42',
          kind: 'document',
          label: 'Contrato Juan',
          expiresAt: inDays(-2),
          ownerId: 'worker-juan',
          projectId: 'mina-norte',
        }),
      ],
      { now: NOW },
    ).expired[0];
    const payload = buildExpirationFindingPayload(outcome);
    expect(payload.type).toBe('expiration_warning');
    expect(payload.itemId).toBe('doc-42');
    expect(payload.itemKind).toBe('document');
    expect(payload.label).toBe('Contrato Juan');
    expect(payload.severity).toBe('expired');
    expect(payload.daysUntilExpiry).toBe(-2);
    expect(payload.projectId).toBe('mina-norte');
    expect(payload.ownerId).toBe('worker-juan');
  });
});
