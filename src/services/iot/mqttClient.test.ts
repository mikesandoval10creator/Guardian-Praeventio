import { describe, it, expect } from 'vitest';
import {
  onlyAnomaliesFilter,
  sampleRateFilter,
  thresholdFilter,
  type MqttSensorEvent,
} from './mqttClient.js';

function makeEvent(over: Partial<MqttSensorEvent> = {}): MqttSensorEvent {
  return {
    topic: 'test/topic',
    payload: new Uint8Array(),
    payloadText: '',
    payloadJson: null,
    receivedAtMs: 1700000000000,
    qos: 0,
    ...over,
  };
}

describe('onlyAnomaliesFilter', () => {
  it('payload sin JSON: deja pasar (no podemos juzgar status)', () => {
    expect(onlyAnomaliesFilter(makeEvent({ payloadText: 'raw text' }))).toBe(true);
  });

  it('JSON con status="ok": filtrado fuera', () => {
    expect(
      onlyAnomaliesFilter(
        makeEvent({ payloadJson: { status: 'ok', value: 42 } }),
      ),
    ).toBe(false);
  });

  it('JSON con status="warning": deja pasar', () => {
    expect(
      onlyAnomaliesFilter(
        makeEvent({ payloadJson: { status: 'warning', value: 90 } }),
      ),
    ).toBe(true);
  });

  it('JSON con status="OK" mayúsculas: filtrado (case-insensitive)', () => {
    expect(
      onlyAnomaliesFilter(makeEvent({ payloadJson: { status: 'OK' } })),
    ).toBe(false);
  });

  it('JSON sin campo status: deja pasar', () => {
    expect(
      onlyAnomaliesFilter(makeEvent({ payloadJson: { value: 42 } })),
    ).toBe(true);
  });
});

describe('sampleRateFilter', () => {
  it('rate=3: deja pasar 1 de cada 3', () => {
    const filter = sampleRateFilter(3);
    expect(filter(makeEvent())).toBe(false); // 1
    expect(filter(makeEvent())).toBe(false); // 2
    expect(filter(makeEvent())).toBe(true); // 3 → mod=0
    expect(filter(makeEvent())).toBe(false); // 4
    expect(filter(makeEvent())).toBe(false); // 5
    expect(filter(makeEvent())).toBe(true); // 6 → mod=0
  });

  it('rate=1: deja pasar todos', () => {
    const filter = sampleRateFilter(1);
    expect(filter(makeEvent())).toBe(true);
    expect(filter(makeEvent())).toBe(true);
    expect(filter(makeEvent())).toBe(true);
  });

  it('rate=0: tratado como 1 (defensive)', () => {
    const filter = sampleRateFilter(0);
    expect(filter(makeEvent())).toBe(true);
  });
});

describe('thresholdFilter', () => {
  it('gte: deja pasar valor ≥ threshold', () => {
    const filter = thresholdFilter('value', 50, 'gte');
    expect(filter(makeEvent({ payloadJson: { value: 60 } }))).toBe(true);
    expect(filter(makeEvent({ payloadJson: { value: 50 } }))).toBe(true);
    expect(filter(makeEvent({ payloadJson: { value: 49 } }))).toBe(false);
  });

  it('lt: deja pasar valor < threshold', () => {
    const filter = thresholdFilter('value', 50, 'lt');
    expect(filter(makeEvent({ payloadJson: { value: 49 } }))).toBe(true);
    expect(filter(makeEvent({ payloadJson: { value: 50 } }))).toBe(false);
  });

  it('campo ausente: filtrado fuera', () => {
    const filter = thresholdFilter('value', 50, 'gte');
    expect(filter(makeEvent({ payloadJson: { other: 100 } }))).toBe(false);
  });

  it('campo no numérico: filtrado fuera', () => {
    const filter = thresholdFilter('value', 50, 'gte');
    expect(filter(makeEvent({ payloadJson: { value: 'high' } }))).toBe(false);
  });

  it('sin payloadJson: filtrado fuera', () => {
    const filter = thresholdFilter('value', 50, 'gte');
    expect(filter(makeEvent({ payloadJson: null }))).toBe(false);
  });
});
