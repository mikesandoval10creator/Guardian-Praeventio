// Tests para §12.7.4 — IoT failure probability scoring.

import { describe, it, expect } from 'vitest';
import {
  calculateFailureScore,
  calculateFailureScoresBatch,
  getCriticalEquipment,
  type IoTTelemetryWindow,
} from './probabilityFailureScoring';

const lowRiskEquip: IoTTelemetryWindow = {
  equipmentId: 'EXC-001',
  vibrationRMSmms: 1.5, // < ISO zona A
  avgTempC: 30,
  totalOperatingHours: 5_000,
  alertsCriticalCount30d: 0,
  alertsWarningCount30d: 1,
  hoursSinceLastMaintenance: 100,
};

const criticalRiskEquip: IoTTelemetryWindow = {
  equipmentId: 'TRT-007',
  vibrationRMSmms: 12, // > ISO zona D
  avgTempC: 90, // mucho sobre nominal
  totalOperatingHours: 50_000,
  alertsCriticalCount30d: 15, // alta densidad
  alertsWarningCount30d: 10,
  hoursSinceLastMaintenance: 3_000, // overdue
};

describe('calculateFailureScore', () => {
  it('equipo en perfecto estado → score bajo', () => {
    const result = calculateFailureScore(lowRiskEquip);
    expect(result.failureScore).toBeLessThan(20);
    expect(result.riskCategory).toBe('low');
    expect(result.shouldDrawRedEdge).toBe(false);
  });

  it('equipo crítico → score alto + roja edge', () => {
    const result = calculateFailureScore(criticalRiskEquip);
    expect(result.failureScore).toBeGreaterThan(70);
    expect(result.riskCategory).toBe('critical');
    expect(result.shouldDrawRedEdge).toBe(true);
    expect(result.recommendation).toContain('INMEDIATO');
  });

  it('descompone components correctamente', () => {
    const result = calculateFailureScore(criticalRiskEquip);
    expect(result.components.vibration).toBe(100); // 12 > zone D max → clamped 100
    expect(result.components.temperature).toBeGreaterThan(0);
    expect(result.components.hours).toBeGreaterThan(0);
    expect(result.components.alertDensity).toBe(100);
  });

  it('medium category 30-50', () => {
    const med: IoTTelemetryWindow = {
      equipmentId: 'GR-003',
      vibrationRMSmms: 5,
      avgTempC: 50,
      totalOperatingHours: 20_000,
      alertsCriticalCount30d: 2,
      alertsWarningCount30d: 5,
      hoursSinceLastMaintenance: 800,
    };
    const result = calculateFailureScore(med);
    expect(result.failureScore).toBeGreaterThanOrEqual(30);
    expect(result.failureScore).toBeLessThan(50);
    expect(result.riskCategory).toBe('medium');
  });

  it('high category 50-70', () => {
    const high: IoTTelemetryWindow = {
      equipmentId: 'GR-004',
      vibrationRMSmms: 6,
      avgTempC: 60,
      totalOperatingHours: 35_000,
      alertsCriticalCount30d: 5,
      alertsWarningCount30d: 5,
      hoursSinceLastMaintenance: 1_200,
    };
    const result = calculateFailureScore(high);
    expect(result.failureScore).toBeGreaterThanOrEqual(50);
    expect(result.failureScore).toBeLessThan(70);
    expect(result.riskCategory).toBe('high');
  });

  it('clamp [0,1] previene overflow vibración', () => {
    const overflow: IoTTelemetryWindow = {
      ...criticalRiskEquip,
      vibrationRMSmms: 1000, // outlier extremo
    };
    const result = calculateFailureScore(overflow);
    expect(result.components.vibration).toBe(100); // clamped
    expect(result.failureScore).toBeLessThanOrEqual(100);
  });

  it('determinístico: mismas entradas → mismas salidas', () => {
    const a = calculateFailureScore(criticalRiskEquip);
    const b = calculateFailureScore(criticalRiskEquip);
    expect(a).toEqual(b);
  });
});

describe('calculateFailureScoresBatch', () => {
  it('ordena por score descendente', () => {
    const results = calculateFailureScoresBatch([lowRiskEquip, criticalRiskEquip]);
    expect(results[0]!.equipmentId).toBe('TRT-007'); // critical primero
    expect(results[1]!.equipmentId).toBe('EXC-001');
  });

  it('array vacío → vacío', () => {
    expect(calculateFailureScoresBatch([])).toEqual([]);
  });
});

describe('getCriticalEquipment', () => {
  it('filtra solo categoría critical', () => {
    const result = getCriticalEquipment([lowRiskEquip, criticalRiskEquip]);
    expect(result).toHaveLength(1);
    expect(result[0]!.equipmentId).toBe('TRT-007');
  });

  it('sin equipos críticos → array vacío', () => {
    const result = getCriticalEquipment([lowRiskEquip]);
    expect(result).toEqual([]);
  });
});
