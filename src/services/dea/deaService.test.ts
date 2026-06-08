import { describe, it, expect } from 'vitest';
import {
  computeDeaStatus,
  daysUntil,
  isChecklistComplete,
  distanceMeters,
  nearestDea,
  type Dea,
} from './deaService.js';

const NOW = '2026-05-15T12:00:00Z';

function dea(
  battery: string,
  pads: string,
  lastCheck: string,
): { batteryExpiry: string; padsExpiry: string; lastCheck: string } {
  return { batteryExpiry: battery, padsExpiry: pads, lastCheck };
}

describe('daysUntil', () => {
  it('positive cuando la fecha es futura', () => {
    expect(daysUntil('2026-05-20', NOW)).toBe(4);
  });

  it('negativo cuando la fecha es pasada', () => {
    expect(daysUntil('2026-05-10', NOW)).toBe(-6);
  });

  it('cero cuando la fecha es hoy', () => {
    expect(daysUntil('2026-05-15', NOW)).toBe(-1); // 12:00 - 00:00 = 12h → floor(-0.5) = -1
  });

  it('-Infinity cuando la fecha es inválida', () => {
    expect(daysUntil('no-es-fecha', NOW)).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe('computeDeaStatus', () => {
  it('operational si todo vigente con holgura y reviewed recientemente', () => {
    // Batería expira en 2027, parches en 2026-12, último check ayer (1 día).
    expect(
      computeDeaStatus(dea('2027-05-10', '2026-12-01', '2026-05-14'), NOW),
    ).toBe('operational');
  });

  it('warning si parches vencen en ≤30 días', () => {
    expect(
      computeDeaStatus(dea('2027-05-10', '2026-05-30', '2026-05-14'), NOW),
    ).toBe('warning');
  });

  it('warning si batería vence en ≤30 días', () => {
    expect(
      computeDeaStatus(dea('2026-06-10', '2027-01-01', '2026-05-14'), NOW),
    ).toBe('warning');
  });

  it('warning si última inspección entre 60-90 días', () => {
    // 75 días antes → check del 2026-03-01
    expect(
      computeDeaStatus(dea('2027-05-10', '2027-05-10', '2026-03-01'), NOW),
    ).toBe('warning');
  });

  it('critical si batería vencida', () => {
    expect(
      computeDeaStatus(dea('2025-11-01', '2026-12-01', '2026-05-14'), NOW),
    ).toBe('critical');
  });

  it('critical si parches vencidos', () => {
    expect(
      computeDeaStatus(dea('2027-05-10', '2025-12-01', '2026-05-14'), NOW),
    ).toBe('critical');
  });

  it('critical si última inspección >90 días atrás', () => {
    // 120 días antes
    expect(
      computeDeaStatus(dea('2027-05-10', '2027-05-10', '2026-01-15'), NOW),
    ).toBe('critical');
  });

  it('critical (fail-closed) si las fechas son inválidas', () => {
    expect(
      computeDeaStatus(dea('not-a-date', '2027-05-10', '2026-05-14'), NOW),
    ).toBe('critical');
  });
});

describe('isChecklistComplete', () => {
  it('true cuando todos los items pasaron', () => {
    expect(
      isChecklistComplete({
        statusLightGreen: true,
        batteryConnectedValid: true,
        padsSealedValid: true,
        responseKitComplete: true,
        cabinetIntactAlarmOperative: true,
      }),
    ).toBe(true);
  });

  it('false si CUALQUIER item está en false', () => {
    expect(
      isChecklistComplete({
        statusLightGreen: true,
        batteryConnectedValid: false, // ← uno solo falla
        padsSealedValid: true,
        responseKitComplete: true,
        cabinetIntactAlarmOperative: true,
      }),
    ).toBe(false);
  });
});

function makeDea(id: string, coordinates?: { lat: number; lng: number }): Dea {
  return {
    id,
    location: id,
    description: '',
    batteryExpiry: '2027-01-01',
    padsExpiry: '2027-01-01',
    lastCheck: '2026-05-01',
    assignedToUid: 'u1',
    assignedToName: 'Resp',
    createdAt: '2026-01-01',
    createdBy: 'u1',
    coordinates,
  };
}

describe('distanceMeters (haversine)', () => {
  it('is 0 for the same point', () => {
    expect(distanceMeters({ lat: -33.45, lng: -70.66 }, { lat: -33.45, lng: -70.66 })).toBe(0);
  });

  it('matches a known distance (~1.11 km per 0.01° of latitude)', () => {
    const d = distanceMeters({ lat: 0, lng: 0 }, { lat: 0.01, lng: 0 });
    expect(d).toBeGreaterThan(1100);
    expect(d).toBeLessThan(1115);
  });
});

describe('nearestDea', () => {
  const me = { lat: -33.45, lng: -70.66 }; // Santiago

  it('returns the closest DEA with coordinates + its distance', () => {
    const far = makeDea('far', { lat: -33.5, lng: -70.7 });
    const near = makeDea('near', { lat: -33.451, lng: -70.661 });
    const res = nearestDea([far, near], me);
    expect(res?.dea.id).toBe('near');
    expect(res!.distanceM).toBeGreaterThan(0);
    expect(res!.distanceM).toBeLessThan(distanceMeters(me, far.coordinates!));
  });

  it('skips DEAs without coordinates', () => {
    const noCoord = makeDea('noCoord');
    const withCoord = makeDea('withCoord', { lat: -33.46, lng: -70.67 });
    expect(nearestDea([noCoord, withCoord], me)?.dea.id).toBe('withCoord');
  });

  it('returns null when no DEA has coordinates', () => {
    expect(nearestDea([makeDea('a'), makeDea('b')], me)).toBeNull();
  });
});
