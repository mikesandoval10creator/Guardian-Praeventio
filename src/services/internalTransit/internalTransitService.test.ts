import { describe, it, expect } from 'vitest';
import {
  getPreOpChecklist,
  validatePreOpChecklist,
  recommendedPedestrianBuffer,
  pointInPolygon,
  checkSpeedCompliance,
  assessDriverFatigue,
  assessRouteRisk,
  type SpeedZone,
} from './internalTransitService.js';

describe('Pre-op checklist', () => {
  it('camion_grande tiene los items mínimos', () => {
    const items = getPreOpChecklist('camion_grande');
    expect(items.some((i) => i.id === 'frenos' && i.blocking)).toBe(true);
    expect(items.some((i) => i.id === 'alarma_retroceso' && i.blocking)).toBe(true);
  });

  it('grua_movil incluye anemometro', () => {
    const items = getPreOpChecklist('grua_movil');
    expect(items.some((i) => i.id === 'anemometro')).toBe(true);
  });

  it('validatePreOpChecklist falla si bloquea', () => {
    const result = validatePreOpChecklist('camioneta', [
      { itemId: 'frenos', passed: false },
      { itemId: 'luces', passed: true },
      { itemId: 'cinturon', passed: true },
      { itemId: 'kit_emergencia', passed: false }, // warning
      { itemId: 'neumaticos', passed: true },
    ]);
    expect(result.passed).toBe(false);
    expect(result.blockingFailures).toContain('frenos');
    expect(result.warnings).toContain('kit_emergencia');
  });

  it('warnings no bloquean operación', () => {
    const items = getPreOpChecklist('camion_grande');
    const responses = items.map((i) => ({
      itemId: i.id,
      passed: i.id !== 'cabin_clean', // solo fail item no-bloqueante
    }));
    const result = validatePreOpChecklist('camion_grande', responses);
    expect(result.passed).toBe(true);
    expect(result.warnings).toContain('cabin_clean');
  });
});

describe('recommendedPedestrianBuffer', () => {
  it('grua_movil tiene buffer alto (10m)', () => {
    expect(recommendedPedestrianBuffer('grua_movil')).toBe(10);
  });

  it('camioneta tiene buffer bajo (2m)', () => {
    expect(recommendedPedestrianBuffer('camioneta')).toBe(2);
  });
});

describe('pointInPolygon', () => {
  it('punto dentro del cuadrado', () => {
    const square: Array<[number, number]> = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    expect(pointInPolygon([5, 5], square)).toBe(true);
  });

  it('punto fuera del cuadrado', () => {
    const square: Array<[number, number]> = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    expect(pointInPolygon([15, 5], square)).toBe(false);
  });
});

describe('checkSpeedCompliance', () => {
  const zone: SpeedZone = {
    id: 'z1',
    label: 'Patio interno',
    polygon: [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
    maxSpeedKmh: 20,
  };

  it('punto dentro y over speed → flag', () => {
    const r = checkSpeedCompliance([5, 5], 30, [zone]);
    expect(r.zone?.id).toBe('z1');
    expect(r.isOverLimit).toBe(true);
    expect(r.excessPercent).toBe(50);
  });

  it('punto dentro y dentro límite → ok', () => {
    const r = checkSpeedCompliance([5, 5], 18, [zone]);
    expect(r.isOverLimit).toBe(false);
    expect(r.excessPercent).toBe(0);
  });

  it('punto fuera de toda zona → no aplica', () => {
    const r = checkSpeedCompliance([100, 100], 50, [zone]);
    expect(r.zone).toBeNull();
    expect(r.isOverLimit).toBe(false);
  });
});

describe('assessDriverFatigue', () => {
  it('descanso normal + 2h volante → low', () => {
    const a = assessDriverFatigue({
      driverUid: 'd1',
      startedAt: 't1',
      hoursAtWheel: 2,
      restHoursBefore: 10,
    });
    expect(a.level).toBe('low');
    expect(a.shouldRotate).toBe(false);
  });

  it('5h volante + descanso 7h → high (combina factores)', () => {
    const a = assessDriverFatigue({
      driverUid: 'd1',
      startedAt: 't1',
      hoursAtWheel: 5,
      restHoursBefore: 7,
    });
    expect(a.shouldRotate).toBe(true);
  });

  it('8h volante + 5h descanso → critical', () => {
    const a = assessDriverFatigue({
      driverUid: 'd1',
      startedAt: 't1',
      hoursAtWheel: 8,
      restHoursBefore: 5,
    });
    expect(a.level).toBe('critical');
    expect(a.fatigueScore).toBeGreaterThanOrEqual(70);
  });

  it('descanso insuficiente flagea aunque pocas horas al volante', () => {
    const a = assessDriverFatigue({
      driverUid: 'd1',
      startedAt: 't1',
      hoursAtWheel: 1,
      restHoursBefore: 4,
    });
    expect(a.recommendations.some((r) => /insuficiente/i.test(r))).toBe(true);
  });
});

describe('assessRouteRisk', () => {
  it('clima claro + buen camino + 0 alertas → low', () => {
    const r = assessRouteRisk({ weather: 'clear', roadState: 'good', externalAlerts: [] });
    expect(r.riskLevel).toBe('low');
    expect(r.shouldDelay).toBe(false);
  });

  it('camino cerrado → shouldDelay true', () => {
    const r = assessRouteRisk({ weather: 'clear', roadState: 'closed', externalAlerts: [] });
    expect(r.shouldDelay).toBe(true);
  });

  it('múltiples factores apilan riesgo', () => {
    const r = assessRouteRisk({
      weather: 'snow',
      roadState: 'icy',
      externalAlerts: ['roadblock', 'rockfall'],
    });
    expect(r.riskLevel).toBe('extreme');
    expect(r.factors.length).toBeGreaterThan(2);
  });
});
