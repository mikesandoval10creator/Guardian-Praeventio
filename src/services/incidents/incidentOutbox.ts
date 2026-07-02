// Praeventio Guard — B.1 (VIDA): durable offline outbox for incident reports.
//
// IncidentReport.tsx used to fire a bare fetch('/api/incidents/report'): with
// no signal (mina, subterráneo, zona muerta) the typed report was LOST in
// silence — the worst failure mode for safety data. This module wires the
// GenericOutboxEngine (designed for exactly this: "Incident report en mina
// sin señal → outbox") to:
//
//   • durable IndexedDB persistence (idb-keyval, same family as the SOS
//     outbox: whole queue under one versioned key),
//   • a sender that POSTs to the REAL audited endpoint
//     POST /api/incidents/report with Idempotency-Key = clientEventId (the
//     route mounts idempotencyKey(), and the payload carries the same value
//     as its deterministic `id`) — a replay can never duplicate the incident,
//   • app-start + reconnect drains (RootLayout), mirroring sosOutboxClient.
//
// HONESTY RULE — never silent-drop safety data: the engine DELETES entries
// classified 'permanent_failure', so this sender NEVER returns it. Every
// failure (network, 5xx, even a deterministic 4xx) classifies as 'retry';
// an entry that exhausts maxRetries is DEAD-LETTERED — retained and
// surfaceable, never erased. A 4xx that will never succeed costs a few
// retries and then parks visibly; that is the right trade for a record the
// Ley 16.744 trail may depend on.

import {
  GenericOutboxEngine,
  type OutboxAdapter,
  type OutboxEntry,
  type OutboxEvent,
} from '../sync/genericOutboxEngine';
import { get, set } from 'idb-keyval';
import { apiAuthHeader } from '../../lib/apiAuth';
import { randomId } from '../../utils/randomId';
import { logger } from '../../utils/logger';

export type IncidentEventType = 'near_miss' | 'incident' | 'post_mortem';
export type IncidentSeverity = 'low' | 'med' | 'high' | 'critical';

/** Same shape POST /api/incidents/report validates (reportIncidentSchema). */
export interface IncidentReportPayload {
  /** Deterministic server-side doc id — equals the outbox clientEventId. */
  id: string;
  projectId: string;
  incidentType: IncidentEventType;
  severity: IncidentSeverity;
  description: string;
  location?: string;
  witnesses?: string[];
  ts: string;
}

const STORAGE_KEY = 'praeventio:incident-outbox:v1';

async function loadAll(): Promise<OutboxEntry<IncidentReportPayload>[]> {
  try {
    const raw = await get<OutboxEntry<IncidentReportPayload>[]>(STORAGE_KEY);
    return Array.isArray(raw) ? raw : [];
  } catch (err) {
    // IndexedDB unavailable (private mode / quota) — degrade to empty rather
    // than crashing the flush loop. Logged, never silent.
    logger.warn('incidentOutbox: IndexedDB load failed', { err: String(err) });
    return [];
  }
}

/** Durable adapter over idb-keyval (exported for integration tests). */
export function createIndexedDbIncidentAdapter(): OutboxAdapter<IncidentReportPayload> {
  return {
    listEntries: loadAll,
    async saveEntry(entry) {
      const all = await loadAll();
      const idx = all.findIndex(
        (e) => e.event.clientEventId === entry.event.clientEventId,
      );
      if (idx >= 0) all[idx] = entry;
      else all.push(entry);
      await set(STORAGE_KEY, all);
    },
    async deleteEntry(clientEventId) {
      const all = await loadAll();
      await set(
        STORAGE_KEY,
        all.filter((e) => e.event.clientEventId !== clientEventId),
      );
    },
  };
}

/**
 * Transport: POST a queued report to the audited endpoint. Exported for unit
 * testing. NEVER returns 'permanent_failure' — see the honesty rule above.
 */
export async function sendIncidentReport(
  event: OutboxEvent<IncidentReportPayload>,
): Promise<{ kind: 'success' | 'retry'; error?: string }> {
  try {
    const authHeader = await apiAuthHeader();
    const res = await fetch('/api/incidents/report', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { Authorization: authHeader } : {}),
        'Idempotency-Key': event.clientEventId,
      },
      body: JSON.stringify(event.payload),
    });
    if (res.ok) return { kind: 'success' };
    return { kind: 'retry', error: `HTTP ${res.status}` };
  } catch (err) {
    return {
      kind: 'retry',
      error: err instanceof Error ? err.message : 'network_error',
    };
  }
}

let _engine: GenericOutboxEngine<IncidentReportPayload> | null = null;
function engine(): GenericOutboxEngine<IncidentReportPayload> {
  if (!_engine) {
    _engine = new GenericOutboxEngine<IncidentReportPayload>({
      adapter: createIndexedDbIncidentAdapter(),
      sender: sendIncidentReport,
      maxEntries: 200,
      onTelemetry: (t) => {
        if (t.kind === 'dead_lettered') {
          logger.warn('incidentOutbox: report dead-lettered (retained, surface for escalation)', t);
        }
      },
    });
  }
  return _engine;
}

/**
 * Enqueue a report for durable, retried delivery. Returns false only when the
 * queue is saturated with same/higher-priority live entries — the caller MUST
 * surface that (never pretend it was stored).
 */
export async function enqueueIncidentReport(
  payload: IncidentReportPayload,
  opts?: { clientEventId?: string; occurredAt?: string },
): Promise<boolean> {
  registerIncidentFlushOnReconnect();
  return engine().enqueue({
    clientEventId: opts?.clientEventId ?? `inc-${randomId()}`,
    kind: 'incident',
    priority: 'normal',
    payload,
    occurredAt: opts?.occurredAt ?? payload.ts,
  });
}

/** Process the queue once (sends due entries, retries/dead-letters failures). */
export function flushIncidentReports(): ReturnType<
  GenericOutboxEngine<IncidentReportPayload>['flush']
> {
  return engine().flush();
}

/** Reports that exhausted retries and remain undelivered (UI escalation). */
export function getIncidentDeadLetters(): Promise<OutboxEntry<IncidentReportPayload>[]> {
  return engine().deadLetters();
}

/** Acknowledge a dead-letter once escalated by another channel. */
export function clearIncidentDeadLetter(clientEventId: string): Promise<void> {
  return engine().clearDeadLetter(clientEventId);
}

let _reconnectArmed = false;
/**
 * Drain pending reports now (app start / first enqueue) and on every
 * reconnect. Idempotent — safe from multiple mount points.
 */
export function registerIncidentFlushOnReconnect(): void {
  if (typeof window === 'undefined') return;
  if (typeof navigator === 'undefined' || navigator.onLine) {
    flushIncidentReports().catch((err) =>
      logger.warn('incidentOutbox: initial flush failed', { err: String(err) }),
    );
  }
  if (_reconnectArmed) return;
  _reconnectArmed = true;
  window.addEventListener('online', () => {
    flushIncidentReports().catch((err) =>
      logger.warn('incidentOutbox: flush on reconnect failed', { err: String(err) }),
    );
  });
}
