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
 *   - For each session, verifies the HMAC tag attached at enqueue time
 *     (TM-T03 mitigation, ninth wave). Tampered entries are DROPPED
 *     (deleted from the queue) and a Sentry warning is emitted; they
 *     never reach `zettelkastenWriteFn`. Legacy entries (pre-mitigation,
 *     no `hmac` field) emit a `slm.queue.unsigned_legacy` breadcrumb
 *     and pass through one last time — TODO Sprint 22: flip to drop.
 *   - For each verified session, invokes `zettelkastenWriteFn` with a
 *     typed payload.
 *   - On success → `markReconciled(id)` flips the row.
 *   - On failure → leaves the row pending; records the error in the
 *     returned `failures[]` array. The next invocation will retry that id.
 *   - Returns aggregate stats (`{ attempted, succeeded, failed, failures }`).
 *
 * The function never throws on a single-session failure — it accumulates
 * and continues — because partial progress is more valuable than
 * all-or-nothing semantics for an offline-recovery flow.
 */

import * as Sentry from '@sentry/core';

import {
  canonicalForHmac,
  deleteSession,
  listPending,
  markReconciled,
  migrateLegacyQueueEntries,
  type QueuedSession,
} from './encryptedOfflineQueue';
import { verifyPayload, currentKeyId } from './hmac';
import { withSentryScope } from '../observability/sentryInstrumentation';

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
  /**
   * Entries kept but not written: signed by a session key that no longer
   * exists (the app was closed), so integrity cannot be proven. NOT
   * failures and NOT tampering — they stay in the queue instead of being
   * destroyed, which is what used to happen to a worker's offline work.
   */
  unverifiable: number;
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
 * Verify a queued session's HMAC tag. Returns one of three states:
 *   - `'ok'`         — tag present and verified.
 *   - `'legacy'`     — no `hmac` field (pre-mitigation entry).
 *   - `'mismatch'`   — tag present but verification failed (tampered).
 *
 * Legacy entries are tolerated for one sprint horizon — see the file-
 * level docstring's TM-T03 note. Tampered entries should be dropped
 * by the caller and reported to Sentry.
 */
async function checkIntegrity(
  session: QueuedSession,
): Promise<'ok' | 'legacy' | 'mismatch' | 'unverifiable'> {
  if (typeof session.hmac !== 'string' || session.hmac.length === 0) {
    return 'legacy';
  }

  // A failed verification has two causes with opposite meanings:
  //   - signed by THIS session's key, tag does not match → tampering.
  //   - signed by a key we no longer hold → we simply cannot check it.
  // The second is the normal consequence of closing the app: the HMAC key
  // lives in sessionStorage by design (see hmac.ts) and dies with the tab.
  // Conflating them destroyed legitimate work a worker captured offline,
  // and reported it to Sentry as an attack.
  if (typeof session.hmacKeyId === 'string' && session.hmacKeyId.length > 0) {
    let activeKeyId: string | null = null;
    try {
      activeKeyId = await currentKeyId();
    } catch {
      // No usable key in this environment — nothing can be verified.
      return 'unverifiable';
    }
    if (session.hmacKeyId !== activeKeyId) return 'unverifiable';
  }

  const canonical = canonicalForHmac({
    id: session.id,
    query: session.query,
    response: session.response,
    createdAt: session.createdAt,
  });
  const ok = await verifyPayload(canonical, session.hmac);
  if (ok) return 'ok';

  // Records written before `hmacKeyId` existed cannot be attributed to a
  // key, so a failure here is ambiguous. Erring toward "unverifiable" keeps
  // the worker's data; it never enters the corpus unverified either way, so
  // the tamper-resistance property (TM-T03) is preserved.
  return session.hmacKeyId ? 'mismatch' : 'unverifiable';
}

/**
 * Drain the offline queue into the Zettelkasten.
 *
 * Iterates pending sessions in chronological order (the order in which
 * they were captured offline) and invokes `zettelkastenWriteFn` for
 * each. Successes are marked reconciled; failures are accumulated and
 * surfaced via the result so the caller can decide whether to retry,
 * back off, or escalate.
 *
 * Integrity (TM-T03):
 *   - HMAC mismatch → entry deleted from queue, counted as `failed`,
 *     `Sentry.captureMessage('slm.queue.hmac_mismatch', ...)` fired.
 *   - Legacy entry (no `hmac`) → breadcrumb emitted and entry treated
 *     as a normal write candidate. TODO Sprint 22: flip to drop.
 */
export async function reconcileOfflineSessions(
  opts: ReconcileOptions,
): Promise<ReconciliationResult> {
  return withSentryScope(
    'zettelkasten',
    { action: 'reconcile' },
    async () => reconcileOfflineSessionsImpl(opts),
  );
}

async function reconcileOfflineSessionsImpl(
  opts: ReconcileOptions,
): Promise<ReconciliationResult> {
  // Privacy [P1]: the encrypted queue's listPending() throws on any legacy
  // plaintext row (it can't decrypt one). Migrate first — this both unblocks
  // the drain AND is what actually wipes the plaintext query/response from
  // disk (put() replaces the record without the legacy fields). Idempotent
  // and a cheap no-op once the store is fully encrypted.
  await migrateLegacyQueueEntries();
  const pending = await listPending();
  const result: ReconciliationResult = {
    attempted: pending.length,
    succeeded: 0,
    failed: 0,
    failures: [],
    unverifiable: 0,
  };

  for (const session of pending) {
    const integrity = await checkIntegrity(session);

    if (integrity === 'mismatch') {
      // Tampered entry. Drop it from the queue so subsequent passes
      // don't re-alert on the same record, count it as failed, and
      // surface a Sentry warning so a human operator can investigate.
      try {
        Sentry.captureMessage('slm.queue.hmac_mismatch', {
          level: 'warning',
          extra: { sessionId: session.id },
        });
      } catch {
        /* observability faults must not mask the drop */
      }
      try {
        await deleteSession(session.id);
      } catch {
        /* swallow — best-effort cleanup, the next pass will retry */
      }
      result.failed += 1;
      result.failures.push({
        sessionId: session.id,
        error: 'hmac_mismatch: queue entry dropped',
      });
      continue;
    }

    if (integrity === 'unverifiable') {
      // The worker closed the app: the session key that signed this entry is
      // gone. We cannot prove the record is intact, so it must NOT enter the
      // safety corpus — but it is almost certainly their genuine offline
      // work, so deleting it (what used to happen) is the worse error of the
      // two. Keep it, count it, and do not raise a tampering alert: those
      // alerts have to stay meaningful for the real thing.
      result.unverifiable += 1;
      continue;
    }

    if (integrity === 'legacy') {
      // TODO(sprint-22): flip this branch to drop legacy entries once
      // any pre-mitigation queues have been drained. For now we
      // breadcrumb so an operator can monitor whether the legacy
      // population goes to zero before we tighten the rule.
      try {
        Sentry.addBreadcrumb({
          category: 'slm.queue.unsigned_legacy',
          level: 'info',
          message: 'reconciling pre-HMAC queue entry',
          data: { sessionId: session.id },
        });
      } catch {
        /* swallow */
      }
    }

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
