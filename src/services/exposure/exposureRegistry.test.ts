import { describe, it, expect } from 'vitest';
import {
  compareToLimit,
  buildExposureMap,
  REGULATORY_LIMITS,
  type ExposureMeasurement,
} from './exposureRegistry.js';

function m(over: Partial<ExposureMeasurement> = {}): ExposureMeasurement {
  return {
    id: 'em-1',
    workerUid: 'worker-1',
    agent: 'noise',
    value: 90,
    unit: 'dB(A)',
    location: 'Sector A',
    durationHours: 8,
    takenAt: '2026-05-01T10:00:00Z',
    measuredByUid: 'tech-1',
    ...over,
  };
}

describe('compareToLimit', () => {
  it('ruido 90 dB(A) excede 85 → warning con %', () => {
    const v = compareToLimit(m({ value: 90, agent: 'noise' }));
    expect(v).not.toBeNull();
    expect(v!.severity).toBe('warning');
    expect(v!.excessPercent).toBe(6); // (90-85)/85 = 5.88 → 6
  });

  it('ruido 130 dB(A) excede 50%+ → critical', () => {
    const v = compareToLimit(m({ value: 130, agent: 'noise' }));
    expect(v!.severity).toBe('critical');
  });

  it('ruido 84 dB(A) bajo límite → null', () => {
    expect(compareToLimit(m({ value: 84 }))).toBeNull();
  });

  it('sílice 0.05 mg/m³ excede 0.025 → critical (100% excess)', () => {
    const v = compareToLimit(m({ agent: 'silica', value: 0.05 }));
    expect(v).not.toBeNull();
    expect(v!.severity).toBe('critical');
  });

  it('chemical (limit=0) NO compara → null sin error', () => {
    const v = compareToLimit(m({ agent: 'chemical', value: 999 }));
    expect(v).toBeNull();
  });

  it('cita norma DS 594 en violation', () => {
    const v = compareToLimit(m({ value: 90, agent: 'noise' }));
    expect(v!.norm).toContain('DS 594');
  });
});

describe('REGULATORY_LIMITS', () => {
  it('cubre los 9 agentes', () => {
    const agents = Object.keys(REGULATORY_LIMITS);
    expect(agents).toEqual(
      expect.arrayContaining([
        'noise', 'silica', 'dust', 'heat', 'cold', 'vibration',
        'uv_radiation', 'chemical', 'biohazard',
      ]),
    );
  });

  it('cada límite cita norma', () => {
    for (const limit of Object.values(REGULATORY_LIMITS)) {
      expect(limit.norm.length).toBeGreaterThan(5);
    }
  });
});

describe('buildExposureMap', () => {
  it('agrupa mediciones por worker × agent', () => {
    const measurements = [
      m({ id: '1', workerUid: 'w1', agent: 'noise', value: 88, takenAt: '2026-05-01' }),
      m({ id: '2', workerUid: 'w1', agent: 'noise', value: 90, takenAt: '2026-05-05' }),
      m({ id: '3', workerUid: 'w1', agent: 'silica', value: 0.01, takenAt: '2026-05-03' }),
      m({ id: '4', workerUid: 'w2', agent: 'noise', value: 85, takenAt: '2026-05-02' }),
    ];
    const map = buildExposureMap(measurements);
    expect(map).toHaveLength(2);
    const w1 = map.find((x) => x.workerUid === 'w1')!;
    expect(w1.agents).toHaveLength(2);
    const w1Noise = w1.agents.find((a) => a.agent === 'noise')!;
    expect(w1Noise.measurementCount).toBe(2);
    expect(w1Noise.lastValue).toBe(90); // 2026-05-05 es más reciente
  });

  it('lista vacía → []', () => {
    expect(buildExposureMap([])).toEqual([]);
  });
});
