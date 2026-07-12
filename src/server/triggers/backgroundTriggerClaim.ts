export interface BackgroundClaimFields {
  completedAt: string;
  leaseUntilMs: string;
  claimToken: string;
  attempts: string;
}

interface TransactionSnapshot {
  data(): Record<string, unknown> | undefined;
}

interface TransactionLike {
  get(ref: unknown): Promise<TransactionSnapshot>;
  update(ref: unknown, patch: Record<string, unknown>): void;
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
}

/** Atomically claim pending work or report the existing terminal/live state. */
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

    const previousAttempts = data[fields.attempts];
    const attempts =
      typeof previousAttempts === 'number' && Number.isFinite(previousAttempts)
        ? Math.max(0, Math.trunc(previousAttempts)) + 1
        : 1;
    transaction.update(ref, {
      ...(args.claimPatch ?? {}),
      [fields.leaseUntilMs]: nowMs + leaseMs,
      [fields.claimToken]: token,
      [fields.attempts]: attempts,
    });
    return { kind: 'claimed', token } as const;
  });
}

interface CompleteBackgroundWorkArgs extends ClaimBaseArgs {
  token: string;
  completionPatch: Record<string, unknown>;
}

/** Complete only the claim still owned by `token`; stale workers cannot win. */
export function completeBackgroundWork(
  args: CompleteBackgroundWorkArgs,
): Promise<boolean> {
  const { db, ref, fields, token } = args;
  return db.runTransaction(async (transaction) => {
    const data = (await transaction.get(ref)).data() ?? {};
    if (data[fields.claimToken] !== token) return false;
    transaction.update(ref, {
      ...args.completionPatch,
      [fields.leaseUntilMs]: null,
      [fields.claimToken]: null,
    });
    return true;
  });
}

interface ReleaseBackgroundWorkArgs extends ClaimBaseArgs {
  token: string;
  failurePatch?: Record<string, unknown>;
}

/** Release a failed claim immediately so a later snapshot/retry can reclaim it. */
export function releaseBackgroundWork(
  args: ReleaseBackgroundWorkArgs,
): Promise<boolean> {
  const { db, ref, fields, token } = args;
  return db.runTransaction(async (transaction) => {
    const data = (await transaction.get(ref)).data() ?? {};
    if (data[fields.claimToken] !== token) return false;
    transaction.update(ref, {
      ...(args.failurePatch ?? {}),
      [fields.leaseUntilMs]: null,
      [fields.claimToken]: null,
    });
    return true;
  });
}
