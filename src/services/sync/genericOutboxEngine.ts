/**
 * Generic Offline Outbox Engine.
 *
 * Patrón reutilizable que cualquier feature usa para encolar
 * eventos generados sin conectividad. Generaliza el patrón de
 * `sosOutbox` (Fase C.5) a cualquier dominio:
 *
 *   - Incident report en mina sin señal → outbox → al recuperar
 *     red, push al backend
 *   - Site book entry en zona muerta → outbox → al recuperar red,
 *     sync con folio atómico server-side
 *   - Audit event durante outage de Firestore → outbox → al
 *     recuperar, push a la tamper-proof chain (#233)
 *
 * Cada feature define su propio `EventKind` discriminator y un
 * `sender` que sabe cómo flush al backend específico. El engine
 * solo orquesta: priority queue, backoff exponencial,
 * idempotency, retention policy, telemetry hooks.
 *
 * Diseño puro: persistencia inyectable (in-memory para tests,
 * IndexedDB cifrado en producción con `encryptedKvStore` de #230).
 *
 * Garantías:
 *   - **Idempotencia por clientEventId**: el caller genera el UUID,
 *     el sender propaga al backend, el server dedupa.
 *   - **Priority queue**: events con `priority: 'critical'` (SOS,
 *     fallDetected) se intentan antes de `'normal'` (incident
 *     report) antes de `'background'` (audit log).
 *   - **Retention cap**: max N events por feature (configurable),
 *     evictando el más antiguo de baja prioridad cuando se llena.
 *   - **Backoff exponencial**: 1s, 2s, 4s, 8s, 16s, 32s, cap 60s.
 *   - **Dead-letter** (NO silent-drop): events que agotan el TTL o el
 *     `maxRetries` NO se descartan — se marcan `deadLettered`, se retienen
 *     intactos y dejan de reintentarse. La UI los surge para escalamiento
 *     (`deadLetters()` / `clearDeadLetter()`). El bug previo los borraba en
 *     silencio, perdiendo datos de seguridad (DEEP-B16 / TODO §2.32 / B16).
 *   - **Failures DON'T crash el engine** — el sender puede throw,
 *     el engine captura, incrementa retryCount, deja en cola.
 */

import {
  computeNextRetryAt,
  DEFAULT_BACKOFF_BASE_MS,
  DEFAULT_BACKOFF_CAP_MS,
} from './outboxBackoff';

// ────────────────────────────────────────────────────────────────────────
// Public types — pure data shapes
// ────────────────────────────────────────────────────────────────────────

export type OutboxPriority = 'critical' | 'normal' | 'background';

/** El evento que el caller persiste. T es el shape específico de la feature. */
export interface OutboxEvent<T> {
  /** UUID generado por el cliente (idempotency key). */
  clientEventId: string;
  /** Tag discriminator de feature (`'incident'`, `'siteBook'`, etc.). */
  kind: string;
  /** Priority queue. */
  priority: OutboxPriority;
  /** Payload arbitrario tipado. */
  payload: T;
  /** ISO-8601 cuando ocurrió en la realidad (NO cuando se encoló). */
  occurredAt: string;
}

/** Estado de un event en la cola. */
export interface OutboxEntry<T> {
  event: OutboxEvent<T>;
  /** ISO-8601 cuándo se encoló localmente. */
  queuedAt: string;
  /** Intentos fallidos. */
  retryCount: number;
  /** Epoch ms próximo intento permitido. */
  nextRetryAt: number;
  /** Último error reportado. */
  lastError?: string;
  /**
   * 🛟 Marcado tras agotar el TTL o `maxRetries`. Un entry dead-lettered NO se
   * reintenta (no tiene sentido) pero TAMPOCO se descarta: queda retenido para
   * que la UI lo surja y el dato de seguridad se escale por otra vía. Reemplaza
   * el `expired` previo, que terminaba en `deleteEntry` (pérdida silenciosa).
   */
  deadLettered?: boolean;
  /** Razón del dead-letter (telemetría / UI). */
  deadLetterReason?: 'ttl' | 'max_retries';
}

/** Resultado de un attempt de flush. */
export type FlushResult =
  | { kind: 'success'; entryId: string }
  | { kind: 'retry'; entryId: string; error: string }
  | { kind: 'permanent_failure'; entryId: string; error: string };

