import { describe, it, expect } from 'vitest';
import {
  detectSilos,
  buildFrictionReport,
  buildClosureTimeReport,
  detectChronicGaps,
  computeOperationalPressure,
} from './organizationalMetrics.js';

describe('detectSilos', () => {
  it('módulo bien conectado → siloScore bajo', () => {
    const r = detectSilos([
      {
        module: 'maintenance',
        outboundEvents: 50,
        inboundEvents: 40,
        expectedPeers: ['prevention'],
        actualPeers: ['prevention'],
      },
    ]);
    expect(r[0].siloScore).toBeLessThanOrEqual(15);
  });

  it('módulo aislado → siloScore alto + missingPeers', () => {
    const r = detectSilos([
      {
        module: 'maintenance',
        outboundEvents: 50,
        inboundEvents: 0,
        expectedPeers: ['prevention', 'audits'],
        actualPeers: [],
      },
    ]);
    expect(r[0].siloScore).toBeGreaterThan(70);
    expect(r[0].missingPeers).toEqual(['prevention', 'audits']);
  });
});

describe('buildFrictionReport', () => {
  it('flujos rápidos → no friction', () => {
    const reports = buildFrictionReport([
      {
        process: 'doc_approval',
        flowId: 'f1',
        startedAt: '2026-05-10T00:00:00Z',
        completedAt: '2026-05-10T12:00:00Z',
        isStuck: false,
      },
      {
        process: 'doc_approval',
        flowId: 'f2',
        startedAt: '2026-05-11T00:00:00Z',
        completedAt: '2026-05-11T20:00:00Z',
        isStuck: false,
      },
    ]);
    const doc = reports.find((r) => r.process === 'doc_approval')!;
    expect(doc.avgCompletionHours).toBeLessThan(doc.slaHours);
    expect(doc.hasFriction).toBe(false);
  });

  it('alto % atascado → hasFriction=true', () => {
    const reports = buildFrictionReport([
      { process: 'action_closure', flowId: 'f1', startedAt: 't1', isStuck: true },
      { process: 'action_closure', flowId: 'f2', startedAt: 't1', isStuck: true },
      { process: 'action_closure', flowId: 'f3', startedAt: 't1', isStuck: false },
    ]);
    expect(reports[0].hasFriction).toBe(true);
    expect(reports[0].stuckPercent).toBeGreaterThan(60);
  });
});

describe('buildClosureTimeReport', () => {
  it('calcula avg / median / p90 por kind', () => {
    const r = buildClosureTimeReport([
      { kind: 'critical_action', openedAt: '2026-05-01T00:00:00Z', closedAt: '2026-05-04T00:00:00Z' }, // 3d
      { kind: 'critical_action', openedAt: '2026-05-01T00:00:00Z', closedAt: '2026-05-06T00:00:00Z' }, // 5d
      { kind: 'critical_action', openedAt: '2026-05-01T00:00:00Z', closedAt: '2026-05-08T00:00:00Z' }, // 7d
    ]);
    expect(r[0].avgDays).toBe(5);
    expect(r[0].medianDays).toBe(5);
  });
});

describe('detectChronicGaps', () => {
  it('3 inspecciones consecutivas con problema → chronic', () => {
    const gaps = detectChronicGaps([
      { location: 'bodega', category: 'orden', inspectionAt: '2026-05-01', foundProblem: true },
      { location: 'bodega', category: 'orden', inspectionAt: '2026-05-08', foundProblem: true },
      { location: 'bodega', category: 'orden', inspectionAt: '2026-05-15', foundProblem: true },
    ]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].consecutiveDetections).toBe(3);
    expect(gaps[0].isChronic).toBe(true);
  });

  it('problema esporádico → no chronic', () => {
    const gaps = detectChronicGaps([
      { location: 'bodega', category: 'orden', inspectionAt: '2026-05-01', foundProblem: true },
      { location: 'bodega', category: 'orden', inspectionAt: '2026-05-08', foundProblem: false },
      { location: 'bodega', category: 'orden', inspectionAt: '2026-05-15', foundProblem: false },
    ]);
    expect(gaps).toHaveLength(0);
  });

  it('alta prevalencia (>70%) aunque no consecutivas → chronic', () => {
    const gaps = detectChronicGaps([
      { location: 'X', category: 'Y', inspectionAt: '2026-05-01', foundProblem: true },
      { location: 'X', category: 'Y', inspectionAt: '2026-05-08', foundProblem: false },
      { location: 'X', category: 'Y', inspectionAt: '2026-05-15', foundProblem: true },
      { location: 'X', category: 'Y', inspectionAt: '2026-05-22', foundProblem: true },
      { location: 'X', category: 'Y', inspectionAt: '2026-05-29', foundProblem: true },
    ]);
    expect(gaps[0].prevalencePercent).toBe(80);
    expect(gaps[0].isChronic).toBe(true);
  });
});

describe('computeOperationalPressure', () => {
  it('faena tranquila → low pressure', () => {
    const r = computeOperationalPressure({
      overdueTasks: 1,
      overtimeHoursWeekTotal: 0,
      minorIncidentsLast7d: 0,
      absenteeismRate: 0.02,
      hasNightShift: false,
      hasAdverseWeather: false,
      totalActiveWorkers: 50,
    });
    expect(r.level).toBe('low');
  });

  it('múltiples factores → high pressure', () => {
    const r = computeOperationalPressure({
      overdueTasks: 12,
      overtimeHoursWeekTotal: 400, // 50 workers × 8h
      minorIncidentsLast7d: 5,
      absenteeismRate: 0.15,
      hasNightShift: true,
      hasAdverseWeather: true,
      totalActiveWorkers: 50,
    });
    expect(r.pressureScore).toBeGreaterThanOrEqual(75);
    expect(r.level).toBe('critical');
    expect(r.topDrivers.length).toBeGreaterThan(3);
  });
});
