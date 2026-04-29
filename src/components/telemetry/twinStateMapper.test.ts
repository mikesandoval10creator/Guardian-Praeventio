import { describe, it, expect } from 'vitest';
import {
  mapIoTEventsToTwinState,
  DEFAULT_WORKERS,
  DEFAULT_MACHINERY,
  type IoTEventLite,
} from './twinStateMapper';

describe('mapIoTEventsToTwinState', () => {
  it('returns the default fleet when no events are provided', () => {
    const { workers, machinery } = mapIoTEventsToTwinState(null);
    expect(workers).toHaveLength(DEFAULT_WORKERS.length);
    expect(machinery).toHaveLength(DEFAULT_MACHINERY.length);
    workers.forEach((w) => expect(w.status).toBe('normal'));
    machinery.forEach((m) => expect(m.status).toBe('normal'));
  });

  it('does not mutate the exported defaults', () => {
    const before = JSON.stringify(DEFAULT_WORKERS);
    mapIoTEventsToTwinState([
      { type: 'wearable', source: 'W-01', metric: 'ritmo', value: 200, status: 'critical' },
    ]);
    expect(JSON.stringify(DEFAULT_WORKERS)).toBe(before);
  });

  it('escalates a worker to warning when a wearable warning arrives', () => {
    const events: IoTEventLite[] = [
      { type: 'wearable', source: 'W-02', metric: 'Ritmo Cardíaco', value: 110, status: 'warning' },
    ];
    const { workers } = mapIoTEventsToTwinState(events);
    expect(workers[2].status).toBe('warning'); // index = 2 % 4 = 2
    expect(workers[2].isFallen).toBeUndefined();
  });

  it('escalates to critical and never downgrades from critical to warning', () => {
    const events: IoTEventLite[] = [
      { type: 'wearable', source: 'W-01', metric: 'Ritmo Cardíaco', value: 180, status: 'critical' },
      { type: 'wearable', source: 'W-01', metric: 'Ritmo Cardíaco', value: 110, status: 'warning' },
    ];
    const { workers } = mapIoTEventsToTwinState(events);
    expect(workers[1].status).toBe('critical');
  });

  it('flags isFallen on caída metric', () => {
    const events: IoTEventLite[] = [
      { type: 'wearable', source: 'W-03', metric: 'Detección de Caída', value: 1, status: 'critical' },
    ];
    const { workers } = mapIoTEventsToTwinState(events);
    expect(workers[3].isFallen).toBe(true);
  });

  it('flags isFallen on extreme heart rate (> 160 with ritmo metric)', () => {
    const events: IoTEventLite[] = [
      { type: 'wearable', source: 'W-01', metric: 'Ritmo Cardíaco', value: 165, status: 'critical' },
    ];
    const { workers } = mapIoTEventsToTwinState(events);
    expect(workers[1].isFallen).toBe(true);
  });

  it('does not flag isFallen when ritmo metric value is ≤160', () => {
    const events: IoTEventLite[] = [
      { type: 'wearable', source: 'W-01', metric: 'Ritmo Cardíaco', value: 160, status: 'critical' },
    ];
    const { workers } = mapIoTEventsToTwinState(events);
    expect(workers[1].isFallen).toBeUndefined();
  });

  it('updates machinery status independently from workers', () => {
    const events: IoTEventLite[] = [
      { type: 'machinery', source: 'M-02', metric: 'Velocidad', value: 80, status: 'critical' },
    ];
    const { workers, machinery } = mapIoTEventsToTwinState(events);
    expect(machinery[0].status).toBe('critical');
    workers.forEach((w) => expect(w.status).toBe('normal'));
  });

  it('falls back to index 0 when source has no digits', () => {
    const events: IoTEventLite[] = [
      { type: 'wearable', source: 'unknown', metric: 'Ritmo', value: 100, status: 'warning' },
    ];
    const { workers } = mapIoTEventsToTwinState(events);
    expect(workers[0].status).toBe('warning');
  });
});
