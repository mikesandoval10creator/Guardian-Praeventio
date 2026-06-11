// Praeventio Guard — B5/B15 remediation (2026-06-11): DTE issue queue DRAIN.
//
// Cron-invoked worker that drains `dte_issue_queue/{idempotencyKey}` docs
// persisted by `enqueueDteIssueJob` (src/services/dte/dteIssueQueueStore.ts)
// whenever a post-payment DTE emission failed transiently (PSE down, Bsale
// 5xx, credential outage). Without this worker the retry/backoff logic in
// `dteIssueQueue.ts` was pure theory — a failed emission was silently lost
// and the customer never got their boleta/factura (Res. Ex. SII 80/2014
// entitles them to the tax receipt within 24h of payment).
//
// Mounted as an independent step of POST /api/maintenance/check-overdue
// (~1 h Cloud Scheduler cadence), mirroring `checkExpiredPpe`. The hourly
// cadence is coarser than the 1/5/30-min rungs of the backoff ladder, which
// is fine: `shouldRetry` only requires `nextAttemptAt <= now`, so an entry
// simply waits for the next pass.
//
// Guarantees:
//   • Idempotent re-drain — `succeeded` / `permanent_failure` entries are
//     excluded by the status query AND by `shouldRetry`; a job that already
//     emitted can never double-emit (doc id is deterministic per invoice).
//   • Bounded retries — after MAX_ATTEMPTS (5) failed attempts the entry is
//     flipped to `permanent_failure`, an `audit_logs` row is written and the
//     error is escalated to Sentry. Never infinite.
//   • Gate respected — when DTE_AUTO_ISSUE !== 'true' the drain exits early
//     WITHOUT burning attempts, so flipping the env flag later resumes the
//     queue exactly where it stopped.

import type { Firestore } from 'firebase-admin/firestore';

import { logger } from '../../utils/logger.js';
import {
  markFailed,
  markInFlight,
  markIssued,
  shouldRetry,
  type ProviderResponseSnapshot,
} from '../../services/dte/dteIssueQueue.js';
import {
  DTE_ISSUE_QUEUE_COLLECTION,
  queueEntryToDoc,
  type DteQueueDoc,
} from '../../services/dte/dteIssueQueueStore.js';
import type { AutoIssueDteResult } from '../../services/billing/invoice.js';
import type { Invoice } from '../../services/billing/types.js';

export interface RunDteIssueQueueDrainOptions {
  /** Firestore handle. Defaults to firebase-admin (lazy import). */
  db?: Firestore;
  /** Clock override for tests / replays. */
  now?: () => Date;
  /** Max entries processed per pass. Default 50. */
  limit?: number;
  /** Override the DTE_AUTO_ISSUE env gate in tests. */
  autoIssueEnabled?: boolean;
  /** Emission function. Defaults to the real `tryAutoIssueDte`. */
  issueDte?: (invoice: Invoice) => Promise<AutoIssueDteResult>;
}

export interface DteIssueQueueDrainResult {
  /** True when DTE_AUTO_ISSUE is off — nothing was touched. */
  gateClosed: boolean;
  scanned: number;
  attempted: number;
  issued: number;
  retried: number;
  permanentFailures: number;
  skippedNotDue: number;
  errors: number;
}

/** Sentry escalation — observability failures must never crash the job. */
async function captureToSentry(err: unknown, tags: Record<string, string | null>): Promise<void> {
  try {
    const { getErrorTracker } = await import('../../services/observability/index.js');
    getErrorTracker().captureException(
      err instanceof Error ? err : new Error(String(err)),
      { endpoint: 'jobs.dteIssueQueueDrain', tags } as never,
    );
  } catch (captureErr) {
    logger.warn('dte_queue_drain_sentry_capture_failed', { err: String(captureErr) });
  }
}

