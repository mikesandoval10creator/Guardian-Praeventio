import { describe, it, expect } from 'vitest';
import {
  compareControls,
  calcIncidentsPrevented,
  calcNearMissReduction,
  calcComplianceImprovement,
  calcCostReduction,
  calcTimeToImplement,
  calcMaintenanceBurden,
} from './controlComparator.js';
import type { ControlHistoricalRecord } from './controlComparator.js';

function makeRecord(overrides: Partial<ControlHistoricalRecord> = {}): ControlHistoricalRecord {
  return {
    controlId: 'ctrl-A',
    controlKind: 'engineering',
    deployedAt: '2025-01-01T00:00:00Z',
    monthlyData: [
      {
        period: '2025-02',
        incidentsBefore: 5,
        incidentsAfter: 1,
        nearMissCount: 8,
        complianceScore: 70,
        operatingCostClp: 1_000_000,
        maintenanceHours: 10,
      },
      {
        period: '2025-03',
        incidentsBefore: 6,
        incidentsAfter: 0,
        nearMissCount: 6,
        complianceScore: 80,
        operatingCostClp: 1_100_000,
        maintenanceHours: 11,
      },
      {
        period: '2025-04',
        incidentsBefore: 4,
        incidentsAfter: 1,
        nearMissCount: 4,
        complianceScore: 90,
        operatingCostClp: 1_050_000,
        maintenanceHours: 9,
      },
    ],
    ...overrides,
  };
}

describe('calcIncidentsPrevented', () => {
  it('suma diferencias before-after solo de meses con baseline', () => {
    const r = makeRecord();
    // Before: 5+6+4=15, After: 1+0+1=2, prevented=13
    expect(calcIncidentsPrevented(r)).toBe(13);
  });

  it('devuelve 0 si no hay baseline', () => {
    const r = makeRecord({
      monthlyData: [
        {
          period: '2025-02',
          incidentsAfter: 1,
          nearMissCount: 0,
          complianceScore: 80,
          operatingCostClp: 100_000,
          maintenanceHours: 1,
        },
      ],
    });
    expect(calcIncidentsPrevented(r)).toBe(0);
  });

  it('no devuelve negativos si after > before', () => {
    const r = makeRecord({
      monthlyData: [
        {
          period: '2025-02',
          incidentsBefore: 1,
          incidentsAfter: 10,
          nearMissCount: 0,
          complianceScore: 80,
          operatingCostClp: 100_000,
          maintenanceHours: 1,
        },
      ],
    });
    expect(calcIncidentsPrevented(r)).toBe(0);
  });
});

describe('calcNearMissReduction', () => {
  it('100 - avg(near_miss)', () => {
    const r = makeRecord(); // avg = (8+6+4)/3 = 6
    expect(calcNearMissReduction(r)).toBeCloseTo(94, 1);
  });

  it('clamp 0 cuando promedio supera 100', () => {
    const r = makeRecord({
      monthlyData: [
        {
          period: '2025-02',
          incidentsAfter: 0,
          nearMissCount: 500,
          complianceScore: 0,
          operatingCostClp: 0,
          maintenanceHours: 0,
        },
      ],
    });
    expect(calcNearMissReduction(r)).toBe(0);
  });
});

describe('calcComplianceImprovement', () => {
  it('último - primero', () => {
    const r = makeRecord();
    expect(calcComplianceImprovement(r)).toBe(20); // 90-70
  });

  it('un solo datapoint devuelve su score', () => {
    const r = makeRecord({
      monthlyData: [
        {
          period: '2025-02',
          incidentsAfter: 0,
          nearMissCount: 0,
          complianceScore: 75,
          operatingCostClp: 0,
          maintenanceHours: 0,
        },
      ],
    });
    expect(calcComplianceImprovement(r)).toBe(75);
  });
});

describe('calcCostReduction', () => {
  it('costo bajo da score alto', () => {
    const r = makeRecord(); // avg ~1MM, ratio 0.1, score ~90
    expect(calcCostReduction(r)).toBeGreaterThanOrEqual(85);
    expect(calcCostReduction(r)).toBeLessThanOrEqual(95);
  });

  it('costo >= 10MM da score 0', () => {
    const r = makeRecord({
      monthlyData: [
        {
          period: '2025-02',
          incidentsAfter: 0,
          nearMissCount: 0,
          complianceScore: 0,
          operatingCostClp: 15_000_000,
          maintenanceHours: 0,
        },
      ],
    });
    expect(calcCostReduction(r)).toBe(0);
  });
});