// ────────────────────────────────────────────────────────────────────────
// Persistence adapter interface
// ────────────────────────────────────────────────────────────────────────

/**
 * El caller implementa esto contra IDB cifrado / in-memory / lo que sea.
 * Las firmas async para que el adapter real pueda hacer I/O.
 */
export interface OutboxAdapter<T> {
  /** Lee todas las entries actualmente en cola. Orden no importa — el engine ordena. */
  listEntries(): Promise<OutboxEntry<T>[]>;
  /** Persiste una entry nueva. Si ya existe (por clientEventId), reemplaza. */
  saveEntry(entry: OutboxEntry<T>): Promise<void>;
  /** Borra una entry por clientEventId. Idempotent. */
  deleteEntry(clientEventId: string): Promise<void>;
}

/**
 * El sender es lo que sabe cómo flush al backend específico. Devuelve
 * `success` si server confirmó, `retry` si fue un error transitorio
 * (network, 5xx), `permanent_failure` si fue 4xx / unrecoverable.
 *
 * El engine NO interpreta errores HTTP — eso es responsabilidad del
 * caller del sender. Esto deja el engine 100% generic.
 */
export type OutboxSender<T> = (
  event: OutboxEvent<T>,
) => Promise<Pick<FlushResult, 'kind'> & { error?: string }>;

// ────────────────────────────────────────────────────────────────────────
// Config
// ────────────────────────────────────────────────────────────────────────

export interface OutboxEngineConfig<T> {
  adapter: OutboxAdapter<T>;
  sender: OutboxSender<T>;
  /** Cap del retention. Si se excede, evict el más viejo de baja prioridad. Default 100. */
  maxEntries?: number;
  /** TTL en horas. Events más viejos se marcan expired. Default 168h (7 días). */
  ttlHours?: number;
  /** Cap de retries antes de marcar permanent_failure. Default 20. */
  maxRetries?: number;
  /** Base del backoff exponencial en ms. Default 1000. */
  backoffBaseMs?: number;
  /** Cap del delay individual entre retries. Default 60000. */
  backoffCapMs?: number;
  /** Override Date.now() para tests. */
  nowMs?: () => number;
  /** Callback de telemetría — llamado en cada flush attempt. */
  onTelemetry?: (event: TelemetryEvent) => void;
}

export type TelemetryEvent =
  | { kind: 'enqueued'; entryId: string; priority: OutboxPriority }
  | { kind: 'flush_success'; entryId: string; retryCount: number }
  | { kind: 'flush_retry'; entryId: string; retryCount: number; error: string }
  | { kind: 'flush_permanent_failure'; entryId: string; error: string }
  | {
      kind: 'dead_lettered';
      entryId: string;
      reason: 'ttl' | 'max_retries';
      priority: OutboxPriority;
    }
  | { kind: 'evicted'; entryId: string; reason: 'capacity' };

// ────────────────────────────────────────────────────────────────────────
// Engine
// ────────────────────────────────────────────────────────────────────────

const PRIORITY_RANK: Record<OutboxPriority, number> = {
  critical: 0,
  normal: 1,
  background: 2,
};

export class GenericOutboxEngine<T> {
  constructor(private readonly config: OutboxEngineConfig<T>) {}