export async function runDteIssueQueueDrain(
  opts: RunDteIssueQueueDrainOptions = {},
): Promise<DteIssueQueueDrainResult> {
  const result: DteIssueQueueDrainResult = {
    gateClosed: false,
    scanned: 0,
    attempted: 0,
    issued: 0,
    retried: 0,
    permanentFailures: 0,
    skippedNotDue: 0,
    errors: 0,
  };

  const enabled =
    opts.autoIssueEnabled ??
    (process.env.DTE_AUTO_ISSUE ?? 'false').toLowerCase() === 'true';
  if (!enabled) {
    // Entries stay `pending`/`failed_retry` with attempts unburned; flipping
    // DTE_AUTO_ISSUE back on resumes the queue exactly where it stopped.
    result.gateClosed = true;
    return result;
  }

  const db = opts.db ?? (await import('firebase-admin')).default.firestore();
  const now = opts.now ?? (() => new Date());
  const limit = opts.limit ?? 50;
  const issueDte =
    opts.issueDte ??
    (async (invoice: Invoice): Promise<AutoIssueDteResult> => {
      // Lazy import — keeps firebase-admin/Bsale env reads out of test paths.
      const { tryAutoIssueDte } = await import('../../services/billing/invoice.js');
      // The env gate was already checked above; pass it explicitly so a
      // mid-drain env mutation cannot half-apply.
      return tryAutoIssueDte(invoice, { autoIssueEnabled: true });
    });

  const snap = await db
    .collection(DTE_ISSUE_QUEUE_COLLECTION)
    .where('status', 'in', ['pending', 'failed_retry'])
    .limit(limit)
    .get();

  for (const doc of snap.docs) {
    result.scanned += 1;
    const data = doc.data() as DteQueueDoc;
    if (!shouldRetry(data, now())) {
      result.skippedNotDue += 1;
      continue;
    }

    // Mark in_flight BEFORE invoking the PSE so a crash mid-flight leaves a
    // visible trace (and the staleness of `shouldRetry` on `in_flight` keeps
    // a concurrent drain from double-dispatching).
    const inFlight = markInFlight(data, now());
    try {
      await doc.ref.set(queueEntryToDoc(inFlight, data.invoice, data.source));
      result.attempted += 1;

      const invoice = { ...data.invoice, status: 'paid' } as unknown as Invoice;
      const issue = await issueDte(invoice);

      if (issue.ok && issue.result) {
        const provider: ProviderResponseSnapshot = {
          provider: process.env.SII_PSE ?? 'bsale',
          folio: issue.result.folio,
          trackId: issue.result.trackingId,
          pdfUrl: issue.result.pdfUrl,
        };
        const done = markIssued(inFlight, provider, now());
        await doc.ref.set(queueEntryToDoc(done, data.invoice, data.source));
        result.issued += 1;
        // Audit invariant (CLAUDE.md #3/#14): the DTE emission is a
        // tax-relevant state change — awaited, fail-soft.
        try {
          await db.collection('audit_logs').add({
            action: 'dte.queue.issued',
            module: 'billing',
            details: {
              idempotencyKey: data.idempotencyKey,
              invoiceId: data.invoice.id,
              source: data.source,
              attempts: done.attempts,
              folio: issue.result.folio ?? null,
              documentKind: data.decision?.documentKind ?? null,
            },
            userId: null,
            userEmail: null,
            projectId: null,
            timestamp: now().toISOString(),
          });
        } catch (auditErr) {
          logger.error('dte_queue_drain_audit_failed', auditErr as Error, {
            idempotencyKey: data.idempotencyKey,
          });
          await captureToSentry(auditErr, { idempotencyKey: data.idempotencyKey });
        }
      } else {
        const errMsg =
          issue.errorMessage ??
          issue.result?.errorMessage ??
          (issue.skipped ? `skipped:${issue.skipped}` : 'unknown_dte_failure');
        const failed = markFailed(inFlight, errMsg, now());
        await doc.ref.set(queueEntryToDoc(failed, data.invoice, data.source));

        if (failed.status === 'permanent_failure') {
          result.permanentFailures += 1;
          logger.error('dte_queue_permanent_failure', new Error(errMsg), {
            idempotencyKey: data.idempotencyKey,
            invoiceId: data.invoice.id,
            attempts: failed.attempts,
          });
          await captureToSentry(new Error(`dte_queue_permanent_failure: ${errMsg}`), {
            idempotencyKey: data.idempotencyKey,
            invoiceId: data.invoice.id ?? null,
          });
          try {
            await db.collection('audit_logs').add({
              action: 'dte.queue.permanent-failure',
              module: 'billing',
              details: {
                idempotencyKey: data.idempotencyKey,
                invoiceId: data.invoice.id,
                source: data.source,
                attempts: failed.attempts,
                lastError: errMsg,
                documentKind: data.decision?.documentKind ?? null,
              },
              userId: null,
              userEmail: null,
              projectId: null,
              timestamp: now().toISOString(),
            });
          } catch (auditErr) {
            logger.error('dte_queue_drain_audit_failed', auditErr as Error, {
              idempotencyKey: data.idempotencyKey,
            });
            await captureToSentry(auditErr, { idempotencyKey: data.idempotencyKey });
          }
        } else {
          result.retried += 1;
          logger.warn('dte_queue_retry_scheduled', {
            idempotencyKey: data.idempotencyKey,
            attempts: failed.attempts,
            nextAttemptAt: failed.nextAttemptAt ?? null,
            lastError: errMsg,
          });
        }
      }
    } catch (err) {
      // Defensive: `tryAutoIssueDte` never throws, but a Firestore write
      // might. Per-entry failures never abort the drain (mirrors
      // checkExpiredPpe's per-assignment isolation).
      result.errors += 1;
      logger.error('dte_queue_drain_entry_failed', err as Error, {
        idempotencyKey: data.idempotencyKey,
      });
      await captureToSentry(err, { idempotencyKey: data.idempotencyKey });
      try {
        const failed = markFailed(inFlight, String(err), now());
        await doc.ref.set(queueEntryToDoc(failed, data.invoice, data.source));
        if (failed.status === 'permanent_failure') result.permanentFailures += 1;
      } catch (persistErr) {
        logger.error('dte_queue_drain_persist_failed', persistErr as Error, {
          idempotencyKey: data.idempotencyKey,
        });
      }
    }
  }

  return result;
}
