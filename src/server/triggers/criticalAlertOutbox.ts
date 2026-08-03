// Praeventio Guard — P0 outbox transaccional para notificaciones críticas.
//
// Autoridad de entrega para alertas de vida: `critical_alert_outbox/{nodeId}`.
// El trigger del nodo crea el outbox create-once con payload congelado; un
// worker claim (pending→processing con lease), entrega FCM+email y marca sent
// (≥1 canal) o failed (backoff exponencial) / dead_lettered (cap de intentos).
// El claim binario del nodo (`_criticalAlertSentAt`) se conserva como espejo y
// solo se escribe al llegar a sent — nunca antes.

export const CRITICAL_OUTBOX_MAX_ATTEMPTS = 12;

export interface FrozenAlertPayload {
  projectId: string;
  nodeId: string;
  title: string;
  description?: string;
  severity: string;
  location?: string;
  supervisorUids: string[];
  fcmTokens: string[];
  emailRecipients: string[];
  capturedAtMs: number;
}

export interface CriticalAlertOutbox {
  status: 'pending' | 'processing' | 'sent' | 'dead_lettered';
  attempts: number;
  payload: FrozenAlertPayload;
  lastError?: string;
  deadLetteredAtMs?: number;
  delivery?: { fcmDelivered: number; fcmAttempted: number; emailDelivered: boolean };
}

export interface OutboxClaimFields {
  completedAt: string;
  leaseUntilMs: string;
  claimToken: string;
  attempts: string;
}

interface TxSnapshot {
  exists: boolean;
  data(): Record<string, unknown> | undefined;
}

interface TxLike {
  get(ref: unknown): Promise<TxSnapshot>;
  create(ref: unknown, value: Record<string, unknown>): void;
  update(ref: unknown, patch: Record<string, unknown>): void;
}

interface TransactionalStore {
  runTransaction<T>(fn: (tx: TxLike) => Promise<T>): Promise<T>;
}

type OutboxRef = unknown;

// ───────────────────────────────────────────────────────────────────────────
// Create-once
// ───────────────────────────────────────────────────────────────────────────

export interface CreateCriticalAlertOutboxArgs {
  db: TransactionalStore;
  ref: OutboxRef;
  payload: FrozenAlertPayload;
  nowMs: number;
}

