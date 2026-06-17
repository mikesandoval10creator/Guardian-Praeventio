import { describe, it, expect } from 'vitest';
import { selectGasReadings } from './gasReadings';
import { evaluateGasTelemetry } from '../../services/workPermits/gasGate';
import type { IoTEvent } from './IoTEventsFeed';

const NOW = 1_700_000_000_000;

function ev(over: Partial<IoTEvent>): IoTEvent {
  return {
    id: 'e',
    type: 'machinery',
    source: 'SENSOR-1',
    metric: 'temperature',
    value: 20,
    unit: '°C',
    timestamp: NOW,
    status: 'normal',
    ...over,
  };
}

describe('selectGasReadings', () => {
  it('returns [] for nullish input', () => {
    expect(selectGasReadings(null)).toEqual([]);
    expect(selectGasReadings(undefined)).toEqual([]);
  });

  it('maps metric/value/unit/source and converts the timestamp to ms', () => {
    const out = selectGasReadings([ev({ metric: 'o2_pct', value: 20.9, unit: '%', timestamp: NOW })]);
    expect(out).toEqual([
      { metric: 'o2_pct', value: 20.9, unit: '%', timestampMs: NOW, source: 'SENSOR-1' },
    ]);
  });

  it('drops events whose timestamp cannot be parsed', () => {
    const out = selectGasReadings([
      ev({ metric: 'o2_pct', timestamp: 'garbage' }),
      ev({ metric: 'lel_pct', timestamp: NOW }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].metric).toBe('lel_pct');
  });

  it('feeds evaluateGasTelemetry correctly: low O2 -> blocking recommendation', () => {
    const readings = selectGasReadings([ev({ metric: 'o2_pct', value: 18, timestamp: NOW })]);
    const result = evaluateGasTelemetry(readings, NOW);
    expect(result.freshReadingCount).toBe(1);
    expect(result.blocked).toBe(true);
    expect(result.reasons.some(r => r.code === 'GAS_OXYGEN_LOW')).toBe(true);
  });

  it('feeds evaluateGasTelemetry: a normal atmosphere is not blocked', () => {
    const readings = selectGasReadings([
      ev({ metric: 'o2_pct', value: 20.9, timestamp: NOW }),
      ev({ metric: 'lel_pct', value: 0, timestamp: NOW }),
    ]);
    const result = evaluateGasTelemetry(readings, NOW);
    expect(result.freshReadingCount).toBe(2);
    expect(result.blocked).toBe(false);
    expect(result.reasons).toEqual([]);
  });

  it('non-gas metrics produce no fresh gas readings (note returned)', () => {
    const readings = selectGasReadings([
      ev({ metric: 'temperature', value: 30, timestamp: NOW }),
      ev({ metric: 'Frecuencia cardíaca', value: 80, timestamp: NOW }),
    ]);
    const result = evaluateGasTelemetry(readings, NOW);
    expect(result.freshReadingCount).toBe(0);
    expect(result.note).toBeTruthy();
  });

  it('stale gas readings (>15 min) are ignored by the engine', () => {
    const readings = selectGasReadings([
      ev({ metric: 'lel_pct', value: 12, timestamp: NOW - 16 * 60_000 }),
    ]);
    const result = evaluateGasTelemetry(readings, NOW);
    expect(result.freshReadingCount).toBe(0);
    expect(result.blocked).toBe(false);
  });
});