  /**
   * Encola un nuevo event. Si ya existe uno con el mismo
   * `clientEventId`, NO se duplica (idempotencia).
   *
   * Si la cola está llena, evict el más viejo de menor prioridad.
   * Si todos son de igual prioridad alta y NO hay espacio, el nuevo
   * event NO se encola (retorna `false`) — protege contra desbordar
   * la IDB con events que el server no puede aceptar.
   */
  async enqueue(event: OutboxEvent<T>): Promise<boolean> {
    const now = this.now();
    const entries = await this.config.adapter.listEntries();

    // Dedup por clientEventId.
    const existing = entries.find(
      (e) => e.event.clientEventId === event.clientEventId,
    );
    if (existing) {
      // Ya está en cola — idempotencia. No re-encolamos.
      return true;
    }

    // Cap check.
    const maxEntries = this.config.maxEntries ?? 100;
    if (entries.length >= maxEntries) {
      // Evict: el más viejo de menor prioridad (background > normal > critical).
      // 🛟 Los dead-letters NO son candidatos a evicción — son datos de
      // seguridad retenidos para escalamiento; descartarlos por capacidad
      // reintroduce la pérdida silenciosa que este bloque arregla.
      const evictable = entries
        .filter((e) => !e.deadLettered)
        .sort((a, b) => {
          const pdiff =
            PRIORITY_RANK[b.event.priority] - PRIORITY_RANK[a.event.priority];
          if (pdiff !== 0) return pdiff;
          return Date.parse(a.queuedAt) - Date.parse(b.queuedAt);
        });
      const victim = evictable[0];
      if (
        !victim ||
        PRIORITY_RANK[victim.event.priority] <= PRIORITY_RANK[event.priority]
      ) {
        // No hay víctima viva de menor prioridad → rechazamos el nuevo (la cola
        // está saturada de items de prioridad ≥ a la del entrante, o sólo
        // quedan dead-letters, que nunca se desalojan).
        return false;
      }
      await this.config.adapter.deleteEntry(victim.event.clientEventId);
      this.emit({
        kind: 'evicted',
        entryId: victim.event.clientEventId,
        reason: 'capacity',
      });
    }

    const entry: OutboxEntry<T> = {
      event,
      queuedAt: new Date(now).toISOString(),
      retryCount: 0,
      nextRetryAt: now,
    };
    await this.config.adapter.saveEntry(entry);
    this.emit({
      kind: 'enqueued',
      entryId: event.clientEventId,
      priority: event.priority,
    });
    return true;
  }

  /**
   * Drena la cola: itera por priority + retry-ready y ejecuta sender.
   * Returns aggregate stats.
   *
   * NO throwea por failures individuales — captura cada error en el
   * entry y deja el resto procesando.
   */
  async flush(): Promise<{
    attempted: number;
    succeeded: number;
    retried: number;
    permanentlyFailed: number;
    deadLettered: number;
  }> {
    const now = this.now();
    const entries = await this.config.adapter.listEntries();
    const ttlMs = (this.config.ttlHours ?? 168) * 60 * 60 * 1000;
    const maxRetries = this.config.maxRetries ?? 20;

    let attempted = 0;
    let succeeded = 0;
    let retried = 0;
    let permanentlyFailed = 0;
    let deadLettered = 0;

    // 1. Dead-letter (NO purge) los que agotan TTL o maxRetries. Se retienen
    //    marcados para escalamiento — jamás se descartan en silencio.
    for (const entry of entries) {
      if (entry.deadLettered) continue; // ya dead-lettered: intacto.
      const ageMs = now - Date.parse(entry.queuedAt);
      const ttlExpired = ageMs > ttlMs;
      const retriesExceeded = entry.retryCount >= maxRetries;
      if (ttlExpired || retriesExceeded) {
        const reason: 'ttl' | 'max_retries' = ttlExpired ? 'ttl' : 'max_retries';
        await this.config.adapter.saveEntry({
          ...entry,
          deadLettered: true,
          deadLetterReason: reason,
          nextRetryAt: Number.POSITIVE_INFINITY,
        });
        this.emit({
          kind: 'dead_lettered',
          entryId: entry.event.clientEventId,
          reason,
          priority: entry.event.priority,
        });
        deadLettered++;
      }
    }

    // 2. Re-lista entries DESPUÉS del dead-lettering. Los dead-letters quedan
    //    excluidos del intento de envío (nextRetryAt = +Infinity los descarta,
    //    pero filtramos explícitamente por claridad).
    const live = (await this.config.adapter.listEntries())
      .filter((e) => !e.deadLettered && e.nextRetryAt <= now)
      .sort((a, b) => {
        const pdiff =
          PRIORITY_RANK[a.event.priority] - PRIORITY_RANK[b.event.priority];
        if (pdiff !== 0) return pdiff;
        return Date.parse(a.queuedAt) - Date.parse(b.queuedAt);
      });

    // 3. Flush en orden.
    for (const entry of live) {
      attempted++;
      let result: { kind: FlushResult['kind']; error?: string };
      try {
        result = await this.config.sender(entry.event);
      } catch (err) {
        result = {
          kind: 'retry',
          error: err instanceof Error ? err.message : String(err),
        };
      }

      if (result.kind === 'success') {
        await this.config.adapter.deleteEntry(entry.event.clientEventId);
        this.emit({
          kind: 'flush_success',
          entryId: entry.event.clientEventId,
          retryCount: entry.retryCount,
        });
        succeeded++;
      } else if (result.kind === 'permanent_failure') {
        await this.config.adapter.deleteEntry(entry.event.clientEventId);
        this.emit({
          kind: 'flush_permanent_failure',
          entryId: entry.event.clientEventId,
          error: result.error ?? 'unknown',
        });
        permanentlyFailed++;
      } else {
        // Retry: incrementa retryCount + recompute backoff.
        const updatedRetryCount = entry.retryCount + 1;
        const nextRetryAt = computeNextRetryAt({
          now,
          retryCount: updatedRetryCount,
          baseMs: this.config.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS,
          capMs: this.config.backoffCapMs ?? DEFAULT_BACKOFF_CAP_MS,
        });
        const updated: OutboxEntry<T> = {
          ...entry,
          retryCount: updatedRetryCount,
          nextRetryAt,
          lastError: result.error,
        };
        await this.config.adapter.saveEntry(updated);
        this.emit({
          kind: 'flush_retry',
          entryId: entry.event.clientEventId,
          retryCount: updatedRetryCount,
          error: result.error ?? 'unknown',
        });
        retried++;
      }
    }

    return {
      attempted,
      succeeded,
      retried,
      permanentlyFailed,
      deadLettered,
    };
  }

