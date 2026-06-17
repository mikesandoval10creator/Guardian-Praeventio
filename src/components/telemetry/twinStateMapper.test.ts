import { describe, it, expect } from 'vitest';
import {
  mapIoTEventsToTwinState,
  type IoTEventLite,
} from './twinStateMapper';

function wearable(over: Partial<IoTEventLite> = {}): IoTEventLite {
  return { type: 'wearable', source: 'W-01', metric: 'ritmo', value: 80, status: 'normal', ...over };
}

describe('mapIoTEventsToTwinState — honest twin (no fabricated roster)', () => {
  it('returns EMPTY arrays when there are no events (no phantom fleet)', () => {
    expect(mapIoTEventsToTwinState(null)).toEqual({ workers: [], machinery: [] });
    expect(mapIoTEventsToTwinState([])).toEqual({ workers: [], machinery: [] });
  });

  it('creates exactly one worker per distinct real wearable source', () => {
    const { workers } = mapIoTEventsToTwinState([
      wearable({ source: 'W-07', status: 'warning' }),
      wearable({ source: 'W-09', status: 'normal' }),
      wearable({ source: 'W-07', status: 'normal' }), // same source → deduped
    ]);
    expect(workers.map((w) => w.id)).toEqual(['W-07', 'W-09']);
    expect(workers[0].status).toBe('warning'); // escalated, not downgraded by the later normal
  });

  it('escalates to critical and never downgrades from critical to warning', () => {
    const { workers } = mapIoTEventsToTwinState([
      wearable({ source: 'W-02', status: 'critical' }),
      wearable({ source: 'W-02', status: 'warning' }),
    ]);
    expect(workers).toHaveLength(1);
    expect(workers[0].status).toBe('critical');
  });

  it('flags isFallen on a caída metric', () => {
    const { workers } = mapIoTEventsToTwinState([
      wearable({ source: 'W-03', metric: 'caída detectada', status: 'critical' }),
    ]);
    expect(workers[0].isFallen).toBe(true);
  });

  it('flags isFallen on extreme heart rate (ritmo > 160) and not at ≤160', () => {
    const hi = mapIoTEventsToTwinState([
      wearable({ source: 'A', metric: 'ritmo', value: 175, status: 'critical' }),
    ]);
    expect(hi.workers[0].isFallen).toBe(true);
    const lo = mapIoTEventsToTwinState([
      wearable({ source: 'B', metric: 'ritmo', value: 150, status: 'warning' }),
    ]);
    expect(lo.workers[0].isFallen).toBeUndefined();
  });

  it('flags isFallen even when the caída event carries a non-critical status after a higher-severity event (life-safety: fall must never be gated by the status guard)', () => {
    const { workers } = mapIoTEventsToTwinState([
      wearable({ source: 'W-05', metric: 'temperatura', status: 'critical' }), // escalates first
      wearable({ source: 'W-05', metric: 'caída detectada', value: 1, status: 'normal' }), // fall reported as 'normal'
    ]);
    expect(workers).toHaveLength(1);
    expect(workers[0].status).toBe('critical'); // not downgraded
    expect(workers[0].isFallen).toBe(true); // fall still detected
  });

  it('creates machinery only from real machinery sources (type neutral, never a fabricated crane)', () => {
    const { workers, machinery } = mapIoTEventsToTwinState([
      { type: 'machinery', source: 'M-42', metric: 'temp', value: 90, status: 'warning' },
    ]);
    expect(workers).toEqual([]); // a machinery event must not invent a worker
    expect(machinery).toHaveLength(1);
    expect(machinery[0].id).toBe('M-42');
    expect(machinery[0].type).toBe('truck');
    expect(machinery[0].status).toBe('warning');
  });

  it('does not place an entity that no real event references (no default roster leak)', () => {
    const { workers, machinery } = mapIoTEventsToTwinState([
      wearable({ source: 'ONLY-ONE', status: 'normal' }),
    ]);
    expect(workers).toHaveLength(1);
    expect(machinery).toHaveLength(0);
  });
});
