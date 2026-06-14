// Praeventio Guard — Sprint 39 Fase C.5: SOS outbox offline-first.
//
// El botón SOS NO PUEDE depender de tener red. Esta capa persiste el
// evento localmente y reintenta con backoff exponencial cuando hay
// conectividad. El engine puro (`meshPacket` + `meshRelayQueue` ya
// existentes) maneja el broadcast BLE — esto es la cola HTTP de respaldo.
//
// Diseño:
//   - PURO en lógica, persistencia inyectada (in-memory para tests,
//     IndexedDB en producción vía adapter en `sosOutbox.indexeddb.ts`).
//   - Idempotencia por `clientEventId` (uuid del cliente). El servidor
//     dedupa con la misma key.
//   - Backoff exponencial: 1s, 2s, 4s, 8s, 16s, 32s, cap 60s. Sin jitter
//     determinístico (para tests reproducibles).
//   - Max 50 entries en cola — protege IndexedDB de explosión si el
//     trabajador queda offline 1 semana presionando SOS por accidente.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type SosEventReason =
  | 'manual_button'
  | 'fall_detected'
  | 'man_down_timeout'
  | 'gas_alert'
  | 'audio_distress'
  | 'lone_worker_timeout';

export interface SosEvent {
  /** UUID generado por el cliente. Sirve como idempotency key. */
  clientEventId: string;
  workerUid: string;
  reason: SosEventReason;
  /**
   * Proyecto al que pertenece el SOS. REQUERIDO para reenviar desde la cola:
   * `POST /api/emergency/sos` valida `projectId` (assertProjectMember) y 400ea
   * sin él. Se persiste en la entry para reconstruir el envío al reconectar.
   * Opcional en el tipo por compatibilidad con el orchestrator/tests previos.
   */
  projectId?: string;
  coords?: { lat: number; lng: number; accuracyMeters?: number };
  /** ISO-8601 — momento del evento, NO de la inserción en la cola. */
  occurredAt: string;
  /** Notas adicionales del trabajador (si las hay). */
  notes?: string;
}

export interface OutboxEntry {
  event: SosEvent;
  /** Cuándo se encoló localmente (ISO-8601). */
  queuedAt: string;
  /** Intentos de envío fallidos. */
  retryCount: number;
  /** Siguiente intento permitido (epoch ms). */
  nextRetryAt: number;
  /** Último error reportado (telemetría). */
  lastError?: string;
  /**
   * 🛟 Marcado tras agotar MAX_RETRY. Un SOS dead-lettered NO se reintenta
   * (la red claramente no responde) pero TAMPOCO se descarta: queda
   * retenido para que la UI lo surja y el trabajador escale presencialmente.
   * El bug previo lo eliminaba en silencio (DEEP-EX-03 / TODO §2.32).
   */
  deadLettered?: boolean;
}

export type OutboxStatus = 'pending' | 'in_flight' | 'sent' | 'gave_up';

const MAX_RETRY = 6; // 1s, 2s, 4s, 8s, 16s, 32s
const MAX_QUEUE_SIZE = 50;

// ────────────────────────────────────────────────────────────────────────
// Backoff
// ────────────────────────────────────────────────────────────────────────

/** Backoff exponencial determinístico: 2^n segundos, cap a 60s. */
export function computeBackoffMs(retryCount: number): number {
  const seconds = Math.min(2 ** retryCount, 60);
  return seconds * 1000;
}

// ────────────────────────────────────────────────────────────────────────
// Persistence interface (DI — tests usan in-memory, prod IndexedDB)
// ────────────────────────────────────────────────────────────────────────

export interface SosOutboxStorage {
  load(): Promise<OutboxEntry[]>;
  save(entries: OutboxEntry[]): Promise<void>;
}

export class InMemorySosStorage implements SosOutboxStorage {
  private state: OutboxEntry[] = [];
  async load() {
    return [...this.state];
  }
  async save(entries: OutboxEntry[]) {
    this.state = entries;
  }
}

// ────────────────────────────────────────────────────────────────────────
// Outbox core
// ────────────────────────────────────────────────────────────────────────

export interface SosOutboxDeps {
  storage: SosOutboxStorage;
  /** Función que intenta enviar al servidor. Devuelve true si éxito. */
  send: (event: SosEvent) => Promise<{ ok: boolean; error?: string }>;
  /** Reloj inyectable (tests). */
  now?: () => number;
}

export class SosOutbox {
  private readonly now: () => number;

  constructor(private readonly deps: SosOutboxDeps) {
    this.now = deps.now ?? (() => Date.now());
  }