  /**
   * 🛟 Entries que agotaron TTL/maxRetries y siguen retenidos sin entregarse.
   * La UI debe surgirlos de forma prominente para escalamiento manual.
   */
  async deadLetters(): Promise<OutboxEntry<T>[]> {
    const entries = await this.config.adapter.listEntries();
    return entries.filter((e) => e.deadLettered);
  }

  /**
   * Remueve un dead-letter una vez escalado por otra vía. Idempotente —
   * sólo borra si el entry está efectivamente dead-lettered.
   */
  async clearDeadLetter(clientEventId: string): Promise<void> {
    const entries = await this.config.adapter.listEntries();
    const target = entries.find(
      (e) => e.event.clientEventId === clientEventId && e.deadLettered,
    );
    if (target) {
      await this.config.adapter.deleteEntry(clientEventId);
    }
  }

  /** Stats sin flushear — útil para UI badges. */
  async stats(): Promise<{
    total: number;
    pending: number;
    deadLettered: number;
    byPriority: Record<OutboxPriority, number>;
    oldestQueuedAt?: string;
    nextRetryReadyAt?: number;
  }> {
    const entries = await this.config.adapter.listEntries();
    const byPriority: Record<OutboxPriority, number> = {
      critical: 0,
      normal: 0,
      background: 0,
    };
    let oldest: string | undefined;
    let nextReady: number | undefined;
    let deadLettered = 0;
    for (const e of entries) {
      byPriority[e.event.priority]++;
      if (e.deadLettered) {
        deadLettered++;
        // Dead-letters no entran en el cálculo de "próximo intento" (no se
        // reintentan) ni representan trabajo pendiente de la cola activa.
        continue;
      }
      if (!oldest || Date.parse(e.queuedAt) < Date.parse(oldest)) {
        oldest = e.queuedAt;
      }
      if (nextReady === undefined || e.nextRetryAt < nextReady) {
        nextReady = e.nextRetryAt;
      }
    }
    return {
      total: entries.length,
      pending: entries.length - deadLettered,
      deadLettered,
      byPriority,
      oldestQueuedAt: oldest,
      nextRetryReadyAt: nextReady,
    };
  }

  private now(): number {
    return this.config.nowMs ? this.config.nowMs() : Date.now();
  }

  private emit(event: TelemetryEvent): void {
    if (this.config.onTelemetry) {
      try {
        this.config.onTelemetry(event);
      } catch {
        // Telemetry NUNCA crashea el flush — best-effort.
      }
    }
  }
}

/**
 * Adapter in-memory para tests + dev. NO usar en producción.
 */
export function createInMemoryOutboxAdapter<T>(): OutboxAdapter<T> {
  const store = new Map<string, OutboxEntry<T>>();
  return {
    async listEntries() {
      return Array.from(store.values());
    },
    async saveEntry(entry) {
      store.set(entry.event.clientEventId, entry);
    },
    async deleteEntry(clientEventId) {
      store.delete(clientEventId);
    },
  };
}
