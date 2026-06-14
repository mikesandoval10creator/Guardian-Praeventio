// Praeventio Guard — SOS outbox singleton + HTTP transport (offline-first).
//
// Wires the pure SosOutbox engine (sosOutbox.ts) to:
//   • durable IndexedDB persistence (sosOutbox.indexeddb.ts), and
//   • a `send()` that POSTs the queued event to the REAL audited endpoint
//     POST /api/emergency/sos (verifyAuth + sosLimiter + assertProjectMember;
//     writes tenants/{tid}/emergency_alerts + audit_logs + FCM fan-out).
//
// The SOSButton enqueues here on a network/HTTP failure (instead of losing the
// alert), and the queue is drained on reconnect + on app start. A SOS that
// exhausts its retries is dead-lettered (retained, never dropped) for the UI to
// surface ("tu alerta no salió — avisa al supervisor presencialmente").

import { SosOutbox, type SosEvent } from './sosOutbox';
import { IndexedDbSosStorage } from './sosOutbox.indexeddb';
import { apiAuthHeader } from '../../lib/apiAuth';
import { logger } from '../../utils/logger';

/**
 * Transport: POST a queued SOS to the server. Returns {ok} so the engine can
 * decide retain/retry/dead-letter. Exported for unit testing.
 */
export async function sendSos(event: SosEvent): Promise<{ ok: boolean; error?: string }> {
  // The server requires a projectId (400 invalid_projectId otherwise). A queued
  // event without one can never succeed — surface it as a non-retryable error
  // so it dead-letters quickly instead of spinning.
  if (!event.projectId) {
    return { ok: false, error: 'missing_projectId' };
  }
  try {
    const authHeader = await apiAuthHeader();
    const res = await fetch('/api/emergency/sos', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      body: JSON.stringify({
        type: 'sos',
        uid: event.workerUid,
        projectId: event.projectId,
        geo: event.coords ? { lat: event.coords.lat, lng: event.coords.lng } : null,
        timestamp: event.occurredAt,
      }),
    });
    return res.ok ? { ok: true } : { ok: false, error: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'network_error' };
  }
}

let _outbox: SosOutbox | null = null;
function outbox(): SosOutbox {
  if (!_outbox) {
    _outbox = new SosOutbox({ storage: new IndexedDbSosStorage(), send: sendSos });
  }
  return _outbox;
}

/** Enqueue a SOS for durable, retried delivery. Arms the reconnect drain. */
export async function enqueueSos(event: SosEvent): Promise<void> {
  registerSosFlushOnReconnect();
  await outbox().enqueue(event);
}

/** Process the queue once (sends due entries, retries/dead-letters failures). */
export function flushSos(): ReturnType<SosOutbox['flush']> {
  return outbox().flush();
}

/** SOS that exhausted retries and remain undelivered (for the UI to surface). */
export function getSosDeadLetters(): ReturnType<SosOutbox['deadLetters']> {
  return outbox().deadLetters();
}

/** Acknowledge a dead-letter once escalated by another channel (presencial). */
export function clearSosDeadLetter(clientEventId: string): Promise<void> {
  return outbox().clearDeadLetter(clientEventId);
}

let _reconnectArmed = false;
/**
 * Drain any pending SOS now (app start / first enqueue) and on every reconnect.
 * Idempotent — safe to call from multiple mount points.
 */
export function registerSosFlushOnReconnect(): void {
  if (typeof window === 'undefined') return;
  // Drain leftovers from a previous session that closed before delivery.
  if (typeof navigator === 'undefined' || navigator.onLine) {
    flushSos().catch((err) => logger.warn('sosOutbox: initial flush failed', { err: String(err) }));
  }
  if (_reconnectArmed) return;
  _reconnectArmed = true;
  window.addEventListener('online', () => {
    flushSos().catch((err) => logger.warn('sosOutbox: flush on reconnect failed', { err: String(err) }));
  });
}
