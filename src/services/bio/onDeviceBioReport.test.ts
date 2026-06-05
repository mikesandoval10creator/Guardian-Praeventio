import { describe, it, expect } from 'vitest';
import {
  buildOnDeviceBioReport,
  EPP_LABELS_ES,
  type BioMediaPipeMetrics,
} from './onDeviceBioReport';
import type { EppInspectionResult } from '../ai/eppDetectorOnDevice';

const REQUIRED = ['casco', 'chaleco_reflectivo', 'botas'] as const;

const healthyMetrics: BioMediaPipeMetrics = { fatigue: 10, posture: 95, attention: 95 };

function inspection(partial: Partial<EppInspectionResult>): EppInspectionResult {
  return {
    detected: [],
    missing: [],
    lowConfidence: [],
    averageConfidence: 0,
    inferenceTimeMs: 12,
    modelVersion: 'color-heuristic-v1',
    timestamp: '2026-06-05T00:00:00.000Z',
    ...partial,
  };
}

describe('buildOnDeviceBioReport', () => {
  it('flags elevated fatigue above the 70 threshold', () => {
    const report = buildOnDeviceBioReport(
      { ...healthyMetrics, fatigue: 82 },
      inspection({ detected: [{ class: 'casco', confidence: 0.9 }, { class: 'chaleco_reflectivo', confidence: 0.8 }, { class: 'botas', confidence: 0.7 }] }),
      REQUIRED,
    );
    expect(report.alerts.some((a) => /fatiga/i.test(a))).toBe(true);
  });

  it('flags poor posture below the 60 threshold', () => {
    const report = buildOnDeviceBioReport(
      { ...healthyMetrics, posture: 45 },
      inspection({ detected: [{ class: 'casco', confidence: 0.9 }, { class: 'chaleco_reflectivo', confidence: 0.8 }, { class: 'botas', confidence: 0.7 }] }),
      REQUIRED,
    );
    expect(report.alerts.some((a) => /postura/i.test(a))).toBe(true);
  });

  it('flags low attention below the 50 threshold', () => {
    const report = buildOnDeviceBioReport(
      { ...healthyMetrics, attention: 40 },
      inspection({ detected: [{ class: 'casco', confidence: 0.9 }, { class: 'chaleco_reflectivo', confidence: 0.8 }, { class: 'botas', confidence: 0.7 }] }),
      REQUIRED,
    );
    expect(report.alerts.some((a) => /atenci[oó]n/i.test(a))).toBe(true);
  });

  it('maps detected EPP classes to es-CL labels', () => {
    const report = buildOnDeviceBioReport(
      healthyMetrics,
      inspection({ detected: [{ class: 'casco', confidence: 0.9 }] }),
      REQUIRED,
    );
    expect(report.eppDetected).toContain(EPP_LABELS_ES.casco);
  });

  it('reports each missing required EPP as a mapped alert and lowers eppScore', () => {
    const report = buildOnDeviceBioReport(
      healthyMetrics,
      inspection({
        detected: [{ class: 'casco', confidence: 0.9 }],
        missing: ['chaleco_reflectivo', 'botas'],
      }),
      REQUIRED,
    );
    expect(report.eppMissing).toEqual([
      EPP_LABELS_ES.chaleco_reflectivo,
      EPP_LABELS_ES.botas,
    ]);
    // 2 of 3 required missing → ~33%.
    expect(report.eppScore).toBe(33);
    expect(report.alerts.some((a) => a.includes(EPP_LABELS_ES.botas))).toBe(true);
  });

  it('returns a clean report (no alerts, eppScore 100) when all is well', () => {
    const report = buildOnDeviceBioReport(
      healthyMetrics,
      inspection({
        detected: [
          { class: 'casco', confidence: 0.9 },
          { class: 'chaleco_reflectivo', confidence: 0.8 },
          { class: 'botas', confidence: 0.7 },
        ],
        missing: [],
      }),
      REQUIRED,
    );
    expect(report.alerts).toEqual([]);
    expect(report.eppScore).toBe(100);
  });

  it('is honest when the on-device EPP inspection is unavailable', () => {
    const report = buildOnDeviceBioReport(healthyMetrics, null, REQUIRED);
    expect(report.eppDetected).toEqual([]);
    expect(report.eppMissing).toEqual([]);
    expect(report.eppScore).toBe(100);
    expect(report.alerts.some((a) => /no se pudo evaluar el epp/i.test(a))).toBe(true);
  });
});
