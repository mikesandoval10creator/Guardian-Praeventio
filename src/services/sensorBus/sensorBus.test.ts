// Praeventio Guard — sensorBus unit tests (TODO.md §12.2.1).

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createSensorBus,
  STALE_THRESHOLD_MS,
  type SensorReading,
  type CorrelationRule,
} from './sensorBus';

const T0 = new Date('2026-01-01T12:00:00Z');

function ts(offsetMs: number): string {
  return new Date(T0.getTime() + offsetMs).toISOString();
}

function reading(overrides: Partial<SensorReading>): SensorReading {
  return {
    readingId: 'r-' + Math.random().toString(36).slice(2),
    kind: 'fall',
    workerUid: 'worker-1',
    projectId: 'proj-1',
    severity: 'warning',
    at: ts(0),
    ...overrides,
  } as SensorReading;
}

describe('sensorBus — DEFAULT_CORRELATION_RULES', () => {
  let bus: ReturnType<typeof createSensorBus>;

  beforeEach(() => {
    bus = createSensorBus();
  });

  it('publishReading sin correlación no genera alerts', () => {
    const alerts = bus.getState().publishReading(reading({ kind: 'heart_rate' }));
    expect(alerts).toHaveLength(0);
    expect(bus.getState().pendingAlerts).toHaveLength(0);
  });

  it('fall+inactivity+ble-off dispara urgent', () => {
    const { publishReading } = bus.getState();
    publishReading(reading({ kind: 'fall', severity: 'critical', at: ts(0) }), new Date(T0.getTime()));
    publishReading(
      reading({ kind: 'inactivity', severity: 'warning', at: ts(10_000) }),
      new Date(T0.getTime() + 10_000),
    );
    const alerts = publishReading(
      reading({ kind: 'ble_proximity', severity: 'warning', at: ts(20_000) }),
      new Date(T0.getTime() + 20_000),
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].ruleId).toBe('fall+inactivity+ble-off');
    expect(alerts[0].escalation).toBe('urgent');
    expect(alerts[0].triggeringReadings).toHaveLength(3);
  });

  it('NO dispara fall+inactivity+ble-off si BLE está info (conectado OK)', () => {
    const { publishReading } = bus.getState();
    publishReading(reading({ kind: 'fall', severity: 'critical' }), new Date(T0.getTime()));
    publishReading(reading({ kind: 'inactivity', severity: 'warning', at: ts(5_000) }), new Date(T0.getTime() + 5_000));
    const alerts = publishReading(
      reading({ kind: 'ble_proximity', severity: 'info', at: ts(10_000) }),
      new Date(T0.getTime() + 10_000),
    );
    expect(alerts).toHaveLength(0);
  });

  it('hr-anomaly+gas-high dispara urgent (intoxicación)', () => {
    const { publishReading } = bus.getState();
    publishReading(
      reading({ kind: 'heart_rate', severity: 'critical', value: 145 }),
      new Date(T0.getTime()),
    );
    const alerts = publishReading(
      reading({ kind: 'gas', severity: 'warning', value: 50, unit: 'ppm', at: ts(5_000) }),
      new Date(T0.getTime() + 5_000),
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].ruleId).toBe('hr-anomaly+gas-high');
    expect(alerts[0].recommendation).toMatch(/intoxicación|evacuar/i);
  });

  it('wbgt-high+inactivity dispara recommend (no urgent)', () => {
    const { publishReading } = bus.getState();
    publishReading(reading({ kind: 'wbgt', severity: 'warning', value: 32 }), new Date(T0.getTime()));
    const alerts = publishReading(
      reading({ kind: 'inactivity', severity: 'warning', at: ts(60_000) }),
      new Date(T0.getTime() + 60_000),
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].escalation).toBe('recommend');
  });

  it('lone-worker-panic dispara urgent sin necesidad de otra señal', () => {
    const { publishReading } = bus.getState();
    const alerts = publishReading(reading({ kind: 'lone_worker_panic', severity: 'critical' }));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].ruleId).toBe('lone-worker-panic');
    expect(alerts[0].escalation).toBe('urgent');
  });

  it('alerts son idempotentes — no se duplican con mismo ruleId+worker+timestamp', () => {
    const { publishReading } = bus.getState();
    publishReading(reading({ kind: 'fall', severity: 'critical' }), T0);
    publishReading(reading({ kind: 'inactivity', severity: 'warning', at: ts(5_000) }), new Date(T0.getTime() + 5_000));
    const r = reading({ kind: 'ble_proximity', severity: 'warning', at: ts(10_000) });
    const first = publishReading(r, new Date(T0.getTime() + 10_000));
    const second = publishReading(r, new Date(T0.getTime() + 10_000));
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0); // mismo timestamp = mismo alertId
    expect(bus.getState().pendingAlerts).toHaveLength(1);
  });

  it('acknowledgeAlert remueve de pendingAlerts', () => {
    const { publishReading, acknowledgeAlert } = bus.getState();
    const alerts = publishReading(reading({ kind: 'lone_worker_panic', severity: 'critical' }));
    expect(bus.getState().pendingAlerts).toHaveLength(1);
    acknowledgeAlert(alerts[0].alertId);
    expect(bus.getState().pendingAlerts).toHaveLength(0);
  });

  it('clearStaleReadings elimina readings fuera de la ventana', () => {
    const { publishReading, clearStaleReadings } = bus.getState();
    publishReading(reading({ kind: 'heart_rate', at: ts(0) }), T0);
    publishReading(reading({ kind: 'gas', at: ts(0) }), T0);
    // Now +90s — todos stale.
    const removed = clearStaleReadings(new Date(T0.getTime() + 90_000));
    expect(removed).toBe(2);
    expect(bus.getState().readings.size).toBe(0);
  });

  it('totalAlertsEmitted contador acumula', () => {
    const { publishReading } = bus.getState();
    publishReading(reading({ kind: 'lone_worker_panic', severity: 'critical', workerUid: 'a' }));
    publishReading(reading({ kind: 'lone_worker_panic', severity: 'critical', workerUid: 'b' }));
    expect(bus.getState().totalAlertsEmitted).toBe(2);
  });

  it('reset limpia todo el estado', () => {
    const { publishReading, reset } = bus.getState();
    publishReading(reading({ kind: 'lone_worker_panic', severity: 'critical' }));
    reset();
    expect(bus.getState().readings.size).toBe(0);
    expect(bus.getState().pendingAlerts).toHaveLength(0);
    expect(bus.getState().totalAlertsEmitted).toBe(0);
  });
});

