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
// (~10 min Cloud Scheduler cadence), mirroring `checkExpiredPpe`. The
// cadence is coarser than the 1/5/30-min rungs of the backoff ladder, which
// is fine: due entries wait for the next pass.
//
// Guarantees:
//   • Single active claimant — a dedicated transactional claim document
//     prevents two workers from invoking the provider for the same key.
//   • Lease recovery — an expired `in_flight` claim can be reclaimed; a
//     malformed legacy entry is surfaced as `legacyStuck`, never guessed.
//   • Token-fenced completion — a stale worker cannot overwrite or delete a
//     newer worker's claim.
//   • Provider dedupe — the stable key is passed to Bsale as `salesId`.
//   • Bounded retries — after MAX_ATTEMPTS (5) failed attempts the entry is
//     flipped to `permanent_failure`, an `audit_logs` row is written and the
//     error is escalated to Sentry. Never infinite.
//   • Gate respected — when DTE_AUTO_ISSUE !== 'true' the drain exits early
//     WITHOUT querying or mutating the queue, so enabling it later resumes
//     where it stopped.

import { randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';

import {
  DTE_ISSUE_CLAIMS_COLLECTION,
  claimDteIssueEntry,
  DTE_QUEUE_LEASE_MS,
  finalizeDteIssueEntry,
} from '../../services/dte/dteIssueClaim.js';
import { logger } from '../../utils/logger.js';
import {
  markFailed,
  markIssued,
  type ProviderResponseSnapshot,
} from '../../services/dte/dteIssueQueue.js';
import {
  DTE_ISSUE_QUEUE_COLLECTION,
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
  issueDte?: (invoice: Invoice, idempotencyKey?: string) => Promise<AutoIssueDteResult>;
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
  skippedLeased: number;
  reclaimedFromStale: number;
  legacyStuck: number;
  completionLost: number;
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
    skippedLeased: 0,
    reclaimedFromStale: 0,
    legacyStuck: 0,
    completionLost: 0,
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
    (async (invoice: Invoice, idempotencyKey?: string): Promise<AutoIssueDteResult> => {
      // Lazy import — keeps firebase-admin/Bsale env reads out of test paths.
      const { tryAutoIssueDte } = await import('../../services/billing/invoice.js');
      // The env gate was already checked above; pass it explicitly so a
      // mid-drain env mutation cannot half-apply. The stable key reaches
      // Bsale as `salesId` for provider-side duplicate suppression.
      return tryAutoIssueDte(invoice, { autoIssueEnabled: true, idempotencyKey });
    });

  const snap = await db
    .collection(DTE_ISSUE_QUEUE_COLLECTION)
    .where('status', 'in', ['pending', 'failed_retry', 'in_flight'])
    .limit(limit)
    .get();

  for (const doc of snap.docs) {
    result.scanned += 1;
    const data = doc.data() as DteQueueDoc;
    const claimRef = db.collection(DTE_ISSUE_CLAIMS_COLLECTION).doc(data.idempotencyKey);

    let claim;
    try {
      claim = await claimDteIssueEntry({
        db,
        queueRef: doc.ref,
        claimRef,
        now: now(),
        leaseMs: DTE_QUEUE_LEASE_MS,
        token: randomUUID(),
      });
    } catch (err) {
      result.errors += 1;
      logger.error('dte_queue_claim_failed', err as Error, {
        idempotencyKey: data.idempotencyKey,
      });
      await captureToSentry(err, { idempotencyKey: data.idempotencyKey });
      continue;
    }

    if (claim.kind === 'not_due') {
      result.skippedNotDue += 1;
      continue;
    }
    if (claim.kind === 'leased') {
      result.skippedLeased += 1;
      continue;
    }
    if (claim.kind === 'legacy_stuck') {
      result.legacyStuck += 1;
      logger.error('dte_queue_legacy_in_flight_unrecoverable', new Error('legacy_in_flight_without_timestamp'), {
        idempotencyKey: data.idempotencyKey,
      });
      continue;
    }
    if (claim.kind === 'completed') continue;
    if (claim.reclaimedFromStale) result.reclaimedFromStale += 1;

    result.attempted += 1;
    const queueData = claim.entry;
    const invoice = { ...queueData.invoice, status: 'paid' } as unknown as Invoice;
    let issue: AutoIssueDteResult;

    try {
      issue = await issueDte(invoice, queueData.idempotencyKey);
    } catch (err) {
      result.errors += 1;
      logger.error('dte_queue_drain_entry_failed', err as Error, {
        idempotencyKey: queueData.idempotencyKey,
      });
      await captureToSentry(err, { idempotencyKey: queueData.idempotencyKey });

      const failed = markFailed(queueData, String(err), now());
      try {
        const finalized = await finalizeDteIssueEntry({
          db,
          queueRef: doc.ref,
          claimRef,
          token: claim.token,
          entry: failed,
          invoice: queueData.invoice,
          source: queueData.source,
        });
        if (!finalized) result.completionLost += 1;
        if (finalized && failed.status === 'permanent_failure') {
          result.permanentFailures += 1;
        }
      } catch (persistErr) {
        result.completionLost += 1;
        logger.error('dte_queue_drain_persist_failed', persistErr as Error, {
          idempotencyKey: queueData.idempotencyKey,
        });
        await captureToSentry(persistErr, { idempotencyKey: queueData.idempotencyKey });
      }
      continue;
    }

    if (issue.ok && issue.result) {
      const provider: ProviderResponseSnapshot = {
        provider: process.env.SII_PSE ?? 'bsale',
        folio: issue.result.folio,
        trackId: issue.result.trackingId,
        pdfUrl: issue.result.pdfUrl,
      };
      const done = markIssued(queueData, provider, now());
      try {
        const finalized = await finalizeDteIssueEntry({
          db,
          queueRef: doc.ref,
          claimRef,
          token: claim.token,
          entry: done,
          invoice: queueData.invoice,
          source: queueData.source,
        });
        if (!finalized) {
          result.completionLost += 1;
          logger.warn('dte_queue_completion_lost', {
            idempotencyKey: queueData.idempotencyKey,
          });
          continue;
        }
      } catch (completionErr) {
        result.errors += 1;
        result.completionLost += 1;
        logger.error('dte_queue_completion_failed', completionErr as Error, {
          idempotencyKey: queueData.idempotencyKey,
        });
        await captureToSentry(completionErr, { idempotencyKey: queueData.idempotencyKey });
        continue;
      }

      result.issued += 1;
      // Audit invariant (CLAUDE.md #3/#14): the DTE emission is a
      // tax-relevant state change — awaited, fail-soft.
      try {
        await db.collection('audit_logs').add({
          action: 'dte.queue.issued',
          module: 'billing',
          details: {
            idempotencyKey: queueData.idempotencyKey,
            invoiceId: queueData.invoice.id,
            source: queueData.source,
            attempts: done.attempts,
            folio: issue.result.folio ?? null,
            documentKind: queueData.decision?.documentKind ?? null,
          },
          userId: null,
          userEmail: null,
          projectId: null,
          timestamp: now().toISOString(),
        });
      } catch (auditErr) {
        logger.error('dte_queue_drain_audit_failed', auditErr as Error, {
          idempotencyKey: queueData.idempotencyKey,
        });
        await captureToSentry(auditErr, { idempotencyKey: queueData.idempotencyKey });
      }
      continue;
    }

    const errMsg =
      issue.errorMessage ??
      issue.result?.errorMessage ??
      (issue.skipped ? `skipped:${issue.skipped}` : 'unknown_dte_failure');
    const failed = markFailed(queueData, errMsg, now());
    let finalized = false;
    let finalizationError = false;
    try {
      finalized = await finalizeDteIssueEntry({
        db,
        queueRef: doc.ref,
        claimRef,
        token: claim.token,
        entry: failed,
        invoice: queueData.invoice,
        source: queueData.source,
      });
    } catch (completionErr) {
      finalizationError = true;
      result.errors += 1;
      result.completionLost += 1;
      logger.error('dte_queue_completion_failed', completionErr as Error, {
        idempotencyKey: queueData.idempotencyKey,
      });
      await captureToSentry(completionErr, { idempotencyKey: queueData.idempotencyKey });
    }
    if (!finalized) {
      if (!finalizationError) {
        result.completionLost += 1;
        logger.warn('dte_queue_completion_lost', {
          idempotencyKey: queueData.idempotencyKey,
        });
      }
      continue;
    }

    if (failed.status === 'permanent_failure') {
      result.permanentFailures += 1;
      logger.error('dte_queue_permanent_failure', new Error(errMsg), {
        idempotencyKey: queueData.idempotencyKey,
        invoiceId: queueData.invoice.id,
        attempts: failed.attempts,
      });
      await captureToSentry(new Error(`dte_queue_permanent_failure: ${errMsg}`), {
        idempotencyKey: queueData.idempotencyKey,
        invoiceId: queueData.invoice.id ?? null,
      });
      try {
        await db.collection('audit_logs').add({
          action: 'dte.queue.permanent-failure',
          module: 'billing',
          details: {
            idempotencyKey: queueData.idempotencyKey,
            invoiceId: queueData.invoice.id,
            source: queueData.source,
            attempts: failed.attempts,
            lastError: errMsg,
            documentKind: queueData.decision?.documentKind ?? null,
          },
          userId: null,
          userEmail: null,
          projectId: null,
          timestamp: now().toISOString(),
        });
      } catch (auditErr) {
        logger.error('dte_queue_drain_audit_failed', auditErr as Error, {
          idempotencyKey: queueData.idempotencyKey,
        });
        await captureToSentry(auditErr, { idempotencyKey: queueData.idempotencyKey });
      }
    } else {
      result.retried += 1;
      logger.warn('dte_queue_retry_scheduled', {
        idempotencyKey: queueData.idempotencyKey,
        attempts: failed.attempts,
        nextAttemptAt: failed.nextAttemptAt ?? null,
        lastError: errMsg,
      });
    }
  }

  return result;
}
