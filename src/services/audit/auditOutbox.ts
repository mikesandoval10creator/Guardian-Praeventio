// Durable offline outbox for audit_logs (§14: audit calls must never be dropped).
//
// logAuditAction used to fire a bare fetch('/api/audit-log') and swallow the
// error: with no signal (mina, subterráneo, zona muerta) the compliance event
// was LOST in silence — the Ley 16.744 / DS trail depends on these. Worse, the
// awaited apiAuthHeader()+fetch could hang the caller with no timeout, keeping a
// submit modal open. This module wires the GenericOutboxEngine (which explicitly
// lists "audit event during a Firestore outage → outbox" as a use case) to:
//
//   • durable IndexedDB persistence (idb-keyval, whole queue under one key),
//   • a sender that POSTs to POST /api/audit-log with Idempotency-Key =
//     clientEventId — the server stamps uid/email/ts from the token and dedupes
//     on the key, so a replayed flush can never create a duplicate append-only
//     row (firestore.rules audit_logs: create:true, update/delete:false),
//   • app-start + reconnect drains (RootLayout), mirroring incidentOutbox.
//
// The critical path (enqueue) touches only IndexedDB — no network — so the
// caller returns immediately whether online or offline.
//
// HONESTY RULE — never silent-drop compliance data: the engine DELETES entries
// classified 'permanent_failure', so this sender NEVER returns it. Every failure
// (network, 5xx, even a 4xx) classifies as 'retry'; an entry that exhausts
// maxRetries is DEAD-LETTERED — retained and surfaceable, never erased.

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

/** Same shape POST /api/audit-log accepts; server stamps actor/ts from token. */
export interface AuditLogOutboxPayload {
  action: string;
  module: string;
  details: Record<string, unknown>;
  projectId?: string;
}

const STORAGE_KEY = 'praeventio:audit-outbox:v1';

async function loadAll(): Promise<OutboxEntry<AuditLogOutboxPayload>[]> {
  try {
    const raw = await get<OutboxEntry<AuditLogOutboxPayload>[]>(STORAGE_KEY);
    return Array.isArray(raw) ? raw : [];
  } catch (err) {
    // IndexedDB unavailable (private mode / quota) — degrade to empty rather
    // than crashing the flush loop. Logged, never silent.
    logger.warn('auditOutbox: IndexedDB load failed', { err: String(err) });
    return [];
  }
}

/** Durable adapter over idb-keyval (exported for integration tests). */
export function createIndexedDbAuditAdapter(): OutboxAdapter<AuditLogOutboxPayload> {
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
 * Transport: POST a queued audit event to the audited endpoint. Exported for
 * unit testing. NEVER returns 'permanent_failure' — see the honesty rule above.
 */
export async function sendAuditLog(
  event: OutboxEvent<AuditLogOutboxPayload>,
): Promise<{ kind: 'success' | 'retry'; error?: string }> {
  try {
    const authHeader = await apiAuthHeader();
    const res = await fetch('/api/audit-log', {
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

let _engine: GenericOutboxEngine<AuditLogOutboxPayload> | null = null;
function engine(): GenericOutboxEngine<AuditLogOutboxPayload> {
  if (!_engine) {
    _engine = new GenericOutboxEngine<AuditLogOutboxPayload>({
      adapter: createIndexedDbAuditAdapter(),
      sender: sendAuditLog,
      // Audit is high-volume; cap generously. Priority 'background' yields to
      // SOS/incident traffic on the shared reconnect drain.
      maxEntries: 500,
      onTelemetry: (t) => {
        if (t.kind === 'dead_lettered') {
          logger.warn('auditOutbox: audit entry dead-lettered (retained, never dropped)', t);
        }
      },
    });
  }
  return _engine;
}

/**
 * Enqueue an audit event for durable, retried delivery, then flush immediately
 * when online so the trail isn't delayed to the next drain. Offline it stays
 * queued and drains on reconnect. Returns false only if the queue is saturated
 * with same/higher-priority live entries (background is lowest — practically
 * never for audit unless the whole outbox is jammed).
 */
export async function enqueueAuditLog(
  payload: AuditLogOutboxPayload,
  opts?: { clientEventId?: string; occurredAt?: string },
): Promise<boolean> {
  registerAuditFlushOnReconnect();
  const ok = await engine().enqueue({
    clientEventId: opts?.clientEventId ?? `audit-${randomId()}`,
    kind: 'audit',
    priority: 'background',
    payload,
    occurredAt: opts?.occurredAt ?? new Date().toISOString(),
  });
  if (typeof navigator === 'undefined' || navigator.onLine) {
    void flushAuditLogs().catch((err) =>
      logger.warn('auditOutbox: immediate flush failed', { err: String(err) }),
    );
  }
  return ok;
}

/** Process the queue once (sends due entries, retries/dead-letters failures). */
export function flushAuditLogs(): ReturnType<
  GenericOutboxEngine<AuditLogOutboxPayload>['flush']
> {
  return engine().flush();
}

/** Audit events that exhausted retries and remain undelivered (UI escalation). */
export function getAuditDeadLetters(): Promise<OutboxEntry<AuditLogOutboxPayload>[]> {
  return engine().deadLetters();
}

let _reconnectArmed = false;
/**
 * Drain pending audit events on every reconnect. Idempotent — safe from
 * multiple mount points. (enqueueAuditLog handles the immediate online send.)
 */
export function registerAuditFlushOnReconnect(): void {
  if (typeof window === 'undefined') return;
  if (_reconnectArmed) return;
  _reconnectArmed = true;
  window.addEventListener('online', () => {
    flushAuditLogs().catch((err) =>
      logger.warn('auditOutbox: flush on reconnect failed', { err: String(err) }),
    );
  });
}
