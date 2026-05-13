// Praeventio Guard — Sprint 49 D.8.b: DTE Issue Queue (pure).
//
// PURPOSE
//   In-memory / persistence-agnostic queue helpers around a DTE issuance
//   entry. Pure: every function returns a new entry — no mutation, no I/O.
//   The caller (a Firestore-backed worker in a future sprint) is responsible
//   for reading/writing the entry into its store.
//
// BACKOFF
//   Exponential ladder per attempt index (1-based):
//     attempt 1 → 1 min
//     attempt 2 → 5 min
//     attempt 3 → 30 min
//     attempt 4 → 2 h
//     attempt 5 → 24 h
//     attempt ≥ 6 → permanent_failure (no further retries)
//
//   Rationale: pay-then-DTE-fail is a high-visibility customer story. Short
//   first retry recovers from transient PSE blips; the 24h tail gives ops a
//   reasonable window to fix a CAF exhaustion / credential outage before we
//   permanently escalate to manual review.

import type { DteIssueDecision } from './dteAutoIssueOrchestrator';

// ─── Public types ─────────────────────────────────────────────────────────

export type QueueEntryStatus =
  | 'pending'
  | 'in_flight'
  | 'succeeded'
  | 'failed_retry'
  | 'permanent_failure';

export interface QueueEntry {
  /** Mirrors `decision.idempotencyKey` — primary key in any backing store. */
  idempotencyKey: string;
  decision: DteIssueDecision;
  status: QueueEntryStatus;
  /** 0 before the first attempt; incremented on each markFailed / start. */
  attempts: number;
  lastError?: string;
  /** ISO 8601. Absent for terminal states / pending=now. */
  nextAttemptAt?: string;
  /** ISO 8601 — when the entry was first enqueued. */
  createdAt: string;
  /** ISO 8601 — last state transition. */
  updatedAt: string;
  /** Set on `markIssued`. Provider response opaque to the queue. */
  providerResponse?: ProviderResponseSnapshot;
}

export interface ProviderResponseSnapshot {
  /** Adapter name (`bsale`, `openfactura`, etc.) — string for forward-compat. */
  provider: string;
  /** Folio number assigned by the PSE / SII. */
  folio?: number;
  /** Tracking id for status polling. */
  trackId?: string;
  /** Hosted PDF URL (PSE-served). */
  pdfUrl?: string;
}

// ─── Backoff schedule ────────────────────────────────────────────────────

/**
 * Backoff schedule in milliseconds, indexed by the attempt number that
 * JUST FAILED. After attempt 5 we give up and mark permanent_failure.
 */
export const BACKOFF_SCHEDULE_MS: readonly number[] = [
  60_000,           // attempt 1 failed → wait 1 min for attempt 2
  5 * 60_000,       // attempt 2 failed → wait 5 min for attempt 3
  30 * 60_000,      // attempt 3 failed → wait 30 min for attempt 4
  2 * 60 * 60_000,  // attempt 4 failed → wait 2 h for attempt 5
  24 * 60 * 60_000, // attempt 5 failed → wait 24 h (BUT we mark permanent)
] as const;

export const MAX_ATTEMPTS = BACKOFF_SCHEDULE_MS.length;

// ─── Helpers ─────────────────────────────────────────────────────────────

function isoNow(now: Date | number = new Date()): string {
  return (now instanceof Date ? now : new Date(now)).toISOString();
}

/**
 * Build a fresh queue entry from a decision. Status starts as `pending`
 * with `nextAttemptAt = now` (ready to dispatch immediately).
 */
export function enqueue(
  decision: DteIssueDecision,
  now: Date = new Date(),
): QueueEntry {
  const ts = isoNow(now);
  return {
    idempotencyKey: decision.idempotencyKey,
    decision,
    status: 'pending',
    attempts: 0,
    nextAttemptAt: ts,
    createdAt: ts,
    updatedAt: ts,
  };
}

/**
 * Pure predicate: should the worker attempt this entry right now?
 *
 * Returns true iff status is retryable (`pending` or `failed_retry`) AND
 * `nextAttemptAt` is in the past (or unset).
 */
export function shouldRetry(entry: QueueEntry, now: Date = new Date()): boolean {
  if (entry.status === 'succeeded' || entry.status === 'permanent_failure') {
    return false;
  }
  if (entry.status === 'in_flight') return false;
  if (!entry.nextAttemptAt) return true;
  return new Date(entry.nextAttemptAt).getTime() <= now.getTime();
}

/**
 * Transition to `in_flight` and bump the attempt counter. Worker calls this
 * immediately before invoking the PSE adapter so a crash mid-flight leaves a
 * visible trace.
 */
export function markInFlight(entry: QueueEntry, now: Date = new Date()): QueueEntry {
  return {
    ...entry,
    status: 'in_flight',
    attempts: entry.attempts + 1,
    updatedAt: isoNow(now),
  };
}

/**
 * Terminal success state. Stamps the provider response for audit.
 */
export function markIssued(
  entry: QueueEntry,
  providerResponse: ProviderResponseSnapshot,
  now: Date = new Date(),
): QueueEntry {
  return {
    ...entry,
    status: 'succeeded',
    lastError: undefined,
    nextAttemptAt: undefined,
    providerResponse,
    updatedAt: isoNow(now),
  };
}

/**
 * Retryable failure. Computes the next attempt time from the backoff ladder.
 * After `MAX_ATTEMPTS` failures, transitions to `permanent_failure`.
 *
 * Caller MUST have already called `markInFlight` (which bumped attempts).
 * If `entry.attempts === 0` we treat it as a defensive bump — same effect.
 */
export function markFailed(
  entry: QueueEntry,
  error: string,
  now: Date = new Date(),
): QueueEntry {
  const attempts = Math.max(entry.attempts, 1);
  if (attempts >= MAX_ATTEMPTS) {
    return {
      ...entry,
      status: 'permanent_failure',
      attempts,
      lastError: error,
      nextAttemptAt: undefined,
      updatedAt: isoNow(now),
    };
  }
  const backoffMs = BACKOFF_SCHEDULE_MS[attempts - 1] ?? 24 * 60 * 60_000;
  const nextTs = isoNow(new Date(now.getTime() + backoffMs));
  return {
    ...entry,
    status: 'failed_retry',
    attempts,
    lastError: error,
    nextAttemptAt: nextTs,
    updatedAt: isoNow(now),
  };
}
