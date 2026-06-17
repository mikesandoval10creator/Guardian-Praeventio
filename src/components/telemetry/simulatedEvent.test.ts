import { describe, it, expect } from 'vitest';
import { buildSimulatedIoTEvent } from './simulatedEvent';

const NOW = 1_700_000_000_000;

describe('buildSimulatedIoTEvent (maps the REAL Gemini schema fields)', () => {
  it('uses deviceId as the source (not the non-existent `source` field)', () => {
    const ev = buildSimulatedIoTEvent(
      { deviceId: 'SENSOR-TEMP-01', type: 'temperature', value: 22, unit: '°C', status: 'normal', message: 'ok' },
      'sim-1',
      NOW,
    );
    expect(ev.source).toBe('SENSOR-TEMP-01');
    expect(ev.metric).toBe('Temperatura');
    expect(ev.value).toBe(22);
    expect(ev.unit).toBe('°C');
  });

  it('classifies biometric as wearable, everything else as machinery', () => {
    expect(buildSimulatedIoTEvent({ type: 'biometric' }, 'a', NOW).type).toBe('wearable');
    expect(buildSimulatedIoTEvent({ type: 'gas' }, 'b', NOW).type).toBe('machinery');
    expect(buildSimulatedIoTEvent({ type: 'temperature' }, 'c', NOW).type).toBe('machinery');
    // The schema never emits 'wearable'; if it somehow did, it is NOT biometric -> machinery.
    expect(buildSimulatedIoTEvent({ type: 'wearable' }, 'd', NOW).type).toBe('machinery');
  });

  it('labels each known sensor type with a Spanish metric', () => {
    expect(buildSimulatedIoTEvent({ type: 'gas' }, 'a', NOW).metric).toBe('Concentración de gas');
    expect(buildSimulatedIoTEvent({ type: 'noise' }, 'b', NOW).metric).toBe('Nivel de ruido');
    expect(buildSimulatedIoTEvent({ type: 'vibration' }, 'c', NOW).metric).toBe('Vibración');
    expect(buildSimulatedIoTEvent({ type: 'biometric' }, 'd', NOW).metric).toBe('Frecuencia cardíaca');
  });

  it('falls back to the message, then "Lectura", for an unknown sensor type', () => {
    expect(buildSimulatedIoTEvent({ type: 'mystery', message: 'Evento raro' }, 'a', NOW).metric).toBe('Evento raro');
    expect(buildSimulatedIoTEvent({ type: 'mystery' }, 'b', NOW).metric).toBe('Lectura');
  });

  it('always marks the event simulated and stamps the provided id/timestamp', () => {
    const ev = buildSimulatedIoTEvent({ type: 'gas', status: 'critical' }, 'sim-xyz', NOW);
    expect(ev.simulated).toBe(true);
    expect(ev.id).toBe('sim-xyz');
    expect(ev.timestamp).toBe(NOW);
    expect(ev.status).toBe('critical');
  });

  it('clamps an invalid status to normal and a non-numeric value to 0', () => {
    const ev = buildSimulatedIoTEvent({ type: 'gas', status: 'EXPLODING', value: 'lots' }, 'a', NOW);
    expect(ev.status).toBe('normal');
    expect(ev.value).toBe(0);
  });

  it('tolerates a null / non-object response without throwing', () => {
    const ev = buildSimulatedIoTEvent(null, 'a', NOW);
    expect(ev).toMatchObject({ id: 'a', source: 'Sensor simulado', metric: 'Lectura', value: 0, simulated: true });
  });
});
