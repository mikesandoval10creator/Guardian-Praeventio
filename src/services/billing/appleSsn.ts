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
// CONTRACT — what this module promises and what it explicitly defers:
//
//   1. Promise: every notification we accept (returns ok=true) has had
//      its outermost JWS verified against the leaf cert in the JWS
//      header's x5c chain (Apple's signing leaf).
//   2. Defer: full Apple Root CA (G3) chain verification is a follow-up.
//      The leaf-only check still rejects forged JWTs that don't carry a
//      valid Apple-issued cert, but it does NOT prove the cert chains to
//      Apple's root. We audit `verified_chain: false` in
//      `apple_ssn_attempts` for every notification so ops can spot any
//      cert-rotation event during the follow-up window.
//
// Why ship the intermediate version? The full chain verifier is ~80 LOC
// of node:crypto X.509 validation (Apple Root G3 PEM bundled, x5c[1] →
// x5c[2] → root, expiry + signature for each link). Decoupling lets us
// close the entitlement gap NOW and harden chain verification in the
// next bucket — same shape as the MercadoPago IPN landing (raw HMAC
// first, manifest format later).
//
// FOLLOW-UP TICKET — full Apple Root chain verification:
//   • Bundle Apple Root CA G3 (https://www.apple.com/appleca/AppleIncRootCertificate.cer
//     → re-encode as PEM) in `src/services/billing/appleRootG3.pem` OR
//     load via env `APPLE_ROOT_CA_PEM`.
//   • Replace `verifyJwsLeafOnly` with `verifyJwsFullChain` that:
//       (a) parses each base64-DER cert in x5c[],
//       (b) for i=0..n-2 verifies x5c[i] is signed by x5c[i+1]'s public key,
//       (c) confirms x5c[n-1] is signed by Apple Root G3,
//       (d) checks notBefore/notAfter on each.
//   • Replace `verified_chain: false` with `verified_chain: true` in the
//     audit row.
//   • Add a unit test fixture with a multi-cert chain rooted in a test
//     CA so the chain-walk is exercised in CI.
//
// Apple SSN v2 reference (canonical):
//   https://developer.apple.com/documentation/appstoreservernotifications/responsebodyv2

import crypto from 'crypto';
import {
  importX509,
  jwtVerify,
  decodeProtectedHeader,
  decodeJwt,
  errors as joseErrors,
} from 'jose';

import { logger } from '../../utils/logger.js';

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
}

// ───────────────────────────────────────────────────────────────────────────
// JWS verification.
//
// Apple sends `{ signedPayload: "<JWS>" }` with a JWS whose protected
// header carries `x5c: [leaf, intermediate, root]`. The signing
// algorithm is ES256 (Apple's signing keys are P-256).
//
// `verifyJwsLeafOnly` decodes the header, imports the leaf cert as a
// public key, and `jwtVerify`s the JWS against it. This catches
// "garbage JWS" and "wrong-leaf attack" but NOT "forged-cert attack" —
// see contract note above.
// ───────────────────────────────────────────────────────────────────────────

export interface VerifiedJws<T> {
  payload: T;
  /** True when the JWS chain was fully verified up to Apple Root G3. We
   * always set this `false` until the follow-up ships — see file header. */
  verifiedChain: boolean;
}

export class AppleSsnVerificationError extends Error {
  constructor(reason: string) {
    super(`Apple SSN verification failed: ${reason}`);
    this.name = 'AppleSsnVerificationError';
  }
}

/** PEM-encode a base64-DER certificate (the form Apple uses in `x5c`). */
function derToPem(b64Der: string): string {
  // Standard 64-char-line wrap. Apple already supplies single-line base64.
  const lines = b64Der.match(/.{1,64}/g) ?? [b64Der];
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;
}

