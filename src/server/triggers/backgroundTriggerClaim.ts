export interface BackgroundClaimFields {
  completedAt: string;
  leaseUntilMs: string;
  claimToken: string;
  attempts: string;
}

interface TransactionSnapshot {
  exists: boolean;
  data(): Record<string, unknown> | undefined;
}

interface TransactionLike {
  get(ref: unknown): Promise<TransactionSnapshot>;
  update(ref: unknown, patch: Record<string, unknown>): void;
  delete?(ref: unknown): void;
  /**
   * Strong-atomic primitive: tx.create fails if the doc already exists.
   * Unlike tx.update, this gives the Firestore emulator and prod the
   * SAME semantics — concurrent `create`s on the same doc id resolve
   * with exactly one winner, no read-then-write race window.
   */
  create(ref: unknown, value: Record<string, unknown>): void;
}

interface TransactionalStore {
  runTransaction<T>(fn: (transaction: TransactionLike) => Promise<T>): Promise<T>;
}

interface ClaimBaseArgs {
  db: TransactionalStore;
  ref: unknown;
  fields: BackgroundClaimFields;
}

export type BackgroundClaimResult =
  | { kind: 'claimed'; token: string }
  | { kind: 'completed' }
  | { kind: 'leased'; retryAfterMs: number };

export interface ClaimBackgroundWorkArgs extends ClaimBaseArgs {
  nowMs: number;
  leaseMs: number;
  token: string;
  claimPatch?: Record<string, unknown>;
  isCompleted?: (data: Record<string, unknown>) => boolean;
  /**
   * Optional strong-atomic claim ref. When provided, the transaction
   * uses `tx.create` instead of read-then-update to take the lease, so
   * concurrent claims on the same key collide on existence rather than
   * on a stale read snapshot.
   */
  claimRef?: unknown;
}

/**
 * Atomically claim pending work or report the existing terminal/live state.
 *
 * When `claimRef` is provided the transaction uses `tx.create` for the
 * lease, which is race-free in both production and the Firestore emulator.
 * Without `claimRef` we fall back to read-then-update, which can race under
 * the emulator's relaxed write-write detection.
 */
export function claimBackgroundWork(
  args: ClaimBackgroundWorkArgs,
): Promise<BackgroundClaimResult> {
  const { db, ref, fields, nowMs, leaseMs, token } = args;

  return db.runTransaction(async (transaction) => {
    const data = (await transaction.get(ref)).data() ?? {};
    const completed = args.isCompleted
      ? args.isCompleted(data)
      : data[fields.completedAt] !== undefined && data[fields.completedAt] !== null;
    if (completed) return { kind: 'completed' } as const;

    const leaseUntil = data[fields.leaseUntilMs];
    if (typeof leaseUntil === 'number' && Number.isFinite(leaseUntil) && leaseUntil > nowMs) {
      return { kind: 'leased', retryAfterMs: leaseUntil - nowMs } as const;
    }

    const attempts =
      typeof data[fields.attempts] === 'number' && Number.isFinite(data[fields.attempts])
        ? Math.max(0, Math.trunc(data[fields.attempts] as number)) + 1
        : 1;
    const claim = {
      ...(args.claimPatch ?? {}),
      [fields.leaseUntilMs]: nowMs + leaseMs,
      [fields.claimToken]: token,
      [fields.attempts]: attempts,
    };

    if (args.claimRef) {
      // Strong-atomic path: read the lease doc FIRST, then decide. A
      // concurrent winner's create() conflicts with our read → Firestore
      // (prod AND emulator) retries our transaction; on retry we see the
      // winner's lease and report `leased`. No post-abort reads.
      const leaseDoc = await transaction.get(args.claimRef);
      if (leaseDoc.exists) {
        const leaseData = leaseDoc.data() ?? {};
        const winnerLease = leaseData[fields.leaseUntilMs];
        if (
          typeof winnerLease === 'number' &&
          Number.isFinite(winnerLease) &&
          winnerLease > nowMs
        ) {
          return { kind: 'leased', retryAfterMs: winnerLease - nowMs } as const;
        }
        transaction.update(args.claimRef, claim);
        return { kind: 'claimed', token } as const;
      }
      transaction.create(args.claimRef, claim);
      return { kind: 'claimed', token } as const;
    }

    transaction.update(ref, claim);
    return { kind: 'claimed', token } as const;
  });
}

interface CompleteBackgroundWorkArgs extends ClaimBaseArgs {
  token: string;
  completionPatch: Record<string, unknown>;
  /** Optional lease ref used by the strong-atomic claim path. */
  claimRef?: unknown;
}

/** Complete only the claim still owned by `token`; stale workers cannot win. */
export function completeBackgroundWork(
  args: CompleteBackgroundWorkArgs,
): Promise<boolean> {
  const { db, ref, fields, token } = args;
  return db.runTransaction(async (transaction) => {
    // With claimRef, ownership lives in the lease doc. Without it, fall back
    // to the work ref itself (legacy inline-claim behavior).
    const ownershipRef = args.claimRef ?? ref;
    const data = (await transaction.get(ownershipRef)).data() ?? {};
    if (data[fields.claimToken] !== token) return false;
    transaction.update(ref, {
      ...args.completionPatch,
      [fields.leaseUntilMs]: null,
      [fields.claimToken]: null,
    });
    if (args.claimRef) {
      // Remove the lease doc so the next claim creates fresh instead of
      // reclaiming a stale lease.
      transaction.delete?.(args.claimRef);
    }
    return true;
  });
}

interface ReleaseBackgroundWorkArgs extends ClaimBaseArgs {
  token: string;
  failurePatch?: Record<string, unknown>;
  /** Optional lease ref used by the strong-atomic claim path. */
  claimRef?: unknown;
}

/** Release a failed claim immediately so a later snapshot/retry can reclaim it. */
export function releaseBackgroundWork(
  args: ReleaseBackgroundWorkArgs,
): Promise<boolean> {
  const { db, ref, fields, token } = args;
  return db.runTransaction(async (transaction) => {
    const ownershipRef = args.claimRef ?? ref;
    const data = (await transaction.get(ownershipRef)).data() ?? {};
    if (data[fields.claimToken] !== token) return false;
    transaction.update(ref, {
      ...(args.failurePatch ?? {}),
      [fields.leaseUntilMs]: null,
      [fields.claimToken]: null,
    });
    if (args.claimRef) {
      transaction.delete?.(args.claimRef);
    }
    return true;
  });
}