describe('calcTimeToImplement', () => {
  it('mide meses entre deployedAt y primer datapoint', () => {
    const r = makeRecord({ deployedAt: '2025-01-01T00:00:00Z' });
    // primer datapoint 2025-02 → 1 mes
    expect(calcTimeToImplement(r)).toBe(1);
  });

  it('clampa a 0 si deploy posterior al primer dato', () => {
    const r = makeRecord({ deployedAt: '2025-06-01T00:00:00Z' });
    expect(calcTimeToImplement(r)).toBe(0);
  });
});

describe('calcMaintenanceBurden', () => {
  it('promedio horas', () => {
    const r = makeRecord(); // (10+11+9)/3 = 10
    expect(calcMaintenanceBurden(r)).toBe(10);
  });
});

describe('compareControls', () => {
  it('A claramente mejor → confidenceScore > 55 y overallFavors A', () => {
    const a = makeRecord({ controlId: 'A' });
    const b = makeRecord({
      controlId: 'B',
      monthlyData: a.monthlyData.map((d) => ({
        ...d,
        incidentsAfter: d.incidentsAfter + 5,
        nearMissCount: d.nearMissCount + 20,
        complianceScore: Math.max(0, d.complianceScore - 30),
        operatingCostClp: d.operatingCostClp * 5,
        maintenanceHours: d.maintenanceHours * 3,
      })),
    });
    const result = compareControls(a, b);
    expect(result.overallFavors).toBe('A');
    expect(result.confidenceScore).toBeGreaterThan(55);
    expect(result.recommendation).toContain('A');
  });

  it('B claramente mejor → overallFavors B', () => {
    const b = makeRecord({ controlId: 'B' });
    const a = makeRecord({
      controlId: 'A',
      monthlyData: b.monthlyData.map((d) => ({
        ...d,
        incidentsAfter: d.incidentsAfter + 5,
        nearMissCount: d.nearMissCount + 20,
        complianceScore: Math.max(0, d.complianceScore - 30),
        operatingCostClp: d.operatingCostClp * 5,
        maintenanceHours: d.maintenanceHours * 3,
      })),
    });
    const result = compareControls(a, b);
    expect(result.overallFavors).toBe('B');
    expect(result.confidenceScore).toBeLessThan(45);
  });

  it('controles idénticos → tie y confidenceScore ~50', () => {
    const a = makeRecord({ controlId: 'A' });
    const b = makeRecord({ controlId: 'B' }); // mismas series
    const result = compareControls(a, b);
    expect(result.overallFavors).toBe('tie');
    expect(result.confidenceScore).toBe(50);
    expect(result.recommendation.toLowerCase()).toContain('empate');
  });

  it('métricas individuales se computan para ambos lados', () => {
    const a = makeRecord({ controlId: 'A' });
    const b = makeRecord({ controlId: 'B' });
    const result = compareControls(a, b);
    expect(result.metricResults).toHaveLength(6);
    const metrics = result.metricResults.map((m) => m.metric);
    expect(metrics).toContain('incidents_prevented');
    expect(metrics).toContain('near_miss_reduction');
    expect(metrics).toContain('compliance_improvement');
    expect(metrics).toContain('cost_reduction');
    expect(metrics).toContain('time_to_implement');
    expect(metrics).toContain('maintenance_burden');
  });

  it('métrica con menor-es-mejor invierte el favor correctamente', () => {
    const a = makeRecord({
      controlId: 'A',
      monthlyData: makeRecord().monthlyData.map((d) => ({ ...d, maintenanceHours: 1 })),
    });
    const b = makeRecord({
      controlId: 'B',
      monthlyData: makeRecord().monthlyData.map((d) => ({ ...d, maintenanceHours: 50 })),
    });
    const result = compareControls(a, b);
    const m = result.metricResults.find((x) => x.metric === 'maintenance_burden')!;
    expect(m.favors).toBe('A'); // A tiene menos horas → mejor
  });

  it('recommendation cita el ganador', () => {
    const a = makeRecord({ controlId: 'super-A' });
    const b = makeRecord({
      controlId: 'super-B',
      monthlyData: a.monthlyData.map((d) => ({
        ...d,
        incidentsAfter: d.incidentsAfter + 10,
      })),
    });
    const result = compareControls(a, b);
    expect(result.recommendation).toContain('super-A');
  });
});
