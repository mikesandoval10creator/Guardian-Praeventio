// Praeventio Guard — B5/B15 remediation (2026-06-11): DTE issue queue
// PERSISTENCE.
//
// `dteIssueQueue.ts` shipped the pure state machine (backoff ladder, status
// transitions) in Sprint 49, but nothing ever persisted an entry — if the
// PSE (Bsale) was down right after a payment, the DTE was silently lost.
// This module is the Firestore-backed store side of that contract:
//
//   • Collection: `dte_issue_queue/{idempotencyKey}` — SERVER-ONLY via the
//     Admin SDK, exactly like `invoices/{id}` and the `processed_*` locks
//     (see BILLING.md "Firestore"). `firestore.rules` stays default-deny on
//     purpose: no client ever reads or writes queue entries, so no client
//     rules / rules-tests are needed (no new client-facing surface).
//   • Doc id = `decision.idempotencyKey` = sha256(paymentId|tenantId) —
//     DETERMINISTIC per invoice. Re-enqueueing the same payment can never
//     create a second job, and a job that already succeeded is never reset,
//     so a drained job can never double-emit a DTE.
//
// The drain worker lives in `src/server/jobs/runDteIssueQueueDrain.ts`
// (mounted as a step of POST /api/maintenance/check-overdue, mirroring
// `checkExpiredPpe`).

import type { Firestore } from 'firebase-admin/firestore';

import type { DteIssueDecision } from './dteAutoIssueOrchestrator';
import { enqueue, type QueueEntry } from './dteIssueQueue';

export const DTE_ISSUE_QUEUE_COLLECTION = 'dte_issue_queue';

/**
 * Narrow invoice snapshot persisted with the job — exactly the fields
 * `tryAutoIssueDte` needs to re-run the emission at drain time. We do NOT
 * persist the whole invoice doc (server stamps, payment tokens, audit
 * metadata stay out of the queue).
 */
export interface DteQueueInvoicePayload {
  id: string;
  status: 'paid';
  paidAt?: string;
  paymentMethod?: string;
  cliente?: { nombre?: string; rut?: string; email?: string };
  lineItems?: Array<{
    tierId?: string;
    description?: string;
    quantity?: number;
    unitAmount?: number;
    currency?: string;
  }>;
  totals?: { subtotal?: number; iva?: number; total?: number; currency?: string };
}

/** Full queue document shape (pure entry + persistence-only fields). */
export interface DteQueueDoc extends QueueEntry {
  invoice: DteQueueInvoicePayload;
  /** Which rail enqueued the job (`mark-paid`, `khipu-ipn`, …). */
  source: string;
}

export type EnqueueDteIssueOutcome =
  | 'enqueued'
  | 'already-queued'
  | 'already-succeeded';

/** Firestore rejects `undefined` values without ignoreUndefinedProperties. */
function stripUndefined<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

/** Serialize a queue entry + persistence fields into a Firestore-safe doc. */
export function queueEntryToDoc(
  entry: QueueEntry,
  invoice: DteQueueInvoicePayload,
  source: string,
): Record<string, unknown> {
  return stripUndefined({
    ...entry,
    ...(entry.providerResponse
      ? { providerResponse: stripUndefined(entry.providerResponse as unknown as Record<string, unknown>) }
      : {}),
    invoice,
    source,
  });
}

/**
 * Build the narrowed invoice payload from raw Firestore invoice data. The
 * raw doc may carry Timestamps / extra fields — only the DTE-relevant subset
 * survives, re-hydrated to `status: 'paid'` (the queue only ever holds jobs
 * for paid invoices).
 */
export function buildDteQueueInvoicePayload(
  invoiceId: string,
  raw: Record<string, unknown>,
  paidAtIso: string,
): DteQueueInvoicePayload {
  const cliente = (raw.cliente ?? {}) as DteQueueInvoicePayload['cliente'];
  return {
    id: invoiceId,
    status: 'paid',
    paidAt: paidAtIso,
    paymentMethod: typeof raw.paymentMethod === 'string' ? raw.paymentMethod : undefined,
    cliente,
    lineItems: Array.isArray(raw.lineItems)
      ? (raw.lineItems as DteQueueInvoicePayload['lineItems'])
      : [],
    totals: (raw.totals ?? {}) as DteQueueInvoicePayload['totals'],
  };
}

/**
 * Decide whether an `tryAutoIssueDte` outcome should be persisted to the
 * retry queue. Shared by every payment rail (mark-paid, webpay, khipu, MP) so
 * the "what gets retried" rule lives in ONE place and cannot drift between
 * call sites.
 *
 * Queue ONLY transient/recoverable failures:
 *   • `errorMessage` present  → adapter threw / PSE outage → retry.
 *   • `skipped: 'no-adapter'` → Bsale credential not yet wired → retry.
 *
 * Never queue deliberate skips (`disabled` env gate, `usd` CLP-only,
 * `invalid-status`, `not-configured`) — those are decisions, not failures.
 * The structural param accepts `AutoIssueDteResult` without importing it
 * (avoids a route→service-layer type coupling).
 */
export function shouldQueueDteRetry(result: {
  ok: boolean;
  skipped?: string;
  errorMessage?: string;
}): boolean {
  if (result.ok) return false;
  return Boolean(result.errorMessage) || result.skipped === 'no-adapter';
}

/**
 * Persist a pending DTE issue job. Create-if-absent semantics:
 *
 *   • doc absent              → fresh `pending` entry (ready to drain now).
 *   • doc exists, succeeded   → no-op — NEVER reset a done job (idempotency).
 *   • doc exists, any other   → no-op — keep its attempt/backoff state; the
 *     drain worker owns transitions once a job is persisted.
 */
export async function enqueueDteIssueJob(
  db: Firestore,
  decision: DteIssueDecision,
  invoice: DteQueueInvoicePayload,
  source: string,
  now: Date = new Date(),
): Promise<EnqueueDteIssueOutcome> {
  const ref = db.collection(DTE_ISSUE_QUEUE_COLLECTION).doc(decision.idempotencyKey);
  const snap = await ref.get();
  if (snap.exists) {
    const data = snap.data() as DteQueueDoc | undefined;
    return data?.status === 'succeeded' ? 'already-succeeded' : 'already-queued';
  }
  const entry = enqueue(decision, now);
  await ref.set(queueEntryToDoc(entry, invoice, source));
  return 'enqueued';
}