describe('sensorBus — custom rules', () => {
  it('soporta rule injection para use cases verticales', () => {
    const customRule: CorrelationRule = {
      id: 'oxygen-critical-low',
      description: 'O₂ < 19.5% → urgent (espacio confinado)',
      match: (_r, neu) => {
        if (neu.kind !== 'oxygen' || typeof neu.value !== 'number') return null;
        if (neu.value >= 19.5) return null;
        return {
          ruleId: 'oxygen-critical-low',
          triggeringReadings: [neu],
          workerUid: neu.workerUid,
          projectId: neu.projectId,
          recommendation: `O₂ ${neu.value}% — evacuar inmediatamente.`,
          escalation: 'urgent',
        };
      },
    };
    const bus = createSensorBus({ rules: [customRule] });
    const alerts = bus.getState().publishReading(
      reading({ kind: 'oxygen', value: 18.2, severity: 'critical' }),
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].recommendation).toContain('18.2%');
  });

  it('sensor sin rule asociada no produce alerts', () => {
    const bus = createSensorBus({ rules: [] });
    const alerts = bus.getState().publishReading(reading({ kind: 'fall', severity: 'critical' }));
    expect(alerts).toHaveLength(0);
  });
});

describe('sensorBus — stale readings no triggerean correlación', () => {
  it('si fall pasa más de 60s, no correlaciona con inactivity nueva', () => {
    const bus = createSensorBus();
    const { publishReading } = bus.getState();
    publishReading(reading({ kind: 'fall', severity: 'critical', at: ts(0) }), T0);
    // 70 segundos después → fall ya stale, no triggerea fall+inactivity+ble.
    const later = new Date(T0.getTime() + 70_000);
    publishReading(reading({ kind: 'inactivity', severity: 'warning', at: ts(65_000) }), later);
    const alerts = publishReading(
      reading({ kind: 'ble_proximity', severity: 'warning', at: ts(70_000) }),
      later,
    );
    expect(alerts).toHaveLength(0);
    void STALE_THRESHOLD_MS;
  });
});
