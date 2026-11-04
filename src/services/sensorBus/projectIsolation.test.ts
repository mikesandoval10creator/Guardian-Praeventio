import { describe, expect, it } from 'vitest';
import { createSensorBus, type SensorReading } from './sensorBus';
import { evaluateManDownEvidence, LOCAL_DEVICE_UID } from './manDownCorrelation';

const now = new Date('2026-11-04T12:00:00Z');
function reading(kind: SensorReading['kind'], projectId: string): SensorReading {
  return { readingId: `${projectId}-${kind}`, kind, projectId, workerUid: 'worker', severity: 'critical', at: now.toISOString() };
}

describe('sensor bus project isolation', () => {
  it.each([
    ['heart_rate', 'gas'], ['wbgt', 'inactivity'], ['noise', 'heart_rate'],
  ] as const)('keeps %s / %s correlation inside one project', (first, second) => {
    const bus = createSensorBus();
    bus.getState().publishReading(reading(first, 'A'), now);
    expect(bus.getState().publishReading(reading(second, 'B'), now)).toEqual([]);
    const alerts = bus.getState().publishReading(reading(first, 'B'), now);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.triggeringReadings.every((r) => r.projectId === 'B')).toBe(true);
  });

  it('retains both project readings without overwriting valid evidence', () => {
    const bus = createSensorBus();
    bus.getState().publishReading(reading('fall', 'B'), now);
    bus.getState().publishReading(reading('fall', 'A'), now);
    bus.getState().publishReading(reading('inactivity', 'B'), now);
    const alerts = bus.getState().publishReading(reading('ble_proximity', 'B'), now);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.triggeringReadings.map((r) => r.projectId)).toEqual(['B', 'B', 'B']);
    expect(bus.getState().readings.size).toBe(4);
  });

  it('tuple keys preserve separator-containing and Unicode identifiers', () => {
    const bus = createSensorBus({ rules: [] });
    bus.getState().publishReading({ ...reading('fall', 'a::b'), workerUid: 'c雪' }, now);
    bus.getState().publishReading({ ...reading('fall', 'a'), workerUid: 'b::c雪' }, now);
    expect(bus.getState().readings.size).toBe(2);
  });

  it.each([null, '', LOCAL_DEVICE_UID])('does not infer a project for explicit %s scope', (projectId) => {
    const events = [reading('fall', 'B'), reading('inactivity', 'B'), reading('ble_proximity', 'B')];
    expect(evaluateManDownEvidence(events, now, { workerUid: 'worker', projectId })).toEqual({ level: 'none', reasons: [] });
  });

  it.each(['fall', 'inactivity'] as const)('never treats unscoped device %s as project-bound evidence', (kind) => {
    const events = [reading('fall', 'B'), reading('inactivity', 'B'), reading('ble_proximity', 'B')]
      .map((r) => r.kind === kind ? { ...r, projectId: LOCAL_DEVICE_UID, workerUid: LOCAL_DEVICE_UID } : r);
    expect(evaluateManDownEvidence(events, now, { workerUid: 'worker', projectId: 'B' }).level).not.toBe('critical');
  });

  it('a named foreign project is never device-wide corroboration', () => {
    const events = [reading('fall', 'B'), reading('inactivity', 'B'), {
      ...reading('ble_proximity', 'A'), workerUid: LOCAL_DEVICE_UID,
    }];
    expect(evaluateManDownEvidence(events, now, { workerUid: 'worker', projectId: 'B' }).level).toBe('suspect');
  });

  it('legacy unscoped evaluation fails closed on multiple projects', () => {
    expect(evaluateManDownEvidence([
      reading('fall', 'A'), reading('inactivity', 'B'), reading('ble_proximity', 'B'),
    ], now, { workerUid: 'worker' })).toEqual({ level: 'none', reasons: [] });
  });

  it('does not suppress a legitimate same-timestamp alert in a second project', () => {
    const bus = createSensorBus();
    expect(bus.getState().publishReading(reading('lone_worker_panic', 'A'), now)).toHaveLength(1);
    expect(bus.getState().publishReading(reading('lone_worker_panic', 'B'), now)).toHaveLength(1);
    expect(bus.getState().pendingAlerts).toHaveLength(2);
  });

  it.each(['ble_proximity', 'battery'] as const)('allows local device %s only as corroboration of project-bound impact and immobility', (kind) => {
    const events = [reading('fall', 'B'), reading('inactivity', 'B'), {
      ...reading(kind, LOCAL_DEVICE_UID), workerUid: LOCAL_DEVICE_UID,
    }];
    expect(evaluateManDownEvidence(events, now, { workerUid: 'worker', projectId: 'B' }).level).toBe('critical');
  });
  it('the pure evaluator rejects foreign-project impact evidence', () => {
    expect(evaluateManDownEvidence([
      reading('fall', 'A'), reading('inactivity', 'B'), reading('ble_proximity', 'B'),
    ], now, { workerUid: 'worker', projectId: 'B' })).toEqual({ level: 'none', reasons: [] });
  });
  it('does not combine an impact in A with immobility and BLE loss in B', () => {
    const bus = createSensorBus();
    bus.getState().publishReading(reading('fall', 'A'), now);
    bus.getState().publishReading(reading('inactivity', 'B'), now);
    expect(bus.getState().publishReading(reading('ble_proximity', 'B'), now)).toEqual([]);
    expect(bus.getState().pendingAlerts).toEqual([]);
  });
});