  /**
   * Encola un evento. Idempotente: si el `clientEventId` ya está en la
   * cola, NO se duplica.
   */
  async enqueue(event: SosEvent): Promise<void> {
    const current = await this.deps.storage.load();
    if (current.some((e) => e.event.clientEventId === event.clientEventId)) {
      return;
    }
    // Hard cap: si la cola está llena evictamos el pendiente más viejo,
    // PERO nunca un dead-letter (SOS no entregado = lo más importante).
    const trimmed = this.trimForCapacity(current);
    const entry: OutboxEntry = {
      event,
      queuedAt: new Date(this.now()).toISOString(),
      retryCount: 0,
      nextRetryAt: this.now(),
    };
    await this.deps.storage.save([...trimmed, entry]);
  }

  /**
   * Procesa la cola: para cada entry cuyo `nextRetryAt <= now`, intenta
   * enviar. Si éxito, lo remueve. Si falla, incrementa retryCount y
   * recalcula nextRetryAt. Si supera MAX_RETRY, lo marca `gave_up`.
   *
   * Devuelve un resumen para telemetría.
   */
  async flush(): Promise<{
    sent: number;
    pending: number;
    gaveUp: number;
    deadLettered: number;
  }> {
    const now = this.now();
    const current = await this.deps.storage.load();
    const next: OutboxEntry[] = [];
    let sent = 0;
    let gaveUp = 0;

    for (const entry of current) {
      // 🛟 Un dead-letter ya agotó los reintentos: se retiene intacto
      // (jamás se descarta), pero no se vuelve a enviar.
      if (entry.deadLettered) {
        next.push(entry);
        continue;
      }
      if (entry.nextRetryAt > now) {
        next.push(entry); // todavía no toca reintentar
        continue;
      }
      const result = await this.deps.send(entry.event).catch((err) => ({
        ok: false,
        error: err instanceof Error ? err.message : 'unknown',
      }));

      if (result.ok) {
        sent += 1;
        continue;
      }

      const newRetry = entry.retryCount + 1;
      if (newRetry > MAX_RETRY) {
        // Agotados los reintentos: NO se descarta. Se marca dead-letter y
        // se retiene para escalamiento presencial (la UI debe surjirlo).
        gaveUp += 1;
        next.push({
          ...entry,
          retryCount: newRetry,
          deadLettered: true,
          nextRetryAt: Number.POSITIVE_INFINITY,
          lastError: result.error ?? entry.lastError,
        });
        continue;
      }
      next.push({
        ...entry,
        retryCount: newRetry,
        nextRetryAt: now + computeBackoffMs(newRetry),
        lastError: result.error,
      });
    }

    await this.deps.storage.save(next);
    const deadLettered = next.filter((e) => e.deadLettered).length;
    return {
      sent,
      pending: next.length - deadLettered,
      gaveUp,
      deadLettered,
    };
  }

  /** Snapshot inmutable del estado de la cola (para UI badge). */
  async snapshot(): Promise<OutboxEntry[]> {
    return this.deps.storage.load();
  }

  /**
   * 🛟 SOS que agotaron los reintentos y siguen sin entregarse. La UI debe
   * mostrarlos de forma prominente ("avisa al supervisor presencialmente").
   */
  async deadLetters(): Promise<OutboxEntry[]> {
    const all = await this.deps.storage.load();
    return all.filter((e) => e.deadLettered);
  }

  /**
   * Remueve un dead-letter una vez escalado por otra vía (p.ej. el
   * trabajador confirmó que avisó presencialmente). Idempotente.
   */
  async clearDeadLetter(clientEventId: string): Promise<void> {
    const all = await this.deps.storage.load();
    await this.deps.storage.save(
      all.filter(
        (e) => !(e.deadLettered && e.event.clientEventId === clientEventId),
      ),
    );
  }

  /**
   * Hard cap respetando dead-letters: evicta primero los pendientes más
   * viejos; solo si la cola está saturada de dead-letters evicta el más
   * viejo en general (caso extremo que no debería ocurrir en la práctica).
   */
  private trimForCapacity(entries: OutboxEntry[]): OutboxEntry[] {
    if (entries.length < MAX_QUEUE_SIZE) return entries;
    const toRemove = entries.length - MAX_QUEUE_SIZE + 1;
    const evictIds = new Set(
      entries
        .filter((e) => !e.deadLettered)
        .slice(0, toRemove)
        .map((e) => e.event.clientEventId),
    );
    let kept = entries.filter((e) => !evictIds.has(e.event.clientEventId));
    if (kept.length >= MAX_QUEUE_SIZE) {
      kept = kept.slice(kept.length - MAX_QUEUE_SIZE + 1);
    }
    return kept;
  }
}
