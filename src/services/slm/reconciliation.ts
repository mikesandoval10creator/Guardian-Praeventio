/**
 * Offline → Zettelkasten reconciliation service.
 *
 * Fase 1 (Sprint 20, Bucket Kappa, T-1.4). Drains the IndexedDB offline
 * queue produced while the device had no connectivity (`offlineQueue.ts`)
 * and writes each session into the Zettelkasten via a caller-supplied
 * write function.
 *
 * Why an injected `zettelkastenWriteFn` rather than a direct import:
 *   - The Zettelkasten write path lives under `src/services/zettelkasten/`
 *     and ships its own dependency graph (Firestore, idempotency, audit
 *     trail). Importing it from this module would couple the SLM
 *     namespace to that graph and make this module hard to unit-test
 *     without spinning up Firestore mocks.
 *   - Bucket Kappa is one of three concurrent buckets in T-1.4. The
 *     orchestrator wiring (which actually invokes this function with
 *     the real `writeNodes` import) ships in a follow-up cut so we
 *     don't fight the other buckets for ownership of the same path.
 *
 * Behaviour contract:
 *   - Calls `listPending()` from the queue.
 *   - For each session, invokes `zettelkastenWriteFn` with a typed payload.
 *   - On success → `markReconciled(id)` flips the row.
 *   - On failure → leaves the row pending; records the error in the
 *     returned `failures[]` array. The next invocation will retry that id.
 *   - Returns aggregate stats (`{ attempted, succeeded, failed, failures }`).
 *
 * The function never throws on a single-session failure — it accumulates
 * and continues — because partial progress is more valuable than
 * all-or-nothing semantics for an offline-recovery flow.
 */

import {
  listPending,
  markReconciled,
  type QueuedSession,
} from './offlineQueue';

/**
 * Aggregate result of one reconciliation pass.
 *
 * `attempted` is always `succeeded + failed` and is exposed verbatim so
 * UI / telemetry doesn't have to recompute the sum.
 */
export interface ReconciliationResult {
  /** Number of pending sessions found at the start of the pass. */
  attempted: number;
  /** Sessions whose write succeeded and were flipped to reconciled. */
  succeeded: number;
  /** Sessions whose write threw / returned an error. */
  failed: number;
  /** Per-failure detail (for logs / Sentry breadcrumbs). */
  failures: Array<{ sessionId: string; error: string }>;
}

/**
 * Shape the caller's write function must satisfy.
 *
 * The shape mirrors what the real Zettelkasten `writeNodes` ultimately
 * needs: a typed payload + a returned node id. Keeping it minimal here
 * lets the caller wrap their full write surface (with idempotency keys,
 * audit author, etc.) and surface only the parts this service cares
 * about.
 */
export type ZettelkastenWriteFn = (input: {
  type: 'slm-session';
  payload: QueuedSession;
}) => Promise<{ nodeId: string }>;

/**
 * Options bag for `reconcileOfflineSessions`. Only the write function
 * is required today; the bag exists so future knobs (max-batch,
 * abort signal, telemetry hook) can land without a breaking signature
 * change.
 */
export interface ReconcileOptions {
  zettelkastenWriteFn: ZettelkastenWriteFn;
}

/**
 * Drain the offline queue into the Zettelkasten.
 *
 * Iterates pending sessions in chronological order (the order in which
 * they were captured offline) and invokes `zettelkastenWriteFn` for
 * each. Successes are marked reconciled; failures are accumulated and
 * surfaced via the result so the caller can decide whether to retry,
 * back off, or escalate.
 */
export async function reconcileOfflineSessions(
  opts: ReconcileOptions,
): Promise<ReconciliationResult> {
  const pending = await listPending();
  const result: ReconciliationResult = {
    attempted: pending.length,
    succeeded: 0,
    failed: 0,
    failures: [],
  };

  for (const session of pending) {
    try {
      await opts.zettelkastenWriteFn({
        type: 'slm-session',
        payload: session,
      });
      // Only flip the queue row AFTER the write resolves successfully —
      // if `markReconciled` itself throws (highly unlikely once the
      // write succeeded, but possible on disk pressure) we still count
      // the session as failed so the next pass re-attempts it. Better
      // to write twice than to lose the session entirely.
      await markReconciled(session.id);
      result.succeeded += 1;
    } catch (err) {
      result.failed += 1;
      result.failures.push({
        sessionId: session.id,
        error: err instanceof Error ? err.message : String(err),
      });
      // Intentionally do NOT mark reconciled — the row stays pending so
      // the next invocation retries it.
    }
  }

  return result;
}
