// Praeventio Guard — deduplicación idempotente del rail MQTT (tarea P1).
//
// QoS 1 permite redelivery: el broker puede entregar el MISMO mensaje dos
// veces (p.ej. tras reconexión sin ACK). Sin identidad estable, una
// repetición crea 2 filas de telemetría, 2 alertas, 2 auditorías y 2 FCM.
//
// Estrategia (spec Notion):
//   1. Identidad estable: `eventId` del dispositivo si viene firmado en el
//      payload; si no, ID determinístico derivado de
//      (deviceId|metric|timestamp|value) — la misma muestra SIEMPRE
//      produce el mismo ID.
//   2. Ventana de deduplicación: `InMemoryDeduplicator` con TTL cubre el
//      redelivery de QoS 1 (segundos/minutos), no lecturas legítimas
//      posteriores de la misma métrica.
//   3. Persistencia idempotente: los docs de telemetría/alerta usan el ID
//      estable como doc id (`set` en vez de `add`), segunda capa de
//      defensa ante dos réplicas del server o reinicios entre
//      `isDuplicate` y `remember`.

import crypto from 'node:crypto';

/** Regex de ids de evento aceptables (seguro como doc id de Firestore). */
export const EVENT_ID_RE = /^[\w.:-]{1,128}$/;

/** Ventana por defecto: 5 minutos (cubre redelivery QoS 1 y reconexiones). */
export const DEFAULT_DEDUP_TTL_MS = 5 * 60 * 1000;

export interface StableEventInput {
  deviceId: string;
  metric: string;
  value: number;
  timestamp: number;
}

/**
 * Identidad estable de una muestra:
 *   - `deviceEventId` válido (enviado por el dispositivo) → `dev:<id>`;
 *   - si no → `derived:<sha256(deviceId|metric|timestamp|value)>`.
 * El prefijo evita colisión entre ids de dispositivo y derivados.
 */
export function deriveStableEventId(
  sample: StableEventInput,
  deviceEventId: string | null | undefined,
): string {
  if (deviceEventId && EVENT_ID_RE.test(deviceEventId)) {
    return `dev:${deviceEventId}`;
  }
  const raw = [sample.deviceId, sample.metric, sample.timestamp, sample.value].join('|');
  const digest = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 48);
  return `derived:${digest}`;
}

/**
 * Ventana en memoria de ids vistos, con TTL y barrido perezoso.
 * Hilos/instancias: cada réplica del server tiene su propia ventana; la
 * capa de persistencia idempotente (doc determinístico) cubre el caso
 * multi-réplica.
 */
export class InMemoryDeduplicator {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly ttlMs: number = DEFAULT_DEDUP_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  isDuplicate(id: string): boolean {
    const at = this.seen.get(id);
    if (at === undefined) return false;
    return this.now() - at <= this.ttlMs;
  }

  remember(id: string): void {
    this.seen.set(id, this.now());
    this.sweep();
  }

  /** Número de ids vivos (superficie de debug/testing). */
  get size(): number {
    return this.seen.size;
  }

  private sweep(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [id, at] of this.seen) {
      if (at < cutoff) this.seen.delete(id);
    }
  }
}
