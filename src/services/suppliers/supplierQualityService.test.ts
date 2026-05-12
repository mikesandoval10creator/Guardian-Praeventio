import { describe, it, expect } from 'vitest';
import {
  buildSLAReport,
  rankSuppliers,
  auditCriticalServices,
  type Supplier,
  type ServiceDeliveryEvent,
  type SLATarget,
} from './supplierQualityService.js';

function supplier(over: Partial<Supplier> & { id: string }): Supplier {
  return {
    id: over.id,
    legalName: over.legalName ?? `Supplier ${over.id}`,
    services: over.services ?? ['epp'],
    active: over.active ?? true,
    qualified: over.qualified ?? true,
  };
}

function event(over: Partial<ServiceDeliveryEvent> & { supplierId: string }): ServiceDeliveryEvent {
  return {
    supplierId: over.supplierId,
    service: over.service ?? 'epp',
    requestedAt: over.requestedAt ?? '2026-05-01T10:00:00Z',
    completedAt: over.completedAt ?? '2026-05-01T16:00:00Z',
    successful: over.successful ?? true,
  };
}

const eppTarget: SLATarget = { service: 'epp', responseTimeHours: 24, acceptableFailureRate: 0.1 };

describe('buildSLAReport', () => {
  it('todos exitosos → meetsSLA=true', () => {
    const events = [event({ supplierId: 's1' }), event({ supplierId: 's1' })];
    const r = buildSLAReport('s1', 'epp', events, eppTarget);
    expect(r.failureRate).toBe(0);
    expect(r.meetsSLA).toBe(true);
  });

  it('failure rate > acceptable → meetsSLA=false', () => {
    const events = [
      event({ supplierId: 's1', successful: false }),
      event({ supplierId: 's1', successful: false }),
      event({ supplierId: 's1' }),
    ];
    const r = buildSLAReport('s1', 'epp', events, eppTarget);
    expect(r.failureRate).toBeGreaterThan(0.1);
    expect(r.meetsSLA).toBe(false);
  });

  it('response time alto → meetsResponseTime=false', () => {
    const events = [
      event({
        supplierId: 's1',
        requestedAt: '2026-05-01T00:00:00Z',
        completedAt: '2026-05-03T00:00:00Z', // 48h
      }),
    ];
    const r = buildSLAReport('s1', 'epp', events, eppTarget);
    expect(r.avgResponseTimeHours).toBe(48);
    expect(r.meetsResponseTime).toBe(false);
  });
});

describe('rankSuppliers', () => {
  it('ordena por quality + marca top 3', () => {
    const suppliers = [
      supplier({ id: 'a' }),
      supplier({ id: 'b' }),
      supplier({ id: 'c' }),
      supplier({ id: 'd' }),
    ];
    const events = [
      event({ supplierId: 'a', successful: true }), // best
      event({ supplierId: 'b', successful: false }), // worst
      event({ supplierId: 'c', successful: true }),
      event({ supplierId: 'd', successful: true }),
    ];
    const r = rankSuppliers(suppliers, events, 'epp', eppTarget);
    const recommended = r.filter((x) => x.isRecommended);
    expect(recommended.length).toBeGreaterThanOrEqual(1);
    expect(recommended.every((x) => x.qualityScore > 0)).toBe(true);
  });

  it('excluye proveedores inactivos / no calificados', () => {
    const suppliers = [
      supplier({ id: 'a', active: false }),
      supplier({ id: 'b', qualified: false }),
      supplier({ id: 'c' }),
    ];
    const r = rankSuppliers(suppliers, [], 'epp', eppTarget);
    expect(r).toHaveLength(1);
    expect(r[0].supplierId).toBe('c');
  });
});

describe('auditCriticalServices', () => {
  it('detecta sole supplier', () => {
    const r = auditCriticalServices(
      [supplier({ id: 'a' })], // único de epp
      [],
      ['epp'],
      eppTarget,
    );
    expect(r[0].isSoleSupplier).toBe(true);
  });

  it('detecta riesgo sistémico cuando todos fallan', () => {
    const r = auditCriticalServices(
      [supplier({ id: 'a' }), supplier({ id: 'b' })],
      [
        event({ supplierId: 'a', successful: false }),
        event({ supplierId: 'a', successful: false }),
        event({ supplierId: 'b', successful: false }),
      ],
      ['epp'],
      eppTarget,
    );
    expect(r[0].hasHighSystemicRisk).toBe(true);
  });
});
