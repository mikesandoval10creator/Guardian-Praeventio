// Praeventio Guard — publishSensorEvent tests (TODO.md §16.2.1 wiring).
//
// Thin non-throwing bridge that sensor hooks use to publish readings to the
// singleton bus. It must NEVER break a sensor flow (life-safety: local alarms
// keep working even if the correlation layer misbehaves).

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useSensorBus } from './sensorBus';
import { LOCAL_DEVICE_UID } from './manDownCorrelation';
import { publishSensorEvent } from './publishSensorEvent';

beforeEach(() => {
  useSensorBus.getState().reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('publishSensorEvent', () => {
  it('publishes a reading to the singleton bus with the given identity', () => {
    publishSensorEvent({
      kind: 'gps',
      severity: 'info',
      workerUid: 'w1',
      projectId: 'p1',
      value: 12,
      unit: 'm',
      meta: { lat: -33.45, lng: -70.66 },
    });
    const r = useSensorBus.getState().readings.get('w1::gps');
    expect(r).toBeDefined();
    expect(r?.projectId).toBe('p1');
    expect(r?.severity).toBe('info');
    expect(r?.value).toBe(12);
    expect(r?.unit).toBe('m');
    expect(r?.meta).toEqual({ lat: -33.45, lng: -70.66 });
    expect(r?.readingId).toBeTruthy();
    expect(Number.isFinite(new Date(r!.at).getTime())).toBe(true);
  });

  it('defaults workerUid/projectId to the LOCAL_DEVICE_UID sentinel when no auth context', () => {
    publishSensorEvent({ kind: 'ble_proximity', severity: 'warning' });
    const r = useSensorBus.getState().readings.get(`${LOCAL_DEVICE_UID}::ble_proximity`);
    expect(r).toBeDefined();
    expect(r?.projectId).toBe(LOCAL_DEVICE_UID);
  });

  it('treats explicit null identity the same as missing identity', () => {
    publishSensorEvent({ kind: 'battery', severity: 'critical', workerUid: null, projectId: null });
    expect(
      useSensorBus.getState().readings.get(`${LOCAL_DEVICE_UID}::battery`),
    ).toBeDefined();
  });

  it('generates unique reading ids per publish', () => {
    publishSensorEvent({ kind: 'fall', severity: 'critical', workerUid: 'w1' });
    const first = useSensorBus.getState().readings.get('w1::fall');
    publishSensorEvent({ kind: 'fall', severity: 'critical', workerUid: 'w1' });
    const second = useSensorBus.getState().readings.get('w1::fall');
    expect(first?.readingId).not.toBe(second?.readingId);
  });

  it('never throws even if the bus itself throws (sensor flows must survive)', () => {
    const spy = vi.spyOn(useSensorBus, 'getState').mockImplementation(() => {
      throw new Error('bus corrupted');
    });
    expect(() =>
      publishSensorEvent({ kind: 'gps', severity: 'info', workerUid: 'w1' }),
    ).not.toThrow();
    spy.mockRestore();
  });
});
