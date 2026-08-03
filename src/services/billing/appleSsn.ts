// Praeventio Guard — Apple App Store Server Notifications v2 handler.
//
// Sprint 27 audit P0 fix H2: closes the IAP-iOS entitlement gap. Before
// this module shipped, POST /api/billing/iap/apple/validate-receipt only
// hashed and 202'd the receipt — there was NO server-to-server pathway
// that could activate a paid tier on iOS, so every Apple subscription
// was effectively a free trial that the server never honored.
//
// The route handler at POST /api/billing/webhook/apple in
// src/server/routes/billing.ts wires the verification + dispatch loop
// here behind the shared `withIdempotency` helper (mirrors Google Play
// RTDN's `processed_pubsub` pattern; we use `processed_apple_ssn` keyed
// by Apple's per-notification UUID).
//
// Authentication contract: every accepted notification has its outer JWS,
// certificate chain, app identity, environment, and nested transaction /
// renewal JWS values verified by Apple's official SignedDataVerifier. The
// trust roots are pinned server-side; no certificate supplied by the request
// can become a trust anchor.
//
// Apple SSN v2 reference (canonical):
//   https://developer.apple.com/documentation/appstoreservernotifications/responsebodyv2

import { logger } from '../../utils/logger.js';
import { cycleFromProductId, planFromIapProductId } from '../pricing/subscriptionPlan.js';
import { verifyAppleNotification } from './appleSignedDataVerifier.js';

// ───────────────────────────────────────────────────────────────────────────
// Apple notification types we care about.
//
// Full list at https://developer.apple.com/documentation/appstoreservernotifications/notificationtype
// — we map each one to a single dispatch action. Anything not in this
// table is logged + ACK'd 200 (so Apple doesn't redeliver) but performs
// no entitlement change. That keeps unknown / future types from leaking
// through as silent grants.
// ───────────────────────────────────────────────────────────────────────────

export type AppleSsnAction =
  | 'grant'      // SUBSCRIBED, DID_RENEW — activate / extend the subscription
  | 'grace'      // DID_FAIL_TO_RENEW + GRACE_PERIOD — temporary entitlement
  | 'revoke'     // REFUND, REVOKE        — strip the entitlement
  | 'expire'     // EXPIRED, DID_FAIL_TO_RENEW — mark inactive but keep history
  | 'noop';      // unhandled / informational types

