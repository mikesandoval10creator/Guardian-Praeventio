// Praeventio Guard — deduplicación idempotente del rail MQTT (tarea P1).
//
// QoS 1 permite redelivery: el broker puede entregar el MISMO mensaje dos
// veces (p.ej. tras reconexión sin ACK). Sin identidad estable, una
// repetición crea 2 filas de telemetría, 2 alertas, 2 auditorías y 2 FCM.
// Este módulo provee:
//   - deriveStableEventId: identidad estable por muestra (eventId del
//     dispositivo si viene, si no hash determinístico deviceId|metric|
//     timestamp|value).
//   - InMemoryDeduplicator: ventana TTL de IDs vistos (isDuplicate/remember).

import { describe, it, expect } from 'vitest';
import {
  deriveStableEventId,
  InMemoryDeduplicator,
  EVENT_ID_RE,
  DEFAULT_DEDUP_TTL_MS,
} from './deduplicator';
import type { TelemetrySample } from './types';

const baseSample: TelemetrySample = {
  deviceId: 'dev-001',
  metric: 'o2',
  value: 19.5,
  unit: '%',
  timestamp: 1754330000000,
  kind: 'environment',
};

describe('deriveStableEventId', () => {
  it('usa el eventId del dispositivo cuando es válido (firmado por device)', () => {
    const id = deriveStableEventId(baseSample, 'evt-42');
    expect(id).toBe('dev:evt-42');
  });

  it('ignora un eventId malformado y deriva uno determinístico', () => {
    const id = deriveStableEventId(baseSample, 'mal formado con espacios!!');
    expect(id.startsWith('derived:')).toBe(true);
  });

  it('deriva el MISMO id para la misma muestra (determinístico)', () => {
    const a = deriveStableEventId(baseSample, null);
    const b = deriveStableEventId({ ...baseSample }, null);
    expect(a).toBe(b);
  });

  it('deriva ids DISTINTOS cuando cambia valor o timestamp', () => {
    const a = deriveStableEventId(baseSample, null);
    const b = deriveStableEventId({ ...baseSample, value: 19.6 }, null);
    const c = deriveStableEventId(
      { ...baseSample, timestamp: baseSample.timestamp + 1000 },
      null,
    );
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it('el id derivado es seguro para doc id de Firestore', () => {
    const id = deriveStableEventId(baseSample, null);
    expect(EVENT_ID_RE.test(id)).toBe(true);
  });
});

describe('InMemoryDeduplicator', () => {
  it('no reporta duplicado la primera vez, sí la segunda dentro de la ventana', () => {
    const dedup = new InMemoryDeduplicator(DEFAULT_DEDUP_TTL_MS);
    expect(dedup.isDuplicate('a')).toBe(false);
    dedup.remember('a');
    expect(dedup.isDuplicate('a')).toBe(true);
  });

  it('olvida el id cuando expira la ventana (TTL)', () => {
    let now = 1_000_000;
    const dedup = new InMemoryDeduplicator(5_000, () => now);
    dedup.remember('a');
    now += 4_999;
    expect(dedup.isDuplicate('a')).toBe(true);
    now += 2;
    expect(dedup.isDuplicate('a')).toBe(false);
  });

  it('sweep limpia ids expirados (sin crecimiento infinito)', () => {
    let now = 1_000_000;
    const dedup = new InMemoryDeduplicator(5_000, () => now);
    for (let i = 0; i < 100; i += 1) dedup.remember(`id-${i}`);
    now += 10_000;
    dedup.remember('fresh');
    expect(dedup.size).toBeLessThan(100);
  });
});
