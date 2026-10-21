// Atomic escalation-marker claim shared by the life-safety cron jobs.
//
// The previous cron implementations read the per-(session|event, level, day)
// marker, called the notifier, and only then wrote the marker. Two overlapping
// sweeps (multi-replica Cloud Run, retries, manual replay) could both observe
// "marker absent" and both page SAMU/brigade for the same worker.
//
// This helper claims the marker inside a Firestore transaction BEFORE the
// external notification. A claim carries a short lease so a crashed or failed
// delivery is retried by a later sweep instead of being silently marked as
// done. The delivery flag is written only after the notifier resolves.
//
// Liveness contract: this is at-least-once, never at-most-once. If a notifier
// succeeds but the subsequent "delivered" write fails, a later sweep may page
// again. For a possibly unconscious worker, a duplicate page is preferable to a
// missed one; the cron logs the partial state so ops can see it.

import { randomUUID } from "node:crypto";
import type { DocumentReference, Firestore } from "firebase-admin/firestore";

/**
 * How long a claimed marker is considered in-flight. A notifier that hangs
 * longer than this can be paged again by a later sweep; keep the lease short
 * enough that a transient FCM failure is retried on the next cron tick.
 */
export const DEFAULT_ESCALATION_CLAIM_LEASE_MS = 2 * 60_000;

export type EscalationClaimOutcome =
  | "claimed"
  | "already-delivered"
  | "in-flight";

export interface ClaimEscalationMarkerInput {
  db: Firestore;
  markerRef: DocumentReference;
  /** Immutable marker fields (session/event id, level, location, message...). */
  payload: Record<string, unknown>;
  /** Trusted clock supplied by the cron (tests inject it). */
  now: Date;
  leaseMs?: number;
}

function claimedAtMs(data: Record<string, unknown>): number | null {
  if (typeof data.claimedAtIso !== "string") return null;
  const ms = Date.parse(data.claimedAtIso);
  return Number.isFinite(ms) ? ms : null;
}

function isAlreadyExists(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const code = (e as { code?: unknown }).code;
  return code === 6 || code === "already-exists" || code === "ALREADY_EXISTS";
}

/**
 * Claims the marker if it is absent or its previous claim lease expired.
 *
 * - `claimed`: this sweep owns delivery and must call the notifier next.
 * - `already-delivered`: a prior sweep already completed (or intentionally
 *   skipped) this level for the day.
 * - `in-flight`: another sweep is currently delivering; leave it alone.
 */
export async function claimEscalationMarker(
  input: ClaimEscalationMarkerInput,
): Promise<EscalationClaimOutcome> {
  const leaseMs = input.leaseMs ?? DEFAULT_ESCALATION_CLAIM_LEASE_MS;
  const nowMs = input.now.getTime();
  const claim = {
    ...input.payload,
    notified: false,
    deliverySkipped: false,
    claimId: randomUUID(),
    claimedAtIso: input.now.toISOString(),
  };

  try {
    return await input.db.runTransaction(async (tx) => {
      const snap = await tx.get(input.markerRef);
      if (!snap.exists) {
        tx.create(input.markerRef, claim);
        return "claimed";
      }

      const data = (snap.data() ?? {}) as Record<string, unknown>;
      // `deliverySkipped` is used when no notifier is configured. Treat it as
      // final so a misconfigured deployment does not re-claim forever.
      if (data.notified === true || data.deliverySkipped === true) {
        return "already-delivered";
      }

      const previousClaimMs = claimedAtMs(data);
      if (
        previousClaimMs !== null &&
        nowMs - previousClaimMs < leaseMs
      ) {
        return "in-flight";
      }

      // Legacy marker (pre-fix) or an expired lease: re-claim atomically. The
      // merge keeps any forensic fields (e.g. firstSeenAtIso) already persisted.
      tx.set(input.markerRef, claim, { merge: true });
      return "claimed";
    });
  } catch (e) {
    // Two sweeps can both read `absent` and race to commit. Firestore aborts
    // the loser with ALREADY_EXISTS; that means the winner owns delivery, not
    // that this sweep failed. Surfacing it as `in-flight` avoids a false
    // error counter while preserving the no-double-page guarantee.
    if (isAlreadyExists(e)) return "in-flight";
    throw e;
  }
}

/**
 * Marks a claimed marker as successfully delivered. Must run after the
 * notifier resolves. A failure here is logged by the caller and leaves the
 * claim in place so the next sweep can retry after the lease.
 */
export async function markEscalationDelivered(
  markerRef: DocumentReference,
  payload: Record<string, unknown>,
  now: Date,
): Promise<void> {
  await markerRef.set(
    {
      ...payload,
      notified: true,
      deliverySkipped: false,
      notifiedAtIso: now.toISOString(),
    },
    { merge: true },
  );
}

/**
 * Marks a claimed marker as deliberately not delivered because the deployment
 * has no notifier for that level. This is not a success; it prevents endless
 * re-claims while making the gap visible in the marker.
 */
export async function markEscalationWithoutNotifier(
  markerRef: DocumentReference,
  payload: Record<string, unknown>,
  now: Date,
): Promise<void> {
  await markerRef.set(
    {
      ...payload,
      notified: false,
      deliverySkipped: true,
      skipReason: "no_notify_hook",
      skippedAtIso: now.toISOString(),
    },
    { merge: true },
  );
}
