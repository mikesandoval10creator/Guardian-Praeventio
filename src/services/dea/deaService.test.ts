import { describe, it, expect } from 'vitest';
import { computeDeaStatus, daysUntil, isChecklistComplete } from './deaService.js';

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