export function actionForNotificationType(notificationType: string): AppleSsnAction {
  switch (notificationType) {
    case 'SUBSCRIBED':
    case 'DID_RENEW':
    case 'DID_CHANGE_RENEWAL_STATUS':
      return 'grant';
    case 'REFUND':
    case 'REVOKE':
      return 'revoke';
    case 'EXPIRED':
    case 'DID_FAIL_TO_RENEW':
    case 'GRACE_PERIOD_EXPIRED':
      return 'expire';
    default:
      return 'noop';
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Decoded shapes — narrow on purpose. Apple's payloads carry many more
// fields (notably the renewalInfo `signedRenewalInfo`); we only decode
// what the dispatcher needs. Add fields here when a future caller needs
// them — do NOT pass `any` through to the route handler.
// ───────────────────────────────────────────────────────────────────────────

export interface AppleSsnPayload {
  /** Apple's per-notification UUID — idempotency key. */
  notificationUUID: string;
  /** e.g. SUBSCRIBED, DID_RENEW, REFUND. */
  notificationType: string;
  /** Sometimes present (e.g. DID_CHANGE_RENEWAL_PREF subtype). */
  subtype?: string;
  /** Decoded `transactionInfo` JWT payload. */
  transactionInfo?: AppleTransactionInfo;
  /** Decoded `renewalInfo` JWT payload (subscription notifications only). */
  renewalInfo?: AppleRenewalInfo;
}

export interface AppleTransactionInfo {
  /** Apple's persistent identifier for the user across re-installs. */
  appAccountToken?: string;
  /** Subscription product id (matches Praeventio SKU like `praeventio_premium_monthly`). */
  productId?: string;
  /** Original transaction id — stable across renewals. */
  originalTransactionId?: string;
  /** Per-charge transaction id. */
  transactionId?: string;
  /** Epoch ms — when access expires. */
  expiresDate?: number;
  /** Epoch ms — when the user was billed. */
  purchaseDate?: number;
  /** 'AUTO_RENEWABLE' | 'NON_RENEWABLE' | 'CONSUMABLE' | 'NON_CONSUMABLE'. */
  type?: string;
}

export interface AppleRenewalInfo {
  productId?: string;
  autoRenewProductId?: string;
  /** 1 = auto-renew on, 0 = off. */
  autoRenewStatus?: number;
  originalTransactionId?: string;
  /** Reason an expiration occurred. */
  expirationIntent?: number;
  /** Epoch ms — access remains valid until this instant during billing retry. */
  gracePeriodExpiresDate?: number;
}

// ───────────────────────────────────────────────────────────────────────────
// JWS verification errors keep the public route contract stable while the
// cryptographic implementation lives in appleSignedDataVerifier.ts.
// ───────────────────────────────────────────────────────────────────────────

export class AppleSsnVerificationError extends Error {
  constructor(reason: string) {
    super(`Apple SSN verification failed: ${reason}`);
    this.name = 'AppleSsnVerificationError';
  }
}

/**
 * Verify and decode an Apple SSN v2 envelope. Returns the flattened
 * AppleSsnPayload + the chain-verification flag for audit.
 */
export async function verifyAndDecodeAppleSsn(
  signedPayload: string,
): Promise<{ payload: AppleSsnPayload; verifiedChain: boolean }> {
  if (typeof signedPayload !== 'string' || signedPayload.length === 0) {
    throw new AppleSsnVerificationError('empty_signed_payload');
  }
  let verified;
  try {
    verified = await verifyAppleNotification(signedPayload);
  } catch (error) {
    throw new AppleSsnVerificationError(
      error instanceof Error ? error.message : 'verification_failed',
    );
  }
  const outer = verified.notification;
  if (!outer || typeof outer.notificationUUID !== 'string') {
    throw new AppleSsnVerificationError('missing_notification_uuid');
  }
  if (typeof outer.notificationType !== 'string') {
    throw new AppleSsnVerificationError('missing_notification_type');
  }

  const tx = verified.transactionInfo;
  const transactionInfo: AppleTransactionInfo | undefined = tx
    ? {
        appAccountToken: tx.appAccountToken,
        productId: tx.productId,
        originalTransactionId: tx.originalTransactionId,
        transactionId: tx.transactionId,
        expiresDate: tx.expiresDate,
        purchaseDate: tx.purchaseDate,
        type: typeof tx.type === 'string' ? tx.type : undefined,
      }
    : undefined;

  const ri = verified.renewalInfo;
  const renewalInfo: AppleRenewalInfo | undefined = ri
    ? {
        productId: ri.productId,
        autoRenewProductId: ri.autoRenewProductId,
        autoRenewStatus:
          typeof ri.autoRenewStatus === 'number' ? ri.autoRenewStatus : undefined,
        originalTransactionId: ri.originalTransactionId,
        expirationIntent:
          typeof ri.expirationIntent === 'number' ? ri.expirationIntent : undefined,
        gracePeriodExpiresDate: ri.gracePeriodExpiresDate,
      }
    : undefined;

  return {
    verifiedChain: true,
    payload: {
      notificationUUID: outer.notificationUUID,
      notificationType: outer.notificationType,
      subtype: typeof outer.subtype === 'string' ? outer.subtype : undefined,
      transactionInfo,
      renewalInfo,
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Entitlement dispatcher.
//
// Resolves uid → (1) `appAccountToken` lookup (set by the client when it
// initiates the App Store transaction; this is the canonical link), then
// (2) `originalTransactionId` lookup against `users/{uid}.subscription.
// originalTransactionId` (populated on first SUBSCRIBED). If neither
// resolves, we audit `apple_ssn_unmatched` and ack 200 — Apple resends
// for ~24 hours, plenty of time for the validate-receipt flow to land
// the cross-reference.
//
// The Firestore shape MIRRORS the Google Play RTDN handler — see line
// 362-366 of billing.ts. Production deployments of the two handlers
// share the same `users/{uid}.subscription.{status,expiryDate,
// updatedAt}` fields so the rest of the app (Pricing.tsx, gating UI)
// doesn't need a per-platform branch.
// ───────────────────────────────────────────────────────────────────────────

export interface ApplyAppleEntitlementInput {
  payload: AppleSsnPayload;
  /** Firestore handle — accepts admin.firestore() or InMemoryFirestore. */
  db: MinimalAppleSsnFirestore;
  now?: () => Date;
}

export interface ApplyAppleEntitlementResult {
  action: AppleSsnAction;
  /** `users/{uid}` doc id we resolved, or null when no match. */
  userId: string | null;
  /** What we wrote (status / expiryDate). null when action was noop or no user. */
  applied: {
    status: 'active' | 'grace_period' | 'expired' | 'revoked';
    expiryDate: string | null;
  } | null;
}

/**
 * Minimal Firestore shape used by the dispatcher. We accept the same
 * subset as `withIdempotency` plus query support.
 */
export interface MinimalAppleSsnFirestore {
  collection(name: string): {
    doc(id: string): {
      get(): Promise<{ exists: boolean; data(): Record<string, any> | undefined }>;
      set(data: Record<string, any>, options?: { merge?: boolean }): Promise<unknown>;
      update(data: Record<string, any>): Promise<unknown>;
    };
    add(data: Record<string, any>): Promise<{ id: string }>;
    where(field: string, op: string, value: any): {
      limit(n: number): {
        get(): Promise<{
          empty: boolean;
          docs: Array<{
            id: string;
            ref: { update(data: Record<string, any>): Promise<unknown> };
            data(): Record<string, any>;
          }>;
        }>;
      };
    };
  };
}

export async function applyAppleEntitlement(
  input: ApplyAppleEntitlementInput,
): Promise<ApplyAppleEntitlementResult> {
  const { payload, db } = input;
  const now = input.now ?? (() => new Date());
  const evaluatedAt = now();
  const baseAction = actionForNotificationType(payload.notificationType);
  const graceEndMs = payload.renewalInfo?.gracePeriodExpiresDate;
  const action: AppleSsnAction =
    baseAction === 'expire' &&
    payload.notificationType === 'DID_FAIL_TO_RENEW' &&
    payload.subtype === 'GRACE_PERIOD' &&
    typeof graceEndMs === 'number' &&
    Number.isFinite(graceEndMs) &&
    graceEndMs > evaluatedAt.getTime()
      ? 'grace'
      : baseAction;

  if (action === 'noop') {
    return { action, userId: null, applied: null };
  }

  const tx = payload.transactionInfo;
  const appAccountToken = tx?.appAccountToken;
  const originalTransactionId = tx?.originalTransactionId;

  // 1. Resolve user. Try `appAccountToken` first (most reliable; set by
  //    client at purchase time and stored on the user doc by validate-
  //    receipt). Fall back to `originalTransactionId` cross-reference.
  let userId: string | null = null;
  let userRef:
    | { update(data: Record<string, any>): Promise<unknown> }
    | null = null;

  if (appAccountToken) {
    const q = await db
      .collection('users')
      .where('subscription.appleAppAccountToken', '==', appAccountToken)
      .limit(1)
      .get();
    if (!q.empty) {
      userId = q.docs[0].id;
      userRef = q.docs[0].ref;
    }
  }
  if (!userId && originalTransactionId) {
    const q = await db
      .collection('users')
      .where('subscription.appleOriginalTransactionId', '==', originalTransactionId)
      .limit(1)
      .get();
    if (!q.empty) {
      userId = q.docs[0].id;
      userRef = q.docs[0].ref;
    }
  }

  if (!userRef || !userId) {
    logger.warn('apple_ssn_unmatched_user', {
      notificationType: payload.notificationType,
      hasAppAccountToken: Boolean(appAccountToken),
      hasOriginalTransactionId: Boolean(originalTransactionId),
    });
    return { action, userId: null, applied: null };
  }

  const expiryDate = tx?.expiresDate
    ? new Date(tx.expiresDate).toISOString()
    : null;

  let status: 'active' | 'grace_period' | 'expired' | 'revoked';
  if (action === 'grant') status = 'active';
  else if (action === 'grace') status = 'grace_period';
  else if (action === 'revoke') status = 'revoked';
  else status = 'expired';
  const gracePeriodEnd =
    action === 'grace' && typeof graceEndMs === 'number'
      ? new Date(graceEndMs).toISOString()
      : null;

  // Mirror RTDN's update shape — same fields + `apple` provider tag so
  // ops can tell the two flows apart. NEVER overwrite the Google Play
  // purchaseToken if one is already set; this user has dual-platform
  // history that the support team may need to reconcile by hand.
  const subscriptionUpdate: Record<string, unknown> = {
    'subscription.status': status,
    'subscription.expiryDate': expiryDate,
    'subscription.gracePeriodEnd': gracePeriodEnd,
    'subscription.provider': 'app-store',
    'subscription.paymentMethod': 'app-store',
    'subscription.appleOriginalTransactionId':
      originalTransactionId ?? null,
    'subscription.updatedAt': evaluatedAt.toISOString(),
  };
  // Only a grant carries a (new) purchased cycle; revoke/expire must NOT
  // clobber the cycle the user originally bought.
  if (action === 'grant') {
    subscriptionUpdate['subscription.cycle'] = cycleFromProductId(tx?.productId);
    // P0 39baa66d-816f: el grant DEBE asignar el plan comprado. Antes solo
    // actualizaba estado/ciclo/expiración — el tier quedaba stale o vacío
    // para usuarios que llegaron vía SSN sin validate-receipt previo.
    // planFromIapProductId resuelve el SKU → tier; si no resuelve (config
    // bug), NO clobber: se loguea y se conserva el planId existente, igual
    // que hace el RTDN de Google (googleplay.ts:297).
    const grantedPlan = planFromIapProductId(tx?.productId);
    if (grantedPlan !== null) {
      subscriptionUpdate['subscription.planId'] = grantedPlan;
    } else {
      logger.warn('apple_ssn_grant_unmapped_sku', {
        userId,
        productId: tx?.productId ?? null,
      });
    }
  }
  await userRef.update(subscriptionUpdate);

  return {
    action,
    userId,
    applied: { status, expiryDate },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Audit row builder — used by the route handler to write
// `apple_ssn_attempts/{auto}` for every notification we accept (one row
// per notification, not per processing attempt — idempotency is handled
// upstream by `processed_apple_ssn`).
// ───────────────────────────────────────────────────────────────────────────

export function buildAppleSsnAuditRow(args: {
  payload: AppleSsnPayload;
  result: ApplyAppleEntitlementResult;
  verifiedChain: boolean;
  receivedAt?: Date;
}): Record<string, any> {
  const { payload, result, verifiedChain } = args;
  return {
    notificationUUID: payload.notificationUUID,
    notificationType: payload.notificationType,
    subtype: payload.subtype ?? null,
    productId: payload.transactionInfo?.productId ?? null,
    originalTransactionId:
      payload.transactionInfo?.originalTransactionId ?? null,
    appAccountTokenPresent: Boolean(payload.transactionInfo?.appAccountToken),
    action: result.action,
    // Only a grant carries a purchased cycle (mirrors the subscription write);
    // revoke/expire have no meaningful cycle → null, so the audit is honest.
    cycle:
      result.action === 'grant'
        ? cycleFromProductId(payload.transactionInfo?.productId)
        : null,
    matchedUserId: result.userId,
    appliedStatus: result.applied?.status ?? null,
    expiryDate: result.applied?.expiryDate ?? null,
    // verified_chain — flagged false until the full Apple Root G3
    // verifier ships. Ops searches `verified_chain == false` to spot
    // any spike (would suggest cert-rotation breakage during the
    // follow-up window).
    verified_chain: verifiedChain,
    receivedAt: (args.receivedAt ?? new Date()).toISOString(),
  };
}
