// Praeventio Guard — transactional Play entitlement + post-grant ACK.
//
// Billing task 3 (playEntitlement.test.ts): the grant, the receipt
// ownership binding and the pending-acknowledgement job must commit
// TOGETHER in one Firestore transaction, BEFORE any external Play
// acknowledgement happens. Why:
//   - An ACK sent before the grant is persisted can be lost after a
//     crash: Google auto-refunds unacknowledged purchases after 3 days,
//     so a lost ACK = a refunded user who never asked for one.
//   - A receipt claimed without its Play account identifier is a known
//     fraud/legacy vector: fail closed (ReceiptOwnershipError).
//   - A receipt already bound to another uid is a replay: fail closed.
//
// The durable `play_ack_jobs` queue is drained by
// `drainPlayAcknowledgements` (called from a scheduled sweep); it
// retries transient failures with backoff and records completion.

import { FieldValue } from 'firebase-admin/firestore';
import { tierForIapSku } from '../pricing/iapSkus';

export class ReceiptOwnershipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReceiptOwnershipError';
  }
}

export interface VerifiedPlaySubscription {
  ok: true;
  productId: string;
  expiryMs: number;
  regionCode: string | null;
  linkedPurchaseToken: string | null;
  subscriptionState: string;
  /** Play's obfuscated account identifier captured at purchase time. */
  obfuscatedAccountId?: string | null;
  /** True when Google still reports the purchase PENDING acknowledgement. */
  needsAcknowledgement?: boolean;
}

interface DocRef {
  get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
  set(v: Record<string, unknown>, opts?: { merge?: boolean }): Promise<void>;
  update(v: Record<string, unknown>): Promise<void>;
}

interface Tx {
  get(ref: DocRef): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
  set(ref: DocRef, v: Record<string, unknown>, opts?: { merge?: boolean }): Promise<void>;
  update(ref: DocRef, v: Record<string, unknown>): Promise<void>;
}

interface DbLike {
  collection(name: string): {
    doc(id?: string): DocRef;
    where(field: string, op: string, value: unknown): {
      limit(n: number): {
        get(): Promise<{ docs: Array<{ ref: DocRef; data(): Record<string, unknown> }> }>;
      };
    };
  };
  runTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

const ACK_BACKOFF_MS = 60_000;

/**
 * Commit access + receipt binding + pending ACK atomically.
 *
 * @param obfuscatedAccountId the Play account identifier captured at
 *   purchase time (must equal the verified one).
 * @throws ReceiptOwnershipError on unbound/legacy tokens, mismatched
 *   account identifiers, or a replayed purchaseToken.
 */
export async function commitPlayEntitlement(
  db: DbLike,
  uid: string,
  purchaseToken: string,
  verified: VerifiedPlaySubscription,
  obfuscatedAccountId: string,
): Promise<void> {
  const entry = tierForIapSku(verified.productId);
  if (!entry) {
    throw new ReceiptOwnershipError(
      `Unknown Play SKU for entitlement grant: ${verified.productId}`,
    );
  }
  // Legacy unbound tokens carry no Play account identifier — the server
  // cannot prove WHO bought them. Fail closed; support resolves these.
  if (!verified.obfuscatedAccountId) {
    throw new ReceiptOwnershipError(
      'Receipt has no Play obfuscatedAccountId — refusing unbound token',
    );
  }
  if (verified.obfuscatedAccountId !== obfuscatedAccountId) {
    throw new ReceiptOwnershipError(
      'Receipt obfuscatedAccountId does not match the claimed account',
    );
  }

  await db.runTransaction(async (tx) => {
    const receiptRef = db.collection('play_receipts').doc(purchaseToken);
    const existing = await tx.get(receiptRef);
    if (existing.exists && existing.data()?.uid !== uid) {
      throw new ReceiptOwnershipError(
        'purchaseToken is already bound to another user — replay rejected',
      );
    }

    // 1. Access grant (dot-keys resolve as nested field paths on merge).
    const userRef = db.collection('users').doc(uid);
    await tx.set(
      userRef,
      {
        'subscription.planId': entry.tierId,
        'subscription.status': 'active',
        'subscription.expiryMs': verified.expiryMs,
        'subscription.provider': 'google-play',
        'subscription.updatedAt': FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    // 2. Receipt → uid binding (anti-replay).
    await tx.set(receiptRef, {
      uid,
      productId: verified.productId,
      boundAt: FieldValue.serverTimestamp(),
    });

    // 3. Durable ACK job — committed BEFORE any external ACK.
    if (verified.needsAcknowledgement) {
      const jobRef = db
        .collection('play_ack_jobs')
        .doc(`${purchaseToken}-ack`);
      await tx.set(jobRef, {
        uid,
        purchaseToken,
        productId: verified.productId,
        status: 'pending',
        attempts: 0,
        nextRetryAt: 0,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    // 4. Audit trail (ownership decision + grant).
    const auditRef = db.collection('audit_logs').doc();
    await tx.set(auditRef, {
      event: 'play_entitlement_committed',
      uid,
      productId: verified.productId,
      tierId: entry.tierId,
      subscriptionState: verified.subscriptionState,
      needsAcknowledgement: Boolean(verified.needsAcknowledgement),
      at: FieldValue.serverTimestamp(),
    });
  });
}

/**
 * Drain the durable `play_ack_jobs` queue: acknowledge pending Play
 * purchases, retrying transient failures with backoff and recording
 * completion. Never throws per-job failures outward — the sweep must
 * survive a dead Play API.
 */
export async function drainPlayAcknowledgements(
  db: DbLike,
  acknowledge: (job: Record<string, unknown>) => Promise<void>,
  nowMs: number = Date.now(),
): Promise<void> {
  const snap = await db
    .collection('play_ack_jobs')
    .where('status', '==', 'pending')
    .limit(25)
    .get();

  for (const doc of snap.docs) {
    const job = doc.data();
    const nextRetryAt = typeof job.nextRetryAt === 'number' ? job.nextRetryAt : 0;
    if (nextRetryAt > nowMs) continue;
    const attempts = typeof job.attempts === 'number' ? job.attempts + 1 : 1;
    try {
      await acknowledge(job);
      await doc.ref.update({
        status: 'done',
        attempts,
        ackedAt: FieldValue.serverTimestamp(),
      });
    } catch (err) {
      await doc.ref.update({
        attempts,
        nextRetryAt: nowMs + ACK_BACKOFF_MS,
        lastError: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