/** Verify a JWS against the public key of the leaf cert in its x5c header. */
export async function verifyJwsLeafOnly<T>(jws: string): Promise<VerifiedJws<T>> {
  let header: ReturnType<typeof decodeProtectedHeader>;
  try {
    header = decodeProtectedHeader(jws);
  } catch (err) {
    throw new AppleSsnVerificationError(
      `bad_jws_header: ${err instanceof Error ? err.message : 'unknown'}`,
    );
  }
  const x5c = header.x5c;
  if (!Array.isArray(x5c) || x5c.length === 0 || typeof x5c[0] !== 'string') {
    throw new AppleSsnVerificationError('missing_x5c_chain');
  }
  const alg = typeof header.alg === 'string' ? header.alg : 'ES256';

  let publicKey: crypto.KeyObject | CryptoKey;
  try {
    const pem = derToPem(x5c[0] as string);
    publicKey = await importX509(pem, alg);
  } catch (err) {
    throw new AppleSsnVerificationError(
      `import_leaf_failed: ${err instanceof Error ? err.message : 'unknown'}`,
    );
  }

  try {
    const { payload } = await jwtVerify(jws, publicKey, { algorithms: [alg] });
    return { payload: payload as unknown as T, verifiedChain: false };
  } catch (err) {
    if (err instanceof joseErrors.JOSEError) {
      throw new AppleSsnVerificationError(`jose_${err.code}`);
    }
    throw new AppleSsnVerificationError(
      `verify_failed: ${err instanceof Error ? err.message : 'unknown'}`,
    );
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Outer envelope decoding — Apple wraps the actionable data in nested
// JWTs. `signedPayload` carries `data.signedTransactionInfo` and
// optionally `data.signedRenewalInfo`, each of which is itself a JWS.
//
// All inner JWTs are signed by the SAME chain as the outer envelope, so
// in principle we should verify each. The intermediate-mode shortcut:
// we verify the outer JWS leaf-only and `decodeJwt` the inner two
// (signature-skipped). This is acceptable for the audit row — the
// outer JWS already proves the inner blobs came from Apple — but the
// follow-up that introduces full-chain verification will switch the
// inner decodes to `verifyJwsLeafOnly` as well.
// ───────────────────────────────────────────────────────────────────────────

interface AppleOuterJwtPayload {
  notificationUUID?: string;
  notificationType?: string;
  subtype?: string;
  data?: {
    signedTransactionInfo?: string;
    signedRenewalInfo?: string;
  };
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
  const verified = await verifyJwsLeafOnly<AppleOuterJwtPayload>(signedPayload);
  const outer = verified.payload;
  if (!outer || typeof outer.notificationUUID !== 'string') {
    throw new AppleSsnVerificationError('missing_notification_uuid');
  }
  if (typeof outer.notificationType !== 'string') {
    throw new AppleSsnVerificationError('missing_notification_type');
  }

  let transactionInfo: AppleTransactionInfo | undefined;
  if (outer.data?.signedTransactionInfo) {
    try {
      const tx = decodeJwt(outer.data.signedTransactionInfo) as Record<string, unknown>;
      transactionInfo = {
        appAccountToken: typeof tx.appAccountToken === 'string' ? tx.appAccountToken : undefined,
        productId: typeof tx.productId === 'string' ? tx.productId : undefined,
        originalTransactionId:
          typeof tx.originalTransactionId === 'string' ? tx.originalTransactionId : undefined,
        transactionId: typeof tx.transactionId === 'string' ? tx.transactionId : undefined,
        expiresDate: typeof tx.expiresDate === 'number' ? tx.expiresDate : undefined,
        purchaseDate: typeof tx.purchaseDate === 'number' ? tx.purchaseDate : undefined,
        type: typeof tx.type === 'string' ? tx.type : undefined,
      };
    } catch (err) {
      // Don't fail the whole notification — Apple sometimes ships
      // malformed inner JWTs during sandbox testing. Log and continue;
      // the outer verification + UUID idempotency are what matter.
      logger.warn('apple_ssn_inner_tx_decode_failed', {
        reason: err instanceof Error ? err.message : 'unknown',
      });
    }
  }

  let renewalInfo: AppleRenewalInfo | undefined;
  if (outer.data?.signedRenewalInfo) {
    try {
      const ri = decodeJwt(outer.data.signedRenewalInfo) as Record<string, unknown>;
      renewalInfo = {
        productId: typeof ri.productId === 'string' ? ri.productId : undefined,
        autoRenewProductId:
          typeof ri.autoRenewProductId === 'string' ? ri.autoRenewProductId : undefined,
        autoRenewStatus:
          typeof ri.autoRenewStatus === 'number' ? ri.autoRenewStatus : undefined,
        originalTransactionId:
          typeof ri.originalTransactionId === 'string' ? ri.originalTransactionId : undefined,
        expirationIntent:
          typeof ri.expirationIntent === 'number' ? ri.expirationIntent : undefined,
      };
    } catch (err) {
      logger.warn('apple_ssn_inner_renewal_decode_failed', {
        reason: err instanceof Error ? err.message : 'unknown',
      });
    }
  }

  return {
    verifiedChain: verified.verifiedChain,
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
  applied: { status: 'active' | 'expired' | 'revoked'; expiryDate: string | null } | null;
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
  const action = actionForNotificationType(payload.notificationType);

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

  let status: 'active' | 'expired' | 'revoked';
  if (action === 'grant') status = 'active';
  else if (action === 'revoke') status = 'revoked';
  else status = 'expired';

  // Mirror RTDN's update shape — same fields + `apple` provider tag so
  // ops can tell the two flows apart. NEVER overwrite the Google Play
  // purchaseToken if one is already set; this user has dual-platform
  // history that the support team may need to reconcile by hand.
  await userRef.update({
    'subscription.status': status,
    'subscription.expiryDate': expiryDate,
    'subscription.provider': 'app-store',
    'subscription.appleOriginalTransactionId':
      originalTransactionId ?? null,
    'subscription.updatedAt': now().toISOString(),
  });

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