/** Create the outbox exactly once; a second writer gets `false`, never an overwrite. */
export function createCriticalAlertOutbox(
  args: CreateCriticalAlertOutboxArgs,
): Promise<boolean> {
  const { db, ref, payload, nowMs } = args;
  return db.runTransaction(async (tx) => {
    const existing = await tx.get(ref);
    if (existing.exists) return false;
    tx.create(ref, {
      status: 'pending',
      attempts: 0,
      payload,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
    } satisfies CriticalAlertOutbox & { createdAtMs: number; updatedAtMs: number });
    return true;
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Claim
// ───────────────────────────────────────────────────────────────────────────

export type OutboxClaimResult =
  | { kind: 'claimed'; token: string }
  | { kind: 'completed' }
  | { kind: 'leased'; retryAfterMs: number };

export interface ClaimOutboxForDeliveryArgs {
  db: TransactionalStore;
  ref: OutboxRef;
  fields: OutboxClaimFields;
  nowMs: number;
  leaseMs: number;
  token: string;
}

/** Atomically claim pending outbox work, honoring terminal/live states. */
export function claimOutboxForDelivery(
  args: ClaimOutboxForDeliveryArgs,
): Promise<OutboxClaimResult> {
  const { db, ref, fields, nowMs, leaseMs, token } = args;
  return db.runTransaction(async (tx) => {
    const data = (await tx.get(ref)).data() ?? {};
    if (data.status === 'sent' || data.status === 'dead_lettered') {
      return { kind: 'completed' } as const;
    }

    const leaseUntil = data[fields.leaseUntilMs];
    if (typeof leaseUntil === 'number' && Number.isFinite(leaseUntil) && leaseUntil > nowMs) {
      return { kind: 'leased', retryAfterMs: leaseUntil - nowMs } as const;
    }

    const previousAttempts = data[fields.attempts];
    const attempts =
      typeof previousAttempts === 'number' && Number.isFinite(previousAttempts)
        ? Math.max(0, Math.trunc(previousAttempts)) + 1
        : 1;
    tx.update(ref, {
      status: 'processing',
      [fields.leaseUntilMs]: nowMs + leaseMs,
      [fields.claimToken]: token,
      [fields.attempts]: attempts,
      updatedAtMs: nowMs,
    });
    return { kind: 'claimed', token } as const;
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Sent / Failed / Dead-letter
// ───────────────────────────────────────────────────────────────────────────

export interface MarkOutboxSentArgs {
  db: TransactionalStore;
  ref: OutboxRef;
  fields: OutboxClaimFields;
  token: string;
  delivery: { fcmDelivered: number; fcmAttempted: number; emailDelivered: boolean };
  nowMs: number;
}

/** Mark sent only while this worker still owns the claim; stale workers lose. */
export function markOutboxSent(args: MarkOutboxSentArgs): Promise<boolean> {
  const { db, ref, fields, token, delivery, nowMs } = args;
  return db.runTransaction(async (tx) => {
    const data = (await tx.get(ref)).data() ?? {};
    if (data[fields.claimToken] !== token) return false;
    if (data.status === 'sent') return false;
    tx.update(ref, {
      status: 'sent',
      [fields.completedAt]: nowMs,
      [fields.leaseUntilMs]: null,
      [fields.claimToken]: null,
      delivery,
      updatedAtMs: nowMs,
    });
    return true;
  });
}

export type OutboxFailureResult =
  | { kind: 'failed'; nextAttemptAtMs: number }
  | { kind: 'dead_lettered' };

export interface MarkOutboxFailedArgs {
  db: TransactionalStore;
  ref: OutboxRef;
  fields: OutboxClaimFields;
  token: string;
  lastError: string;
  nowMs: number;
  backoffBaseMs: number;
  maxAttempts?: number;
}

/** Zero channels delivered → backoff retry, or dead-letter past the attempt cap. */
export function markOutboxFailed(args: MarkOutboxFailedArgs): Promise<OutboxFailureResult> {
  const { db, ref, fields, token, lastError, nowMs, backoffBaseMs } = args;
  const maxAttempts = args.maxAttempts ?? CRITICAL_OUTBOX_MAX_ATTEMPTS;
  return db.runTransaction(async (tx) => {
    const data = (await tx.get(ref)).data() ?? {};
    if (data[fields.claimToken] !== token) {
      // Claim was lost (lease stolen / completed elsewhere); treat as terminal
      // no-op so a stale worker cannot resurrect the outbox.
      return { kind: 'dead_lettered' } as const;
    }
    const attempts =
      typeof data[fields.attempts] === 'number' && Number.isFinite(data[fields.attempts])
        ? Math.trunc(data[fields.attempts] as number)
        : 0;

    if (attempts >= maxAttempts) {
      tx.update(ref, {
        status: 'dead_lettered',
        [fields.leaseUntilMs]: null,
        [fields.claimToken]: null,
        lastError,
        deadLetteredAtMs: nowMs,
        updatedAtMs: nowMs,
      });
      return { kind: 'dead_lettered' } as const;
    }

    // Exponential backoff: base * 2^(attempts-1) → base, 2x, 4x, 8x…
    const delayMs = backoffBaseMs * 2 ** (attempts - 1);
    tx.update(ref, {
      status: 'pending',
      [fields.leaseUntilMs]: null,
      [fields.claimToken]: null,
      lastError,
      nextAttemptAtMs: nowMs + delayMs,
      updatedAtMs: nowMs,
    });
    return { kind: 'failed', nextAttemptAtMs: nowMs + delayMs } as const;
  });
}
