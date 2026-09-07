// Praeventio Guard — DTE queue claim/recovery boundary.
//
// The queue document is the durable invoice state; the dedicated claim
// document is the contention boundary. A transaction reads the queue and the
// claim, then creates/updates `dte_issue_claims/{idempotencyKey}` before the
// provider call. `tx.create` makes concurrent claims collide on the same
// document in Firestore production and in the emulator.
//
// This provides single-active-claim / at-least-once delivery. It does NOT
// claim exactly-once for an external PSE by itself. Bsale receives `salesId`
// from `tryAutoIssueDte` so a recovery after a provider-side timeout can use
// Bsale's documented duplicate suppression.

import { randomUUID } from 'node:crypto';
import type { DocumentReference, Firestore } from 'firebase-admin/firestore';

import {
  markInFlight,
  type QueueEntry,
} from './dteIssueQueue.js';
import {
  queueEntryToDoc,
  type DteQueueDoc,
  type DteQueueInvoicePayload,
} from './dteIssueQueueStore.js';

export const DTE_ISSUE_CLAIMS_COLLECTION = 'dte_issue_claims';
/** Five minutes: longer than the normal DTE provider request window. */
export const DTE_QUEUE_LEASE_MS = 5 * 60_000;

export type DteIssueClaimResult =
  | {
      kind: 'claimed';
      token: string;
      entry: DteQueueDoc;
      reclaimedFromStale: boolean;
    }
  | { kind: 'leased'; retryAfterMs: number }
  | { kind: 'not_due'; nextAttemptAt?: string }
  | { kind: 'legacy_stuck' }
  | { kind: 'completed' };

export interface ClaimDteIssueEntryOptions {
  db: Firestore;
  queueRef: DocumentReference;
  claimRef: DocumentReference;
  now: Date;
  leaseMs?: number;
  token?: string;
}

function parseIsoMs(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Legacy in_flight docs predate leaseExpiresAt. Their updatedAt is the only
 * safe age marker, so use it to derive the same lease window. A malformed
 * legacy timestamp is left non-reclaimable rather than guessing and risking
 * a second provider emission.
 */
function effectiveInlineLeaseExpiry(data: DteQueueDoc, leaseMs: number): number | null {
  const explicit = parseIsoMs(data.leaseExpiresAt);
  if (explicit !== null) return explicit;
  if (data.status !== 'in_flight') return null;
  const started = parseIsoMs(data.lastClaimStartedAt) ?? parseIsoMs(data.updatedAt);
  return started === null ? null : started + leaseMs;
}

function leasedResult(expiresAtMs: number, nowMs: number): DteIssueClaimResult {
  return {
    kind: 'leased',
    retryAfterMs: Math.max(0, expiresAtMs - nowMs),
  };
}

/**
 * Atomically claim a due queue entry, or report that another worker owns it.
 * The claim document is deliberately separate from the queue document: a
 * `tx.create` collision is observable to Firestore's transaction machinery,
 * unlike a read-then-update race on an already-existing queue doc.
 */
export async function claimDteIssueEntry(
  options: ClaimDteIssueEntryOptions,
): Promise<DteIssueClaimResult> {
  const nowMs = options.now.getTime();
  if (!Number.isFinite(nowMs)) throw new Error('claimDteIssueEntry requires a valid now');
  const leaseMs = options.leaseMs ?? DTE_QUEUE_LEASE_MS;
  if (!Number.isFinite(leaseMs) || leaseMs <= 0) {
    throw new Error('claimDteIssueEntry requires a positive leaseMs');
  }
  const token = options.token ?? randomUUID();
  const nowIso = options.now.toISOString();
  const leaseExpiresAt = new Date(nowMs + leaseMs).toISOString();

  return options.db.runTransaction(async (tx) => {
    const queueSnap = await tx.get(options.queueRef);
    if (!queueSnap.exists) return { kind: 'completed' } as const;
    const data = queueSnap.data() as DteQueueDoc;

    if (data.status === 'succeeded' || data.status === 'permanent_failure') {
      return { kind: 'completed' } as const;
    }

    const nextAttemptAtMs = parseIsoMs(data.nextAttemptAt);
    if (data.status !== 'in_flight' && nextAttemptAtMs !== null && nextAttemptAtMs > nowMs) {
      return { kind: 'not_due', nextAttemptAt: data.nextAttemptAt } as const;
    }

    // Read the dedicated claim before writing it. A live claim wins even if
    // the queue's inline metadata is stale or temporarily inconsistent.
    const claimSnap = await tx.get(options.claimRef);
    const inlineExpiry = effectiveInlineLeaseExpiry(data, leaseMs);
    if (claimSnap.exists) {
      const claimData = claimSnap.data() as Record<string, unknown>;
      const claimExpiry = parseIsoMs(claimData.leaseExpiresAt);
      if (claimExpiry === null) {
        return { kind: 'legacy_stuck' } as const;
      }
      if (claimExpiry !== null && claimExpiry > nowMs) {
        return leasedResult(claimExpiry, nowMs);
      }
      // An expired dedicated claim is reclaimed below with update().
    } else if (data.status === 'in_flight' && inlineExpiry === null) {
      return { kind: 'legacy_stuck' } as const;
    } else if (inlineExpiry !== null && inlineExpiry > nowMs) {
      // Legacy/new queue docs may have a live inline lease while the claim doc
      // is absent. Do not create a second claim inside that safety window.
      return leasedResult(inlineExpiry, nowMs);
    }

    const reclaimedFromStale = data.status === 'in_flight';
    const nextEntry: QueueEntry = {
      ...markInFlight(data, options.now),
      status: 'in_flight',
      nextAttemptAt: undefined,
      leaseExpiresAt,
      claimToken: token,
      lastClaimStartedAt: nowIso,
    };
    const claimDoc = {
      idempotencyKey: data.idempotencyKey,
      claimToken: token,
      leaseExpiresAt,
      lastClaimStartedAt: nowIso,
    };

    if (claimSnap.exists) {
      tx.update(options.claimRef, claimDoc);
    } else {
      tx.create(options.claimRef, claimDoc);
    }
    // Replacement set removes stale `nextAttemptAt`/lease fields while
    // retaining only the whitelisted invoice payload.
    tx.set(
      options.queueRef,
      queueEntryToDoc(nextEntry, data.invoice, data.source),
    );

    return {
      kind: 'claimed',
      token,
      entry: {
        ...nextEntry,
        invoice: data.invoice,
        source: data.source,
      },
      reclaimedFromStale,
    } as const;
  });
}

export interface FinalizeDteIssueEntryOptions {
  db: Firestore;
  queueRef: DocumentReference;
  claimRef: DocumentReference;
  token: string;
  entry: QueueEntry;
  invoice: DteQueueInvoicePayload;
  source: string;
}

/**
 * Persist a terminal/retry state only while the caller still owns the claim.
 * A stale worker cannot overwrite a newer worker's state or delete its lease.
 */
export async function finalizeDteIssueEntry(
  options: FinalizeDteIssueEntryOptions,
): Promise<boolean> {
  return options.db.runTransaction(async (tx) => {
    const claimSnap = await tx.get(options.claimRef);
    if (!claimSnap.exists) return false;
    const claimData = claimSnap.data() as Record<string, unknown>;
    if (claimData.claimToken !== options.token) return false;

    tx.set(
      options.queueRef,
      queueEntryToDoc(options.entry, options.invoice, options.source),
    );
    tx.delete(options.claimRef);
    return true;
  });
}
